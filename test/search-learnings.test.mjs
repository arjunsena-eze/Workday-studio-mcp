import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { parseEntries, renderIndex, renderHits } from '../src/tools/search-learnings.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEARNINGS_PATH = join(__dirname, '../learnings.md');

const SAMPLE = `# Studio Learnings

Preamble that is not an entry.

### [2026-01-02] First thing
**Category**: MVEL
**Trigger**: something broke
**Pattern**: do it this way instead
**Promote to**: patterns.md
**Status**: raw

### [2026-03-04] Second thing
**Category**: Schema
**Trigger**: schema rejected the file
**Pattern**: order matters
**Corrects**: get_step_type_reference workday-in — claims the wrong thing
**Example**:
\`\`\`xml
### [9999-99-99] This heading is inside a fence and must be ignored
\`\`\`
**Promote to**: all
**Status**: raw
`;

test('parseEntries finds entries and ignores headings inside code fences', () => {
  const entries = parseEntries(SAMPLE);
  assert.equal(entries.length, 2, 'fenced heading must not count as an entry');
  assert.deepEqual(entries.map((e) => e.title), ['First thing', 'Second thing']);
});

test('parseEntries extracts category, date and corrects', () => {
  const [first, second] = parseEntries(SAMPLE);
  assert.equal(first.category, 'MVEL');
  assert.equal(first.date, '2026-01-02');
  assert.equal(first.corrects, null);
  assert.equal(second.category, 'Schema');
  assert.match(second.corrects, /get_step_type_reference workday-in/);
});

test('entry body carries the whole entry, including the fenced example', () => {
  const [, second] = parseEntries(SAMPLE);
  assert.match(second.body, /order matters/);
  assert.match(second.body, /inside a fence/);
});

test('renderIndex groups by category and flags corrections', () => {
  const out = renderIndex(parseEntries(SAMPLE));
  assert.match(out, /## MVEL \(1\)/);
  assert.match(out, /## Schema \(1\)/);
  assert.match(out, /CORRECTS/);
});

test('renderHits returns newest first and warns when a correction is present', () => {
  const entries = parseEntries(SAMPLE);
  const out = renderHits(entries, { search: 'thing', limit: 6 });
  assert.ok(
    out.indexOf('Second thing') < out.indexOf('First thing'),
    'newest entry must come first — a later entry can supersede an earlier one',
  );
  assert.match(out, /CORRECT a curated source/);
});

test('renderHits honours limit', () => {
  const out = renderHits(parseEntries(SAMPLE), { search: 'thing', limit: 1 });
  assert.match(out, /showing the 1 newest/);
  assert.ok(!out.includes('First thing'));
});

// ─── Against the real file ────────────────────────────────────────────────────

test('real learnings.md parses and every entry has a category', async () => {
  const md = await readFile(LEARNINGS_PATH, 'utf8');
  const entries = parseEntries(md);
  assert.ok(entries.length > 40, `expected the full intake log, got ${entries.length}`);
  for (const e of entries) {
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(e.title.length > 0, 'entry must have a title');
  }
});

test('the entries this repo relies on are retrievable by their error text', async () => {
  const md = await readFile(LEARNINGS_PATH, 'utf8');
  const entries = parseEntries(md);
  const findBy = (term) =>
    entries.filter((e) => e.body.toLowerCase().includes(term.toLowerCase()));

  // Each of these cost a deploy cycle because learnings.md was not searchable.
  assert.ok(findBy('END_DOCUMENT').length, 'listener payload learning must be findable');
  assert.ok(findBy('defaulting to GET').length, 'workday-out-rest verb learning must be findable');
  assert.ok(findBy('cvc-complex-type').length, 'integration-system order learning must be findable');
  assert.ok(findBy('do not match').length, 'MVEL brace learning must be findable');
});

test('control: a term that appears nowhere returns no hits', async () => {
  const md = await readFile(LEARNINGS_PATH, 'utf8');
  const entries = parseEntries(md);
  const hits = entries.filter((e) => e.body.includes('zzzznotarealterm'));
  assert.equal(hits.length, 0, 'search must not match everything');
});
