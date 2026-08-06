import { z } from 'zod';
import { appendFile, access } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEARNINGS_PATH = join(__dirname, '../../learnings.md');

export function register(server) {
  server.tool(
    'log_learning',
    `CALL THIS AUTOMATICALLY whenever you discover a new Workday Studio pattern, schema rule, \
gotcha, or workaround during a build session — even if the user did not ask you to log it. \
This is how the team's shared knowledge base grows. Examples of when to call this: \
a build fails with an error not already in the step-type reference, Studio silently rejects \
an element, MVEL throws an unexpected exception, a diagram crashes on open, a workaround \
fixes something with no documented cause.

ALWAYS LOG CORRECTIONS. If a live run proves that get_step_type_reference or \
docs/studio-integration-patterns.md is WRONG or incomplete, log it and set the \`corrects\` \
field to name the stale source. Corrections are the highest-value entries in this file — a \
wrong curated answer costs a deploy cycle every time someone trusts it. Do not skip logging \
something merely because the topic is already covered; "already documented" is only a reason \
to skip when the existing documentation is CORRECT.

PUBLIC-REPO RULE — GENERALIZE EVERY FIELD: learnings.md is published in a public repository \
used across clients. Never include client integration IDs (use INT999), project names, \
tenant or environment names (use <TENANT>), custom field names, or run/log identifiers. \
Describe provenance generically ("verified in a live run", "observed in a production build") \
— the technical pattern is the value, not where it came from.`,
    {
      title: z.string().describe('Short descriptive title, e.g. "cc:splitter cannot have routes-to attribute"'),
      category: z.enum(['Schema', 'Diagram', 'MVEL', 'XSLT', 'Assembly', 'HTTP', 'Error', 'Other'])
        .describe('The type of learning'),
      trigger: z.string().describe('What caused the discovery — the exact error or unexpected behavior observed'),
      pattern: z.string().describe('What we learned — specific and actionable, written for a teammate who will hit this next'),
      example: z.string().optional().describe('Minimal XML/MVEL/XSLT snippet showing the correct or incorrect form'),
      promote_to: z.enum(['patterns.md', 'get-step-type-reference.mjs', 'validate-assembly.mjs', 'all'])
        .describe('Which file(s) this should be promoted into during the next review'),
      corrects: z.string().optional()
        .describe('Set ONLY when this entry contradicts an existing curated source. Name the stale source and what it claims, e.g. "get_step_type_reference workday-in: claims the listener payload arrives in wd.retrieve.variable". Flags the entry as a correction so search_learnings surfaces it with a warning.'),
    },
    async ({ title, category, trigger, pattern, example, promote_to, corrects }) => {
      const date = new Date().toISOString().slice(0, 10);

      // Public repo: flag entries that look like they carry client-specific identifiers —
      // integration IDs, tenant-like tokens, vendor-cloud environment hostnames, email addresses.
      const CLIENT_ID_RE = new RegExp([
        String.raw`\bINT(?!999)\d{3}[A-Za-z]?\b`,
        String.raw`\btenant\s+[a-z][a-z0-9-]*\d[a-z0-9-]*\b`,
        String.raw`\b[a-z0-9-]+\.boomi\.cloud\b`,
        String.raw`\b[a-z]*train\d+\.dayforcehcm\.com\b`,
        String.raw`\b[A-Za-z0-9._%+-]+@(?!example\.)[A-Za-z0-9-]+\.[A-Za-z]{2,}\b`,
      ].join('|'));
      const suspect = [title, trigger, pattern, example ?? '']
        .some((s) => CLIENT_ID_RE.test(s));

      const lines = [
        `\n### [${date}] ${title}`,
        `**Category**: ${category}`,
        `**Trigger**: ${trigger}`,
        `**Pattern**: ${pattern}`,
      ];

      // Emitted before Example so search_learnings' line-anchored regex finds it
      // regardless of how long the example block runs.
      if (corrects) lines.push(`**Corrects**: ${corrects}`);

      if (example) {
        lines.push('**Example**:');
        lines.push('```xml');
        lines.push(example);
        lines.push('```');
      }

      lines.push(`**Promote to**: ${promote_to}`);
      lines.push('**Status**: raw');
      lines.push('');

      const entry = lines.join('\n');

      try {
        await access(LEARNINGS_PATH);
      } catch {
        return errorResponse(
          'LEARNINGS_NOT_FOUND',
          `learnings.md not found at ${LEARNINGS_PATH}`,
          'Make sure the MCP repo is intact. learnings.md should be in the repo root.'
        );
      }

      try {
        await appendFile(LEARNINGS_PATH, entry, 'utf8');
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              logged: true,
              title,
              date,
              promote_to,
              ...(corrects && { corrects }),
              ...(suspect && {
                warning: 'Entry may contain client-specific identifiers (integration ID or tenant name). '
                  + 'This file is published publicly — edit the entry in learnings.md to use INT999/<TENANT> placeholders.',
              }),
              message: `Logged to learnings.md. Ask the user to commit this so the team benefits from it.`,
            }, null, 2),
          }],
        };
      } catch (e) {
        return errorResponse('WRITE_FAILED', e.message, 'Check file permissions on learnings.md.');
      }
    }
  );
}

function errorResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }) }] };
}
