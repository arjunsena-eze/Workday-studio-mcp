import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scanForIdentifiers } from '../src/learnings-store.mjs';
import { parseEntries, renderIndex, renderHits } from '../src/tools/search-learnings.mjs';

// ─── Identifier scanning ──────────────────────────────────────────────────────
//
// This gate is what stands between a client's detail and a public repo, so it is
// tested against the real shapes that appeared in a live engagement — with the
// values themselves altered.

test('flags a client integration ID but not the INT999 placeholder', () => {
  assert.ok(scanForIdentifiers('INT042B_Some_Inbound failed').length, 'client INT id must be caught');
  assert.ok(scanForIdentifiers('INT-042 failed').length, 'hyphenated form must be caught');
  assert.deepEqual(scanForIdentifiers('INT999 failed'), [], 'the placeholder must pass');
});

test('flags a Workday WID', () => {
  const found = scanForIdentifiers('bound to 1234abcd5678ef901234abcd5678ef90');
  assert.ok(found.some((f) => /WID/.test(f)), `expected a WID match, got ${found.join(', ')}`);
});

test('flags a tenant hostname and a ccx tenant path', () => {
  assert.ok(scanForIdentifiers('POST https://impl-services9.wd999.myworkday.com/ccx/api/v1/acme/x').length);
  assert.ok(scanForIdentifiers('/ccx/api/v1/acmecorp/customObjects/thing').length);
});

test('does NOT flag a ccx path already using the placeholder', () => {
  assert.deepEqual(
    scanForIdentifiers('URL=/ccx/api/v1/<TENANT>/customObjects/alias?updateIfExists=true'),
    [],
    'the documented placeholder form must be publishable',
  );
});

test('flags an internal Workday host and a server log id', () => {
  assert.ok(scanForIdentifiers('endpoint http://sir-impl-wd999.sir:11710/ccx').length);
  assert.ok(scanForIdentifiers('see server-ab12cd34ef56ab78cd90 for detail').length);
});

test('flags an email address but allows example.com', () => {
  assert.ok(scanForIdentifiers('contact someone@acme.com').length);
  assert.deepEqual(scanForIdentifiers('contact someone@example.com'), []);
});

test('CONTROL: a properly generalized entry passes cleanly', () => {
  // Close to a real published entry — this must not be blocked, or the gate is
  // useless and people will route everything to private.
  const found = scanForIdentifiers(
    'cc:workday-out-rest defaults to GET',
    'The server log showed: REST Method Type not set, defaulting to GET, then 404 Not Found.',
    'Set method="POST" explicitly. Verified in a live run against INT999 in tenant <TENANT>. '
      + 'The attribute is typed tns:MVELHttpMethodType, accepting GET, POST, PUT, DELETE, PATCH.',
    '<cc:workday-out-rest id="PostRecord" method="POST" extra-path="..."/>',
  );
  assert.deepEqual(found, [], `generalized entry must not be flagged, got: ${found.join('; ')}`);
});

test('scan names every distinct problem so a refusal is actionable', () => {
  const found = scanForIdentifiers('INT042B on https://impl-services9.wd999.myworkday.com wid 1234abcd5678ef901234abcd5678ef90');
  assert.ok(found.length >= 3, `expected multiple labels, got: ${found.join('; ')}`);
  for (const label of found) assert.ok(label.length > 3, 'labels must be human-readable');
});

// ─── Public / private separation in search ────────────────────────────────────

const PUBLIC_MD = `# Studio Learnings

### [2026-02-01] Public finding
**Category**: HTTP
**Trigger**: something
**Pattern**: generalized guidance
**Promote to**: patterns.md
**Status**: raw
`;

const PRIVATE_MD = `# Studio Learnings — LOCAL ONLY

### [2026-02-02] Client specific finding
**Category**: HTTP
**Trigger**: tenant returned 404
**Pattern**: the alias was unbound in that tenant
**Promote to**: patterns.md
**Status**: raw
`;

function combined() {
  return [
    ...parseEntries(PUBLIC_MD).map((e) => ({ ...e, scope: 'public' })),
    ...parseEntries(PRIVATE_MD).map((e) => ({ ...e, scope: 'private' })),
  ];
}

test('index labels local entries and warns about them', () => {
  const out = renderIndex(combined());
  assert.match(out, /\[LOCAL\] \[2026-02-02\]/, 'private entry must be marked');
  assert.ok(!/\[LOCAL\] \[2026-02-01\]/.test(out), 'public entry must NOT be marked');
  assert.match(out, /gitignored/, 'must explain what LOCAL means');
});

test('search results label local entries and carry a handling warning', () => {
  const out = renderHits(combined(), { search: 'finding', limit: 6 });
  assert.match(out, /🔒/, 'must warn when a local result is included');
  assert.match(out, /strip identifiers/, 'must say what not to do with it');
  assert.match(out, /\[LOCAL\]/);
});

test('CONTROL: public-only results carry no local warning', () => {
  const out = renderHits(parseEntries(PUBLIC_MD).map((e) => ({ ...e, scope: 'public' })),
    { search: 'finding', limit: 6 });
  assert.ok(!out.includes('🔒'), 'no local banner when nothing is local');
  assert.ok(!out.includes('[LOCAL]'));
});

test('private entries are still findable — the point of searching both', () => {
  const hits = combined().filter((e) => e.body.toLowerCase().includes('alias was unbound'));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].scope, 'private');
});
