// Renders the design-brief form from the live zod schema served by /api/schema,
// so adding a field to DesignBriefSchema in the MCP surfaces here with no edit.

const form       = document.getElementById('brief-form');
const fieldsHost = document.getElementById('schema-fields');
const statusEl   = document.getElementById('form-status');
const resultEl   = document.getElementById('result');
const resultBody = document.getElementById('result-body');
const submitBtn  = document.getElementById('generate-btn');

let schema = {};

/** Field groups, so the form reads like a conversation rather than a schema dump. */
const GROUPS = [
  { title: 'Shape',            fields: ['data_source', 'data_destination', 'trigger', 'record_volume', 'external_auth'] },
  { title: 'Error handling',   fields: ['error_handling'] },
  { title: 'Reports & operations', fields: ['raas_reports', 'soap_operations'] },
  { title: 'Configuration',    fields: ['integration_attributes'] },
  { title: 'Design notes',     fields: ['conditional_logic', 'notes'] },
];

/**
 * When a field is irrelevant we hide it rather than let the user fill in
 * something the generator will ignore. Mirrors checkBriefConsistency() server-side.
 */
const RELEVANCE = {
  raas_reports: b => ['raas', 'multiple'].includes(b.data_source),
  soap_operations: b =>
    ['soap-get', 'multiple'].includes(b.data_source) ||
    ['workday-soap-write', 'multiple'].includes(b.data_destination),
};

const titleCase = k => k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// ─── field renderers ─────────────────────────────────────────────────────────

function renderEnum(key, def) {
  const wrap = el('div', 'field');
  wrap.append(el('span', 'label', titleCase(key) + (def.optional ? ' (optional)' : '')));
  const choices = el('div', 'choices');
  for (const [i, opt] of def.options.entries()) {
    const lab = el('label', 'choice');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = key;
    input.value = opt;
    // Optional enums start unset; required ones default to the first option so
    // the form is always in a submittable state.
    if (!def.optional && i === 0) input.checked = true;
    lab.append(input, document.createTextNode(opt));
    choices.append(lab);
  }
  wrap.append(choices);
  if (def.description) wrap.append(el('span', 'hint', def.description));
  return wrap;
}

function renderMultiEnum(key, def) {
  const wrap = el('div', 'field');
  wrap.append(el('span', 'label', titleCase(key)));
  const choices = el('div', 'choices');
  for (const opt of def.options) {
    const lab = el('label', 'choice');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = key;
    input.value = opt;
    // Integration messages are the documented minimum for any integration.
    if (opt === 'integration-messages') input.checked = true;
    lab.append(input, document.createTextNode(opt));
    choices.append(lab);
  }
  wrap.append(choices);
  if (def.description) wrap.append(el('span', 'hint', def.description));
  return wrap;
}

function renderString(key, def) {
  const wrap = el('div', 'field');
  wrap.append(el('span', 'label', titleCase(key) + (def.optional ? ' (optional)' : '')));
  const long = key === 'notes' || key === 'conditional_logic';
  const input = document.createElement(long ? 'textarea' : 'input');
  if (!long) input.type = 'text';
  input.name = key;
  input.spellcheck = long;
  wrap.append(input);
  if (def.description) wrap.append(el('span', 'hint', def.description));
  return wrap;
}

function renderObjectList(key, def) {
  const wrap = el('div', 'field');
  wrap.append(el('span', 'label', titleCase(key) + (def.optional ? ' (optional)' : '')));
  if (def.description) wrap.append(el('span', 'hint', def.description));

  const rep = el('div', 'repeater');
  rep.dataset.field = key;
  const rows = el('div', 'rows');
  const note = el('p', 'empty-note', 'None added yet.');
  const add = el('button', 'add-row', `+ Add ${titleCase(key).replace(/s$/, '').toLowerCase()}`);
  add.type = 'button';

  const sync = () => { note.hidden = rows.children.length > 0; };

  add.addEventListener('click', () => {
    rows.append(buildRow(def.fields, sync));
    sync();
  });

  rep.append(note, rows, add);
  wrap.append(rep);
  sync();
  return wrap;
}

function buildRow(fields, onRemove) {
  const row = el('div', 'row');
  for (const [name, fdef] of Object.entries(fields)) {
    const isBool = fdef.kind === 'boolean';
    const sub = el('label', isBool ? 'sub-field check' : 'sub-field');
    const input = document.createElement('input');
    input.type = isBool ? 'checkbox' : 'text';
    input.dataset.sub = name;
    input.dataset.kind = fdef.kind;
    if (fdef.kind === 'string-list') input.placeholder = 'comma, separated';
    if (fdef.description) input.title = fdef.description;
    if (isBool) sub.append(input, el('span', 'label', titleCase(name)));
    else sub.append(el('span', 'label', titleCase(name)), input);
    row.append(sub);
  }
  const rm = el('button', 'row-remove', 'Remove');
  rm.type = 'button';
  rm.addEventListener('click', () => { row.remove(); onRemove(); });
  row.append(rm);
  return row;
}

// ─── form assembly ───────────────────────────────────────────────────────────

function renderForm() {
  fieldsHost.replaceChildren();
  const rendered = new Set();

  for (const group of GROUPS) {
    const present = group.fields.filter(f => schema[f]);
    if (!present.length) continue;
    const card = el('section', 'card');
    card.append(el('h2', null, group.title));
    for (const key of present) {
      card.append(renderField(key, schema[key]));
      rendered.add(key);
    }
    fieldsHost.append(card);
  }

  // Anything added to DesignBriefSchema that GROUPS doesn't know about still
  // shows up, rather than being silently dropped.
  const extras = Object.keys(schema).filter(k => !rendered.has(k));
  if (extras.length) {
    const card = el('section', 'card');
    card.append(el('h2', null, 'Other'));
    for (const key of extras) card.append(renderField(key, schema[key]));
    fieldsHost.append(card);
  }

  applyRelevance();
  form.addEventListener('change', applyRelevance);
}

function renderField(key, def) {
  const node = def.kind === 'enum'        ? renderEnum(key, def)
             : def.kind === 'multi-enum'  ? renderMultiEnum(key, def)
             : def.kind === 'object-list' ? renderObjectList(key, def)
             : renderString(key, def);
  node.dataset.fieldName = key;
  return node;
}

function applyRelevance() {
  const brief = collectBrief();
  for (const [key, test] of Object.entries(RELEVANCE)) {
    const node = fieldsHost.querySelector(`[data-field-name="${key}"]`);
    if (node) node.classList.toggle('hidden-field', !test(brief));
  }
}

// ─── collect ─────────────────────────────────────────────────────────────────

function collectBrief() {
  const brief = {};
  for (const [key, def] of Object.entries(schema)) {
    if (def.kind === 'enum') {
      const sel = form.querySelector(`input[name="${key}"]:checked`);
      if (sel) brief[key] = sel.value;
    } else if (def.kind === 'multi-enum') {
      brief[key] = [...form.querySelectorAll(`input[name="${key}"]:checked`)].map(i => i.value);
    } else if (def.kind === 'object-list') {
      const rep = fieldsHost.querySelector(`.repeater[data-field="${key}"]`);
      const rows = rep ? [...rep.querySelectorAll('.row')] : [];
      const items = rows.map(row => {
        const obj = {};
        for (const input of row.querySelectorAll('[data-sub]')) {
          const { sub, kind } = input.dataset;
          if (kind === 'boolean') obj[sub] = input.checked;
          else if (kind === 'string-list') {
            const parts = input.value.split(',').map(s => s.trim()).filter(Boolean);
            if (parts.length) obj[sub] = parts;
          } else if (input.value.trim()) obj[sub] = input.value.trim();
        }
        return obj;
      }).filter(o => Object.keys(o).length > 0);
      if (items.length) brief[key] = items;
    } else {
      const input = form.querySelector(`[name="${key}"]`);
      if (input && input.value.trim()) brief[key] = input.value.trim();
    }
  }

  // Drop fields the current shape makes irrelevant, so a stale hidden row
  // cannot reach the server.
  for (const [key, test] of Object.entries(RELEVANCE)) {
    if (!test(brief)) delete brief[key];
  }
  return brief;
}

// ─── result rendering ────────────────────────────────────────────────────────

function showResult(data) {
  resultBody.replaceChildren();
  const v = data.validation;

  const verdict = el('div', 'verdict');
  verdict.append(
    mk(v.errors === 0 ? 'ok' : 'err', `${v.errors} error${v.errors === 1 ? '' : 's'}`),
    mk(v.warnings ? 'warn' : 'ok', `${v.warnings} warning${v.warnings === 1 ? '' : 's'}`),
    mk('', `${v.info} info`),
    mk('', `${data.sub_flows.length} sub-flows`),
  );
  resultBody.append(el('p', null, `Written to ${data.project_path}`), verdict);

  resultBody.append(el('h3', null, 'Sub-flow chain'));
  const chain = el('ul', 'chain');
  for (const sf of data.sub_flows) {
    const li = el('li');
    li.append(el('span', 'flow-id', sf.id), el('span', 'flow-desc', sf.description));
    chain.append(li);
  }
  resultBody.append(chain);

  if (data.derivation_notes?.length) {
    resultBody.append(el('h3', null, 'What you still need to wire by hand'));
    const ul = el('ul', 'notes');
    for (const n of data.derivation_notes) ul.append(el('li', null, n));
    resultBody.append(ul);
  }

  if (v.issues.length) {
    resultBody.append(el('h3', null, 'Validation detail'));
    const ul = el('ul', 'issues');
    for (const i of v.issues) {
      const li = el('li');
      const sev = el('span', `sev ${i.severity === 'ERROR' ? 'err' : i.severity === 'WARNING' ? 'warn' : ''}`, i.severity);
      li.append(sev, document.createTextNode(`${i.code ? i.code + ' — ' : ''}${i.message}${i.line ? ` (line ${i.line})` : ''}`));
      ul.append(li);
    }
    resultBody.append(ul);
  }

  resultBody.append(el('h3', null, 'Files written'));
  const files = el('ul', 'files');
  for (const f of data.files_written) files.append(el('li', null, f));
  resultBody.append(files);

  if (data.warning) resultBody.append(el('p', 'warn', data.warning));

  if (data.downloadable) {
    const a = el('a', 'download', `Download ${data.project}.zip`);
    a.href = `/api/download?project=${encodeURIComponent(data.project)}`;
    resultBody.append(a);
  } else {
    resultBody.append(el('p', 'blocked',
      'Download blocked: the project has validation errors. Fix them, then re-validate.'));
  }

  resultEl.hidden = false;
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function mk(cls, text) { return el('span', cls, text); }

function showError(payload, status) {
  resultBody.replaceChildren();
  const box = el('div', 'errbox');
  box.append(el('h3', null, `${payload.error ?? 'Error'} (HTTP ${status})`));
  box.append(el('p', null, payload.message ?? 'Unknown error.'));

  const d = payload.detail;
  if (Array.isArray(d)) {
    const ul = el('ul', 'notes');
    for (const item of d) {
      ul.append(el('li', null, typeof item === 'string' ? item : `${item.field}: ${item.message}`));
    }
    box.append(ul);
  } else if (typeof d === 'string') {
    box.append(el('p', 'hint', d));
  }

  resultBody.append(box);
  resultEl.hidden = false;
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── wire up ─────────────────────────────────────────────────────────────────

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  statusEl.textContent = 'Generating…';
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_name: document.getElementById('project_name').value.trim(),
        design_brief: collectBrief(),
      }),
    });
    const payload = await res.json();
    if (res.ok) {
      statusEl.textContent = payload.validation.errors === 0 ? 'Generated and validated.' : 'Generated with errors.';
      showResult(payload);
    } else {
      statusEl.textContent = 'Not generated.';
      showError(payload, res.status);
    }
  } catch (err) {
    statusEl.textContent = '';
    showError({ error: 'NETWORK', message: err.message }, 0);
  } finally {
    submitBtn.disabled = false;
  }
});

(async function init() {
  try {
    const res = await fetch('/api/schema');
    const data = await res.json();
    schema = data.fields;
    document.getElementById('workspace').textContent =
      `${data.workspace} [${data.active_workspace}]`;
    renderForm();
  } catch (err) {
    fieldsHost.replaceChildren(el('p', 'err', `Could not load the schema: ${err.message}`));
  }
})();
