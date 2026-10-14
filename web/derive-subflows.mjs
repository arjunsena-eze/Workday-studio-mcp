// ─────────────────────────────────────────────────────────────────────────────
// Deterministic design-brief → sub-flow decomposition.
//
// plan_integration takes `sub_flows` as a SEPARATE input from `design_brief`,
// because normally an LLM decides the decomposition after talking to the user.
// The web form has no LLM in the loop, so this module replaces that judgement
// with rules. It is intentionally conservative: it emits the sub-flows that a
// brief unambiguously implies and nothing speculative, so every stub it writes
// is one a human would have written too.
//
// The chain it returns is LINEAR — plan_integration wires sub-flow N to N+1 via
// Call_{id} → vm:// → local-in {id}. Real integrations sometimes need a
// splitter fanning out to a per-record sub-flow instead of a straight chain;
// where that applies we still emit the sub-flow and record a rewiring note in
// `notes` rather than quietly producing the wrong topology.
// ─────────────────────────────────────────────────────────────────────────────

/** PascalCase a free-text label into a legal sub-flow id fragment. */
function pascal(text) {
  return String(text ?? '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1))
    .join('');
}

/**
 * Turn a RAAS alias into a sub-flow id fragment.
 * Strips the INT-number prefix and a trailing "Report", both of which are
 * naming convention rather than meaning: "INT999_Sample_Worker_Report" → "SampleWorker".
 */
function aliasFragment(alias) {
  let frag = pascal(String(alias ?? '').replace(/^INT\d+[_\s-]*/i, ''));
  frag = frag.replace(/Report$/, '');
  return frag;
}

/** Sub-flow ids must be unique — plan_integration derives vm:// endpoints from them. */
function uniquifier() {
  const seen = new Set();
  return (candidate, fallback) => {
    let id = candidate && /^[A-Za-z]/.test(candidate) ? candidate : fallback;
    if (!id) id = fallback;
    if (id.length > 40) id = id.slice(0, 40);
    let out = id, n = 2;
    while (seen.has(out)) out = `${id}${n++}`;
    seen.add(out);
    return out;
  };
}

/**
 * Derive an ordered sub-flow list from a design brief.
 * @returns {{ sub_flows: Array, notes: string[] }} notes are advisory messages
 *          surfaced in the UI — things the skeleton cannot decide for you.
 */
export function deriveSubFlows(brief) {
  const uniq  = uniquifier();
  const flows = [];
  const notes = [];

  const auth       = brief.external_auth ?? 'none';
  const attrs      = brief.integration_attributes ?? [];
  const reports    = brief.raas_reports ?? [];
  const soapOps    = brief.soap_operations ?? [];
  const errModes   = brief.error_handling ?? [];
  const source     = brief.data_source;
  const dest       = brief.data_destination;
  const volume     = brief.record_volume;

  const usesRaas = source === 'raas' || (source === 'multiple' && reports.length > 0);
  const soapGets   = soapOps.filter(o => o.direction === 'get');
  const soapWrites = soapOps.filter(o => o.direction === 'write');

  // 1 ── Attributes. Any stored config or credential has to be read into props
  //      before anything else can use it. Non-'none' auth implies attributes
  //      even when the user listed none explicitly.
  if (attrs.length > 0 || auth !== 'none') {
    const named = attrs.map(a => `Attr_${pascal(a.name)}`);
    flows.push({
      id: uniq('LoadAttrs', 'LoadAttrs'),
      description: 'Read integration system attributes into props and build any static auth header',
      reads_props: [],
      writes_props: named.length ? named : ['Attr_ApiUrl'],
    });
    if (auth === 'basic' || auth === 'api-key') {
      notes.push(
        `external_auth is "${auth}" — the header is a single eval, so it is folded into ` +
        'LoadAttrs rather than given its own sub-flow.',
      );
    }
  }

  // 2 ── OAuth2 is a real HTTP round-trip, so it earns its own sub-flow.
  //      Static schemes (basic / api-key) do not — see the note above.
  if (auth === 'oauth2') {
    flows.push({
      id: uniq('AuthToken', 'AuthToken'),
      description: 'Exchange client credentials for a bearer token and cache it in props',
      reads_props: ['Attr_ClientId', 'Attr_ClientSecret', 'Attr_TokenUrl'],
      writes_props: ['Calc_BearerToken', 'Calc_TokenExpiry'],
    });
  }

  // 3 ── Source. One sub-flow per concrete source the brief names, so each
  //      retrieval is independently testable.
  if (usesRaas) {
    if (reports.length === 0) {
      notes.push('data_source is "raas" but no reports were listed — emitted a single generic RAAS sub-flow.');
      flows.push({
        id: uniq('RaasData', 'RaasData'),
        description: 'Call the RAAS report and hold the Report_Entry rows as the message',
        writes_props: ['Calc_RecordCount'],
      });
    }
    for (const [i, r] of reports.entries()) {
      const frag = aliasFragment(r.alias);
      flows.push({
        id: uniq(frag ? `Raas${frag}` : '', `RaasSource${i + 1}`),
        description: r.description || `Call RAAS report ${r.alias} and hold its Report_Entry rows`,
        reads_props: (r.filter_params ?? [])
          .filter(p => !p.includes('='))
          .map(p => `Calc_${pascal(p)}`),
        writes_props: ['Calc_RecordCount'],
      });
    }
  }

  for (const op of soapGets) {
    flows.push({
      id: uniq(`WD${pascal(op.operation)}`, 'WDGetData'),
      description: `Call Workday SOAP ${op.operation} (${op.application} v${op.version}) and hold the response`,
      writes_props: ['Calc_RecordCount'],
    });
  }

  if (source === 'inbound-file') {
    flows.push({
      id: uniq('InboundFile', 'InboundFile'),
      description: 'Retrieve the uploaded file from the integration event and parse it into XML',
      writes_props: ['Calc_RecordCount', 'Calc_SourceFileName'],
    });
  }
  if (source === 'webhook') {
    flows.push({
      id: uniq('EventPayload', 'EventPayload'),
      description: 'Accept the Workday event payload and extract the subject reference',
      writes_props: ['Calc_SubjectWid'],
    });
  }
  if (source === 'external-rest' || (source === 'multiple' && !usesRaas && soapGets.length === 0)) {
    flows.push({
      id: uniq('ExternalData', 'ExternalData'),
      description: 'GET the source records from the external REST API',
      reads_props: auth === 'oauth2' ? ['Calc_BearerToken'] : ['Attr_ApiUrl'],
      writes_props: ['Calc_RecordCount'],
    });
  }

  // 4 ── Transform. Always present: the source shape is never the target shape.
  flows.push({
    id: uniq('OutboundPayload', 'OutboundPayload'),
    description: 'Transform the source data into the shape the destination expects (xslt-plus)',
    reads_props: ['Calc_RecordCount'],
  });

  // 5 ── Per-record work. Only when there is more than one record AND the
  //      destination is a per-record call rather than one bulk delivery.
  const perRecordDest = ['workday-soap-write', 'workday-rest-write', 'external-rest', 'multiple'].includes(dest);
  if (volume !== 'single' && perRecordDest) {
    const splitter = volume === 'large' ? 'xml-stream-splitter' : 'xpath-splitter';
    const id = uniq('RecordUpdate', 'RecordUpdate');
    flows.push({
      id,
      description: `Process one record: validate it, call the destination, record the outcome (invoked per record by ${splitter})`,
      reads_props: ['Calc_RecordCount'],
      writes_props: ['Calc_SuccessCount', 'Calc_FailureCount'],
    });
    notes.push(
      `record_volume is "${volume}" with a per-record destination, so ${splitter === 'xml-stream-splitter' ? 'an' : 'a'} ${splitter} is needed. ` +
      `The skeleton chains ${id} linearly — put the ${splitter} in the preceding sub-flow and ` +
      `point its route at vm://{integration}/${id} to make it a real per-record loop.`,
    );
  }

  // 6 ── Destination.
  for (const op of soapWrites) {
    flows.push({
      id: uniq(`WD${pascal(op.operation)}`, 'WDWrite'),
      description: `Call Workday SOAP ${op.operation} (${op.application} v${op.version}) to update Workday`,
    });
  }
  if (dest === 'workday-soap-write' && soapWrites.length === 0) {
    notes.push('data_destination is "workday-soap-write" but no write operations were listed — emitted a generic write sub-flow.');
    flows.push({ id: uniq('WorkdayWrite', 'WorkdayWrite'), description: 'Call the Workday SOAP write operation' });
  }
  if (dest === 'workday-rest-write') {
    flows.push({ id: uniq('WorkdayRestWrite', 'WorkdayRestWrite'), description: 'PUT/POST the payload to the Workday REST custom object' });
  }
  if (dest === 'external-rest' || (dest === 'multiple' && soapWrites.length === 0)) {
    flows.push({
      id: uniq('ExternalPost', 'ExternalPost'),
      description: 'POST/PATCH the payload to the external REST API and check the response',
      reads_props: auth === 'oauth2' ? ['Calc_BearerToken'] : ['Attr_ApiUrl'],
    });
  }
  if (dest === 'file-delivery') {
    flows.push({
      id: uniq('FileDelivery', 'FileDelivery'),
      description: 'Store the output document and attach it to the integration event as a deliverable',
      reads_props: ['Calc_RecordCount'],
      writes_props: ['Calc_OutputFileName'],
    });
  }
  if (dest === 'email-only') {
    flows.push({
      id: uniq('EmailDelivery', 'EmailDelivery'),
      description: 'Build and send the notification email',
      reads_props: ['Calc_RecordCount'],
    });
  }

  // 7 ── Failure notification, if asked for. Always last: it is invoked from
  //      the error handlers, not from the happy path.
  if (errModes.includes('email-notification')) {
    const id = uniq('FailureEmail', 'FailureEmail');
    flows.push({
      id,
      description: 'Send the failure notification email (invoked from the error handlers)',
    });
    notes.push(
      `error_handling includes "email-notification", so ${id} is emitted. It sits in the linear ` +
      `chain as generated — repoint the send-error handlers at vm://{integration}/${id} so it ` +
      'only runs on failure.',
    );
  }

  if (errModes.includes('rethrow') && errModes.includes('integration-messages')) {
    notes.push(
      'error_handling has both "rethrow" and "integration-messages": the generated handlers log ' +
      'to the event first, then rethrow. Set rethrow-error="true" on the send-error steps that ' +
      'should actually stop the run.',
    );
  }

  return { sub_flows: flows, notes };
}
