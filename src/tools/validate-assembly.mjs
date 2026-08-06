import { z } from 'zod';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { config } from '../config.mjs';
import { validateAssembly } from '../assembly-validator.mjs';
import { recordValidation } from '../aidlc-docs.mjs';

export function register(server) {
  server.tool(
    'validate_assembly',
    [
      'Validates assembly.xml (and assembly-diagram.xml if present) against Studio-specific rules.',
      '',
      'RUN THIS BEFORE EVERY DEPLOY. The first two checks are schema-derived and catch',
      'errors Studio only reveals on open — each has cost a deploy cycle in the field.',
      '',
      'Schema-derived checks (from data/studio-schema-model.json, distilled from the XSDs',
      'shipped in the Studio install — committed, so these work with no Studio present):',
      '  ERROR   — SCHEMA_SEQUENCE_ORDER: children of an xsd:sequence element are out of',
      '            order (e.g. cc:integration-system: listener-service must precede',
      '            custom-object-service). Studio fails these on open with',
      '            cvc-complex-type.2.4.a, naming the rejected element and listing only',
      '            what is still legal at that position — which reads as "unsupported',
      '            element" when it merely came too late.',
      '  ERROR   — MVEL_BRACE_IMBALANCE: a value typed MVELTemplateType (cc:text,',
      '            cc:header-text, cc:footer-text, and ~135 attributes incl. message,',
      '            title, extra-path, endpoint, value) has unequal { and } counts. Studio:',
      '            "Closing and opening tags {...} do not match". Fix by building the string',
      '            in cc:expression (MVELExpressionType — not brace-checked) and emitting a',
      '            single balanced @{prop} token.',
      '',
      'assembly.xml checks:',
      '  ERROR   — XML comments present (shifts @mixed indices, breaks diagram connections)',
      '  ERROR   — Broken routes-to / routes-response-to (target id does not exist)',
      '  ERROR   — cc:workday-out-soap missing application= or version=',
      '  ERROR   — cc:workday-out-soap used for RAAS (must use cc:workday-out-rest)',
      '  ERROR   — cc:workday-out-rest missing extra-path=',
      '  ERROR   — cc:http-out missing endpoint=',
      '  ERROR   — cc:xslt-plus missing url=',
      '  WARNING — vm:// endpoint references a local-in id that does not exist',
      '  WARNING — url= references an XSL file not found in WSAR-INF',
      '  INFO    — TODO stubs still present (sub-flows not yet filled in)',
      '',
      'assembly-diagram.xml checks (when diagram file exists):',
      '  ERROR   — diagram href="assembly.xml#Id" points to an id no longer in assembly.xml',
      '            (stale reference from a rename or delete — causes scala.MatchError on open)',
      '  WARNING — renderable assembly element has no diagram entry (missing from visualProperties)',
      '',
      'Run this after update_sub_flow, any manual assembly edit, or any component rename/delete.',
      'Fix all ERRORs before opening in Studio. WARNINGs block testing, not diagram load.',
    ].join('\n'),
    {
      project_name: z.string().describe('Project name, e.g. "INT145_My_Integration"'),
    },
    async ({ project_name }) => {
      const projectPath = resolve(config.workspacePath, project_name);
      const wsDir       = join(projectPath, 'ws', 'WSAR-INF');
      const assemblyPath = join(wsDir, 'assembly.xml');

      if (!existsSync(assemblyPath)) {
        return errResponse(
          'FILE_NOT_FOUND',
          `assembly.xml not found in project '${project_name}'.`,
          'Run plan_integration first.',
        );
      }

      const xml         = await readFile(assemblyPath, 'utf-8');
      const diagramPath = join(wsDir, 'assembly-diagram.xml');
      const diagramXml  = existsSync(diagramPath)
        ? await readFile(diagramPath, 'utf-8')
        : null;
      const issues = validateAssembly(xml, wsDir, diagramXml);

      const errors   = issues.filter(i => i.severity === 'ERROR');
      const warnings = issues.filter(i => i.severity === 'WARNING');
      const infos    = issues.filter(i => i.severity === 'INFO');

      // Record the result in lifecycle state. Best-effort: no-ops when the
      // project has no aidlc-docs/, and never turns a report into a failure.
      let lifecycle = null;
      try {
        const state = await recordValidation(projectPath, {
          clean: errors.length === 0,
          errors: errors.length,
          warnings: warnings.length,
        });
        if (state) {
          const all = state.units_of_work ?? [];
          const remaining = all.filter(u => u.status === 'todo_stub');
          lifecycle = {
            units_built: all.filter(u => u.status === 'built').length,
            units_total: all.length,
            next_recommended_action: errors.length
              ? 'Fix the ERRORs above, then validate again'
              : remaining.length
                ? `update_sub_flow for "${remaining[0].id}"`
                : 'Construction complete — work the Operations handoff in aidlc-docs/plan.md',
          };
        }
      } catch { /* best-effort bookkeeping */ }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            project: project_name,
            valid: errors.length === 0,
            summary: {
              errors:   errors.length,
              warnings: warnings.length,
              info:     infos.length,
            },
            ...(lifecycle ? { lifecycle } : {}),
            issues,
          }, null, 2),
        }],
      };
    },
  );
}

function errResponse(code, message, suggestion) {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ error: true, code, message, suggestion }),
    }],
  };
}
