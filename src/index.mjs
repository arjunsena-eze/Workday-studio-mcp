import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from './config.mjs';

import { register as registerListProjects } from './tools/list-projects.mjs';
import { register as registerListFiles } from './tools/list-files.mjs';
import { register as registerReadFile } from './tools/read-file.mjs';
import { register as registerWriteFile } from './tools/write-file.mjs';
import { register as registerSearchFiles } from './tools/search-files.mjs';
import { register as registerWorkspaceTree } from './tools/workspace-tree.mjs';
import { register as registerValidateXml } from './tools/validate-xml.mjs';
import { register as registerCreateProject } from './tools/create-project.mjs';
import { register as registerListAssemblySteps } from './tools/list-assembly-steps.mjs';
import { register as registerListIntegrationParams } from './tools/list-integration-params.mjs';
import { register as registerAddAssemblyStep } from './tools/add-assembly-step.mjs';
import { register as registerCreateXslTransform } from './tools/create-xsl-transform.mjs';
import { register as registerCopyFileFromProject } from './tools/copy-file-from-project.mjs';
import { register as registerRenameFile } from './tools/rename-file.mjs';
import { register as registerDeleteFile } from './tools/delete-file.mjs';
import { register as registerGetStepTypeReference } from './tools/get-step-type-reference.mjs';
import { register as registerLookupSoapOperations } from './tools/lookup-soap-operations.mjs';
import { register as registerPlanIntegration } from './tools/plan-integration.mjs';
import { register as registerUpdateSubFlow } from './tools/update-sub-flow.mjs';
import { register as registerValidateAssembly } from './tools/validate-assembly.mjs';
import { register as registerParseServerLog } from './tools/parse-server-log.mjs';
import { register as registerLogLearning } from './tools/log-learning.mjs';
import { register as registerSearchLearnings } from './tools/search-learnings.mjs';
import { register as registerRenameSteps } from './tools/rename-steps.mjs';
import { register as registerDeleteAssemblyStep } from './tools/delete-assembly-step.mjs';
import { register as registerGetPatterns } from './tools/get-patterns.mjs';
import { register as registerGetWorkflow } from './tools/get-workflow.mjs';

const server = new McpServer({
  name: 'studio-file-mcp',
  version: '1.7.0',
});

// File navigation
registerListProjects(server);
registerListFiles(server);
registerReadFile(server);
registerWriteFile(server);
registerSearchFiles(server);
registerWorkspaceTree(server);
registerValidateXml(server);

// Project & file management
registerCreateProject(server);
registerCreateXslTransform(server);
registerCopyFileFromProject(server);
registerRenameFile(server);
registerDeleteFile(server);

// Assembly operations
registerListAssemblySteps(server);
registerListIntegrationParams(server);
registerAddAssemblyStep(server);

// Reference
registerGetStepTypeReference(server);
registerLookupSoapOperations(server);
registerGetPatterns(server);

// Planning (call this before any assembly XML work)
registerPlanIntegration(server);

// Lifecycle — where an integration stands and what to do next
registerGetWorkflow(server);

// Assembly editing
registerUpdateSubFlow(server);
registerValidateAssembly(server);
registerRenameSteps(server);
registerDeleteAssemblyStep(server);

// Diagnostics (parses local log files only — no network calls)
registerParseServerLog(server);

// Knowledge capture — Claude calls this automatically when it discovers something new
registerLogLearning(server);
registerSearchLearnings(server);

// ----------------------------------------------------------------------------
// Optional local extensions (gitignored, never part of the public distribution).
//
// The public MCP is purely local file-ops. If a user wants tenant-connecting
// tools (SOAP launch / poll / fetch document URL etc.) they can drop a
// `src/local-extensions.mjs` file that exports `registerLocalTools(server)`.
// That file is gitignored — it stays on the user's machine.
// ----------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const localExtPath = join(__dirname, 'local-extensions.mjs');
let localExtensionCount = 0;
if (existsSync(localExtPath)) {
  try {
    const localExt = await import('./local-extensions.mjs');
    if (typeof localExt.registerLocalTools === 'function') {
      localExtensionCount = localExt.registerLocalTools(server) ?? 0;
    }
  } catch (e) {
    process.stderr.write(`[studio-mcp] WARN: local-extensions.mjs failed to load: ${e.message}\n`);
  }
}

const transport = new StdioServerTransport();
await server.connect(transport);

const extSuffix = localExtensionCount > 0
  ? ` (+${localExtensionCount} local extension${localExtensionCount === 1 ? '' : 's'})`
  : '';
process.stderr.write(`[studio-mcp] Server started. Workspace: ${config.workspacePath}${extSuffix}\n`);
