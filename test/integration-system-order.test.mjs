import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAssemblyXml } from '../src/tools/plan-integration.mjs';

/**
 * cc:integration-system's children are an xsd:sequence in Studio's
 * integration-system.xsd, so their order is mandatory. Emitting them in any
 * other order fails validation on Studio open with:
 *
 *   cvc-complex-type.2.4.a: Invalid content was found starting with element
 *   '{"urn:com.workday/esb/cloud/10.0":attribute-map-service}'...
 *
 * Verified against integration-system.xsd, shipped inside the Studio install at
 * plugins/com.workday.sh.common.ui_<version>/schemas/assembly/
 */
const SCHEMA_ORDER = [
  'param',
  'attribute-map-service',
  'sequence-generator-service',
  'transaction-log-service',
  'delivery-service',
  'retrieval-service',
  'report-service',
  'listener-service',
  'custom-object-service',
  'service-reference',
  'data-initialization-service',
];

const SUB_FLOWS = [{ id: 'DoWork', description: 'Does the work.' }];

/** Names of the direct cloud:* children of cc:integration-system, in document order. */
function cloudChildren(xml) {
  const block = /<cc:integration-system\b[^>]*>([\s\S]*?)<\/cc:integration-system>/.exec(xml);
  assert.ok(block, 'assembly has a cc:integration-system element');
  const names = [];
  let depth = 0;
  const re = /<(\/?)cloud:([\w-]+)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(block[1])) !== null) {
    const [, closing, name, , selfClose] = m;
    if (closing) { depth--; continue; }
    if (depth === 0) names.push(name);
    if (!selfClose) depth++;
  }
  return names;
}

/** Returns the first out-of-sequence pair, or null when the order is legal. */
function firstOrderViolation(names) {
  let high = -1, highName = null;
  for (const n of names) {
    const rank = SCHEMA_ORDER.indexOf(n);
    if (rank === -1) continue;
    if (rank < high) return { after: highName, before: n };
    high = rank; highName = n;
  }
  return null;
}

// Each case previously produced schema-invalid output — the scaffolder emitted
// report/retrieval/listener before attribute-map-service, and param last.
const CASES = [
  {
    name: 'inbound-file + api-key (retrieval + attributes)',
    brief: { data_source: 'inbound-file', data_destination: 'external-rest', trigger: 'event-driven', record_volume: 'large', external_auth: 'api-key', error_handling: ['integration-messages'] },
    expect: ['attribute-map-service', 'retrieval-service'],
  },
  {
    name: 'raas + oauth2 (report + attributes)',
    brief: { data_source: 'raas', data_destination: 'external-rest', trigger: 'scheduled', record_volume: 'small', external_auth: 'oauth2', error_handling: ['integration-messages'], raas_reports: [{ alias: 'Workers', description: 'All workers' }] },
    expect: ['attribute-map-service', 'report-service'],
  },
  {
    name: 'webhook + basic (listener + attributes)',
    brief: { data_source: 'webhook', data_destination: 'workday-soap-write', trigger: 'event-driven', record_volume: 'single', external_auth: 'basic', error_handling: ['integration-messages'] },
    expect: ['attribute-map-service', 'listener-service'],
  },
  {
    name: 'raas + manual launch params + api-key (param first of all)',
    brief: { data_source: 'raas', data_destination: 'file-delivery', trigger: 'launch-params-manual', record_volume: 'small', external_auth: 'api-key', error_handling: ['integration-messages'], raas_reports: [{ alias: 'Workers', description: 'All workers', filter_params: ['Worker!WID', 'Effective_Date'] }] },
    expect: ['attribute-map-service', 'report-service'],
  },
];

for (const c of CASES) {
  test(`integration-system children follow the schema sequence — ${c.name}`, () => {
    const xml = buildAssemblyXml('INT999_Test', SUB_FLOWS, c.brief);
    const names = cloudChildren(xml);
    const violation = firstOrderViolation(names);
    assert.equal(
      violation, null,
      violation
        ? `<cloud:${violation.before}> must come before <cloud:${violation.after}>. Emitted order: ${names.join(', ')}`
        : '',
    );
    for (const expected of c.expect) {
      assert.ok(names.includes(expected), `expected a cloud:${expected}; got: ${names.join(', ')}`);
    }
  });
}

test('param, when present, precedes every service element', () => {
  const xml = buildAssemblyXml('INT999_Test', SUB_FLOWS, CASES[3].brief);
  const names = cloudChildren(xml);
  const firstParam = names.indexOf('param');
  const firstService = names.findIndex(n => n.endsWith('-service'));
  if (firstParam !== -1 && firstService !== -1) {
    assert.ok(firstParam < firstService, `cloud:param must precede services. Order: ${names.join(', ')}`);
  }
});

// Guards the checker itself. Without this, a firstOrderViolation() that always
// returned null would make every test above pass silently.
test('the order checker actually fires on a bad sequence', () => {
  const bad = ['report-service', 'attribute-map-service'];
  const v = firstOrderViolation(bad);
  assert.notEqual(v, null, 'checker must reject report-service before attribute-map-service');
  assert.equal(v.before, 'attribute-map-service');
  assert.equal(v.after, 'report-service');

  assert.equal(firstOrderViolation(['param', 'attribute-map-service', 'retrieval-service', 'report-service']), null);
});
