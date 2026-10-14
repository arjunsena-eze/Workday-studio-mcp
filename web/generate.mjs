// ─────────────────────────────────────────────────────────────────────────────
// Generation orchestrator for the web front end.
//
// This is the whole Phase 1 pipeline, in-process and LLM-free:
//
//   design brief  →  deriveSubFlows()      (rules, this repo's web/ layer)
//                 →  createProjectScaffold (Eclipse/Studio project skeleton)
//                 →  buildAssemblyXml      ← the MCP's own generators, reused
//                 →  buildDiagramXml       ← verbatim, so the web UI and the
//                 →  buildPlanDocument     ← MCP can never drift apart
//                 →  writeAidlcDocs        (plan.md + state for progress views)
//                 →  validateAssembly      (hard gate — no download if ERRORs)
//
// Nothing here reimplements assembly generation. If a Studio rule changes in
// the MCP, this pipeline picks it up for free.
// ─────────────────────────────────────────────────────────────────────────────

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

import { config } from '../src/config.mjs';
import { resolveSafe } from '../src/fs.mjs';
import { validateAssembly } from '../src/assembly-validator.mjs';
import { writeAidlcDocs, AIDLC_DIR } from '../src/aidlc-docs.mjs';
import { createProjectScaffold } from '../src/tools/create-project.mjs';
import {
  DesignBriefSchema,
  buildAssemblyXml,
  buildDiagramXml,
  buildPlanDocument,
} from '../src/tools/plan-integration.mjs';

import { deriveSubFlows } from './derive-subflows.mjs';

export class GenerateError extends Error {
  constructor(code, message, suggestion) {
    super(message);
    this.code = code;
    this.suggestion = suggestion;
  }
}

/** Studio project folder names: letters, digits, underscore. Nothing path-like. */
const PROJECT_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{2,63}$/;

/** The design-brief field list, derived from the zod schema so the form cannot drift. */
export function briefSchemaShape() {
  const shape = DesignBriefSchema.shape;
  const out = {};
  for (const [key, def] of Object.entries(shape)) {
    out[key] = describeZod(def);
  }
  return out;
}

/**
 * Reduce a zod node to the minimum the browser needs to render a control.
 * Only the shapes DesignBriefSchema actually uses are handled — enum, array of
 * enum, array of object, string, boolean — and unwrapping for .optional().
 */
function describeZod(def) {
  const description = def.description ?? null;
  const inner = def._def?.innerType ?? null;
  const typeName = def._def?.typeName;

  if (typeName === 'ZodOptional' || typeName === 'ZodDefault') {
    return { ...describeZod(inner ?? def._def.type), optional: true, description: description ?? undefined };
  }
  if (typeName === 'ZodEnum') {
    return { kind: 'enum', options: def._def.values, optional: false, description };
  }
  if (typeName === 'ZodArray') {
    const el = def._def.type;
    if (el._def?.typeName === 'ZodEnum') {
      return { kind: 'multi-enum', options: el._def.values, optional: false, description };
    }
    if (el._def?.typeName === 'ZodObject') {
      const fields = {};
      for (const [k, v] of Object.entries(el.shape)) fields[k] = describeZod(v);
      return { kind: 'object-list', fields, optional: false, description };
    }
    return { kind: 'string-list', optional: false, description };
  }
  if (typeName === 'ZodBoolean') return { kind: 'boolean', optional: false, description };
  return { kind: 'string', optional: false, description };
}

/**
 * Run the full pipeline.
 * @param {string} projectName
 * @param {object} rawBrief   unvalidated design brief from the browser
 * @returns {Promise<object>} generation result, including the validation verdict
 */
export async function generateProject(projectName, rawBrief) {
  if (!PROJECT_NAME_RE.test(projectName ?? '')) {
    throw new GenerateError(
      'INVALID_PROJECT_NAME',
      `"${projectName}" is not a usable Studio project name.`,
      'Use letters, digits and underscores only, 3–64 characters, starting with a letter — e.g. INT145_Worker_Export.',
    );
  }

  // Parse through the MCP's own schema so the web form and the MCP tool accept
  // exactly the same briefs. Surface zod's field paths straight to the UI.
  const parsed = DesignBriefSchema.safeParse(rawBrief);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => ({
      field: i.path.join('.') || '(root)',
      message: i.message,
    }));
    throw new GenerateError('INVALID_BRIEF', 'The design brief is incomplete or invalid.', issues);
  }
  const brief = parsed.data;

  // Cross-field checks the enum schema cannot express on its own.
  const consistency = checkBriefConsistency(brief);
  if (consistency.length) {
    throw new GenerateError('INCONSISTENT_BRIEF', 'The design brief contradicts itself.', consistency);
  }

  let projectPath;
  try {
    projectPath = resolveSafe(projectName, '').projectRoot;
  } catch {
    throw new GenerateError(
      'UNSAFE_PROJECT_NAME',
      `"${projectName}" resolves outside the configured workspace.`,
      `Workspace is ${config.workspacePath}.`,
    );
  }

  // Never overwrite an existing project — a Studio project holds hand-written
  // MVEL and XSL that no regeneration can reconstruct.
  if (existsSync(projectPath)) {
    throw new GenerateError(
      'PROJECT_EXISTS',
      `Project "${projectName}" already exists at ${projectPath}.`,
      'Pick a different name, or delete/rename the existing folder first. The generator will not overwrite it.',
    );
  }

  const { sub_flows, notes } = deriveSubFlows(brief);

  await createProjectScaffold(projectPath, projectName);

  const wsDir = join(projectPath, 'ws', 'WSAR-INF');
  const assemblyXml = buildAssemblyXml(projectName, sub_flows, brief);
  const diagramXml  = buildDiagramXml(projectName, sub_flows);
  const plan        = buildPlanDocument(projectName, sub_flows, brief);

  const { writeFile } = await import('fs/promises');
  await writeFile(join(wsDir, 'assembly.xml'),         assemblyXml, 'utf-8');
  await writeFile(join(wsDir, 'assembly-diagram.xml'), diagramXml,  'utf-8');

  const filesWritten = ['ws/WSAR-INF/assembly.xml', 'ws/WSAR-INF/assembly-diagram.xml'];
  let docsWarning = null;
  try {
    filesWritten.push(...await writeAidlcDocs(projectPath, plan));
  } catch (e) {
    docsWarning = `Assembly files were written, but ${AIDLC_DIR}/ could not be saved: ${e.message}`;
  }

  // The gate. Read back from disk rather than trusting the in-memory strings —
  // this validates what Studio will actually open.
  const verdict = await validateProject(projectName);

  return {
    project: projectName,
    project_path: projectPath,
    sub_flows,
    derivation_notes: notes,
    files_written: filesWritten,
    ...(docsWarning ? { warning: docsWarning } : {}),
    validation: verdict,
    downloadable: verdict.errors === 0,
    plan,
  };
}

/** Re-run the validation gate against a project already on disk. */
export async function validateProject(projectName) {
  if (!PROJECT_NAME_RE.test(projectName ?? '')) {
    throw new GenerateError('INVALID_PROJECT_NAME', `"${projectName}" is not a usable project name.`);
  }
  const projectPath = resolveSafe(projectName, '').projectRoot;
  const wsDir        = join(projectPath, 'ws', 'WSAR-INF');
  const assemblyPath = join(wsDir, 'assembly.xml');

  if (!existsSync(assemblyPath)) {
    throw new GenerateError('FILE_NOT_FOUND', `assembly.xml not found in "${projectName}".`);
  }

  const xml         = await readFile(assemblyPath, 'utf-8');
  const diagramPath = join(wsDir, 'assembly-diagram.xml');
  const diagramXml  = existsSync(diagramPath) ? await readFile(diagramPath, 'utf-8') : null;

  const issues = validateAssembly(xml, wsDir, diagramXml);
  return {
    valid:    issues.filter(i => i.severity === 'ERROR').length === 0,
    errors:   issues.filter(i => i.severity === 'ERROR').length,
    warnings: issues.filter(i => i.severity === 'WARNING').length,
    info:     issues.filter(i => i.severity === 'INFO').length,
    issues,
  };
}

/**
 * Cross-field brief checks. These catch the briefs that parse cleanly but
 * describe an integration that cannot be built — better to say so at the form
 * than to emit a skeleton that is quietly missing its data source.
 */
function checkBriefConsistency(brief) {
  const problems = [];
  const reports = brief.raas_reports ?? [];
  const soapOps = brief.soap_operations ?? [];

  if (brief.data_source === 'raas' && reports.length === 0) {
    problems.push({ field: 'raas_reports', message: 'data_source is "raas" — add at least one report alias.' });
  }
  if (brief.data_source === 'soap-get' && !soapOps.some(o => o.direction === 'get')) {
    problems.push({ field: 'soap_operations', message: 'data_source is "soap-get" — add at least one operation with direction "get".' });
  }
  if (brief.data_destination === 'workday-soap-write' && !soapOps.some(o => o.direction === 'write')) {
    problems.push({ field: 'soap_operations', message: 'data_destination is "workday-soap-write" — add at least one operation with direction "write".' });
  }
  if (brief.data_source === 'multiple' && reports.length === 0 && soapOps.length === 0) {
    problems.push({ field: 'data_source', message: 'data_source is "multiple" but no reports or SOAP operations were listed.' });
  }
  if (!(brief.error_handling ?? []).includes('integration-messages')) {
    problems.push({ field: 'error_handling', message: '"integration-messages" is the minimum for any integration — include it.' });
  }
  if (brief.trigger === 'inbound-file' && brief.data_source !== 'inbound-file' && brief.data_source !== 'multiple') {
    problems.push({ field: 'trigger', message: 'trigger is "inbound-file" but data_source is not — a file-triggered integration reads that file.' });
  }
  if ((brief.external_auth ?? 'none') === 'none'
      && ['external-rest'].includes(brief.data_destination)) {
    problems.push({ field: 'external_auth', message: 'The destination is an external REST API — pick the auth scheme it requires.' });
  }
  return problems;
}
