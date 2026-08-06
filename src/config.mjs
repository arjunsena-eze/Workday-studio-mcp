import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config as loadDotenv } from 'dotenv';

loadDotenv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '..', 'config.json');

/**
 * Workspace resolution supports named profiles so one clone can serve several
 * engagements — your own workspace, plus a client's project dropped in for a
 * fix — without editing paths between jobs.
 *
 * Precedence (first match wins):
 *   1. STUDIO_WORKSPACE_PATH   — explicit path, overrides everything
 *   2. STUDIO_WORKSPACE        — profile name, resolved against config.workspaces
 *   3. config.active_workspace — profile name
 *   4. config.workspace_path   — legacy single-workspace form (still supported)
 *   5. config.workspaces.default
 */
function loadConfig() {
  let file = {};
  if (existsSync(CONFIG_PATH)) {
    file = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  }

  const profiles = {};
  for (const [name, path] of Object.entries(file.workspaces ?? {})) {
    if (typeof path === 'string' && path.trim()) profiles[name] = path;
  }
  // Fold the legacy single-workspace key in as a profile so both forms coexist.
  if (file.workspace_path && !profiles.default) profiles.default = file.workspace_path;

  const envPath = process.env.STUDIO_WORKSPACE_PATH;
  const envProfile = process.env.STUDIO_WORKSPACE;

  let activeName;
  let workspacePath;

  if (envPath) {
    activeName = '(STUDIO_WORKSPACE_PATH)';
    workspacePath = envPath;
  } else {
    const wanted = envProfile || file.active_workspace || 'default';
    if (!profiles[wanted]) {
      const known = Object.keys(profiles);
      fail(
        `Workspace profile '${wanted}' is not defined.`,
        known.length
          ? `Known profiles: ${known.join(', ')}. Set "active_workspace" in config.json, or STUDIO_WORKSPACE=<name>.`
          : 'Define "workspaces": { "default": "<path>" } in config.json, or set STUDIO_WORKSPACE_PATH.',
      );
    }
    activeName = wanted;
    workspacePath = profiles[wanted];
  }

  if (!existsSync(workspacePath)) {
    fail(
      `Workspace path does not exist: ${workspacePath}`,
      `(profile '${activeName}') Check the path, or select another profile with STUDIO_WORKSPACE=<name>.`,
    );
  }

  const resolvedProfiles = {};
  for (const [name, path] of Object.entries(profiles)) {
    resolvedProfiles[name] = { path: resolve(path), exists: existsSync(path) };
  }

  return {
    // Mutable at runtime via setActiveWorkspace — every tool reads this live.
    workspacePath: resolve(workspacePath),
    activeWorkspace: activeName,
    workspaces: resolvedProfiles,
    maxFileSizeKb: file.max_file_size_kb ?? 500,
    backupOnWrite: file.backup_on_write ?? true,
    excludedDirs: new Set(file.excluded_dirs ?? ['.git', '.settings', 'bin', 'build', 'node_modules', '.metadata', '.plugins']),
    excludedExtensions: new Set(file.excluded_extensions ?? ['.class', '.jar', '.zip', '.bak']),
  };
}

function fail(message, suggestion) {
  process.stderr.write(`[studio-mcp] ERROR: ${message}\n`);
  if (suggestion) process.stderr.write(`[studio-mcp]        ${suggestion}\n`);
  process.exit(1);
}

export const config = loadConfig();

/**
 * Switch the active workspace for the remainder of this server process.
 *
 * Deliberately explicit: every read and write tool resolves against
 * config.workspacePath, so a silent or accidental switch would send edits into
 * the wrong client's project. Callers must name a profile that already exists in
 * config.json — this cannot invent a path.
 */
export function setActiveWorkspace(name) {
  const entry = config.workspaces[name];
  if (!entry) {
    return {
      ok: false,
      error: `Unknown workspace profile '${name}'.`,
      known: Object.keys(config.workspaces),
    };
  }
  if (!entry.exists) {
    return { ok: false, error: `Profile '${name}' points at a path that does not exist: ${entry.path}` };
  }
  const previous = config.activeWorkspace;
  config.workspacePath = entry.path;
  config.activeWorkspace = name;
  process.stderr.write(`[studio-mcp] active workspace: ${previous} -> ${name} (${entry.path})\n`);
  return { ok: true, previous, active: name, path: entry.path };
}
