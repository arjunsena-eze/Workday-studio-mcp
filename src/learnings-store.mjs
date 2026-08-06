/**
 * Two-file learnings store.
 *
 *   learnings.md        — committed, world-readable if the repo is public.
 *                         Generalized patterns only.
 *   learnings.local.md  — gitignored. Never leaves the machine. The place for
 *                         anything carrying a client's identifiers.
 *
 * Both are searched together so a private finding is still retrievable; only the
 * public one is ever committed.
 *
 * The identifier scan is deliberately fail-closed: a suspected identifier in a
 * PUBLIC entry is refused, not warned about. A warning that still writes leaves
 * the leak in place and depends on someone reading the response, and a public
 * git history is not something you can quietly clean up later.
 */

import { existsSync, readFileSync } from 'fs';
import { appendFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PUBLIC_PATH = join(__dirname, '../learnings.md');
export const PRIVATE_PATH = join(__dirname, '../learnings.local.md');

const PRIVATE_HEADER = `# Studio Learnings — LOCAL ONLY

Gitignored. This file never leaves this machine.

Entries here may contain client-specific detail: integration IDs, project and tenant
names, hostnames, WIDs, custom field names. That is the point — the generalizable
pattern belongs in learnings.md, and the specifics that make it actionable for one
engagement belong here.

\`search_learnings\` reads this file alongside the public one and labels results
\`[LOCAL]\`, so nothing is lost by keeping a finding private.

Before moving anything to learnings.md: strip identifiers to INT999 / <TENANT> and
describe provenance generically.

---
`;

export function pathFor(visibility) {
  return visibility === 'private' ? PRIVATE_PATH : PUBLIC_PATH;
}

export async function appendEntry(visibility, entry) {
  const path = pathFor(visibility);
  if (visibility === 'private' && !existsSync(path)) {
    await writeFile(path, PRIVATE_HEADER, 'utf8');
  }
  await appendFile(path, entry, 'utf8');
  return path;
}

export function readStores() {
  const out = [];
  if (existsSync(PUBLIC_PATH)) {
    out.push({ scope: 'public', path: PUBLIC_PATH, text: readFileSync(PUBLIC_PATH, 'utf8') });
  }
  if (existsSync(PRIVATE_PATH)) {
    out.push({ scope: 'private', path: PRIVATE_PATH, text: readFileSync(PRIVATE_PATH, 'utf8') });
  }
  return out;
}

// ─── Identifier scanning ──────────────────────────────────────────────────────

/**
 * Patterns that indicate an entry is tied to one engagement. Each returns a
 * label so the refusal can name what to fix rather than saying "looks risky".
 */
const RULES = [
  // No trailing \b: real project names are like INT042B_Foo_Inbound, and '_' is a
  // word character, so a trailing boundary never occurs and the ID slips through.
  { label: 'integration ID (use INT999)', re: /\bINT-?(?!999)\d{3}[A-Za-z]?/ },
  { label: 'Workday WID (32 hex chars)', re: /\b[0-9a-f]{32}\b/i },
  { label: 'Workday tenant hostname', re: /\b[a-z0-9-]*(?:services|impl|wd)\d*[a-z0-9-]*\.(?:myworkday|workday)\.com\b/i },
  { label: 'internal Workday host', re: /\b[a-z0-9-]*\.(?:sir|wd\d+)\b/i },
  { label: 'ccx tenant path (use <TENANT>)', re: /\/ccx\/(?:api\/v\d+|service|oauth2)\/(?!<TENANT>)[a-z0-9][a-z0-9_-]*/i },
  { label: 'vendor cloud tenant', re: /\b[a-z0-9-]+\.boomi\.cloud\b/i },
  { label: 'vendor environment host', re: /\b[a-z]*train\d+\.dayforcehcm\.com\b/i },
  { label: 'email address', re: /\b[A-Za-z0-9._%+-]+@(?!example\.)[A-Za-z0-9-]+\.[A-Za-z]{2,}\b/ },
  { label: 'server log / event ID', re: /\bserver-[0-9a-f]{16,}\b/i },
  { label: 'client-specific tenant token', re: /\btenant\s+[a-z][a-z0-9-]*\d[a-z0-9-]*\b/i },
];

/** Returns the labels of every rule that matched. Empty array means clean. */
export function scanForIdentifiers(...fields) {
  const text = fields.filter(Boolean).join('\n');
  return RULES.filter((r) => r.re.test(text)).map((r) => r.label);
}
