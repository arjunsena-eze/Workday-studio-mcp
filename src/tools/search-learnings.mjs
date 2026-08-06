import { z } from 'zod';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEARNINGS_PATH = join(__dirname, '../../learnings.md');

// ─── Public tool registration ─────────────────────────────────────────────────

export function register(server) {
  server.tool(
    'search_learnings',
    [
      'Searches learnings.md — the raw intake log of Studio gotchas discovered during real',
      'build sessions. These are findings that have NOT yet been promoted into',
      'docs/studio-integration-patterns.md or get_step_type_reference, so they are invisible',
      'to get_patterns. Many are corrections to those very sources.',
      '',
      'CALL THIS BEFORE burning a deploy cycle on a diagnosis. Specifically:',
      '  • a Studio schema/validation error you have not seen before',
      '  • a runtime error in a server log whose cause is not obvious',
      '  • any "where does X actually come from at runtime" question',
      '    (listener payloads, event documents, launch params, retrieve variables)',
      '  • before concluding that a documented behaviour is wrong — check whether',
      '    someone already found the correction',
      '',
      'Search the ERROR TEXT, not your theory about it. Distinctive fragments work best:',
      'search="END_DOCUMENT", search="cvc-complex-type", search="defaulting to GET".',
      '',
      'Relationship to the other knowledge tools:',
      '  get_step_type_reference → one element, curated, can be out of date',
      '  get_patterns            → curated cross-element rules',
      '  search_learnings        → raw field findings, newest first, may correct the other two',
      '',
      'USAGE:',
      '  • No arguments        → index of every entry (date, category, title).',
      '  • search="END_DOCUMENT" → full text of every entry mentioning the term.',
      '  • category="MVEL"     → every entry in that category.',
      '  • Both                → search within that category.',
    ].join('\n'),
    {
      search: z.string().optional()
        .describe('Keyword or error fragment to find across all entries. Prefer literal error text over paraphrase.'),
      category: z.enum(['Schema', 'Diagram', 'MVEL', 'XSLT', 'Assembly', 'HTTP', 'Error', 'Other'])
        .optional().describe('Restrict results to one category.'),
      limit: z.number().int().positive().optional()
        .describe('Max entries to return (default 6). Full entries are long — raise deliberately.'),
    },
    async ({ search, category, limit } = {}) => {
      if (!existsSync(LEARNINGS_PATH)) {
        return errorResponse(
          'LEARNINGS_NOT_FOUND',
          `learnings.md not found at ${LEARNINGS_PATH}`,
          'The intake log ships with the repo. Ensure the studio-mcp clone is intact.',
        );
      }

      const md = await readFile(LEARNINGS_PATH, 'utf8');
      const entries = parseEntries(md);

      if (!entries.length) {
        return successText('learnings.md contains no entries yet.');
      }

      let hits = entries;
      if (category) {
        hits = hits.filter((e) => e.category.toLowerCase() === category.toLowerCase());
      }
      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        hits = hits.filter((e) => e.body.toLowerCase().includes(q));
      }

      if (!search && !category) {
        return successText(renderIndex(entries));
      }

      if (!hits.length) {
        const what = [
          search ? `"${search}"` : null,
          category ? `category ${category}` : null,
        ].filter(Boolean).join(' in ');
        return successText(
          `No learning matches ${what}.\n\n`
          + 'Try a shorter fragment of the literal error text, or call search_learnings with no '
          + 'arguments for the full index. Also try get_patterns for curated rules.',
        );
      }

      return successText(renderHits(hits, { search, category, limit: limit ?? 6 }));
    },
  );
}

// ─── Parsing ──────────────────────────────────────────────────────────────────
//
// Entries are "### [YYYY-MM-DD] Title" followed by **Field**: lines. Headings
// inside fenced code blocks are ignored so an XML comment or shell prompt in an
// example is never mistaken for an entry boundary.

export function parseEntries(md) {
  const lines = md.split('\n');
  const starts = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^###\s+\[(\d{4}-\d{2}-\d{2})\]\s+(.*\S)\s*$/.exec(lines[i]);
    if (m) starts.push({ line: i, date: m[1], title: m[2].trim() });
  }

  return starts.map((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1].line : lines.length;
    const body = lines.slice(s.line, end).join('\n').trim();
    const cat = /^\*\*Category\*\*:\s*(\S+)/m.exec(body);
    const corrects = /^\*\*Corrects\*\*:\s*(.+)$/m.exec(body);
    return {
      date: s.date,
      title: s.title,
      category: cat ? cat[1].trim() : 'Other',
      corrects: corrects ? corrects[1].trim() : null,
      body,
    };
  });
}

// ─── Rendering ────────────────────────────────────────────────────────────────

export function renderIndex(entries) {
  const out = [
    `# Studio learnings — index (${entries.length} entries)`,
    '',
    'Raw field findings, not yet promoted into the curated knowledge base.',
    'Call `search_learnings` again with `search="<error text>"` for full entries.',
    '',
  ];

  const byCategory = new Map();
  for (const e of entries) {
    if (!byCategory.has(e.category)) byCategory.set(e.category, []);
    byCategory.get(e.category).push(e);
  }

  for (const [cat, list] of [...byCategory.entries()].sort()) {
    out.push(`## ${cat} (${list.length})`);
    for (const e of list.slice().sort((a, b) => b.date.localeCompare(a.date))) {
      out.push(`  - [${e.date}] ${e.title}${e.corrects ? '  ⚠ CORRECTS ' + e.corrects : ''}`);
    }
    out.push('');
  }
  return out.join('\n');
}

export function renderHits(hits, { search, category, limit }) {
  // Newest first — a later entry may supersede an earlier one.
  const sorted = hits.slice().sort((a, b) => b.date.localeCompare(a.date));
  const shown = sorted.slice(0, limit);

  const what = [
    search ? `"${search}"` : null,
    category ? `category ${category}` : null,
  ].filter(Boolean).join(' in ');

  const header = sorted.length > shown.length
    ? `${sorted.length} learnings match ${what} — showing the ${shown.length} newest. `
      + 'Narrow the term or raise limit.\n'
    : `${sorted.length} learning${sorted.length === 1 ? '' : 's'} match ${what} (newest first):\n`;

  const corrections = shown.filter((e) => e.corrects);
  const banner = corrections.length
    ? '\n⚠ ' + corrections.length + ' of these CORRECT a curated source. '
      + 'Where they disagree with get_step_type_reference or get_patterns, the learning is newer — trust it.\n'
    : '';

  return header + banner + '\n' + shown.map((e) => e.body).join('\n\n---\n\n');
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function successText(text) {
  return { content: [{ type: 'text', text }] };
}

function errorResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }) }] };
}
