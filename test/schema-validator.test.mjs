import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateAssembly } from '../src/assembly-validator.mjs';
import { loadSchemaModel, checkSequenceOrder, checkMvelBraces } from '../src/schema-validator.mjs';

const HEAD = `<?xml version="1.0" encoding="UTF-8"?>
<beans xmlns="http://www.springframework.org/schema/beans"
     xmlns:cc="http://www.capeclear.com/assembly/10"
     xmlns:cloud="urn:com.workday/esb/cloud/10.0">
  <cc:assembly id="WorkdayAssembly" version="2024.37">`;
const TAIL = `  </cc:assembly>
</beans>`;

const wrap = (inner) => `${HEAD}\n${inner}\n${TAIL}`;

const codesOf = (xml) => validateAssembly(xml).map((i) => i.code);

// ─── The model itself ─────────────────────────────────────────────────────────

test('committed schema model is present and carries the sequences we rely on', () => {
  const model = loadSchemaModel();
  assert.ok(model, 'data/studio-schema-model.json must be committed so validation works without Studio');
  const is = model.sequences['integration-system'];
  assert.ok(Array.isArray(is), 'integration-system sequence must be extracted');
  assert.ok(
    is.indexOf('listener-service') < is.indexOf('custom-object-service'),
    'listener-service must precede custom-object-service',
  );
  assert.ok(model.mvelTemplateAttributes.length > 100, 'expected the full MVEL attribute set');
  for (const el of ['text', 'header-text', 'footer-text']) {
    assert.ok(model.mvelTemplateElements.includes(el), `${el} must be brace-checked`);
  }
});

// ─── 1. Sequence order ────────────────────────────────────────────────────────
//
// Reproduces the real failure: custom-object-service written before
// listener-service. Studio: "cvc-complex-type.2.4.a: Invalid content was found
// starting with element 'listener-service'."

const BAD_ORDER = wrap(`    <cc:workday-in id="StartHere" routes-to="Next">
      <cc:integration-system name="INT999">
        <cloud:custom-object-service name="INT999_CustomObj">
          <cloud:custom-object-alias name="alias"/>
        </cloud:custom-object-service>
        <cloud:listener-service name="INT999_Listener"/>
      </cc:integration-system>
    </cc:workday-in>`);

const GOOD_ORDER = wrap(`    <cc:workday-in id="StartHere" routes-to="Next">
      <cc:integration-system name="INT999">
        <cloud:listener-service name="INT999_Listener"/>
        <cloud:custom-object-service name="INT999_CustomObj">
          <cloud:custom-object-alias name="alias"/>
        </cloud:custom-object-service>
      </cc:integration-system>
    </cc:workday-in>`);

test('catches custom-object-service before listener-service', () => {
  const issues = [];
  checkSequenceOrder(BAD_ORDER, issues);
  assert.equal(issues.length, 1, 'exactly one ordering violation expected');
  assert.equal(issues[0].code, 'SCHEMA_SEQUENCE_ORDER');
  assert.equal(issues[0].severity, 'ERROR');
  assert.match(issues[0].message, /listener-service/);
  assert.match(issues[0].message, /must come before/);
});

test('CONTROL: the corrected order produces no ordering error', () => {
  const issues = [];
  checkSequenceOrder(GOOD_ORDER, issues);
  assert.deepEqual(issues, [], 'valid order must not be flagged — guards against a check that always fires');
});

test('nested grandchildren do not confuse direct-child ordering', () => {
  // custom-object-alias sits INSIDE custom-object-service; it must not be read
  // as a sibling of the service elements.
  const issues = [];
  checkSequenceOrder(GOOD_ORDER, issues);
  assert.equal(issues.length, 0);
});

// ─── 2. MVEL brace balance ────────────────────────────────────────────────────
//
// Reproduces both real failures: a cc:text with one stray '}', and a
// cc:header-text opening a JSON object it cannot close.

const BAD_TEXT = wrap(`    <cc:async-mediation id="Emit">
      <cc:steps>
        <cc:write id="WriteResponse" output-mimetype="application/json">
          <cc:message>
            <cc:text>@{props['rows']}], "total": @{props['n']}}</cc:text>
          </cc:message>
        </cc:write>
      </cc:steps>
    </cc:async-mediation>`);

const BAD_HEADER = wrap(`    <cc:aggregator id="Collect" routes-to="Next">
      <cc:message-content-collater>
        <cc:header-text>{"results": [</cc:header-text>
      </cc:message-content-collater>
    </cc:aggregator>`);

const GOOD_BALANCED = wrap(`    <cc:async-mediation id="Emit">
      <cc:steps>
        <cc:eval id="Build">
          <cc:expression>props['out'] = '{"results": [' + props['rows'] + ']}'</cc:expression>
        </cc:eval>
        <cc:write id="WriteResponse" output-mimetype="application/json">
          <cc:message>
            <cc:text>@{props['out']}</cc:text>
          </cc:message>
        </cc:write>
      </cc:steps>
    </cc:async-mediation>`);

test('catches an unbalanced cc:text', () => {
  const issues = [];
  checkMvelBraces(BAD_TEXT, issues);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'MVEL_BRACE_IMBALANCE');
  // Two @{...} openers, three closers — the last '}' is the stray literal.
  assert.match(issues[0].message, /2 '\{' vs 3 '\}'/);
  assert.match(issues[0].message, /cc:expression/, 'must point at the escape hatch');
});

test('catches a cc:header-text that opens a brace it cannot close', () => {
  const issues = [];
  checkMvelBraces(BAD_HEADER, issues);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /1 '\{' vs 0 '\}'/);
});

test('CONTROL: braces inside cc:expression are NOT flagged', () => {
  // cc:expression is MVELExpressionType — Studio does not brace-check it, and
  // flagging it would break the documented workaround.
  const issues = [];
  checkMvelBraces(GOOD_BALANCED, issues);
  assert.deepEqual(issues, [], 'cc:expression braces and a balanced cc:text must both pass');
});

test('literal JSON balanced within one cc:text passes', () => {
  const ok = wrap(`    <cc:write id="Body" output-mimetype="application/json">
      <cc:message>
        <cc:text>{ "worker": { "id": "@{props['wid']}" }, "serial": "@{props['s']}" }</cc:text>
      </cc:message>
    </cc:write>`);
  const issues = [];
  checkMvelBraces(ok, issues);
  assert.deepEqual(issues, []);
});

test('entity-encoded and CDATA forms of the same value agree', () => {
  // Studio rewrites CDATA as &quot; entities on save; both must give one verdict.
  const cdata = wrap(`    <cc:write id="W"><cc:message><cc:text><![CDATA[{"a": "@{props['x']}"}]]></cc:text></cc:message></cc:write>`);
  const entity = wrap(`    <cc:write id="W"><cc:message><cc:text>{&quot;a&quot;: &quot;@{props['x']}&quot;}</cc:text></cc:message></cc:write>`);
  const a = []; const b = [];
  checkMvelBraces(cdata, a);
  checkMvelBraces(entity, b);
  assert.deepEqual(a, [], 'CDATA form is balanced');
  assert.deepEqual(b, [], 'entity form is balanced');
});

test('unbalanced MVEL template ATTRIBUTE is caught', () => {
  const bad = wrap(`    <cc:local-out id="Put" endpoint="vm://wcc/PutIntegrationMessage">
      <cc:set name="is.message.summary" value="'x'"/>
    </cc:local-out>
    <cc:cloud-log id="Log" message="loaded @{props['n']}} records"/>`);
  const issues = [];
  checkMvelBraces(bad, issues);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /@message/);
});

// ─── Wired into validate_assembly ─────────────────────────────────────────────

test('validateAssembly surfaces both new codes', () => {
  assert.ok(codesOf(BAD_ORDER).includes('SCHEMA_SEQUENCE_ORDER'));
  assert.ok(codesOf(BAD_TEXT).includes('MVEL_BRACE_IMBALANCE'));
});

test('CONTROL: a clean assembly gains no new schema errors', () => {
  const codes = codesOf(GOOD_ORDER);
  assert.ok(!codes.includes('SCHEMA_SEQUENCE_ORDER'), `unexpected: ${codes.join(', ')}`);
  assert.ok(!codes.includes('MVEL_BRACE_IMBALANCE'), `unexpected: ${codes.join(', ')}`);
});

test('issues carry a line number for the offending value', () => {
  const issues = [];
  checkMvelBraces(BAD_TEXT, issues);
  assert.equal(typeof issues[0].line, 'number');
  assert.ok(issues[0].line > 1);
});
