import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAssemblyXml, buildDiagramXml } from '../src/tools/plan-integration.mjs';
import { validateAssembly } from '../src/assembly-validator.mjs';
import { BRIEF, subFlows } from './fixtures/assembly.mjs';

// ─── A ground-truth @mixed resolver ──────────────────────────────────────────
// Resolves diagram positional refs against the generated assembly by actually
// walking the mixed content model — an oracle independent of the scaffolder's
// own index formulas, so a wrong formula cannot "verify itself".

function findClose(s, tag, from) {
  const re = new RegExp(`<${tag}\\b[^>]*?(/?)>|</${tag}>`, 'g');
  re.lastIndex = from;
  let depth = 1, m;
  while ((m = re.exec(s)) !== null) {
    if (m[0].startsWith('</')) { if (--depth === 0) return m.index + m[0].length; }
    else if (m[1] !== '/') depth++;
  }
  return -1;
}

function mixedChildren(inner) {
  const nodes = [];
  let i = 0;
  while (i < inner.length) {
    if (inner[i] === '<') {
      const t = /^<([\w.:-]+)([^>]*?)(\/?)>/.exec(inner.slice(i));
      if (!t) break;
      const tag = t[1], selfClose = t[3] === '/';
      const openEnd = i + t[0].length;
      const end = selfClose ? openEnd : findClose(inner, tag, openEnd);
      const idM = /\bid="([^"]*)"/.exec(t[0]);
      nodes.push({
        type: 'elem', tag, id: idM ? idM[1] : null,
        inner: selfClose ? '' : inner.slice(openEnd, end - (tag.length + 3)),
      });
      i = end;
    } else {
      let j = inner.indexOf('<', i);
      if (j === -1) j = inner.length;
      nodes.push({ type: 'text' });
      i = j;
    }
  }
  return nodes;
}

function elementInner(xml, tag) {
  const open = new RegExp(`<${tag}\\b[^>]*?>`).exec(xml);
  const end = findClose(xml, tag, open.index + open[0].length);
  return xml.slice(open.index + open[0].length, end - (tag.length + 3));
}

function resolveMixed(asm, path) {
  const m = /#\/\/@beans\/@mixed\.(\d+)(?:\/@mixed\.(\d+))?(?:\/@mixed\.(\d+))?$/.exec(path);
  if (!m) return { err: 'not a positional path' };
  let node = mixedChildren(elementInner(asm, 'beans'))[+m[1]];
  if (!node || node.type !== 'elem') return { err: `@beans/@mixed.${m[1]} is not an element` };
  for (const idx of [m[2], m[3]].filter(x => x !== undefined)) {
    node = mixedChildren(node.inner)[+idx];
    if (!node || node.type !== 'elem') return { err: `@mixed.${idx} is not an element` };
  }
  return { tag: node.tag, id: node.id };
}

const idHrefs = (d) => [...d.matchAll(/href="assembly\.xml#([^"/@][^"]*)"/g)].map(m => m[1]);
const mixedHrefs = (d) => [...d.matchAll(/href="(assembly\.xml#\/\/@beans[^"]*)"/g)].map(m => m[1]);

// ─── Tests ───────────────────────────────────────────────────────────────────

for (const N of [1, 2, 3]) {
  test(`scaffold with ${N} sub-flow(s): every diagram href resolves`, () => {
    const sf = subFlows(N);
    const asm = buildAssemblyXml('INT999_Test', sf, BRIEF);
    const diag = buildDiagramXml('INT999_Test', sf);

    // No dangling id refs — regression guard for the End{SubFlowName} bug.
    const asmIds = new Set([...asm.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
    const dangling = idHrefs(diag).filter(id => !asmIds.has(id));
    assert.deepEqual(dangling, [], 'diagram references a non-existent element');
    assert.ok(!diag.includes('End'), 'no End{SubFlowName} refs may be emitted');

    // Every positional ref resolves to a real element.
    for (const href of mixedHrefs(diag)) {
      const r = resolveMixed(asm, href);
      assert.ok(!r.err, `${href}: ${r.err}`);
    }

    // Two-segment refs are the GlobalErrorHandler; three-segment are per-sub-flow send-errors.
    for (const h of mixedHrefs(diag).filter(x => (x.match(/@mixed/g) || []).length === 2)) {
      const r = resolveMixed(asm, h);
      assert.equal(r.tag, 'cc:send-error');
      assert.equal(r.id, 'GlobalErrorHandler');
    }
    const threeSeg = mixedHrefs(diag).filter(x => (x.match(/@mixed/g) || []).length === 3);
    assert.equal(threeSeg.length, N, 'one nested send-error ref per sub-flow');
    for (const h of threeSeg) {
      const r = resolveMixed(asm, h);
      assert.equal(r.tag, 'cc:send-error');
      assert.match(r.id, /Error$/);
    }
  });

  test(`scaffold with ${N} sub-flow(s): no arrows Studio would not draw`, () => {
    const sf = subFlows(N);
    const diag = buildDiagramXml('INT999_Test', sf);
    for (const s of sf) {
      // Call_X → X is a vm:// dispatch — Studio never draws it.
      assert.ok(
        !new RegExp(`<source href="assembly\\.xml#Call_${s.id}"/>\\s*<target href="assembly\\.xml#${s.id}"/>`).test(diag),
        `redundant vm dispatch arrow for ${s.id}`);
      // Do{X} is the sub-flow terminal — it has no outgoing arrow.
      assert.ok(!new RegExp(`<source href="assembly\\.xml#Do${s.id}"/>`).test(diag),
        `Do${s.id} must be terminal`);
    }
  });

  test(`scaffold with ${N} sub-flow(s) validates clean, reporting only its stubs`, () => {
    const sf = subFlows(N);
    const issues = validateAssembly(
      buildAssemblyXml('INT999_Test', sf, BRIEF), null, buildDiagramXml('INT999_Test', sf));

    // The contract: a fresh scaffold must be openable and deployable-shaped —
    // nothing that blocks Studio.
    const blocking = issues.filter(i => i.severity === 'ERROR' || i.severity === 'WARNING');
    assert.deepEqual(blocking, [],
      `scaffold must emit no ERROR or WARNING:\n${JSON.stringify(blocking, null, 2)}`);

    // A fresh scaffold is all stubs by definition, so the INFO findings are the
    // build-progress signal, not a defect. Assert them positively: this test
    // previously asserted zero findings and passed only because checkTodoStubs
    // matched an id form nothing emits, so the check never ran.
    const stubs = issues.find(i => i.code === 'TODO_STUBS_REMAINING');
    assert.ok(stubs, 'a fresh scaffold must report its unfilled sub-flows');
    assert.match(stubs.message, new RegExp(`^${N} sub-flow\\(s\\)`),
      `expected exactly ${N} stubbed sub-flows, got: ${stubs.message}`);
  });
}
