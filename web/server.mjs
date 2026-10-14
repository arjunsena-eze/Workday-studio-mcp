// ─────────────────────────────────────────────────────────────────────────────
// Local web front end for the Studio integration generator.
//
//   npm run web        →  http://127.0.0.1:4321
//
// Deliberately dependency-free (node:http + static files) and bound to
// loopback only. This writes real Studio projects into the configured
// workspace, so it is not something to expose on a network interface.
// ─────────────────────────────────────────────────────────────────────────────

import { createServer } from 'node:http';
import { readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../src/config.mjs';
import { listProjects, resolveSafe } from '../src/fs.mjs';
import { generateProject, validateProject, briefSchemaShape, GenerateError } from './generate.mjs';

const execFileAsync = promisify(execFile);

const PORT   = Number(process.env.STUDIOGEN_PORT ?? 4321);
const HOST   = '127.0.0.1';
const PUBLIC = join(fileURLToPath(new URL('.', import.meta.url)), 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function readJsonBody(req, limitBytes = 1_000_000) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) throw new GenerateError('BODY_TOO_LARGE', 'Request body exceeds 1 MB.');
    chunks.push(chunk);
  }
  if (!total) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch (e) {
    throw new GenerateError('MALFORMED_JSON', `Request body is not valid JSON: ${e.message}`);
  }
}

/** Serve a file from web/public, refusing anything that escapes that directory. */
async function serveStatic(urlPath, res) {
  const rel = normalize(urlPath === '/' ? '/index.html' : urlPath).replace(/^([/\\])+/, '');
  const abs = resolve(PUBLIC, rel);
  if (abs !== PUBLIC && !abs.startsWith(PUBLIC + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const info = await stat(abs);
    if (!info.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'Content-Type': MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
    });
    createReadStream(abs).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

/**
 * Zip a generated project for Eclipse import.
 * Uses PowerShell's Compress-Archive rather than adding a zip dependency —
 * this front end is Windows-local by design. -LiteralPath keeps workspace
 * paths containing spaces or brackets intact.
 */
async function zipProject(projectName) {
  const { projectRoot } = resolveSafe(projectName, '');
  if (!existsSync(projectRoot)) {
    throw new GenerateError('PROJECT_NOT_FOUND', `Project "${projectName}" does not exist.`);
  }
  const dir = await mkdtemp(join(tmpdir(), 'studiogen-'));
  const zipPath = join(dir, `${projectName}.zip`);
  const ps = [
    '-NoProfile', '-NonInteractive', '-Command',
    'Compress-Archive -LiteralPath $env:SG_SRC -DestinationPath $env:SG_DEST -Force',
  ];
  try {
    await execFileAsync('powershell.exe', ps, {
      env: { ...process.env, SG_SRC: projectRoot, SG_DEST: zipPath },
      windowsHide: true,
      timeout: 120_000,
    });
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw new GenerateError('ZIP_FAILED', `Could not create the zip: ${e.message}`);
  }
  return { zipPath, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// ─── routes ──────────────────────────────────────────────────────────────────

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  switch (route) {
    // The form's field definitions come straight from the MCP's zod schema, so
    // the UI cannot drift from what plan_integration accepts.
    case 'GET /api/schema':
      return sendJson(res, 200, {
        workspace: config.workspacePath,
        active_workspace: config.activeWorkspace,
        fields: briefSchemaShape(),
      });

    case 'GET /api/projects':
      return sendJson(res, 200, { projects: await listProjects() });

    case 'POST /api/generate': {
      const body = await readJsonBody(req);
      const result = await generateProject(body.project_name, body.design_brief ?? {});
      return sendJson(res, 200, result);
    }

    case 'POST /api/validate': {
      const body = await readJsonBody(req);
      return sendJson(res, 200, await validateProject(body.project_name));
    }

    case 'GET /api/download': {
      const projectName = url.searchParams.get('project');

      // The gate: a project with validation ERRORs is never handed out. This is
      // the whole point of the pipeline — refuse to ship what we cannot verify.
      const verdict = await validateProject(projectName);
      if (verdict.errors > 0) {
        return sendJson(res, 409, {
          error: 'VALIDATION_FAILED',
          message: `"${projectName}" has ${verdict.errors} validation error(s) — download refused.`,
          validation: verdict,
        });
      }

      const { zipPath, cleanup } = await zipProject(projectName);
      const info = await stat(zipPath);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': info.size,
        'Content-Disposition': `attachment; filename="${projectName}.zip"`,
      });
      const stream = createReadStream(zipPath);
      stream.pipe(res);
      stream.on('close', cleanup);
      stream.on('error', cleanup);
      return undefined;
    }

    default:
      return sendJson(res, 404, { error: 'NOT_FOUND', message: `No route for ${route}` });
  }
}

// ─── server ──────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await serveStatic(url.pathname, res);
  } catch (e) {
    if (e instanceof GenerateError) {
      const status = e.code === 'PROJECT_EXISTS' ? 409
                   : e.code.startsWith('INVALID') || e.code.startsWith('INCONSISTENT') || e.code === 'MALFORMED_JSON' ? 400
                   : e.code.endsWith('NOT_FOUND') ? 404
                   : 500;
      return sendJson(res, status, { error: e.code, message: e.message, detail: e.suggestion ?? null });
    }
    process.stderr.write(`[studiogen] unhandled: ${e.stack ?? e.message}\n`);
    return sendJson(res, 500, { error: 'INTERNAL', message: e.message });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(
    `\n  Studio integration generator\n` +
    `  ────────────────────────────\n` +
    `  URL:       http://${HOST}:${PORT}\n` +
    `  Workspace: ${config.workspacePath} [${config.activeWorkspace}]\n\n` +
    `  Generated projects are written straight into that workspace.\n` +
    `  Ctrl+C to stop.\n\n`,
  );
});
