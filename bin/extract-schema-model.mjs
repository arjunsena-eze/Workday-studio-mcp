#!/usr/bin/env node
//
// Distils Workday Studio's shipped XSDs into data/studio-schema-model.json.
//
// WHY A COMMITTED ARTEFACT: the authoritative schemas live inside the Studio
// install (plugins/com.workday.sh.common.ui_<version>/schemas/assembly/). A
// teammate cloning this repo, a CI runner, or a laptop without Studio has no
// access to them. Extracting once and committing the distilled model means the
// validator works everywhere and needs no XSD parser at runtime.
//
// WHAT IT EXTRACTS (deliberately narrow — the two error classes that a
// rule-based linter cannot see, both of which have cost real deploy cycles):
//   1. xsd:sequence child order per element  → catches "cvc-complex-type.2.4.a"
//   2. values typed tns:MVELTemplateType     → catches the brace-balance error
//
// USAGE
//   node bin/extract-schema-model.mjs                      (auto-discovers Studio)
//   node bin/extract-schema-model.mjs "<path to schemas/assembly>"
//   STUDIO_SCHEMA_PATH=... node bin/extract-schema-model.mjs
//
// Re-run after a Studio upgrade and commit the regenerated JSON.

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { XMLParser } from 'fast-xml-parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '../data/studio-schema-model.json');

const SCHEMA_FILES = [
  'assembly.xsd',
  'assembly-core.xsd',
  'cloud.xsd',
  'integration-system.xsd',
  'job.xsd',
];

// ─── Locating the Studio install ──────────────────────────────────────────────

export function discoverSchemaDir(explicit) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (process.env.STUDIO_SCHEMA_PATH) candidates.push(process.env.STUDIO_SCHEMA_PATH);

  // Studio installs as "<something>/WD/studio/plugins/com.workday.sh.common.ui_<version>".
  // The version is part of the folder name, so glob it rather than pinning.
  const roots = [
    join(homedir(), 'Studio 2026'), join(homedir(), 'Studio 2025'), join(homedir(), 'Studio'),
    'C:/Program Files/Workday', 'C:/Workday',
    '/Applications/Workday Studio', join(homedir(), 'Applications', 'Workday Studio'),
  ];
  for (const root of roots) {
    for (const pluginsDir of [join(root, 'WD', 'studio', 'plugins'), join(root, 'studio', 'plugins'), join(root, 'plugins')]) {
      if (!existsSync(pluginsDir)) continue;
      let names = [];
      try { names = readdirSync(pluginsDir); } catch { continue; }
      const hits = names
        .filter((n) => n.startsWith('com.workday.sh.common.ui_'))
        .sort()
        .reverse(); // newest version first
      for (const h of hits) candidates.push(join(pluginsDir, h, 'schemas', 'assembly'));
    }
  }

  for (const c of candidates) {
    if (c && existsSync(join(c, 'assembly-core.xsd'))) return c;
  }
  return null;
}

// ─── XSD model building ───────────────────────────────────────────────────────

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  preserveOrder: true,        // sequence order is the whole point
  trimValues: true,
});

const localName = (n) => (n.includes(':') ? n.split(':').pop() : n);

// preserveOrder gives arrays of single-key objects: [{ 'xsd:element': [...], ':@': {...} }]
function* walk(nodes) {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    for (const key of Object.keys(node)) {
      if (key === ':@' || key === '#text') continue;
      yield { tag: localName(key), attrs: node[':@'] ?? {}, children: node[key] };
      yield* walk(node[key]);
    }
  }
}

// Direct children of a node matching a tag (non-recursive).
function childrenOf(children, tag) {
  const out = [];
  if (!Array.isArray(children)) return out;
  for (const node of children) {
    for (const key of Object.keys(node)) {
      if (key === ':@' || key === '#text') continue;
      if (localName(key) === tag) out.push({ attrs: node[':@'] ?? {}, children: node[key] });
    }
  }
  return out;
}

// Unwrap complexContent/extension|restriction to reach the particle + attributes.
function contentOf(ctChildren) {
  for (const wrapper of ['complexContent', 'simpleContent']) {
    for (const cc of childrenOf(ctChildren, wrapper)) {
      for (const kind of ['extension', 'restriction']) {
        for (const ext of childrenOf(cc.children, kind)) {
          return { children: ext.children, base: localName(ext.attrs['@base'] ?? '') };
        }
      }
    }
  }
  return { children: ctChildren, base: null };
}

function build(schemaDir) {
  // complexType name -> { seq: [childElementName], base, unordered }
  const types = new Map();
  // element name -> type name (global and nested declarations)
  const elementType = new Map();
  // element name -> inline sequence (element with an anonymous complexType)
  const inlineSeq = new Map();

  const mvelAttrs = new Set();
  const mvelElements = new Set();
  const MVEL_TEMPLATE = /^MVEL(Template|BooleanTemplate|IntegerTemplate|DecimalTemplate)Type$/;

  for (const file of SCHEMA_FILES) {
    const p = join(schemaDir, file);
    if (!existsSync(p)) continue;
    const tree = parser.parse(readFileSync(p, 'utf8'));

    for (const node of walk(tree)) {
      const name = node.attrs['@name'];
      const type = node.attrs['@type'] ? localName(node.attrs['@type']) : null;

      if (node.tag === 'attribute' && name && type && MVEL_TEMPLATE.test(type)) {
        mvelAttrs.add(name);
      }
      if (node.tag === 'element' && name && type && MVEL_TEMPLATE.test(type)) {
        mvelElements.add(name);
      }
      if (node.tag === 'complexType' && name) {
        const { children, base } = contentOf(node.children);
        const seqs = childrenOf(children, 'sequence');
        const hasChoice = childrenOf(children, 'choice').length > 0
          || (seqs.length > 0 && childrenOf(seqs[0].children, 'choice').length > 0);
        const seq = seqs.length
          ? childrenOf(seqs[0].children, 'element').map((e) => e.attrs['@name']).filter(Boolean)
          : [];
        types.set(name, { seq, base, unordered: hasChoice });
      }
      if (node.tag === 'element' && name) {
        if (type) {
          elementType.set(name, type);
        } else {
          // element with an anonymous complexType
          const cts = childrenOf(node.children, 'complexType');
          if (cts.length) {
            const { children, base } = contentOf(cts[0].children);
            const seqs = childrenOf(children, 'sequence');
            const hasChoice = childrenOf(children, 'choice').length > 0;
            const seq = seqs.length
              ? childrenOf(seqs[0].children, 'element').map((e) => e.attrs['@name']).filter(Boolean)
              : [];
            if (seq.length && !hasChoice) inlineSeq.set(name, { seq, base });
          }
        }
      }
    }
  }

  // Resolve a type's effective sequence, walking the extension chain.
  const resolve_ = (typeName, depth = 0) => {
    if (!typeName || depth > 12) return null;
    const t = types.get(typeName);
    if (!t) return null;
    if (t.unordered) return null;              // choice/all: order is not constrained
    const inherited = t.base ? (resolve_(t.base, depth + 1) ?? []) : [];
    return [...inherited, ...t.seq];
  };

  const sequences = {};
  for (const [el, typeName] of elementType) {
    const seq = resolve_(typeName);
    if (seq && seq.length > 1) sequences[el] = seq;
  }
  for (const [el, { seq, base }] of inlineSeq) {
    const inherited = base ? (resolve_(base) ?? []) : [];
    const full = [...inherited, ...seq];
    if (full.length > 1) sequences[el] = full;
  }

  return {
    sequences,
    mvelTemplateAttributes: [...mvelAttrs].sort(),
    mvelTemplateElements: [...mvelElements].sort(),
  };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  const dir = discoverSchemaDir(process.argv[2]);
  if (!dir) {
    console.error(
      'Could not locate Studio schemas.\n'
      + 'Pass the path explicitly:\n'
      + '  node bin/extract-schema-model.mjs "<Studio>/WD/studio/plugins/com.workday.sh.common.ui_<ver>/schemas/assembly"\n'
      + 'or set STUDIO_SCHEMA_PATH.\n\n'
      + 'This script only needs to run on a machine WITH Studio installed. The\n'
      + 'generated data/studio-schema-model.json is committed, so everyone else\n'
      + 'validates without it.',
    );
    process.exit(1);
  }

  const version = /com\.workday\.sh\.common\.ui_([\d.]+)/.exec(dir)?.[1] ?? 'unknown';
  const model = build(dir);

  const seqCount = Object.keys(model.sequences).length;
  if (seqCount < 5 || model.mvelTemplateAttributes.length < 20) {
    console.error(
      `Extraction looks wrong: ${seqCount} sequences, `
      + `${model.mvelTemplateAttributes.length} MVEL attributes. Refusing to write.\n`
      + 'Check that the path points at schemas/assembly inside the Studio plugins dir.',
    );
    process.exit(1);
  }

  // Sanity anchor: the rule that started all of this must be present and ordered.
  const is = model.sequences['integration-system'];
  const iL = is?.indexOf('listener-service') ?? -1;
  const iC = is?.indexOf('custom-object-service') ?? -1;
  if (iL < 0 || iC < 0 || iL > iC) {
    console.error(
      'Sanity check FAILED: integration-system must list listener-service before '
      + `custom-object-service. Got: ${JSON.stringify(is)}`,
    );
    process.exit(1);
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify({
    _comment: 'GENERATED by bin/extract-schema-model.mjs from the Studio install XSDs. Do not hand-edit — re-run the script after a Studio upgrade.',
    studioPluginVersion: version,
    ...model,
  }, null, 2) + '\n', 'utf8');

  console.log(`Wrote ${OUT_PATH}`);
  console.log(`  Studio plugin version : ${version}`);
  console.log(`  element sequences     : ${seqCount}`);
  console.log(`  MVEL template attrs   : ${model.mvelTemplateAttributes.length}`);
  console.log(`  MVEL template elements: ${model.mvelTemplateElements.join(', ')}`);
  console.log(`  integration-system    : ${is.join(' -> ')}`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('extract-schema-model.mjs')) {
  main();
}

export { build };
