/**
 * Studio assembly validator — checks rules that XML well-formedness alone cannot catch.
 *
 * Returns an array of { severity, code, message } objects.
 * severity: 'ERROR' (will break Studio) | 'WARNING' (will cause runtime failures) | 'INFO' (awareness)
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { checkSequenceOrder, checkMvelBraces } from './schema-validator.mjs';

export function validateAssembly(xml, wsDir = null, diagramXml = null) {
  const issues = [];

  // Schema-derived checks (data/studio-schema-model.json). These catch the two
  // classes Studio rejects on open that rule-based inspection below cannot see:
  // xsd:sequence child order, and brace balance in MVELTemplateType values.
  checkSequenceOrder(xml, issues);
  checkMvelBraces(xml, issues);

  checkNoXmlComments(xml, issues);
  checkBrokenRoutes(xml, issues);
  checkLocalOutEndpoints(xml, issues);
  checkRequiredAttributes(xml, issues);
  checkTopLevelOnlyElements(xml, issues);
  checkSplitterRoutes(xml, issues);
  if (wsDir) checkXslFileReferences(xml, wsDir, issues);
  if (wsDir) checkXslParamObjectProps(xml, wsDir, issues);
  checkCcNote(xml, issues);
  checkTodoStubs(xml, issues);
  checkRaasViaSoap(xml, issues);
  checkLogConditionAttribute(xml, issues);          // plan #5  — LOG_HAS_CONDITION
  checkMvelSemicolonInStringLiteral(xml, issues);   // plan #11 — MVEL_SEMICOLON_IN_STRING
  checkJavaTimeContext(xml, issues);                // plans #9+#20 merged — JAVA_TIME_IN_PER_MESSAGE_EVAL

  if (diagramXml) {
    // Check for assembly elements not referenced in diagram (drift from assembly add/remove)
    const driftMissing = checkDiagramDrift(xml, diagramXml);
    for (const { tag, id } of driftMissing) {
      issues.push({
        severity: 'WARNING',
        code: 'DIAGRAM_MISSING_ELEMENT',
        message: `<${tag} id="${id}"> exists in assembly.xml but has no entry in assembly-diagram.xml. Add visualProperties + connections + swimlane membership before opening Studio.`,
      });
    }

    // Check for diagram hrefs that point to IDs no longer in assembly (rename/delete drift)
    const staleRefs = checkStaleDiagramHrefs(xml, diagramXml);
    for (const { href } of staleRefs) {
      issues.push({
        severity: 'ERROR',
        code: 'STALE_DIAGRAM_HREF',
        message: `assembly-diagram.xml contains href="${href}" but no element with that id exists in assembly.xml. This will cause scala.MatchError when Studio opens the diagram. Either rename or remove this reference.`,
      });
    }

    // Check for diagram hrefs that reference a cc:send-error by its XML id.
    // The id exists in assembly.xml so STALE_DIAGRAM_HREF does not fire, but
    // Studio's diagram editor has no EditPart for cc:send-error and crashes
    // with scala.MatchError on load. Send-error refs must use positional EMF
    // XPath (assembly.xml#//@beans/@mixed...) instead.
    const sendErrorRefs = checkSendErrorIdRefs(xml, diagramXml);
    for (const { id, count } of sendErrorRefs) {
      issues.push({
        severity: 'ERROR',
        code: 'SEND_ERROR_ID_IN_DIAGRAM',
        message: `assembly-diagram.xml references cc:send-error id="${id}" by id (${count} occurrence${count === 1 ? '' : 's'}). The id exists, but Studio has no EditPart for cc:send-error and crashes with scala.MatchError on diagram open. Remove the id-based reference(s); send-errors may appear only via positional EMF XPath (assembly.xml#//@beans/@mixed.1/@mixed.N — index = 2 x element position + 1; local send-errors add /@mixed.3), and only in the entry types the send-error step reference DIAGRAM RULES allow for their scope (connections source always; never visualProperties/swimlane entries for local send-errors).`,
      });
    }

    // Check nested-swimlane reference fragment forms (attribute form vs child-element form)
    const badSwimlaneRefs = checkSwimlaneRefForms(diagramXml);
    for (const { form, ref } of badSwimlaneRefs) {
      issues.push({
        severity: 'WARNING',
        code: 'SWIMLANE_REF_FRAGMENT_FORM',
        message: form === 'attribute'
          ? `Swimlane elements="..." attribute contains "${ref}" — the self-closing attribute form must use //@swimlanes.N with NO leading #. Studio-authored diagrams never emit # in attribute form; the reference may not resolve.`
          : `Swimlane <elements href="${ref}"/> — the child-element form must use #//@swimlanes.N WITH the leading #. Studio-authored diagrams always emit the # in href form; the reference may not resolve.`,
      });
    }

    // Check for redundant vm:// dispatch arrows (Call_X local-out → X local-in)
    const vmArrows = checkVmDispatchArrows(xml, diagramXml);
    for (const { source, target } of vmArrows) {
      issues.push({
        severity: 'INFO',
        code: 'REDUNDANT_VM_DISPATCH_ARROW',
        message: `Diagram draws a connection from cc:local-out "${source}" to cc:local-in "${target}", but vm:// dispatch links are implicit — Studio never draws them. Remove this <connections> block; it renders as a redundant diagonal arrow.`,
      });
    }

    // Check for multiple Do/PutError pairs crammed into one VERTICAL swimlane
    for (const { name, mediations, localOuts } of checkVerticalPairLanes(xml, diagramXml)) {
      issues.push({
        severity: 'INFO',
        code: 'CROWDED_VERTICAL_SWIMLANE',
        message: `VERTICAL swimlane "${name}" contains ${mediations} async-mediations and ${localOuts} local-outs. Each (Do{X} + Put{X}Error) pair should have its own VERTICAL swimlane child — split this lane so each pair renders as its own boxed work unit. Append the new swimlane at the END of the swimlane list so no #//@swimlanes.N index shifts.`,
      });
    }

    checkPositionalDiagramRefs(xml, diagramXml, issues);
  }

  return issues;
}

// ─── Rule: no XML comments in assembly.xml ────────────────────────────────────
// Comments are valid XML but shift @mixed indices, breaking all diagram EMF XPath references.

function checkNoXmlComments(xml, issues) {
  const matches = [...xml.matchAll(/<!--/g)];
  if (matches.length > 0) {
    issues.push({
      severity: 'ERROR',
      code: 'XML_COMMENTS_PRESENT',
      message: `Found ${matches.length} XML comment(s). Comments shift @mixed indices and break all diagram connections. Remove every <!-- --> block from assembly.xml.`,
    });
  }
}

// ─── Rule: every routes-to / routes-response-to target must exist ─────────────

function checkBrokenRoutes(xml, issues) {
  const ids = collectIds(xml);

  for (const m of xml.matchAll(/\broutes-to="([^"]+)"/g)) {
    if (!ids.has(m[1])) {
      issues.push({
        severity: 'ERROR',
        code: 'BROKEN_ROUTES_TO',
        message: `routes-to="${m[1]}" — no element with this id exists in assembly.xml.`,
      });
    }
  }

  for (const m of xml.matchAll(/\broutes-response-to="([^"]+)"/g)) {
    if (!ids.has(m[1])) {
      issues.push({
        severity: 'ERROR',
        code: 'BROKEN_ROUTES_RESPONSE_TO',
        message: `routes-response-to="${m[1]}" — no element with this id exists in assembly.xml.`,
      });
    }
  }
}

// ─── Rule: vm:// sub-flow endpoints must point to a real cc:local-in ──────────
// Built-in wcc/* endpoints are exempt.

function checkLocalOutEndpoints(xml, issues) {
  const ids = collectIds(xml);

  for (const m of xml.matchAll(/endpoint="vm:\/\/([^/]+)\/([^"]+)"/g)) {
    const [, systemName, localInId] = m;
    if (systemName === 'wcc') continue;  // built-in platform endpoints

    if (!ids.has(localInId)) {
      issues.push({
        severity: 'WARNING',
        code: 'UNRESOLVED_LOCAL_IN',
        message: `vm://${systemName}/${localInId} — no cc:local-in with id="${localInId}" found. Either the local-in is missing or the id is misspelled.`,
      });
    }
  }
}

// ─── Rule: required attributes per step type ─────────────────────────────────

const REQUIRED_ATTRS = [
  // [tagPattern, requiredAttr, errorMessage]
  [/cc:workday-out-soap\b[^>]*(?<!extra-path="[^"]*")(?<!application="[^"]*")/,
    'application',
    'cc:workday-out-soap is missing required attribute application="..." (e.g. Human_Resources, Staffing, Talent).'],
  [/cc:workday-out-soap\b[^>]*(?<!version="[^"]*")/,
    'version',
    'cc:workday-out-soap is missing required attribute version="..." (e.g. 38.2).'],
  [/cc:workday-out-rest\b/,
    'extra-path',
    'cc:workday-out-rest is missing required attribute extra-path.'],
  [/cc:http-out\b/,
    'endpoint',
    'cc:http-out is missing required attribute endpoint.'],
  [/cc:xslt-plus\b/,
    'url',
    'cc:xslt-plus is missing required attribute url (path to .xsl file).'],
];

function checkRequiredAttributes(xml, issues) {
  // Extract each self-contained step tag (opening tag only, may span multiple lines)
  const tagPattern = /<(cc:[a-z-]+)\b([^>]*(?:>(?!.*<\/cc:\1)|\/>))/gs;

  for (const tagMatch of xml.matchAll(/<cc:[a-z-]+\b[^>]*(?:\/>|>)/gs)) {
    const tagText = tagMatch[0];
    const nameMatch = tagText.match(/^<(cc:[a-z-]+)/);
    if (!nameMatch) continue;
    const tagName = nameMatch[1];

    // workday-out-soap: check application
    if (tagName === 'cc:workday-out-soap') {
      if (!tagText.includes('application=')) {
        issues.push({ severity: 'ERROR', code: 'MISSING_ATTR_APPLICATION', message: `cc:workday-out-soap (id="${extractId(tagText)}") is missing required attribute application= (e.g. Human_Resources).` });
      }
      if (!tagText.includes('version=')) {
        issues.push({ severity: 'ERROR', code: 'MISSING_ATTR_VERSION', message: `cc:workday-out-soap (id="${extractId(tagText)}") is missing required attribute version= (e.g. 38.2).` });
      }
    }

    // workday-out-rest: check extra-path
    if (tagName === 'cc:workday-out-rest' && !tagText.includes('extra-path=')) {
      issues.push({ severity: 'ERROR', code: 'MISSING_ATTR_EXTRA_PATH', message: `cc:workday-out-rest (id="${extractId(tagText)}") is missing required attribute extra-path=.` });
    }

    // http-out: check endpoint (skip if it's a closing tag)
    if (tagName === 'cc:http-out' && !tagText.includes('endpoint=')) {
      issues.push({ severity: 'ERROR', code: 'MISSING_ATTR_ENDPOINT', message: `cc:http-out (id="${extractId(tagText)}") is missing required attribute endpoint=.` });
    }

    // xslt-plus: check url
    if (tagName === 'cc:xslt-plus' && !tagText.includes('url=')) {
      issues.push({ severity: 'ERROR', code: 'MISSING_ATTR_URL', message: `cc:xslt-plus (id="${extractId(tagText)}") is missing required attribute url= (path to .xsl file).` });
    }
  }
}

// ─── Rule: certain elements must be TOP-LEVEL, not inside cc:steps ───────────
// cc:workday-out-rest, cc:splitter, cc:http-out, cc:email-out are assembly-level
// routing elements. Studio's schema rejects them inside cc:steps.
// Confirmed across four production builds.

const TOP_LEVEL_ONLY = ['cc:workday-out-rest', 'cc:splitter', 'cc:http-out', 'cc:email-out', 'cc:workday-out-soap'];

function checkTopLevelOnlyElements(xml, issues) {
  // Find every <cc:steps> block and check its content
  const stepsPattern = /<cc:steps>([\s\S]*?)<\/cc:steps>/g;
  for (const stepsMatch of xml.matchAll(stepsPattern)) {
    const stepsContent = stepsMatch[1];
    for (const tag of TOP_LEVEL_ONLY) {
      if (stepsContent.includes(`<${tag}`)) {
        // Find the id of the containing async-mediation for a useful error message
        const stepsIdx = stepsMatch.index;
        const before = xml.substring(0, stepsIdx);
        const asyncMedMatch = [...before.matchAll(/<cc:async-mediation\b[^>]*>/g)].pop();
        const containerId = asyncMedMatch ? extractId(asyncMedMatch[0]) : '?';
        issues.push({
          severity: 'ERROR',
          code: 'ELEMENT_INSIDE_STEPS',
          message: `<${tag}> found inside <cc:steps> of "${containerId}". This is a top-level assembly element — it must sit directly inside <cc:assembly>, not inside cc:steps. Move it out of the async-mediation and chain it via routes-to/routes-response-to.`,
        });
      }
    }
  }
}

// ─── Rule: cc:splitter must NOT have a routes-to attribute ───────────────────
// Studio's schema does not allow routes-to on cc:splitter. The splitter routes
// via its cc:sub-route children only. Confirmed in production builds.

function checkSplitterRoutes(xml, issues) {
  for (const m of xml.matchAll(/<cc:splitter\b[^>]*>/g)) {
    if (m[0].includes('routes-to=')) {
      issues.push({
        severity: 'ERROR',
        code: 'SPLITTER_HAS_ROUTES_TO',
        message: `cc:splitter (id="${extractId(m[0])}") has a routes-to attribute — the Studio schema does not allow this. Remove routes-to from the splitter. Routing is done via cc:sub-route children only.`,
      });
    }
  }
}

// ─── Rule: XSL files referenced by url= must exist in WSAR-INF ───────────────

function checkXslFileReferences(xml, wsDir, issues) {
  for (const m of xml.matchAll(/\burl="([^"]+\.xslt?)"/g)) {
    const xslFile = m[1];
    if (!existsSync(join(wsDir, xslFile))) {
      issues.push({
        severity: 'WARNING',
        code: 'MISSING_XSL_FILE',
        message: `url="${xslFile}" — file not found in WSAR-INF. Create it with create_xsl_transform before testing.`,
      });
    }
  }
}

// ─── Rule: object-typed props bound to xsl:param bind EMPTY ──────────────────
// cc:xslt-plus auto-binds props to same-named xsl:params, but ONLY String-typed
// props. Object-typed props (LocalDate, Long, ...) bind as EMPTY in the XSL,
// while @{props['x']} interpolation in cc:log still renders the object's
// toString() — so logs mask the bug. Reliable coercion: props['y'] = '' + props['x'].
// Runtime-verified 2026-07-09: a blank CSV column populated after coercion.

const OBJECT_VALUED_RHS = /\bnew\s+java\.|\bjava\.\w[\w.]*\.\w+\s*\(|\.now\s*\(|\.minus\w*\s*\(|\.plus\w*\s*\(|\.with\w*\s*\(|\.atStartOfDay\s*\(/;

function checkXslParamObjectProps(xml, wsDir, issues) {
  // Prop assignments whose RHS looks object-typed and is never string-coerced.
  // Any string-literal concatenation ('' + x, 'prefix' + x) coerces to String;
  // x.toString() is deliberately NOT treated as coercion — it can retain
  // non-String typing in props (confirmed at runtime).
  const suspects = new Map();
  for (const m of xml.matchAll(/props\['([^']+)'\]\s*=\s*([^<;]+)/g)) {
    const name = m[1];
    const rhs = m[2].trim();
    if (!OBJECT_VALUED_RHS.test(rhs)) continue;
    if (/'[^']*'\s*\+/.test(rhs)) continue; // string-concat coercion present
    suspects.set(name, rhs);
  }
  if (suspects.size === 0) return;

  for (const m of xml.matchAll(/\burl="([^"]+\.xslt?)"/g)) {
    const xslPath = join(wsDir, m[1]);
    if (!existsSync(xslPath)) continue;
    const xsl = readFileSync(xslPath, 'utf8');
    for (const p of xsl.matchAll(/<xsl:param\b[^>]*\bname="([^"]+)"/g)) {
      const paramName = p[1];
      if (!suspects.has(paramName)) continue;
      issues.push({
        severity: 'WARNING',
        code: 'XSL_PARAM_OBJECT_PROP',
        message: `props['${paramName}'] is assigned an object-typed value (${suspects.get(paramName)}) and ${m[1]} declares <xsl:param name="${paramName}"/>. cc:xslt-plus binds only String-typed props — object-typed props bind EMPTY (cc:log @{props['...']} still renders toString(), masking the bug). Coerce first: props['${paramName}_Str'] = '' + props['${paramName}'] and declare <xsl:param name="${paramName}_Str"/> instead.`,
      });
    }
  }
}

// ─── Rule: cc:note is schema-invalid in assembly.xml ─────────────────────────
// Studio's schema rejects cc:note as a cc:assembly child. The correct terminal
// pattern is an cc:async-mediation with no routes-to attribute.
// Also: cc:note in assembly-diagram.xml crashes Studio (scala.MatchError).

function checkCcNote(xml, issues) {
  const matches = [...xml.matchAll(/<cc:note\b/g)];
  if (matches.length > 0) {
    issues.push({
      severity: 'ERROR',
      code: 'CC_NOTE_IN_ASSEMBLY',
      message: `Found ${matches.length} <cc:note> element(s). cc:note is schema-invalid in assembly.xml and crashes Studio if added to assembly-diagram.xml. Replace with an cc:async-mediation that has no routes-to attribute — that is the correct terminal pattern.`,
    });
  }
}

// ─── Rule: flag remaining TODO stubs ─────────────────────────────────────────

function checkTodoStubs(xml, issues) {
  // plan_integration marks an unfilled sub-flow with a single log step whose
  // text begins "TODO:" — see buildAssemblyXml. Attribute each marker to its
  // enclosing async-mediation by splitting on the mediation boundary, which is
  // reliable where a non-greedy regex across the whole document is not.
  //
  // This previously matched `id="TODO_..."`, which nothing has ever emitted —
  // the check silently never fired. Do not "simplify" it back to an id match.
  const stubbed = [];
  for (const chunk of xml.split(/<cc:async-mediation\b/).slice(1)) {
    if (!/<cc:text>\s*TODO:/.test(chunk)) continue;
    const id = chunk.match(/^[^>]*\bid="([^"]+)"/);
    stubbed.push(id ? id[1] : '(unnamed mediation)');
  }
  if (stubbed.length > 0) {
    issues.push({
      severity: 'INFO',
      code: 'TODO_STUBS_REMAINING',
      message: `${stubbed.length} sub-flow(s) still contain TODO stubs: ${stubbed.join(', ')}. Fill these in with update_sub_flow before testing.`,
    });
  }

  // Tenant-specific placeholders the generator cannot know: report aliases and
  // WIDs. These block a deploy rather than merely a test, so report them
  // separately from the sub-flow stubs above.
  const placeholders = [...new Set(
    [...xml.matchAll(/\bTODO_[A-Z][A-Z0-9_]*/g)].map(m => m[0]),
  )];
  if (placeholders.length > 0) {
    issues.push({
      severity: 'INFO',
      code: 'TODO_PLACEHOLDERS_REMAINING',
      message: `${placeholders.length} tenant placeholder(s) still to replace: ${placeholders.join(', ')}. Substitute real tenant values before deploying.`,
    });
  }
}

// ─── Diagram drift detection ──────────────────────────────────────────────────
// Returns top-level assembly element ids that have NO reference in the diagram.
// Only checks renderable node types — cc:send-error, cc:log-error, and inline
// steps (cc:eval, cc:xslt-plus, etc.) are intentionally excluded because Studio
// never places them as standalone diagram nodes.

const RENDERABLE_TAGS = new Set([
  'cc:workday-in', 'cc:local-out', 'cc:local-in', 'cc:async-mediation',
  'cc:route', 'cc:splitter', 'cc:aggregator', 'cc:http-out',
  'cc:workday-out-rest', 'cc:workday-out-soap', 'cc:email-out',
]);

export function checkDiagramDrift(assemblyXml, diagramXml) {
  const missing = [];

  for (const m of assemblyXml.matchAll(/<(cc:[a-z-]+)\b[^>]*\bid="([^"]+)"/g)) {
    const [, tag, id] = m;
    if (!RENDERABLE_TAGS.has(tag)) continue;
    // Diagram references an id either as href="assembly.xml#Id" or href="#Id"
    if (!diagramXml.includes(`#${id}`)) {
      missing.push({ tag, id });
    }
  }

  return missing;
}

// ─── Rule: RAAS calls must use cc:workday-out-rest, not cc:workday-out-soap ───
// Custom Workday reports are always called via REST + cloud:report-alias.
// Using cc:workday-out-soap for report execution does not work with custom reports
// and causes incorrect diagram rendering.

function checkRaasViaSoap(xml, issues) {
  // Look for patterns that suggest someone is trying to run a report via SOAP:
  // operation names containing "Report" or extra-path on a workday-out-soap
  const soapTags = [...xml.matchAll(/<cc:workday-out-soap\b[^>]*/g)];
  for (const m of soapTags) {
    const tagText = m[0];
    if (/\boperation=["'][^"']*[Rr]eport[^"']*["']/.test(tagText)) {
      issues.push({
        severity: 'ERROR',
        code: 'RAAS_VIA_SOAP',
        message: `cc:workday-out-soap (id="${extractId(tagText)}") appears to target a report operation. RAAS calls must use cc:workday-out-rest with extra-path="@{intsys.reportService.getExtrapath('ALIAS')}". SOAP does not work for custom reports.`,
      });
    }
  }

  // Also flag if report-related extra-path patterns appear on workday-out-soap
  for (const m of xml.matchAll(/<cc:workday-out-soap\b[^>]*extra-path=/g)) {
    issues.push({
      severity: 'ERROR',
      code: 'SOAP_WITH_EXTRA_PATH',
      message: `cc:workday-out-soap does not support extra-path. For RAAS calls, use cc:workday-out-rest instead.`,
    });
  }
}

// ─── Rule: cc:log must NOT have a condition attribute ────────────────────────
// Studio's schema rejects condition= on cc:log (cvc-complex-type.3.2.2:
// "Attribute 'condition' is not allowed to appear in element 'cc:log'").
// Only cc:cloud-log supports condition. For conditional discrimination with
// cc:log, compute a status prop in a preceding cc:eval and embed it in the
// log text, e.g. <cc:text>[INT999][@{props['Status']}] ...</cc:text>.
// NOTE: the lookahead (?=[\s/>]) keeps this from matching cc:log-message
// and cc:log-error, whose names begin with "log".

function checkLogConditionAttribute(xml, issues) {
  for (const m of xml.matchAll(/<cc:log(?=[\s/>])[^>]*>/g)) {
    if (m[0].includes('condition=')) {
      issues.push({
        severity: 'ERROR',
        code: 'LOG_HAS_CONDITION',
        message: `cc:log (id="${extractId(m[0])}") has a condition attribute — Studio's schema rejects this (cvc-complex-type.3.2.2). Either switch to cc:cloud-log (which supports condition=), or compute a status prop via cc:eval and embed it in the log text: <cc:text>[INT999][@{props['Status']}] ...</cc:text>.`,
      });
    }
  }
}

// ─── Rule: no semicolon inside MVEL string literals ──────────────────────────
// Studio's bundled MVEL 1.3.13 treats ';' as a statement separator EVEN INSIDE
// single-quoted string literals. Any ';' in a literal ('a; b', '; b', 'b;') fails
// compilation of that expression with [Error: unterminated literal], which fails
// the ENTIRE assembly deploy at collection deploy. It looks like a data problem
// (every record failing) but is a static compile error. Parens and brackets inside
// strings are fine; ';' as a statement separator outside literals is fine.
// Fix: replace the in-string ';' with a dash or period.
// Verified against Studio's own mvel-1.3.13-workday.12 jar (July 2026).
// Scans the MVEL-bearing locations: cc:expression text, choose-route/validate-exp
// expression=, cc:set value=, and execute-when=. Entities are decoded outside
// CDATA (so '&amp;' / '&#10;' never false-positive); CDATA content is taken raw,
// exactly as MVEL sees it.

function checkMvelSemicolonInStringLiteral(xml, issues) {
  const mvelSources = [];

  for (const m of xml.matchAll(/<cc:expression\b[^>]*>([\s\S]*?)<\/cc:expression>/g)) {
    mvelSources.push({ where: 'cc:expression', code: decodeOutsideCdata(m[1]) });
  }
  for (const m of xml.matchAll(/<cc:set\b[^>]*\bvalue="([^"]*)"/g)) {
    mvelSources.push({ where: 'cc:set value=', code: decodeXmlEntities(m[1]) });
  }
  for (const m of xml.matchAll(/\bexpression="([^"]*)"/g)) {
    mvelSources.push({ where: 'expression=', code: decodeXmlEntities(m[1]) });
  }
  for (const m of xml.matchAll(/\bexecute-when="([^"]*)"/g)) {
    mvelSources.push({ where: 'execute-when=', code: decodeXmlEntities(m[1]) });
  }

  for (const { where, code } of mvelSources) {
    for (const lit of code.matchAll(/'([^'\n]*)'/g)) {
      if (lit[1].includes(';')) {
        issues.push({
          severity: 'ERROR',
          code: 'MVEL_SEMICOLON_IN_STRING',
          message: `MVEL string literal '${truncateLiteral(lit[1])}' (in ${where}) contains a semicolon. Studio's MVEL 1.3.13 treats ';' as a statement separator even inside quoted strings — the expression fails to compile with [Error: unterminated literal] and the WHOLE deploy fails. Replace the in-string ';' with a dash or period.`,
        });
      }
    }
  }
}

function decodeOutsideCdata(text) {
  // CDATA content reaches MVEL raw; outside CDATA, XML entities are decoded first.
  return text
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
    .map(seg => seg.startsWith('<![CDATA[') ? seg.slice(9, -3) : decodeXmlEntities(seg))
    .join('');
}

function decodeXmlEntities(text) {
  // Any &...; sequence in valid XML is an entity; no decoded entity contains a
  // semicolon, so a neutral placeholder is sufficient for this check.
  return text.replace(/&#?\w+;/g, '_');
}

function truncateLiteral(s) {
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
}

// ─── Rule: java.time FQCN only resolves in the bootstrap eval ─────────────────
// Studio's per-message MVEL runtime cannot resolve fully-qualified java.time
// references (org.mvel.CompileException: unable to resolve property: java) even
// though the expression compiles offline against Studio's own mvel-1.3.13 jar,
// so neither validate-time XML checks nor an offline compile pass catch it.
// The run-scoped bootstrap eval (Init* / InitializeProperties, executed once per
// run) is the exception: java.time FQCN works there, even inside ternary
// branches and as nested method arguments. Runtime-verified 2026-06/07 (7/7
// split workers succeeded after replacing per-message statics with instance
// methods on a props-stored LocalDate).
// java.text / java.util FQCNs (SimpleDateFormat, Calendar, Base64) are NOT
// flagged — they are canonical per-message patterns and resolve fine, as do
// java.lang simple names (Integer, Long, Math).

function checkJavaTimeContext(xml, issues) {
  for (const m of xml.matchAll(/<cc:eval\b[^>]*>([\s\S]*?)<\/cc:eval>/g)) {
    const id = extractId(m[0]);
    if (/^init/i.test(id)) continue;  // bootstrap eval (Init*/InitializeProperties) is exempt
    if (m[1].includes('java.time.')) {
      issues.push({
        severity: 'WARNING',
        code: 'JAVA_TIME_IN_PER_MESSAGE_EVAL',
        message: `cc:eval (id="${id}") references java.time.* outside the bootstrap Init eval. Per-message MVEL fails at RUNTIME to resolve java.time FQCNs (offline compile passes, so a compile-check will not catch this). Store a LocalDate in props during the Init/InitializeProperties eval and use instance methods here instead (e.g. props['Current_Date'].minusDays(N).toString(), ISO-string compareTo, or withDayOfMonth/withYear/withMonth construction).`,
      });
    }
  }
}

// ─── Stale diagram href detection ────────────────────────────────────────────
// Checks for diagram href="assembly.xml#SomeId" references where SomeId no longer
// exists in assembly.xml. This is the most common cause of scala.MatchError after
// a rename or delete — the diagram still points to the old ID.
//
// Only checks id-based hrefs. Positional @mixed refs get a formula-level check
// in checkPositionalDiagramRefs; full resolution still requires the
// verification script in patterns.md.

export function checkStaleDiagramHrefs(assemblyXml, diagramXml) {
  const assemblyIds = collectIds(assemblyXml);
  const stale = [];

  for (const m of diagramXml.matchAll(/href="assembly\.xml#([^"@][^"]*)"/g)) {
    const id = m[1];
    // Skip positional paths (//@ prefix after the #)
    if (id.startsWith('/')) continue;
    if (!assemblyIds.has(id)) {
      stale.push({ href: `assembly.xml#${id}` });
    }
  }

  return stale;
}

// ─── Send-error id-based diagram reference detection ──────────────────────────
// cc:send-error carries an id="..." that is meaningful at runtime (routes-to
// targets), but it is not a renderable node type in Studio's EMF model. A
// diagram href that points at a send-error's id passes the stale-href check
// (the id exists in assembly.xml) yet crashes Studio with scala.MatchError at
// Factory.createEditPart. The only valid way to reference a send-error in the
// diagram is positional EMF XPath — e.g. assembly.xml#//@beans/@mixed.1/@mixed.53
// for a top-level GlobalErrorHandler, or .../@mixed.N/@mixed.3 for a send-error
// inside an async-mediation.

export function checkSendErrorIdRefs(assemblyXml, diagramXml) {
  const sendErrorIds = new Set(
    [...assemblyXml.matchAll(/<cc:send-error\b[^>]*\bid="([^"]+)"/g)].map(m => m[1])
  );

  const counts = new Map();
  for (const m of diagramXml.matchAll(/href="(?:assembly\.xml)?#([^"]+)"/g)) {
    const id = m[1];
    if (id.startsWith('/')) continue;  // positional @mixed / @swimlanes paths are the correct form
    if (sendErrorIds.has(id)) counts.set(id, (counts.get(id) || 0) + 1);
  }

  return [...counts.entries()].map(([id, count]) => ({ id, count }));
}

// ─── Nested swimlane reference fragment forms ─────────────────────────────────
// Studio uses two distinct syntaxes for a parent swimlane referencing nested
// vertical children (confirmed against a Studio-authored production diagram):
//   attribute form:      <swimlanes ... elements="//@swimlanes.N"/>   (no leading #)
//   child-element form:  <elements href="#//@swimlanes.N"/>           (leading # required)
// Mixing the fragments up produces swimlane references Studio may not resolve.

export function checkSwimlaneRefForms(diagramXml) {
  const bad = [];

  // Attribute form: elements="..." values must not carry a leading # on swimlane refs
  for (const m of diagramXml.matchAll(/<swimlanes\b[^>]*\belements="([^"]*)"/g)) {
    for (const ref of m[1].split(/\s+/)) {
      if (ref.startsWith('#//@swimlanes.')) {
        bad.push({ form: 'attribute', ref });
      }
    }
  }

  // Child-element form: href must carry the leading #
  for (const m of diagramXml.matchAll(/<elements\s+href="(\/\/@swimlanes\.[^"]*)"/g)) {
    bad.push({ form: 'child', ref: m[1] });
  }

  return bad;
}

// ─── Redundant vm:// dispatch arrows ──────────────────────────────────────────
// A cc:local-out → cc:local-in vm:// link is implicit; Studio draws connections
// only for routes-to / routes-response-to. A hand-added <connections> block from
// Call_X to its X local-in renders as a redundant diagonal arrow (confirmed
// against a Studio-authored production diagram, which draws none of these).

export function checkVmDispatchArrows(assemblyXml, diagramXml) {
  // Map local-out id → the local-in id it dispatches to (vm endpoint tail = local-in id)
  const localInIds = new Set(
    [...assemblyXml.matchAll(/<cc:local-in\b[^>]*\bid="([^"]+)"/g)].map(m => m[1])
  );
  const dispatch = new Map();
  for (const m of assemblyXml.matchAll(/<cc:local-out\b[^>]*>/g)) {
    const id = extractId(m[0]);
    const ep = m[0].match(/\bendpoint="vm:\/\/[^"]*\/([^"/]+)"/);
    if (id && ep && localInIds.has(ep[1])) dispatch.set(id, ep[1]);
  }

  const redundant = [];
  for (const m of diagramXml.matchAll(/<connections\b[^>]*>([\s\S]*?)<\/connections>/g)) {
    const src = m[1].match(/<source\s+href="assembly\.xml#([^"@/][^"]*)"/);
    const tgt = m[1].match(/<target\s+href="assembly\.xml#([^"@/][^"]*)"/);
    if (src && tgt && dispatch.get(src[1]) === tgt[1]) {
      redundant.push({ source: src[1], target: tgt[1] });
    }
  }
  return redundant;
}

// ─── Rule: one Do/PutError pair per VERTICAL swimlane child ───────────────────
// Each substantive cc:async-mediation plus its dedicated cc:local-out error
// handler renders as one boxed work unit only when the pair has its own
// VERTICAL swimlane child in assembly-diagram.xml. Two or more pairs crammed
// into a single vertical lane collapse into one box and lose the hierarchy.
// Heuristic: a VERTICAL swimlane whose elements include >=2 async-mediations
// AND >=2 local-outs almost certainly holds multiple Do/PutError pairs.
// (Co-located error-branch bands — the endorsed pattern in patterns.md — have
// multiple async-mediations but not multiple local-outs, so they don't trip.)

export function checkVerticalPairLanes(assemblyXml, diagramXml) {
  const tagById = new Map();
  for (const m of assemblyXml.matchAll(/<(cc:[a-z-]+)\b[^>]*\bid="([^"]+)"/g)) {
    tagById.set(m[2], m[1]);
  }

  const crowded = [];
  for (const m of diagramXml.matchAll(/<swimlanes\b[^>]*orientation="VERTICAL"[^>]*>([\s\S]*?)<\/swimlanes>/g)) {
    let mediations = 0;
    let localOuts = 0;
    for (const el of m[1].matchAll(/href="assembly\.xml#([^"@][^"]*)"/g)) {
      const tag = tagById.get(el[1]);
      if (tag === 'cc:async-mediation') mediations++;
      if (tag === 'cc:local-out') localOuts++;
    }
    if (mediations >= 2 && localOuts >= 2) {
      const nameMatch = m[0].match(/name="([^"]*)"/);
      crowded.push({ name: nameMatch ? nameMatch[1] : '(unnamed)', mediations, localOuts });
    }
  }

  return crowded;
}

// ─── Positional diagram ref check (@mixed formula) ────────────────────────────
// In a comment-free, pretty-printed assembly.xml, EMF's @mixed feature interleaves
// [whitespace, element, whitespace, element, ...], so the element at 0-based
// position k among a parent's child ELEMENTS always has index 2k+1.
// Therefore every valid positional ref uses ODD indices, and the outer index is
// bounded by 2×(top-level element count)−1. Even or out-of-range indices resolve
// to whitespace text nodes (or nothing) and render as floating/misconnected
// nodes in Studio.

function checkPositionalDiagramRefs(assemblyXml, diagramXml, issues) {
  // Formula only holds for comment-free, pretty-printed files. Comments already
  // raise XML_COMMENTS_PRESENT; skip quietly for minified files.
  if (assemblyXml.includes('<!--')) return;
  const asmOpen = assemblyXml.match(/<cc:assembly\b[^>]*>/);
  if (!asmOpen) return;
  const bodyStart = asmOpen.index + asmOpen[0].length;
  const bodyEnd = assemblyXml.indexOf('</cc:assembly>');
  if (bodyEnd < 0) return;
  const body = assemblyXml.slice(bodyStart, bodyEnd);
  if (!/^\s*\n/.test(body)) return; // not pretty-printed

  // Count direct child elements of cc:assembly (depth-0 opening tags).
  let depth = 0;
  let topLevelCount = 0;
  for (const t of body.matchAll(/<(\/?)([A-Za-z][^\s/>]*)[^>]*?(\/?)>/g)) {
    const [, closing, , selfClosing] = t;
    if (closing) { depth--; continue; }
    if (depth === 0) topLevelCount++;
    if (!selfClosing) depth++;
  }
  const maxOuter = 2 * topLevelCount - 1;

  for (const m of diagramXml.matchAll(/href="assembly\.xml#\/\/@beans\/@mixed\.1((?:\/@mixed\.\d+)+)"/g)) {
    const indices = [...m[1].matchAll(/@mixed\.(\d+)/g)].map(x => Number(x[1]));
    const href = `assembly.xml#//@beans/@mixed.1${m[1]}`;

    if (indices.some(n => n % 2 === 0)) {
      issues.push({
        severity: 'ERROR',
        code: 'POSITIONAL_REF_EVEN_INDEX',
        message: `assembly-diagram.xml href="${href}" uses an EVEN @mixed index. In a comment-free pretty-printed assembly.xml, elements always sit at odd indices (element at 0-based position k among its parent's child elements = @mixed.(2k+1)); even indices resolve to whitespace text nodes and Studio renders floating or misconnected components. Recompute the index with the 2k+1 formula.`,
      });
      continue;
    }

    if (indices[0] > maxOuter) {
      issues.push({
        severity: 'ERROR',
        code: 'POSITIONAL_REF_OUT_OF_RANGE',
        message: `assembly-diagram.xml href="${href}" — outer index @mixed.${indices[0]} exceeds the last element index @mixed.${maxOuter} (cc:assembly has ${topLevelCount} direct child elements, so valid element indices are 1..${maxOuter}, odd only). A structural edit likely removed elements without regenerating the ref (index = 2×position+1).`,
      });
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function collectIds(xml) {
  return new Set([...xml.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
}

function extractId(tagText) {
  const m = tagText.match(/\bid="([^"]+)"/);
  return m ? m[1] : '?';
}
