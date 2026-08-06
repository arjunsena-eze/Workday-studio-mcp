import { z } from 'zod';
import { appendEntry, scanForIdentifiers, PRIVATE_PATH, PUBLIC_PATH } from '../learnings-store.mjs';

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

CHOOSE THE RIGHT VISIBILITY — this decides whether the entry can be published:
  visibility="public"  (default) → learnings.md, which is COMMITTED and may be a public \
repo. Generalized patterns ONLY: INT999 for integration IDs, <TENANT> for tenants, no WIDs, \
no hostnames, no client or project names, no log identifiers. Describe provenance as \
"verified in a live run".
  visibility="private" → learnings.local.md, which is gitignored and never leaves the \
machine. Use this for anything tied to one engagement, and whenever you are unsure. \
search_learnings reads both, so nothing is lost by keeping a finding private.

A public entry containing client identifiers is REFUSED, not warned about — the response \
will name what to strip. Either generalize the wording and retry, or set \
visibility="private". Prefer generalizing: the pattern is the value, the client is not.`,
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
      visibility: z.enum(['public', 'private']).optional()
        .describe('public (default) = learnings.md, committed, generalized patterns only. private = learnings.local.md, gitignored, safe for client-specific detail. When unsure, choose private.'),
    },
    async ({ title, category, trigger, pattern, example, promote_to, corrects, visibility }) => {
      const date = new Date().toISOString().slice(0, 10);
      const scope = visibility ?? 'public';

      // Fail closed on the public path. A warning that still writes leaves the
      // leak in place, and a public git history cannot be quietly cleaned later.
      const found = scanForIdentifiers(title, trigger, pattern, example, corrects);
      if (scope === 'public' && found.length) {
        return errorResponse(
          'CLIENT_IDENTIFIER_IN_PUBLIC_ENTRY',
          `Refused: this entry looks tied to one engagement (${found.join('; ')}). `
            + 'learnings.md is committed and may be public.',
          'Either (a) rewrite using INT999 / <TENANT> and drop WIDs, hostnames and log IDs — '
            + 'the technical pattern is the value — or (b) retry with visibility="private" to '
            + 'store it in learnings.local.md, which is gitignored. search_learnings reads both.',
        );
      }

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

      try {
        const path = await appendEntry(scope, lines.join('\n'));
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              logged: true,
              title,
              date,
              visibility: scope,
              file: scope === 'private' ? 'learnings.local.md' : 'learnings.md',
              promote_to,
              ...(corrects && { corrects }),
              ...(scope === 'private'
                ? {
                  message: 'Logged to learnings.local.md (gitignored — stays on this machine). '
                    + 'If the underlying pattern generalizes, consider also logging a scrubbed '
                    + 'version with visibility="public" so it survives to other machines.',
                }
                : {
                  message: 'Logged to learnings.md. Ask the user to commit this so the knowledge '
                    + 'survives to other machines and sessions.',
                }),
              path,
            }, null, 2),
          }],
        };
      } catch (e) {
        return errorResponse(
          'WRITE_FAILED',
          e.message,
          `Check file permissions on ${scope === 'private' ? PRIVATE_PATH : PUBLIC_PATH}.`,
        );
      }
    }
  );
}

function errorResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }, null, 2) }] };
}
