import { z } from 'zod';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { resolveSafe } from '../fs.mjs';
import { writeAidlcDocs, AIDLC_DIR } from '../aidlc-docs.mjs';

// ─── Design brief schema ──────────────────────────────────────────────────────

export const DesignBriefSchema = z.object({
  data_source: z.enum(['raas', 'soap-get', 'inbound-file', 'webhook', 'external-rest', 'multiple'])
    .describe('raas=Workday custom report; soap-get=Workday SOAP Get_*; inbound-file=user uploads a file; webhook=Workday event listener; external-rest=third-party API GET; multiple=more than one type'),

  data_destination: z.enum(['workday-soap-write', 'workday-rest-write', 'external-rest', 'file-delivery', 'email-only', 'multiple'])
    .describe('workday-soap-write=SOAP Put_*/Change_*/Hire_*; workday-rest-write=Workday REST custom objects; external-rest=third-party API; file-delivery=output file; email-only=send email'),

  trigger: z.enum(['scheduled', 'event-driven', 'launch-params-manual', 'inbound-file'])
    .describe('scheduled=Workday scheduler; event-driven=Workday business event (hire/terminate/etc); launch-params-manual=manually launched; inbound-file=triggered by file upload'),

  record_volume: z.enum(['single', 'small', 'large'])
    .describe('single=always 1 record (no splitter needed); small=under 100 records (xpath-splitter ok); large=over 100 records (MUST use xml-stream-splitter)'),

  external_auth: z.enum(['none', 'oauth2', 'basic', 'api-key']).optional()
    .describe('none=no external system; oauth2=token refresh flow; basic=username+password; api-key=static API key'),

  error_handling: z.array(z.enum(['integration-messages', 'email-notification', 'rethrow']))
    .describe('integration-messages=always minimum; email-notification=send on failure (adds Email sub-flow); rethrow=stop integration on error'),

  raas_reports: z.array(z.object({
    alias: z.string().describe('Alias name for cloud:report-alias name= attribute — must match exactly'),
    description: z.string().describe('What data this report returns'),
    filter_params: z.array(z.string()).optional()
      .describe('Prompt filter params e.g. ["Worker!WID", "Effective_Date", "format=simplexml"]'),
    has_reference_wid: z.boolean().optional()
      .describe('True if the report WID is known — enables cloud:report-reference binding'),
  })).optional().describe('Required when data_source is raas or multiple. One entry per RAAS report.'),

  soap_operations: z.array(z.object({
    application: z.string().describe('Workday module e.g. Human_Resources, Staffing, Talent'),
    operation: z.string().describe('SOAP operation e.g. Get_Workers, Put_Applicant'),
    version: z.string().describe('API version e.g. 38.2'),
    direction: z.enum(['get', 'write']).describe('get=reading from Workday; write=updating Workday'),
  })).optional().describe('Required when SOAP is used for reading or writing.'),

  integration_attributes: z.array(z.object({
    name: z.string().describe('Attribute display name in Workday UI, e.g. "API URL", "Client Secret"'),
    is_password: z.boolean().optional().describe('True for secrets/keys (masked in Workday UI)'),
    required: z.boolean().optional().describe('True to require this field before launch'),
  })).optional().describe('Credentials and config stored in Workday integration system attributes.'),

  conditional_logic: z.string().optional()
    .describe('Free-text: any routing conditions, e.g. "route by worker type: Employee vs Contractor"'),

  notes: z.string().optional()
    .describe('Other design notes: rate limits, special namespaces, downstream dependencies'),
});

// ─── Public tool registration ─────────────────────────────────────────────────

export function register(server) {
  server.tool(
    'plan_integration',
    [
      '⚠️  DO NOT CALL THIS TOOL without first gathering ALL design decisions from the user.',
      '',
      'Design questions you MUST ask before calling:',
      '',
      '1. DATA SOURCE — How does data enter the integration?',
      '     raas          → Workday custom report (most common for scheduled/outbound)',
      '     soap-get      → Workday SOAP Get_* (when RAAS is not available)',
      '     inbound-file  → User uploads a file on the integration event',
      '     webhook       → Workday event listener fires (listener-service)',
      '     external-rest → Fetch data from a third-party REST API',
      '',
      '2. DATA DESTINATION — Where does processed data go?',
      '     workday-soap-write → Workday SOAP Put_*/Change_*/Hire_* etc.',
      '     workday-rest-write → Workday REST custom objects PUT/POST/DELETE',
      '     external-rest      → POST/PATCH to a third-party API',
      '     file-delivery      → Output file delivered on the integration event',
      '     email-only         → Send email notification (no system update)',
      '',
      '3. TRIGGER — What launches this integration?',
      '     scheduled             → Workday scheduler (daily, hourly, etc.)',
      '     event-driven          → Workday business event (hire, terminate, etc.)',
      '     launch-params-manual  → Manually launched, optional filter params',
      '     inbound-file          → Triggered by file upload on the integration event',
      '',
      '4. RECORD VOLUME — How many records does the integration process?',
      '     single → Always exactly 1 record (no splitter needed)',
      '     small  → Under 100 records (xpath-splitter loads all into memory)',
      '     large  → Over 100 records (MUST use xml-stream-splitter for streaming)',
      '',
      '5. EXTERNAL AUTH — What auth does the external system require?',
      '     none     → No external system involved',
      '     oauth2   → OAuth2 token refresh flow (adds GetToken sub-flow)',
      '     basic    → Username + password (Base64 encoded)',
      '     api-key  → Static API key',
      '',
      '6. ERROR HANDLING:',
      '     integration-messages  → Log to Workday event log (always minimum)',
      '     email-notification    → Send failure email (adds Email sub-flow)',
      '     rethrow               → Stop integration and propagate the error',
      '',
      '7. RAAS REPORTS (if data_source = raas or multiple):',
      '     For each report: alias name, what data it returns, any filter params.',
      '     Filter param syntax: "Worker!WID" for object refs, "Effective_Date" for text,',
      '     "format=simplexml" to strip wd: namespaces from response.',
      '     Example: alias="INT145_Get_Workers", filters=["Worker!WID", "format=simplexml"]',
      '',
      '8. SOAP OPERATIONS (if soap-get or workday-soap-write):',
      '     For each: application (e.g. Human_Resources), operation (e.g. Get_Workers), version.',
      '',
      '9. INTEGRATION ATTRIBUTES:',
      '     Any credentials or config stored in Workday? (API keys, URLs, OAuth credentials)',
      '     Note: oauth2/basic/api-key auth types auto-generate the standard attributes.',
      '',
      '10. CONDITIONAL LOGIC:',
      '     Any routing decisions? e.g. "employee vs contractor", "new hire vs rehire", "active only"',
      '',
      'Once you have all answers, call with project_name + sub_flows + design_brief.',
      'The tool writes assembly.xml + assembly-diagram.xml with correct declarations pre-populated.',
    ].join('\n'),
    {
      project_name: z.string()
        .describe('Existing project name (e.g. "INT145_My_Integration"). Must already exist in the workspace.'),
      sub_flows: z.array(z.object({
        id: z.string()
          .describe([
            'Sub-flow entry noun — becomes the cc:local-in id and vm:// endpoint name.',
            'Use PascalCase noun or NounNoun. No spaces, no underscores.',
            'Examples: LoadAttrs, AzureToken, GraphUsers, WDWorkers, GeneratePayload, LookupEmployee.',
            'The skeleton generates Call_{id} for the caller and Do{id} for the async-mediation stub.',
            'Rename Do{id} stubs to Verb+Object (e.g. PrepareAzureToken) using rename_steps before testing.',
          ].join(' ')),
        description: z.string().describe('One sentence: what this sub-flow produces'),
        reads_props: z.array(z.string()).optional(),
        writes_props: z.array(z.string()).optional(),
      })).min(1).describe('Ordered list of sub-flows. Order = execution order in the main flow chain.'),
      design_brief: DesignBriefSchema,
    },
    async ({ project_name, sub_flows, design_brief }) => {
      let projectPath;
      try {
        projectPath = resolveSafe(project_name, '').projectRoot;
      } catch {
        return errorResponse(
          'INVALID_PROJECT_NAME',
          `Invalid project name '${project_name}' — resolves outside the workspace.`,
          'project_name must be a folder inside the configured workspace, not a path containing ../ segments.',
        );
      }
      const wsDir = join(projectPath, 'ws', 'WSAR-INF');

      if (!existsSync(projectPath)) {
        return errorResponse(
          'PROJECT_NOT_FOUND',
          `Project '${project_name}' does not exist.`,
          'Run create_studio_project first, or check the project name with list_studio_projects.',
        );
      }

      const assemblyXml = buildAssemblyXml(project_name, sub_flows, design_brief);
      const diagramXml  = buildDiagramXml(project_name, sub_flows);
      const plan        = buildPlanDocument(project_name, sub_flows, design_brief);

      await writeFile(join(wsDir, 'assembly.xml'),         assemblyXml, 'utf-8');
      await writeFile(join(wsDir, 'assembly-diagram.xml'), diagramXml,  'utf-8');

      // Persist the plan so the design rationale outlives this conversation.
      // Never let a docs failure break a successful scaffold — report and move on.
      const filesWritten = ['ws/WSAR-INF/assembly.xml', 'ws/WSAR-INF/assembly-diagram.xml'];
      let docsWarning = null;
      try {
        filesWritten.push(...await writeAidlcDocs(projectPath, plan));
      } catch (e) {
        docsWarning = `assembly files were written, but ${AIDLC_DIR}/ could not be saved: ${e.message}`;
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            files_written: filesWritten,
            ...(docsWarning ? { warning: docsWarning } : {}),
            plan,
          }, null, 2),
        }],
      };
    },
  );
}

// ─── workday-in declaration generation ───────────────────────────────────────

// The children of cc:integration-system are an xsd:sequence in Studio's
// integration-system.xsd — the order below is MANDATORY, not stylistic:
//
//   param → attribute-map-service → sequence-generator-service →
//   transaction-log-service → delivery-service → retrieval-service →
//   report-service → listener-service → custom-object-service →
//   service-reference → data-initialization-service
//
// Emitting them in any other order fails Studio's schema validation on open
// with `cvc-complex-type.2.4.a`. Do not reorder these blocks for readability.
function buildWorkdayInDeclarations(projectName, designBrief) {
  const parts = [];

  // 1. Launch params (from RAAS filter params when trigger is manual)
  if (designBrief.trigger === 'launch-params-manual') {
    const paramStubs = buildLaunchParamStubs(designBrief.raas_reports ?? []);
    parts.push(...paramStubs);
  }

  // 2. Integration attributes (credentials + config)
  const attrs = resolveAttributes(designBrief);
  if (attrs.length > 0) {
    parts.push(`\t\t\t<cloud:attribute-map-service name="${projectName}_Attributes">`);
    for (const attr of attrs) {
      parts.push(`\t\t\t\t<cloud:attribute name="${attr.name}">`);
      parts.push(`\t\t\t\t\t<cloud:type><cloud:simple-type>text</cloud:simple-type></cloud:type>`);
      if (attr.is_password) parts.push(`\t\t\t\t\t<cloud:display-option>display-as-password</cloud:display-option>`);
      if (attr.required)    parts.push(`\t\t\t\t\t<cloud:display-option>required-for-launch</cloud:display-option>`);
      parts.push(`\t\t\t\t</cloud:attribute>`);
    }
    parts.push(`\t\t\t</cloud:attribute-map-service>`);
  }

  // 3. Retrieval service for inbound file integrations
  if (designBrief.data_source === 'inbound-file') {
    parts.push(`\t\t\t<cloud:retrieval-service name="${projectName}_Retrieval"/>`);
  }

  // 4. RAAS report service
  if (designBrief.data_source === 'raas' || designBrief.data_source === 'multiple') {
    const reports = designBrief.raas_reports ?? [];
    parts.push(`\t\t\t<cloud:report-service name="${projectName}_Reports">`);
    if (reports.length === 0) {
      parts.push(`\t\t\t\t<cloud:report-alias description="TODO: Add report description" name="TODO_REPORT_ALIAS"/>`);
    } else {
      for (const r of reports) {
        if (r.has_reference_wid) {
          parts.push(`\t\t\t\t<cloud:report-alias description="${r.description}" name="${r.alias}">`);
          parts.push(`\t\t\t\t\t<cloud:report-reference description="${r.description}" type="WID">TODO_REPLACE_WITH_REPORT_WID</cloud:report-reference>`);
          parts.push(`\t\t\t\t</cloud:report-alias>`);
        } else {
          parts.push(`\t\t\t\t<cloud:report-alias description="${r.description}" name="${r.alias}"/>`);
        }
      }
    }
    parts.push(`\t\t\t</cloud:report-service>`);
  }

  // 5. Listener service for webhook/event-driven integrations
  if (designBrief.data_source === 'webhook') {
    parts.push(`\t\t\t<cloud:listener-service name="${projectName}_Listener"/>`);
  }

  return parts.join('\n');
}

function resolveAttributes(designBrief) {
  const attrs = [];
  const seen = new Set();

  const add = (name, is_password = false, required = false) => {
    if (!seen.has(name)) { seen.add(name); attrs.push({ name, is_password, required }); }
  };

  if (designBrief.external_auth === 'oauth2') {
    add('Token URL', false, true);
    add('Client ID', false, true);
    add('Client Secret', true, true);
    add('Refresh Token', true, true);
  }
  if (designBrief.external_auth === 'basic') {
    add('API Username', false, true);
    add('API Password', true, true);
  }
  if (designBrief.external_auth === 'api-key') {
    add('API Key', true, true);
  }
  const needsUrl = designBrief.data_destination === 'external-rest'
    || designBrief.data_source === 'external-rest'
    || designBrief.data_destination === 'multiple';
  if (needsUrl) add('API URL', false, true);

  for (const a of designBrief.integration_attributes ?? []) {
    add(a.name, a.is_password ?? false, a.required ?? false);
  }

  return attrs;
}

function buildLaunchParamStubs(raasReports) {
  const parts = [];
  const seen = new Set();
  for (const r of raasReports) {
    for (const fp of r.filter_params ?? []) {
      if (fp.startsWith('format=')) continue;
      const key = fp.replace(/!.+$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      const displayName = key.replace(/_/g, ' ');
      const isRef = fp.includes('!');
      parts.push(`\t\t\t<cloud:param name="${displayName}">`);
      if (isRef) {
        parts.push(`\t\t\t\t<cloud:type>`);
        parts.push(`\t\t\t\t\t<cloud:class-report-field description="${displayName}" type="WID" singular="true">TODO_OBJECT_TYPE_WID</cloud:class-report-field>`);
        parts.push(`\t\t\t\t</cloud:type>`);
      } else {
        parts.push(`\t\t\t\t<cloud:type><cloud:simple-type>text</cloud:simple-type></cloud:type>`);
      }
      parts.push(`\t\t\t</cloud:param>`);
    }
  }
  return parts;
}

// ─── assembly.xml skeleton ────────────────────────────────────────────────────

export function buildAssemblyXml(projectName, subFlows, designBrief) {
  const n = subFlows.length;
  const lines = [];

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>
<beans
     xmlns="http://www.springframework.org/schema/beans"
     xmlns:beans="http://www.springframework.org/schema/beans"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:cc="http://www.capeclear.com/assembly/10"
     xmlns:cloud="urn:com.workday/esb/cloud/10.0"
     xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"
     xmlns:pi="urn:com.workday/picof"
     xmlns:wd="urn:com.workday/bsvc"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">

\t<cc:assembly id="WorkdayAssembly" version="2024.37">`);

  const firstTarget = n > 0 ? `Call_${subFlows[0].id}` : 'End';
  const declarations = buildWorkdayInDeclarations(projectName, designBrief);
  const intSysBody = declarations ? `\n${declarations}\n\t\t\t` : '';

  lines.push(`
\t\t<cc:workday-in id="StartHere" routes-to="${firstTarget}">
\t\t\t<cc:integration-system name="${projectName}">${intSysBody}</cc:integration-system>
\t\t</cc:workday-in>`);

  // Sequential local-out chain
  // Naming convention: Call_SubFlowName (underscore separator) for cc:local-out callers
  for (let i = 0; i < n; i++) {
    const sf   = subFlows[i];
    const next = subFlows[i + 1];
    const rrt  = next ? `\n\t\t\troutes-response-to="Call_${next.id}"` : '';
    lines.push(`
\t\t<cc:local-out id="Call_${sf.id}" store-message="none"${rrt}
\t\t\tendpoint="vm://${projectName}/${sf.id}"/>`);
  }

  // Sub-flow stubs
  // Naming convention:
  //   cc:local-in    → SubFlowName (the entry noun, matches vm:// endpoint)
  //   cc:async-mediation → Do{SubFlowName} as stub; rename to Verb+Object before testing
  //                        e.g. DoLoadAttrs → InitBatch, DoAzureToken → PrepareAzureToken
  //   cc:send-error  → SubFlowName+Error (describes the failure context)
  //   cc:local-out error → Put{SubFlowName}Error (error delivery step)
  for (const sf of subFlows) {
    lines.push(`
\t\t<cc:local-in id="${sf.id}" routes-to="Do${sf.id}"/>
\t\t<cc:async-mediation id="Do${sf.id}" handle-downstream-errors="true">
\t\t\t<cc:steps>
\t\t\t\t<cc:log id="Log${sf.id}Start">
\t\t\t\t\t<cc:log-message><cc:text>TODO: ${sf.description}</cc:text></cc:log-message>
\t\t\t\t</cc:log>
\t\t\t</cc:steps>
\t\t\t<cc:send-error id="${sf.id}Error" rethrow-error="false" routes-to="Put${sf.id}Error"/>
\t\t</cc:async-mediation>`);
  }

  // Global error handler
  lines.push(`
\t\t<cc:send-error id="GlobalErrorHandler" rethrow-error="false" routes-to="DeliverError"/>
\t\t<cc:local-out id="DeliverError" store-message="none" endpoint="vm://wcc/PutIntegrationMessage">
\t\t\t<cc:set name="is.message.severity"     value="'CRITICAL'"/>
\t\t\t<cc:set name="is.message.summary"      value="'${projectName} failed: ' + context.errorMessage"/>
\t\t\t<cc:set name="is.document.deliverable" value="'false'"/>
\t\t</cc:local-out>`);

  for (const sf of subFlows) {
    lines.push(`
\t\t<cc:local-out id="Put${sf.id}Error" endpoint="vm://wcc/PutIntegrationMessage">
\t\t\t<cc:set name="is.message.severity" value="'ERROR'"/>
\t\t\t<cc:set name="is.message.summary"  value="'${sf.id} failed'"/>
\t\t\t<cc:set name="is.message.detail"   value="context.errorMessage"/>
\t\t</cc:local-out>`);
  }

  lines.push(`
\t</cc:assembly>

</beans>`);

  return lines.join('');
}

// ─── EMF @mixed index helpers ─────────────────────────────────────────────────
//
// assembly.xml has NO XML comments (by design), so every element is at an odd
// @mixed index:  element at 1-based position P → @mixed.(2P-1)
//
// Direct children of cc:assembly in generation order. Each sub-flow contributes
// exactly TWO top-level elements (local-in + async-mediation); the send-error
// lives INSIDE the async-mediation, and there is no End{SF} terminal element.
//   P=1        workday-in StartHere
//   P=2..1+N   local-out Call{SF[0..N-1]}
//   P=2+N+2*i  local-in  SF[i]
//   P=3+N+2*i  async-med Do{SF[i]}
//   P=2+3N     send-error GlobalErrorHandler
//   P=3+3N     local-out  DeliverError
//   P=4+3N+i   local-out  Put{SF[i]}Error

function mixedIdx(p)            { return 2 * p - 1; }
function globalErrorPosition(n) { return 2 + 3 * n; }
function deliverErrorPosition(n){ return 3 + 3 * n; }
function localInPosition(n, i)  { return 2 + n + 2 * i; }
function doSubFlowPosition(n, i){ return 3 + n + 2 * i; }
function globalErrorPath(n)     { return `assembly.xml#//@beans/@mixed.1/@mixed.${mixedIdx(globalErrorPosition(n))}`; }
function sendErrorInsideDoSubFlow(n, i) {
  return `assembly.xml#//@beans/@mixed.1/@mixed.${mixedIdx(doSubFlowPosition(n, i))}/@mixed.3`;
}

// ─── assembly-diagram.xml skeleton ───────────────────────────────────────────

export function buildDiagramXml(projectName, subFlows) {
  const n     = subFlows.length;
  const lines = [];

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>
<wdnm:Diagram xmlns:wdnm="http://workday.com/studio/editors/notation">
  <element href="assembly.xml#WorkdayAssembly"/>`);

  lines.push(vp(60, 200, 'StartHere'));
  for (let i = 0; i < n; i++) lines.push(vp(320 + i * 150, 200, `Call_${subFlows[i].id}`));

  lines.push(`  <visualProperties>\n    <element href="${globalErrorPath(n)}"/>\n  </visualProperties>`);
  lines.push(vp(450, 65, 'DeliverError'));

  for (let i = 0; i < n; i++) {
    const yBase = 360 + i * 180;
    lines.push(vp(60,  yBase,      subFlows[i].id));
    lines.push(vp(170, yBase + 55, `Put${subFlows[i].id}Error`));
  }

  lines.push(conn('routesTo', 'StartHere', `Call_${subFlows[0].id}`));
  for (let i = 0; i < n - 1; i++) {
    lines.push(conn('routesResponseTo', `Call_${subFlows[i].id}`, `Call_${subFlows[i + 1].id}`));
  }
  // Do{SF} is the sub-flow terminal — no outgoing routes-to (there is no End{SF}).
  for (const sf of subFlows) {
    lines.push(conn('routesTo', sf.id, `Do${sf.id}`));
  }
  // Call_{SF} → SF dispatch is a vm:// hop, which Studio never draws — emitting a
  // routesTo arrow for it adds an edge Studio wouldn't (validate_assembly flags it
  // as REDUNDANT_VM_DISPATCH_ARROW). The local-in still gets its own visualProperties.

  lines.push(`  <connections type="routesTo">\n    <source href="${globalErrorPath(n)}"/>\n    <target href="assembly.xml#DeliverError"/>\n  </connections>`);
  for (let i = 0; i < n; i++) {
    lines.push(`  <connections type="routesTo">\n    <source href="${sendErrorInsideDoSubFlow(n, i)}"/>\n    <target href="assembly.xml#Put${subFlows[i].id}Error"/>\n  </connections>`);
  }

  const mainElems = ['StartHere', ...subFlows.map(sf => `Call_${sf.id}`)];
  lines.push(swimlane(30, 140, 'Main Flow', 'MIDDLE', mainElems));
  lines.push(swimlane(30, 20, 'Error Handler', 'END', [{ emf: globalErrorPath(n) }, 'DeliverError']));

  for (let i = 0; i < n; i++) {
    const sf   = subFlows[i];
    const yH   = 340 + i * 180;
    const vIdx = 3 + 2 * i;
    lines.push(swimlane(30, yH, `${sf.id} Sub-flow`, 'MIDDLE', [sf.id, { nested: vIdx }]));
    lines.push(swimlaneVertical(170, yH + 15, `Do${sf.id}`, `Put${sf.id}Error`));
  }

  lines.push(`\n</wdnm:Diagram>`);
  return lines.join('\n');
}

function vp(x, y, id) {
  return `  <visualProperties x="${x}" y="${y}">\n    <element href="assembly.xml#${id}"/>\n  </visualProperties>`;
}

function conn(type, src, tgt) {
  return `  <connections type="${type}">\n    <source href="assembly.xml#${src}"/>\n    <target href="assembly.xml#${tgt}"/>\n  </connections>`;
}

function swimlane(x, y, name, alignment, elements) {
  const elemsXml = elements.map(e => {
    if (typeof e === 'string')  return `    <elements href="assembly.xml#${e}"/>`;
    if (e.emf)                  return `    <elements href="${e.emf}"/>`;
    if (e.nested !== undefined) return `    <elements href="#//@swimlanes.${e.nested}"/>`;
    return '';
  }).join('\n');
  return `  <swimlanes x="${x}" y="${y}" name="${name}" alignment="${alignment}" labelAlignment="LEFT">\n${elemsXml}\n  </swimlanes>`;
}

function swimlaneVertical(x, y, asyncMedId, errorLocalOutId) {
  return `  <swimlanes x="${x}" y="${y}" name="Swimlane" orientation="VERTICAL">
    <elements href="assembly.xml#${asyncMedId}"/>
    <elements href="assembly.xml#${errorLocalOutId}"/>
  </swimlanes>`;
}

// ─── Planning document ────────────────────────────────────────────────────────

export function buildPlanDocument(projectName, subFlows, designBrief) {
  const n = subFlows.length;

  const chain = subFlows.map((sf, i) => {
    const next = subFlows[i + 1];
    return `Call_${sf.id}${next ? ` →(routes-response-to)→ Call_${next.id}` : ' (final)'}`;
  }).join('\n  ');

  const contract = subFlows.map(sf => ({
    sub_flow: sf.id,
    description: sf.description,
    reads_props: sf.reads_props ?? ['(define before building)'],
    writes_props: sf.writes_props ?? ['(define before building)'],
    error_handler: `Put${sf.id}Error`,
  }));

  const emfSummary = {
    GlobalErrorHandler: `@mixed.${mixedIdx(globalErrorPosition(n))}`,
    ...Object.fromEntries(subFlows.map((sf, i) => [
      `${sf.id}Error (send-error inside Do${sf.id})`,
      `//@beans/@mixed.1/@mixed.${mixedIdx(doSubFlowPosition(n, i))}/@mixed.3`,
    ])),
  };

  const attrs = resolveAttributes(designBrief);
  const autoGenerated = [];
  if (designBrief.data_source === 'raas' || designBrief.data_source === 'multiple') {
    const count = designBrief.raas_reports?.length ?? 0;
    autoGenerated.push(`cloud:report-service "${projectName}_Reports" with ${count} alias${count !== 1 ? 'es' : ''}`);
  }
  if (designBrief.data_source === 'inbound-file') autoGenerated.push(`cloud:retrieval-service "${projectName}_Retrieval"`);
  if (designBrief.data_source === 'webhook')       autoGenerated.push(`cloud:listener-service "${projectName}_Listener"`);
  if (attrs.length > 0) {
    autoGenerated.push(`cloud:attribute-map-service "${projectName}_Attributes": ${attrs.map(a => a.name).join(', ')}`);
  }

  const gaps = buildGaps(designBrief, subFlows);

  return {
    integration: projectName,
    design_brief: {
      data_source:       designBrief.data_source,
      data_destination:  designBrief.data_destination,
      trigger:           designBrief.trigger,
      record_volume:     designBrief.record_volume,
      external_auth:     designBrief.external_auth ?? 'none',
      error_handling:    designBrief.error_handling,
      raas_reports:      designBrief.raas_reports?.map(r => r.alias) ?? [],
      soap_operations:   designBrief.soap_operations?.map(s => `${s.application}.${s.operation} v${s.version} (${s.direction})`) ?? [],
      conditional_logic: designBrief.conditional_logic ?? 'none',
    },
    auto_generated_in_workday_in: autoGenerated.length ? autoGenerated : ['none — no special declarations needed'],
    gaps_to_fill: gaps,
    sub_flow_count: n,
    execution_chain: chain,
    props_contract: contract,
    swimlane_layout: subFlows.map((sf, i) => ({
      [`swimlanes.${2 + 2 * i}`]: `${sf.id} Sub-flow (horizontal)`,
      [`swimlanes.${3 + 2 * i}`]: `Do${sf.id} VERTICAL (nested inside above)`,
    })),
    emf_xpath_summary: emfSummary,
    build_order: buildBuildOrder(subFlows, designBrief),
    naming_conventions: {
      'cc:local-out (call)':       'Call_{SubFlowName}  — e.g. Call_LoadAttrs, Call_AzureToken',
      'cc:local-in':               '{SubFlowName}       — entry noun, matches vm:// endpoint  e.g. LoadAttrs, AzureToken',
      'cc:async-mediation (stub)': 'Do{SubFlowName}     — RENAME before testing to Verb+Object  e.g. PrepareTermination, ParseGraphUsers',
      'cc:async-mediation (real)': 'Verb+Object         — e.g. InitBatch, SetTransactionProps, CountWDWorkers',
      'cc:send-error':             '{SubFlowName}Error  — e.g. LoadAttrsError, PrepareTokenError',
      'cc:local-out (error)':      'Put{SubFlowName}Error — e.g. PutLoadAttrsFail, PutAzureTokenFail',
      'cc:route':                  'RouteBy{Criteria}   — e.g. RouteByTransactionType, RouteByWorkerType',
      'cc:splitter':               'SplitBy{Element}    — e.g. SplitByEmployee, SplitByTransaction',
      'cc:workday-out-*':          'Call{Api}{Operation} — e.g. GetWDWorkersRAAS, CallStaffingTerminateEmployee',
      'rename_tool':               'Use rename_steps tool to atomically rename IDs in both assembly.xml and assembly-diagram.xml — never rename by hand',
    },
    warnings: [
      'Do NOT add XML comments to assembly.xml — they shift @mixed indices and break diagram connections',
      'RENAME Do{SubFlowName} stubs to Verb+Object before running integration — use rename_steps tool',
      'rename_steps must update BOTH assembly.xml and assembly-diagram.xml atomically — manual renames cause scala.MatchError',
      'Props keys with dots (e.g. my.prop.name) are fine in MVEL but MUST use underscores as xsl:param names',
      'xml-stream-splitter streams records one at a time — parts[0] inside async-mediation has ONE entry',
      'xpath-splitter loads all records into memory — only use for small datasets (<100 records)',
    ],
  };
}

function buildGaps(designBrief, subFlows) {
  const gaps = [];

  if (designBrief.data_source === 'raas' && !(designBrief.raas_reports?.length)) {
    gaps.push('RAAS reports not specified — add cloud:report-alias entries after creating reports in Workday UI');
  }
  if (designBrief.raas_reports?.some(r => r.has_reference_wid)) {
    gaps.push('Replace TODO_REPLACE_WITH_REPORT_WID placeholders with actual report WIDs from Workday tenant');
  }
  if (designBrief.trigger === 'launch-params-manual' &&
      designBrief.raas_reports?.some(r => r.filter_params?.some(fp => fp.includes('!')))) {
    gaps.push('Replace TODO_OBJECT_TYPE_WID in cloud:class-report-field with correct Workday object type descriptor WIDs');
  }
  if (designBrief.soap_operations?.length) {
    const ops = designBrief.soap_operations.map(s => `${s.application}.${s.operation}`).join(', ');
    gaps.push(`SOAP XSL transforms not generated — create one XSL per operation using create_xsl_transform: ${ops}`);
    gaps.push(`ISU domain permissions required for ${ops} — user/admin configures this in the Workday tenant`);
  }
  if (designBrief.conditional_logic) {
    gaps.push(`Conditional logic not scaffolded: "${designBrief.conditional_logic}" — add cc:route steps or execute-when attributes manually`);
  }
  if (designBrief.error_handling.includes('email-notification')) {
    gaps.push('Email-notification error handling selected — add email-out step inside error handlers with recipient and template');
  }
  if (designBrief.external_auth === 'oauth2') {
    gaps.push('OAuth2 GetToken sub-flow not generated — add cc:http-out POST to Token URL, extract access_token from response');
  }

  return gaps.length ? gaps : ['No critical gaps — all required declarations were generated'];
}

function buildBuildOrder(subFlows, designBrief) {
  const n = subFlows.length;
  const steps = ['1. Open assembly-diagram.xml in Studio — verify all swimlanes render correctly'];
  let i = 2;

  if (designBrief.data_source === 'raas') {
    steps.push(`${i++}. Verify RAAS reports exist in Workday tenant; confirm alias names match cloud:report-alias`);
    if (designBrief.raas_reports?.some(r => r.has_reference_wid)) {
      steps.push(`${i++}. Replace TODO_REPLACE_WITH_REPORT_WID with actual WIDs from the Workday report URL`);
    }
  }
  if (designBrief.data_source === 'soap-get' || designBrief.data_destination === 'workday-soap-write') {
    steps.push(`${i++}. Create XSL transforms for SOAP operations using create_xsl_transform`);
    steps.push(`${i++}. Verify ISU has the required domain security permissions for each SOAP call`);
  }
  if (designBrief.external_auth === 'oauth2') {
    steps.push(`${i++}. Build and test GetToken sub-flow (cc:http-out POST → extract access_token) before other sub-flows`);
  }
  if (designBrief.external_auth !== 'none' && designBrief.external_auth !== undefined) {
    steps.push(`${i++}. Configure integration attributes in Workday UI (${designBrief.external_auth} credentials)`);
  }

  for (let j = 0; j < n; j++) {
    steps.push(`${i++}. Fill in Do${subFlows[j].id}: ${subFlows[j].description}`);
  }

  if (designBrief.record_volume === 'large') {
    steps.push(`${i++}. IMPORTANT: Replace xpath-splitter stubs with xml-stream-splitter — large volume requires streaming`);
  }
  if (designBrief.error_handling.includes('email-notification')) {
    steps.push(`${i++}. Add email-out step in error handlers for failure notification`);
  }
  steps.push(`${i++}. For each RAAS-consuming sub-flow: ask user for a sample report XML response to derive accurate XPath mappings`);
  steps.push(`${i++}. Test each sub-flow independently before running end-to-end`);
  steps.push(`${i++}. Run full integration test on Workday Implementation tenant before deploying to Production`);

  return steps;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function errorResponse(code, message, suggestion) {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ error: true, code, message, suggestion }),
    }],
  };
}
