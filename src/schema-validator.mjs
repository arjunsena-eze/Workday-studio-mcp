/**
 * Schema-derived checks that rule-based inspection cannot do.
 *
 * Both checks here exist because a hand-written linter reported an assembly
 * clean and Studio then rejected it on open. They are driven by
 * data/studio-schema-model.json, distilled from the XSDs shipped in the Studio
 * install by bin/extract-schema-model.mjs. The model is committed, so these run
 * on machines that have never had Studio installed.
 *
 *   1. SCHEMA_SEQUENCE_ORDER — cc:integration-system and friends are declared
 *      as xsd:sequence, so child order is mandatory rather than stylistic.
 *      Studio's own error names the rejected element and lists only what is
 *      still legal at that position, which reads as "unsupported element" when
 *      the element merely came too late.
 *
 *   2. MVEL_BRACE_IMBALANCE — Studio counts { and } in every value typed
 *      tns:MVELTemplateType and rejects the file when the totals differ.
 *      cc:expression is MVELExpressionType and is NOT checked, which is the
 *      escape hatch for building JSON whose braces cannot balance in one value.
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = join(__dirname, '../data/studio-schema-model.json');

let cachedModel;

export function loadSchemaModel(path = MODEL_PATH) {
  if (cachedModel !== undefined && path === MODEL_PATH) return cachedModel;
  let model = null;
  try {
    if (existsSync(path)) model = JSON.parse(readFileSync(path, 'utf8'));
  } catch { model = null; }
  if (path === MODEL_PATH) cachedModel = model;
  return model;
}

const localName = (n) => (n.includes(':') ? n.split(':').pop() : n);
const lineOf = (xml, index) => xml.slice(0, index).split('\n').length;

// ─── 1. xsd:sequence child order ──────────────────────────────────────────────

export function checkSequenceOrder(xml, issues, model = loadSchemaModel()) {
  if (!model?.sequences) return;

  for (const [parent, order] of Object.entries(model.sequences)) {
    const rank = new Map(order.map((n, i) => [n, i]));

    // Every occurrence of this parent element, with its inner XML.
    const openRe = new RegExp(`<([A-Za-z0-9_.-]+:)?${escapeRe(parent)}(\\s[^>]*?)?>`, 'g');
    let m;
    while ((m = openRe.exec(xml)) !== null) {
      const prefix = m[1] ?? '';
      const closeTag = `</${prefix}${parent}>`;
      const bodyStart = m.index + m[0].length;
      const bodyEnd = xml.indexOf(closeTag, bodyStart);
      if (bodyEnd === -1) continue;                    // self-closing or malformed
      const body = xml.slice(bodyStart, bodyEnd);

      // Direct children only: skip anything nested deeper.
      const seen = [];
      const childRe = /<([A-Za-z0-9_.-]+:)?([A-Za-z0-9_.-]+)(\s[^>]*?)?(\/?)>/g;
      let depth = 0;
      let c;
      while ((c = childRe.exec(body)) !== null) {
        const nameLocal = c[2];
        const selfClosing = c[4] === '/';
        if (depth === 0 && rank.has(nameLocal)) {
          seen.push({ name: nameLocal, at: bodyStart + c.index });
        }
        if (!selfClosing) {
          // Track nesting so grandchildren are ignored.
          const close = new RegExp(`</([A-Za-z0-9_.-]+:)?${escapeRe(nameLocal)}>`, 'g');
          close.lastIndex = c.index;
          const closeMatch = close.exec(body);
          if (closeMatch) childRe.lastIndex = closeMatch.index + closeMatch[0].length;
          else depth += 1;
        }
      }

      for (let i = 1; i < seen.length; i++) {
        const prev = seen[i - 1];
        const cur = seen[i];
        if (rank.get(cur.name) < rank.get(prev.name)) {
          issues.push({
            severity: 'ERROR',
            code: 'SCHEMA_SEQUENCE_ORDER',
            line: lineOf(xml, cur.at),
            message:
              `<${prefix}${parent}> children are an xsd:sequence — order is mandatory. `
              + `'${cur.name}' appears after '${prev.name}' but must come before it. `
              + `Studio fails this on open with cvc-complex-type.2.4.a, naming '${cur.name}' `
              + `and listing only the elements still legal at that position. `
              + `Required order: ${order.join(' -> ')}.`,
          });
          break;                                       // one report per parent occurrence
        }
      }
    }
  }
}

// ─── 2. MVEL template brace balance ───────────────────────────────────────────

export function checkMvelBraces(xml, issues, model = loadSchemaModel()) {
  if (!model) return;
  const tplElements = new Set(model.mvelTemplateElements ?? []);
  const tplAttrs = new Set(model.mvelTemplateAttributes ?? []);

  const report = (label, value, at, ownerHint) => {
    const open = (value.match(/\{/g) ?? []).length;
    const close = (value.match(/\}/g) ?? []).length;
    if (open === close) return;
    const preview = value.replace(/\s+/g, ' ').slice(0, 80);
    issues.push({
      severity: 'ERROR',
      code: 'MVEL_BRACE_IMBALANCE',
      line: lineOf(xml, at),
      message:
        `${label} is typed MVELTemplateType, which Studio brace-balance checks: `
        + `${open} '{' vs ${close} '}'${ownerHint ? ` (in ${ownerHint})` : ''}. `
        + `Studio rejects this with "Closing and opening tags {...} do not match". `
        + `Literal JSON braces are fine only when they balance within this one value — `
        + `if the opening and closing brace live in different elements, build the string in `
        + `cc:expression (MVELExpressionType, not brace-checked) and emit a single `
        + `balanced @{prop} token here. Value: ${preview}${value.length > 80 ? '...' : ''}`,
    });
  };

  // Element text content, e.g. <cc:text>, <cc:header-text>.
  for (const el of tplElements) {
    const re = new RegExp(`<([A-Za-z0-9_.-]+:)?${escapeRe(el)}(?:\\s[^>]*?)?>([\\s\\S]*?)</\\1?${escapeRe(el)}>`, 'g');
    let m;
    while ((m = re.exec(xml)) !== null) {
      const raw = m[2];
      if (!raw.includes('{') && !raw.includes('}')) continue;
      report(`<${m[1] ?? ''}${el}>`, decodeEntities(stripCdata(raw)), m.index, nearestId(xml, m.index));
    }
  }

  // Attribute values on any element.
  const attrRe = /\s([A-Za-z0-9_.:-]+)\s*=\s*"([^"]*)"/g;
  let a;
  while ((a = attrRe.exec(xml)) !== null) {
    const name = localName(a[1]);
    if (!tplAttrs.has(name)) continue;
    const value = a[2];
    if (!value.includes('{') && !value.includes('}')) continue;
    report(`@${name}`, decodeEntities(value), a.index, nearestId(xml, a.index));
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripCdata(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

// Studio serializes " as &quot; in element content; decode before counting so a
// CDATA form and an entity form of the same value give the same verdict.
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// Walk backwards to the nearest enclosing id="..." for a human-usable location.
function nearestId(xml, index) {
  const before = xml.slice(0, index);
  const m = /id="([^"]+)"(?![\s\S]*id=")/.exec(before);
  return m ? m[1] : null;
}
