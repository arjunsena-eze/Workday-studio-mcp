# Workday Studio Integration Patterns

A reference of confirmed patterns, schema rules, and runtime gotchas for building integrations in Workday Studio. Every entry below was verified against a working integration before being recorded.

---

## Table of Contents

1. [Mandatory Build Process](#mandatory-build-process)
2. [Studio Schema Gotchas](#studio-schema-gotchas)
3. [Diagram (assembly-diagram.xml) Rules](#diagram-rules)
4. [MVEL Idioms and Gotchas](#mvel-idioms-and-gotchas)
5. [Custom Java Beans](#custom-java-beans)
6. [Sub-flow Decomposition Patterns](#sub-flow-decomposition)
7. [Outbound HTTP Patterns](#outbound-http-patterns)
8. [XSLT Patterns](#xslt-patterns)
9. [RAAS (Report as a Service) Patterns](#raas-patterns)
10. [REST API Patterns](#rest-api-patterns)
11. [Document Storage Patterns](#email-and-documents)
12. [Server Log Diagnosis Recipes](#server-log-diagnosis)
13. [Common Error Patterns and Fixes](#common-errors)
14. [Backup Workflow Before Structural Edits](#backup-workflow)
15. [Studio Starter Kit (SSK) Patterns](#ssk-patterns)
16. [How to Contribute](#how-to-contribute)

---

## Mandatory Build Process

Skipping the planning phase leads to diagram rewrites, swimlane surgery, and broken EMF XPath indices.

### Step 1 — Gather requirements

| Question | Examples |
|---|---|
| What triggers the integration? | Schedule / Event / Webhook / Manual |
| What does it read from Workday? | SOAP operations, RAAS reports, custom objects |
| What external systems does it call? | REST APIs, SMTP, SFTP |
| What does it produce? | Deliverable file, Workday write-back, email, API call |
| Are there conditional branches? | Rehire vs new hire, impl vs prod |
| What can fail independently? | Each distinct step that needs its own error message |
| What launch params are needed? | Names, types, required/optional |

### Step 2 — Plan sub-assemblies

Decompose into named sub-flows. Each sub-flow = one `cc:local-in` plus its async-mediation steps.

- One responsibility per sub-flow. `GetWorkers`, `TransformToCSV`, `PostToDayforce` — never `DoEverything`.
- Name sub-flows by what they produce, not by what they call. `BuildHireRequest` not `CallSOAP`.
- Identify the props contract: what each sub-flow READS and WRITES.
- Sequential chains use `routes-response-to` on the calling `cc:local-out`.
- Parallel paths each get their own chain starting from the same branch point.

### Step 3 — Write the skeleton assembly first

Create `assembly.xml` with all entry/exit points connected, steps left as `cc:log` stubs. Validate routing before writing any logic. Then fill in each sub-flow one at a time.

```xml
<!-- Main flow: entry then stub mediations then local-out chains -->
<cc:workday-in id="StartHere" routes-to="Init"/>
<cc:async-mediation id="Init" routes-to="CallSubFlow1">
  <cc:steps>
    <cc:log id="TODO_Init"><cc:log-message><cc:text>TODO: Init params</cc:text></cc:log-message></cc:log>
  </cc:steps>
</cc:async-mediation>
<cc:local-out id="CallSubFlow1" store-message="none"
  routes-response-to="CallSubFlow2"
  endpoint="vm://INT999_Name/SubFlow1"/>
<cc:local-out id="CallSubFlow2" store-message="none"
  endpoint="vm://INT999_Name/SubFlow2"/>

<!-- Sub-flow stubs: each local-in plus a TODO log -->
<cc:local-in id="SubFlow1" routes-to="DoSubFlow1"/>
<cc:async-mediation id="DoSubFlow1" handle-downstream-errors="true">
  <cc:steps>
    <cc:log id="TODO_SubFlow1"><cc:log-message><cc:text>TODO: SubFlow1 logic</cc:text></cc:log-message></cc:log>
  </cc:steps>
  <cc:send-error id="SubFlow1Error" rethrow-error="false" routes-to="PutSubFlow1Error"/>
</cc:async-mediation>

<!-- Error handlers -->
<cc:send-error id="GlobalErrorHandler" rethrow-error="false" routes-to="DeliverError"/>
<cc:local-out id="DeliverError" store-message="none" endpoint="vm://wcc/PutIntegrationMessage">
  <cc:set name="is.message.severity" value="'CRITICAL'"/>
  <cc:set name="is.message.summary" value="'INT999 failed: ' + context.errorMessage"/>
  <cc:set name="is.document.deliverable" value="'false'"/>
</cc:local-out>
```

A sub-flow ends naturally when its async-mediation has no `routes-to`. **Do not add `cc:note` as a terminal marker** — `cc:note` is schema-invalid inside `cc:assembly`.

### Step 4 — Write the skeleton diagram second

Write `assembly-diagram.xml` matching the skeleton above. All swimlanes, all connections, all placeholder nodes. Fix EMF XPath indices at this step, not after adding logic.

### Step 5 — Fill in sub-flows one at a time

Replace each `TODO` log with real steps. Open Studio after each sub-flow to verify the diagram renders correctly before moving to the next.

---

## Studio Schema Gotchas

### `cc:note` is schema-invalid in `assembly.xml`

Studio rejects `cc:note` as a `cc:assembly` child. It also crashes Studio if present in `assembly-diagram.xml`. The correct terminal pattern for a sub-flow is an `cc:async-mediation` with no `routes-to` attribute — execution ends naturally when there is nowhere to route.

For colored annotations on swimlanes, use `decorations` in `assembly-diagram.xml` instead (see [SSK Patterns](#ssk-patterns)).

### `cloud:launch-option` valid values

Two distinct categories:

- `"required"` — valid on ALL param types (text, date, boolean, enumeration, class-report-field). Forces the user to fill in the param before launching.
- `"as-of-effective-date"` / `"as-of-entry-datetime"` / `"begin-effective-date"` / `"begin-entry-datetime"` — DATE params ONLY. Auto-populates the date from the business process context.
- `"optional"` is NOT a valid value — schema error.

Text params that are truly optional simply omit `cloud:launch-option` entirely.

### `xsl:param` names cannot contain dots

Props key `DF.XRefCode` declared as `<xsl:param name="DF.XRefCode"/>` produces an XML parse error since dots are not valid in XML NCNames. Use underscores in prop keys that will be XSL params: `DF_XRefCode`. Props accessed only via MVEL (eval, http-out endpoint) can keep dots.

### Top-level vs nested elements

These are TOP-LEVEL `cc:assembly` children only — they cannot be placed inside `cc:async-mediation cc:steps`:

- `cc:workday-out-rest`, `cc:workday-out-soap`
- `cc:http-out`, `cc:email-out`
- `cc:splitter`, `cc:aggregator`, `cc:route`
- `cc:workday-in`, `cc:local-in`, `cc:local-out`
- `cc:send-error` (only as a child of `cc:async-mediation`, never inside `cc:steps`)

Steps that go INSIDE `cc:async-mediation cc:steps`: `cc:log`, `cc:cloud-log`, `cc:eval`, `cc:write`, `cc:store`, `cc:set-headers`, `cc:json-to-xml`, `cc:base64-encode`, `cc:validate-exp`, `cc:custom`, `cc:xslt-plus`.

### `cc:splitter` has no `routes-to` attribute

Adding `routes-to` on `cc:splitter` is a schema validation error. The splitter dispatches per-record sub-routes; the per-record `cc:local-out` returns to the splitter, which advances to the next record automatically.

### Per-record `cc:local-out` from a splitter has no `routes-response-to`

The splitter waits for the sub-flow to finish, then advances to the next record automatically. Do not add `routes-response-to` on the local-out inside a splitter sub-route.

### `cloud:attribute` display options

Two confirmed values for `cloud:display-option`:

```xml
<cloud:attribute name="API Password">
  <cloud:type><cloud:simple-type>text</cloud:simple-type></cloud:type>
  <cloud:display-option>display-as-password</cloud:display-option>   <!-- masks in UI -->
</cloud:attribute>
<cloud:attribute name="Client Namespace">
  <cloud:type><cloud:simple-type>text</cloud:simple-type></cloud:type>
  <cloud:display-option>required-for-launch</cloud:display-option>   <!-- mandatory on launch -->
</cloud:attribute>
```

### XML position does NOT define execution order

Element order in `assembly.xml` has no effect on execution. Only the explicit `routes-to` / `routes-response-to` chain determines what runs next.

When inserting a new step before an existing one in a flow, you MUST update the predecessor's `routes-to` to point at the new step. A step that nothing routes to is unreachable dead code — Studio will not warn you.

After any insertion, trace the full routing chain from the entry `local-in` to the exit and verify every `routes-to` points to the intended next step.

```xml
<!-- WRONG: mediator still routes to OldStep; NewStep is dead code despite being above it -->
<cc:sync-mediation id="EntryLog" routes-to="OldStep" .../>
<cc:local-out id="NewStep" execute-when="conditionA" .../>  <!-- never reached -->
<cc:local-out id="OldStep" execute-when="conditionB" .../>

<!-- CORRECT: mediator routes-to updated; NewStep falls through to OldStep when skipped -->
<cc:sync-mediation id="EntryLog" routes-to="NewStep" .../>
<cc:local-out id="NewStep" execute-when="conditionA" routes-response-to="OldStep" .../>
<cc:local-out id="OldStep" execute-when="conditionB" routes-response-to="FinalDestination" .../>
```

### Conditional cc:local-out chaining — routes-response-to is the skip fallthrough

When a `cc:sync-mediation` needs to choose between two mutually exclusive `cc:local-out` steps using `execute-when`, chain them sequentially — do NOT have the mediator route directly to the second step.

When a `cc:local-out` is skipped (`execute-when` evaluates to false), Studio fires its `routes-response-to` as a pass-through fallthrough. It does NOT automatically advance to the next sibling.

```xml
<!-- WRONG: mediator routes to StepB directly; StepA is unreachable dead code -->
<cc:sync-mediation id="LogStep" routes-to="StepB" .../>
<cc:local-out id="StepA" execute-when="conditionA" routes-response-to="Destination" .../>
<cc:local-out id="StepB" execute-when="conditionB" routes-response-to="Destination" .../>

<!-- CORRECT: chain them; skipped StepA falls through to StepB -->
<cc:sync-mediation id="LogStep" routes-to="StepA" .../>
<cc:local-out id="StepA" execute-when="conditionA" routes-response-to="StepB" .../>
<cc:local-out id="StepB" execute-when="conditionB" routes-response-to="Destination" .../>
```

Both paths converge at `Destination`:
- Path A (`conditionA` true): StepA executes → sub-flow → returns → StepB skipped via fallthrough → Destination
- Path B (`conditionB` true): StepA skipped via fallthrough → StepB executes → sub-flow → returns → Destination

**Silent double passthrough:** if BOTH conditions in a mutually-exclusive pair evaluate false (e.g. due to a prop containing the string `"null"` — see [JSON null](#json-null-values-become-the-string-null--not-java-null)), the flow silently jumps two steps forward with no log output. Add a `cc:log` before the pair logging the raw prop value and each `execute-when` boolean to diagnose this:

```xml
<!-- Debug log before a conditional local-out pair -->
<cc:log><cc:log-message><cc:text>
  myProp=[@{props['myProp']}]
  condA (fires StepA)=[@{props['myProp'] != ''}]
  condB (fires StepB)=[@{props['myProp'] == ''}]
</cc:text></cc:log-message></cc:log>
```

### Every `cc:async-mediation` needs its own `cc:send-error`

Each `cc:async-mediation` with `handle-downstream-errors="true"` must have its own `cc:send-error` child. Do NOT consolidate multiple mediations onto a single upstream handler — each step needs its error caught at the right scope with the right `context.errorMessage`.

The multiple arrows converging on a shared `PutError` terminal in the diagram are normal Studio rendering — not a problem to fix. Never remove individual `cc:send-error` elements to "clean up" the diagram.

```xml
<!-- CORRECT: each mediation catches its own errors -->
<cc:async-mediation id="PrepareToken" routes-to="GetTokenHttp" handle-downstream-errors="true">
  <cc:steps>...</cc:steps>
  <cc:send-error id="PrepareTokenError" rethrow-error="false" routes-to="PutError"/>
</cc:async-mediation>

<cc:async-mediation id="ParseToken" routes-to="PrepareRequest" handle-downstream-errors="true">
  <cc:steps>...</cc:steps>
  <cc:send-error id="ParseTokenError" rethrow-error="false" routes-to="PutError"/>
</cc:async-mediation>
```

### Component ID naming conventions

Studio shows all element IDs flat in the palette. Without descriptive names, five `AsyncMediation` entries are indistinguishable. Names also appear in server logs — readable names make log triage 10× faster.

| Element type | Convention | Examples |
|---|---|---|
| `cc:async-mediation` | Verb + Object (PascalCase) | `InitBatch`, `SetTransactionProps`, `PrepareTermination`, `ParseGraphUsers` |
| `cc:local-in` | Sub-flow noun (what this flow produces) | `LoadAttrs`, `AzureToken`, `GraphUsers`, `LookupEmployee` |
| `cc:local-out` (sub-flow call) | `Call_` + SubFlowName | `Call_LoadAttrs`, `Call_AzureToken`, `Call_GraphUsers` |
| `cc:local-out` (error delivery) | `Put` + SubFlowName + `Fail` | `PutLoadAttrsFail`, `PutAzureTokenFail` |
| `cc:route` | `RouteBy` + Criteria | `RouteByTransactionType`, `RouteByPositionExists` |
| `cc:splitter` | `SplitBy` + Element | `SplitByEmployee`, `SplitByTransaction` |
| `cc:send-error` (inside mediation) | SubFlowName + `Error` | `LoadAttrsError`, `PrepareTokenError` |
| `cc:workday-out-*` | `Call` + Api + Operation | `CallStaffingTerminate`, `GetWDWorkersRAAS`, `PostGraphBatch` |
| Global error `cc:local-out` | `DeliverError` (singleton) | — |
| Global `cc:send-error` | `GlobalErrorHandler` (singleton) | — |

```xml
<!-- BAD — auto-generated, palette shows five mediations with no context -->
<cc:async-mediation id="AsyncMediation0" .../>
<cc:async-mediation id="AsyncMediation3" .../>
<cc:local-in id="SubFlow0" .../>
<cc:local-out id="LocalOut1" .../>

<!-- GOOD — self-documenting in palette and server logs -->
<cc:async-mediation id="InitBatch" .../>
<cc:async-mediation id="PrepareTermination" .../>
<cc:local-in id="LookupEmployee" .../>
<cc:local-out id="Call_LookupEmployee" .../>
```

---

## Diagram Rules

### EMF XPath indices count whitespace and comments

Studio's `assembly-diagram.xml` uses positional XPath like:

```xml
<source href="assembly.xml#//@beans/@mixed.1/@mixed.75/@mixed.3"/>
```

The `@mixed` index counts elements AND whitespace text nodes AND XML comments. Each `<cc:foo>` element typically occupies 2 slots: whitespace then element.

To count correctly:

```python
import xml.dom.minidom
doc = xml.dom.minidom.parse('assembly.xml')
asm = doc.getElementsByTagNameNS('*','assembly')[0]
for i, n in enumerate(asm.childNodes):
    print(i, n.nodeType, getattr(n,'tagName','[text/comment]'))
```

**Shortcut:** Write `assembly.xml` with NO XML comments — then all elements fall on odd indices (1, 3, 5...) and you can compute without Python.

**Closed-form formula (verified in Studio):** in a comment-free, pretty-printed `assembly.xml`, EMF interleaves the `@mixed` feature as `[whitespace, element, whitespace, element, ...]`, so the element at 0-based position `k` among `cc:assembly`'s direct child ELEMENTS has index `2k+1`. This makes positional refs computable instead of copied from a Studio-generated file:

```python
children = list(assembly_element)          # ordered direct child elements
k = children.index(target)
ref = f"assembly.xml#//@beans/@mixed.1/@mixed.{2*k+1}"
```

Example: the 10th top-level element (`k=9`) is `@mixed.19`. The leading `@mixed.1` in `//@beans/@mixed.1` is the same formula applied to `cc:beans` — `cc:assembly` is its first child element (`k=0`). The formula also applies one level down for nested refs (a `cc:send-error` that follows `cc:steps` inside an async-mediation sits at `k=1` → `/@mixed.3`).

Corollary of the insertion shift rule below: inserting or removing a top-level element before position `k` shifts the index by ±2 per element — regenerate the ref (or the whole diagram) after any structural edit. Verified end-to-end: a computed ref used as the `<source>` of a top-level `cc:send-error`'s (GlobalErrorHandler) `routesTo` connection resolved and rendered correctly in Studio.

### Insertion shift rule

Inserting N new top-level elements anywhere inside `cc:assembly` shifts ALL subsequent `@mixed` indices by `2×N`. When you add one element at position P, every `@mixed.X` where X > P becomes `@mixed.(X+2)`.

- Removing N top-level elements (with their preceding whitespace) decreases all subsequent indices by `2×N`.
- Adding 1 XML comment block increases subsequent indices by `2`.
- Adding N elements increases subsequent indices by `2×N`.

A reference at `@mixed.95` BEFORE a 6-element deletion + 1-comment add becomes `@mixed.95 - 12 + 2 = @mixed.85`.

**Concrete example (JobCreation flow removal from a live build):**

```xml
<!-- BEFORE: 6-element JobCreation flow removed + 1 XML comment inserted -->
<source href="assembly.xml#//@beans/@mixed.1/@mixed.95"/>         <!-- global-error-handler -->
<source href="assembly.xml#//@beans/@mixed.1/@mixed.129/@mixed.3"/>  <!-- AsyncMediation60 send-error -->

<!-- AFTER: shift = -12 (6 elements) + 2 (1 comment) = -10 for indices ≥ 95 -->
<source href="assembly.xml#//@beans/@mixed.1/@mixed.85"/>         <!-- global-error-handler -->
<source href="assembly.xml#//@beans/@mixed.1/@mixed.119/@mixed.3"/>  <!-- AsyncMediation60 send-error -->
```

If you get this wrong, Studio renders floating unconnected components or edges from the wrong source node (e.g. `AsyncMediation12` appearing disconnected because `@mixed.95` now resolves to it instead of the global-error-handler).

Update the diagram's error connection `<source href>` values and any index-map comment in `assembly-diagram.xml` before opening in Studio.

### Verification script — run after every structural edit

Confirms every diagram positional ref still resolves to its intended target:

```python
from lxml import etree
import re
parser = etree.XMLParser(remove_blank_text=False, remove_comments=False)
asm = etree.parse('ws/WSAR-INF/assembly.xml').getroot().find(
    '{http://www.capeclear.com/assembly/10}assembly')

# Build index map
idx_map = {}
i = 0
if asm.text is not None:
    idx_map[i] = ('<ws>', None); i += 1
for child in asm.iterchildren():
    if isinstance(child, etree._Comment):
        idx_map[i] = ('COMMENT', None)
    else:
        tag = etree.QName(child.tag).localname
        cid = child.get('id', '')
        idx_map[i] = (f"{tag}#{cid}" if cid else tag, child)
    i += 1
    if child.tail is not None:
        idx_map[i] = ('<ws>', None); i += 1

diag = etree.parse('ws/WSAR-INF/assembly-diagram.xml').getroot()
for elem in diag.iter():
    href = elem.get('href')
    if not href:
        continue
    m = re.match(r'assembly\.xml#//@beans/@mixed\.1/@mixed\.(\d+)(?:/@mixed\.(\d+))?$', href)
    if not m:
        continue
    outer = int(m.group(1))
    inner = m.group(2)
    label, el = idx_map.get(outer, ('???', None))
    if inner is None:
        print(f"@mixed.{outer:3d}                 = {label}")
    else:
        sub_i = 0
        sub_label = '???'
        if el is not None and el.text is not None:
            if sub_i == int(inner):
                sub_label = '<ws>'
            sub_i += 1
        for sub in (el.iterchildren() if el is not None else []):
            if sub_i == int(inner):
                sub_label = etree.QName(sub.tag).localname
                rt = sub.get('routes-to', '')
                if rt:
                    sub_label += f" routes-to={rt}"
                break
            sub_i += 1
            if sub.tail is not None:
                if sub_i == int(inner):
                    sub_label = '<ws>'; break
                sub_i += 1
        print(f"@mixed.{outer:3d}/@mixed.{inner}      = inside {label}: {sub_label}")
```

Compare each output line against the diagram's `<target>` for that connection. If the target says `AsyncMediation12` and the resolved source is `AsyncMediation4 routes-to=AsyncMediation12`, it's correct.

### `cc:send-error` cannot be a diagram node

Adding ANY `cc:send-error` element as a `<visualProperties>` block OR as a swimlane `<elements>` entry crashes Studio with `scala.MatchError` at every load. This applies equally to:

- Inline send-errors referenced via EMF XPath (`#//@beans/@mixed.1/@mixed.43`)
- Named top-level send-errors referenced by id (`#GlobalErrorHandler`)

Studio's `Factory.scala:19` has no `EditPart` case for `cc:send-error`. The element type is not renderable.

**Fix:** `cc:send-error` is ONLY safe as a `<source>` in a `<connections>` block — resolved as a reference, not rendered as a node. The Error Handler swimlane should contain only `cc:local-out` targets (e.g. `DeliverError`), never the `cc:send-error` itself.

### Confirmed safe diagram node types

Only these elements can appear in `visualProperties` or as swimlane `elements`:

`cc:workday-in`, `cc:local-out`, `cc:local-in`, `cc:async-mediation`, `cc:route`, `cc:splitter`, `cc:aggregator`, `cc:http-out`, `cc:workday-out-rest`, `cc:workday-out-soap`, `cc:email-out`.

Steps inside `cc:async-mediation` (like `cc:store`, `cc:write`, `cc:eval`) are NOT top-level — they have no diagram entry.

### Splitter sub-route arrows anchor at the sub-route slot, not the splitter id

The arrow from a splitter to its per-record target uses the `@splitter.N/@subRoute.M` EMF XPath as its `<source>` — NOT the splitter's element id. The XPath anchors the arrow at the sub-route slot inside the rendered splitter box; an id-based source draws the arrow from the splitter box as a whole. (Confirmed against a Studio-authored production diagram.)

```xml
<!-- Arrow from the splitter's first sub-route to the per-record mediation -->
<connections type="routesTo">
  <source href="assembly.xml#//@beans/@mixed.1/@splitter.0/@subRoute.0"/>
  <target href="assembly.xml#DoGetWorkers"/>
</connections>
```

Both indices are zero-based: `@splitter.N` counts the assembly's splitter elements, `@subRoute.M` the sub-routes within that splitter.

### Adding components: three required diagram entries

Every new top-level element added to `assembly.xml` MUST have three corresponding entries in `assembly-diagram.xml` before the next Studio open:

1. **`visualProperties`** — coordinates:

```xml
<visualProperties x="400" y="810">
  <element href="assembly.xml#NewComponentId"/>
</visualProperties>
```

2. **`connections`** — one `routesTo` or `routesResponseTo` per arrow:

```xml
<connections type="routesTo">
  <source href="assembly.xml#PreviousComponent"/>
  <target href="assembly.xml#NewComponentId"/>
</connections>
```

3. **`swimlanes` membership** — add to the appropriate outer swimlane `<elements>` list:

```xml
<swimlanes x="30" y="770" name="BuildAuditFile Sub-flow" ...>
  <elements href="assembly.xml#BuildAuditFile"/>
  <elements href="#//@swimlanes.10"/>
  <elements href="assembly.xml#NewComponentId"/>
</swimlanes>
```

Coordinate placement rule: x/y should place the component inline with its upstream node — same y as the flow row, x = upstream_x + ~140px.

### `Call_X` → `X` vm:// dispatch arrows are never drawn

Diagram connections correspond to `routes-to` / `routes-response-to` attributes only. A `cc:local-out` → `cc:local-in` vm:// dispatch is an implicit logical link: Studio-authored diagrams never draw it, and hand-adding a `<connections>` block for it produces a redundant diagonal arrow across the canvas. (Confirmed against a Studio-authored production diagram, which draws none of these.)

For a RaaS-driven flow (workday-out-rest + splitter + sub-flows), the complete arrow set is:

- entry node → RAAS call (`routesTo`)
- `cc:workday-out-rest` → splitter (`routesResponseTo`)
- splitter sub-route → per-record mediation (`@splitter.N/@subRoute.M` source — see above)
- the linear `Call_X` `routes-response-to` `Call_X+1` chain in the main flow
- per sub-flow: `X` (local-in) → `DoX`, and `DoX`'s send-error → `PutXError` (send-error source via `@mixed` XPath)
- global send-error → `DeliverError` (`@mixed` XPath)

No arrow between any `Call_X` and its `X` local-in. `validate_assembly` flags hand-drawn dispatch arrows (`REDUNDANT_VM_DISPATCH_ARROW`).

This invisibility is also a layout tool — see [vm:// hops as a legibility tool](#vm-hops-as-a-legibility-tool--fan-in-local-outs-eliminate-cross-canvas-arrows) at the end of this section.

### Removing components: mirror the three entries

When removing a top-level element from `assembly.xml`, drop all three corresponding diagram entries in the same change:

1. Drop the `<visualProperties>` block that wraps `<element href="assembly.xml#DeletedId"/>`
2. Drop every `<connections>` block where source OR target href points at the deleted id
3. Drop the matching `<elements href="assembly.xml#DeletedId"/>` line from any swimlane

If you skip step 1-3, Studio shows: `scala.MatchError: org.eclipse.emf.ecore.impl.EObjectImpl@... (eProxyURI: ...assembly.xml#DeletedId)`. Each unresolved href returns an `EObjectImpl` with only `eProxyURI` set; Studio's `Factory.scala:19` has no match case for unresolved proxies, so the editor part fails to initialize and a cascading `IWorkbenchWindow` NPE follows.

### Renaming a step ID requires matching rename in both files

Every element `id=` attribute in `assembly.xml` has up to three corresponding forms in `assembly-diagram.xml`. When you rename a step ID, ALL three forms must be updated in the same change:

| Form | Example |
|---|---|
| `visualProperties` | `<element href="assembly.xml#OldID"/>` |
| `connections` source/target | `<source href="assembly.xml#OldID"/>` |
| `swimlanes` element ref | `<elements href="assembly.xml#OldID"/>` |

Missing any one of these causes `scala.MatchError` on diagram open — Studio crashes the editor with no useful error message.

**Safe rename process:**
1. Rename `id="OldID"` → `id="NewID"` in `assembly.xml`
2. `grep -r "OldID" ws/WSAR-INF/assembly-diagram.xml` to find every occurrence
3. Replace all `#OldID"` → `#NewID"` in `assembly-diagram.xml` (the `#` prefix plus trailing `"` ensures no partial matches)
4. Run `validate_assembly` — it checks for stale diagram hrefs

The `rename_steps` studio-mcp tool (if installed) does this atomically.

```xml
<!-- assembly.xml — id renamed -->
<cc:async-mediation id="SetTransactionProps" .../>  <!-- was: AsyncMediation3 -->

<!-- assembly-diagram.xml — ALL three href forms must change -->
<element href="assembly.xml#SetTransactionProps"/>      <!-- was: #AsyncMediation3 -->
<source  href="assembly.xml#SetTransactionProps"/>      <!-- was: #AsyncMediation3 -->
<elements href="assembly.xml#SetTransactionProps"/>     <!-- was: #AsyncMediation3 -->
```

### Don't remove swimlanes — empty them

Removing a `<swimlanes>` container shifts every `#//@swimlanes.N` reference and breaks unrelated parts of the diagram. Empty the container instead:

```xml
<!-- Before -->
<swimlanes x="..." name="...">
  <elements href="assembly.xml#DeletedItem"/>
</swimlanes>

<!-- After: keep container with no children, indices unchanged -->
<swimlanes x="..." name="..."/>
```

### Never insert a swimlane between existing ones

Swimlane cross-references use zero-based positional indices (`#//@swimlanes.0`, `#//@swimlanes.1`, etc.), not IDs. Inserting a new swimlane anywhere except the very end silently corrupts every reference with a higher index — all those connections silently point to the wrong swimlane.

**Safe rules:**
- NEVER insert a swimlane between existing ones.
- Only APPEND new swimlanes at the very end of the swimlanes list.
- When adding components to an existing sub-flow, add them as `<elements>` inside an existing swimlane — usually `Master` for startup-flow steps.

```xml
<!-- WRONG — inserting in the middle shifts all downstream #//@swimlanes.N refs -->
<swimlanes name="Master"> ... </swimlanes>
<swimlanes name="New Swimlane">    <!-- inserted here — BREAKS everything below -->
  <elements href="assembly.xml#NewStep"/>
</swimlanes>
<swimlanes name="SomeLane"> ... </swimlanes>  <!-- was index 1, now index 2 -->

<!-- SAFE — add new component into existing Master swimlane instead -->
<swimlanes name="Master">
  <elements href="assembly.xml#AsyncMediation"/>
  <elements href="assembly.xml#GetBearerToken_Out"/>  <!-- added here, no index shift -->
  <elements href="assembly.xml#FetchTokenMediation"/>
</swimlanes>
```

### Swimlane layout template

```
swimlanes.0   Error Handler        (alignment=END)     — DeliverError local-out only
swimlanes.1   Main Flow            (alignment=MIDDLE)  — entry node + local-out chain
swimlanes.2   SubFlow1 outer       (alignment=MIDDLE)  — local-in + #//@swimlanes.3 + optional success-exit node
swimlanes.3   SubFlow1 inner       (orientation=VERTICAL) — async step (top) + PutXxxError (bottom)
swimlanes.4   SubFlow2 outer       (alignment=MIDDLE)  — same pattern
swimlanes.5   SubFlow2 inner       (orientation=VERTICAL)
...
swimlanes.N   MASTER CONTAINER     (orientation=VERTICAL, labelAlignment=LEFT)
              — added LAST so no refs shift; references all outer bands
```

For sub-flows that contain a RAAS plus splitter, use TWO inner vertical lanes inside the outer band:

```
swimlanes.2   GetWorkers outer: local-in, workday-out-rest, #/swimlanes.3,
                                splitter, #/swimlanes.4, CallProcessOneWorker
swimlanes.3   GetWorkers Inner A VERTICAL: pre-fetch async (top) + PutFetchError (bottom)
swimlanes.4   GetWorkers Inner B VERTICAL: per-record extract async (top) + HandleExtractError (bottom)
```

Splitter node lives inline in the outer band, between the two inner boxes.

### Two nested-swimlane reference syntaxes — pick by content

A parent swimlane references its nested vertical children in one of two forms, and the URI fragment differs between them (confirmed against a Studio-authored production diagram):

**Self-closing attribute form** — the parent contains ONLY nested-child references. The `elements` attribute uses `//@swimlanes.N` with NO leading `#`:

```xml
<swimlanes x="30" y="320" name="RaaS Processing Sub-flow" elements="//@swimlanes.3" alignment="MIDDLE" labelAlignment="LEFT"/>
```

**Container child-element form** — the parent mixes nested children with inline step members. Each nested reference is an `<elements>` child whose href DOES take the leading `#`:

```xml
<swimlanes x="30" y="140" name="Main Flow" alignment="MIDDLE" labelAlignment="LEFT">
  <elements href="assembly.xml#SplitWorkers"/>
  <elements href="#//@swimlanes.2"/>
  <elements href="assembly.xml#Call_FindResource"/>
</swimlanes>
```

Mixing the fragments up (e.g. `elements="#//@swimlanes.3"` in attribute form, or `href="//@swimlanes.2"` in child form) leaves the swimlane reference unresolvable — `validate_assembly` flags this (`SWIMLANE_REF_FRAGMENT_FORM`).

The Master container swimlane (last in the file, `orientation="VERTICAL"`) uses the attribute form and lists PARENT swimlanes only — nested vertical children are reached through their parents, never listed directly. Each `DoX`/`PutXError` step still needs BOTH its own top-level `visualProperties` block AND membership in its vertical child swimlane (not either/or):

```xml
<swimlanes x="-26" y="-287" name="Master" orientation="VERTICAL"
  elements="//@swimlanes.0 //@swimlanes.1 //@swimlanes.4 //@swimlanes.6 //@swimlanes.8"/>
```

### Inner swimlane design rule (success path exits, error stays)

- Inner VERTICAL swimlane: the async-mediation step ON TOP, its `cc:local-out` error handler ON BOTTOM — stacked vertically, same x, different y.
- If the step has a success continuation, that node goes in the OUTER band to the right of the inner swimlane box.
- If the step is terminal, the inner swimlane contains only step + error handler.

### One inner VERTICAL lane per (Do + PutError) pair

When a sub-flow gains a SECOND substantive async-mediation with its own error handler (a second `Do{X}` + `Put{X}Error` pair), give the new pair its OWN inner VERTICAL swimlane — do not append it to the vertical lane that already holds the first pair. Studio renders each vertical child as a distinct boxed work unit; cramming two pairs into one lane collapses them into a single box and loses the visual hierarchy. (This generalizes the two-inner-lane RAAS example in the swimlane layout template.)

The outer sub-flow band lists one `#//@swimlanes.N` reference per inner lane. Add the new vertical lane at the END of the diagram's swimlane list (see "Never insert a swimlane between existing ones") so no existing `#//@swimlanes.N` index shifts — its index is simply the next free slot, which may be far from its sibling's.

```xml
<!-- Outer band: one #//@swimlanes.N ref per Do/PutError pair -->
<swimlanes x="30" y="1120" name="GetWorker Sub-flow">
  <elements href="assembly.xml#GetWorker"/>             <!-- local-in -->
  <elements href="assembly.xml#FetchWorker"/>           <!-- http-out -->
  <elements href="assembly.xml#FetchWorkerDetail"/>     <!-- http-out -->
  <elements href="#//@swimlanes.12"/>                   <!-- first pair -->
  <elements href="#//@swimlanes.23"/>                   <!-- second pair, appended at end -->
</swimlanes>

<!-- First pair: its own vertical box -->
<swimlanes x="170" y="1135" name="Swimlane" orientation="VERTICAL">
  <elements href="assembly.xml#DoFetchWorker"/>
  <elements href="assembly.xml#PutFetchWorkerError"/>
</swimlanes>

<!-- Second pair: SEPARATE vertical box, added at the END of the swimlane list -->
<swimlanes x="644" y="1634" name="Swimlane" orientation="VERTICAL">
  <elements href="assembly.xml#DoFetchWorkerDetail"/>
  <elements href="assembly.xml#PutFetchWorkerDetailError"/>
</swimlanes>
```

The new pair's `send-error` connection source is a positional `@mixed` ref — compute it with the `2k+1` formula (see "EMF XPath indices count whitespace and comments") rather than copying a neighbor's index.

This does not conflict with "Co-located errors with nested VERTICAL bands" below: that pattern co-locates error BRANCH nodes (async-mediations without paired local-outs) next to their decision point. This rule is about substantive work units that each route to a dedicated `cc:local-out` error handler.

### Error handler proximity rule

- Two async-mediations in the SAME sub-flow band can share one error handler if they are adjacent.
- Two async-mediations in DIFFERENT bands must have SEPARATE error handlers — avoids long cross-band arrows.
- Name them after their source: `HandleExtractError` for errors from `ExtractFields`.

### Co-located errors with nested VERTICAL bands

For complex sub-flows with multiple decision points, do NOT isolate errors in a separate "Errors" outer band. Place error branch nodes adjacent to their decision point inside the same VERTICAL inner band. Nesting 3 levels deep is acceptable.

```
SubFlow (outer, default horizontal):
  EntryPoint (local-in)
  swimlanes.A — Decision/branch group (VERTICAL):
      AsyncMediation_1            # initial log/step
      AsyncMediation_NotFound     # not-found branch, co-located
      AsyncMediation_WD_Error     # WD error, co-located near its source
  swimlanes.B — API calls group (VERTICAL container):
      swimlanes.C — GET check band:
          GET_Resource
          AsyncMediation_Found
      swimlanes.D — WD+POST chain band:
          WorkdayOutRest_Resource
          swimlanes.E — Response/error inner (VERTICAL):
              AsyncMediation_WD_Response
              AsyncMediation_POST_Error
          POST_Resource
          AsyncMediation_POST_Success
```

When Studio recalculates `@mixed.N` indices after node moves, let it. Do NOT hand-edit those references — Studio-written connection sources are always correct.

### `cc:route` code-gated recovery — three-lane left-to-right layout

For any "log error then branch to recovery vs terminal" pattern, use three swimlanes left-to-right:

```
[error-handler lane]       [decision lane]            [terminal lane]
 AsyncMediation12           HireErrorBranch            CallDTA1 (recovery, top)
  Log + Eval ──────────▶    cc:route ──────────────▶   CallProcessErrorHire (terminal, below)
  (logs error,               MVEL Strategy
   sets can_recover_*)        Recover / LogAndExit
```

**Layout rules:**
1. Error-handler async-mediation in its own lane — Log + Eval inline, `routes-to` = decision route.
2. `cc:route` decision in its own lane — Studio renders Strategy chip and Sub-Routes automatically.
3. Terminal targets stack vertically in one lane: recovery on top (~100px gap), terminal log below.

**Coordinate convention:** error-handler x ≈ 480, route x ≈ 640, terminals x ≈ 800.

**Reusable XML template:**
```xml
<cc:async-mediation id="<ErrorHandler>" routes-to="<DecisionRoute>">
    <cc:steps>
        <cc:log .../>
        <cc:eval>
            <cc:expression>props['p.error.log'].append(... + 'ERROR,<Step>,' + context.errorMessage.toString() + '\n')</cc:expression>
            <cc:expression>props['p.error.count'] = props['p.error.count'] + 1</cc:expression>
            <cc:expression>props['can_recover'] = context.errorMessage.toString().contains('<RecoverableErrorCode>')</cc:expression>
        </cc:eval>
    </cc:steps>
</cc:async-mediation>
<cc:route id="<DecisionRoute>">
    <cc:mvel-strategy>
        <cc:choose-route expression="props['can_recover'] == true" route="Recover"/>
        <cc:choose-route expression="true" route="LogAndExit"/>
    </cc:mvel-strategy>
    <cc:sub-route name="Recover"    routes-to="<RecoveryTarget>"/>
    <cc:sub-route name="LogAndExit" routes-to="<TerminalLogTarget>"/>
</cc:route>
```

Always book-keep the error BEFORE the branch decision — even on recoverable errors, the audit trail should show the failed attempt followed by the recovery success.

### Add new cc:local-out at the END of assembly to avoid @mixed index cascade

When adding a `cc:local-out` that does not need to appear adjacent to its caller in the XML (error handlers, utility steps), add it at the very end of `assembly.xml` — just before `</cc:assembly>`.

This guarantees zero `@mixed` index shift for all existing diagram connections. The diagram references error handlers and targets by element ID (`assembly.xml#MyErrorHandler`), not by `@mixed` index, so physical XML position does not affect how they are referenced.

```xml
<!-- Add at the very end — nothing above shifts, no diagram audit needed -->
<cc:local-out id="MySubFlowError" endpoint="vm://INT999_Name/UMsgH_Do">
    <cc:set name="UMsgH_Number" value="1"/>
    <cc:set name="UMsgH_Summary" value="'Error in MySubFlow: describe the specific failure.'"/>
    <cc:set name="UMsgH_ToWorkday" value="true"/>
    <cc:set name="UMsgH_Detail" value="context.errorMessage"/>
</cc:local-out>
</cc:assembly>

<!-- Diagram connection targets it by ID — @mixed index of any source is unaffected -->
<connections type="routesTo">
    <source href="assembly.xml#//@beans/@mixed.1/@mixed.N/@mixed.3"/>
    <target href="assembly.xml#MySubFlowError"/>
</connections>
```

If you add a local-out inline near its caller instead, every element below it shifts by +2, requiring a full diagram audit to update all downstream `@mixed` references.

### Give each sub-flow swimlane its own local error handler

Every sub-flow swimlane containing a `cc:async-mediation` with `handle-downstream-errors="true"` should declare its OWN `cc:local-out` error handler — included in that swimlane's `<elements>` list.

Routing a sub-flow's `cc:send-error` to a global error handler in a distant swimlane produces a long diagonal arrow spanning the entire canvas and uses a generic error message that doesn't describe the specific failure.

```xml
<!-- async-mediation routes error to its own handler, not a distant global one -->
<cc:async-mediation id="MySubFlow_Mediation" routes-to="MyRestCall"
    handle-downstream-errors="true">
    <cc:send-error id="SendError" routes-to="MySubFlowError"/>
</cc:async-mediation>

<!-- Error handler added at END of assembly.xml (no @mixed shift) -->
<cc:local-out id="MySubFlowError" endpoint="vm://INT999_Name/UMsgH_Do">
    <cc:set name="UMsgH_Summary" value="'Error in MySubFlow: describe the specific failure.'"/>
</cc:local-out>

<!-- Diagram: error handler is a member of its own sub-flow swimlane -->
<swimlanes name="My Sub-Flow">
    <elements href="assembly.xml#MySubFlow_Mediation"/>
    <elements href="assembly.xml#MyRestCall"/>
    <elements href="assembly.xml#MySubFlowError"/>
</swimlanes>
```

Name error handlers after their sub-flow: `GetWorkersError`, `PostToDayforceError`. This makes the SendError arrow stay entirely within the swimlane and the error message accurately describes what failed.

### vm:// hops as a legibility tool — fan-in local-outs eliminate cross-canvas arrows

Diagram connections exist only for `routes-to` / `routes-response-to`; a `cc:local-out` → `cc:local-in` vm:// pair draws NO arrow (see [`Call_X` → `X` vm:// dispatch arrows are never drawn](#call_x--x-vm-dispatch-arrows-are-never-drawn) above). Exploit this deliberately:

When one step has multiple distant feeders, no amount of repositioning helps — with far-apart feeders, SOME arrow is always long. Instead, give EACH feeder its own small `cc:local-out` placed right beside it, all pointing at one vm endpoint whose `cc:local-in` routes to the real target:

```xml
<!-- One tiny local-out beside each distant feeder — name them by intent -->
<cc:local-out id="Call_Phase5Skip" store-message="none" endpoint="vm://INT999_Name/Phase5NoOp"/>
<cc:local-out id="Call_Phase5Done" store-message="none" endpoint="vm://INT999_Name/Phase5NoOp"/>

<!-- One shared entry point that routes to the real target -->
<cc:local-in id="Phase5NoOp" routes-to="DoPhase5NoOpTerminator"/>
```

The drawn arrows shrink to tiny feeder → local-out hops; the long spans vanish into the invisible vm link. Flow semantics are unchanged — it is the same vm dispatch pattern the assembly already uses between sub-flows (`store-message="none"`, no `routes-response-to` on the fan-in local-outs). Cost: two extra elements per distant feeder, each needing the standard three diagram entries (visualProperties + connections + swimlane membership — `validate_assembly` warns with `DIAGRAM_MISSING_ELEMENT` if you forget). This is a deliberate assembly refactor for readability.

### Swimlane membership can override a member's explicit x/y

During render, a node's swimlane MEMBERSHIP can override its explicit `visualProperties` x/y. Keep free-floating positioned nodes OUT of swimlane `<elements>` lists if their coordinates must stick. (Steps that logically belong to a lane still need BOTH their `visualProperties` block AND lane membership — see the nested-swimlane rules above; the lane's layout wins on conflict. This rule is about nodes that are not part of any lane.)

---

## MVEL Idioms and Gotchas

### CDATA for comparison operators and multi-statement blocks

`>`, `<`, `if/else`, and multi-statement blocks must be wrapped in CDATA, since `>` and `<` are markup characters in XML:

```xml
<cc:expression><![CDATA[
  if (props['status'] == 'Active' && props['count'] > 0) {
    props['result'] = props['val'] + ',MATCH'
  } else {
    props['result'] = props['val'] + ',MISMATCH'
  }
]]></cc:expression>
```

Single-assignment expressions that only use `=`, `+`, string literals, and `props['key']` accesses don't need CDATA. Any `if`, `else`, `>`, `<`, `>=`, `<=`, `&&`, `||`, or multi-statement logic does.

`&&` in `cc:expression` (without CDATA) must be written as `&amp;&amp;`. The XML parser converts it back to `&&` before MVEL sees it.

### `props['map'].method(complexExpr)` fails inside if/else

MVEL 1.3.13 cannot compile a method call on a map-accessed object when the argument is a complex expression AND the call is inside an if/else block. Fails with:

```
org.mvel.ParseException: unknown class: props['csv.builder'].append(props['WD_Employee_ID'] + ',' + ...)
```

- `props['map'].methodCall(localVar)` inside if/else — works.
- `props['map'].methodCall(complexExpr)` at the top level of `cc:expression` — works.
- `props['map'].methodCall(complexExpr)` inside an if/else block — fails.

**Fix:** Replace if/else with sequential `cc:expression` elements using ternary operators. Pre-compute the value, then call the method at the top level:

```xml
<!-- BAD: if/else with method call on complex arg -->
<cc:eval id="AppendErrorRow">
    <cc:expression>
if (condition) {
    props['csv.builder'].append(props['A'] + ',' + props['B'] + ',label1,\n')
    props['count.x'] = props['count.x'] + 1
} else {
    props['csv.builder'].append(props['A'] + ',' + props['B'] + ',label2,\n')
    props['count.y'] = props['count.y'] + 1
}
    </cc:expression>
</cc:eval>

<!-- GOOD: sequential expressions, ternary for branching -->
<cc:eval id="AppendErrorRow">
    <cc:expression>props['_flag'] = condition</cc:expression>
    <cc:expression>props['_label'] = props['_flag'] ? 'label1' : 'label2'</cc:expression>
    <cc:expression>props['csv.builder'].append(props['A'] + ',' + props['B'] + ',' + props['_label'] + ',\n')</cc:expression>
    <cc:expression>props['count.x'] = props['count.x'] + (props['_flag'] ? 1 : 0)</cc:expression>
    <cc:expression>props['count.y'] = props['count.y'] + (props['_flag'] ? 0 : 1)</cc:expression>
</cc:eval>
```

### A semicolon inside a string literal fails the whole deploy

Studio's bundled MVEL 1.3.13 treats `;` as a statement separator **even inside single-quoted string literals**. Any `;` in a literal — leading, middle, or trailing (`'a; b'`, `'; b'`, `'b;'`) — fails compilation of that expression:

```
Error compiling expression ... Failed to compile: [Error: unterminated literal] [Near: { ... }]
```

which fails the **entire assembly deploy** at collection deploy. It looks like a data problem (every record failing) but is a static compile error. Parens and brackets inside strings are fine (`'a (b'`, `' [Technical: x'` compile), and `;` as a statement separator outside literals is fine — only `;` inside the quotes breaks.

```java
// BAD — fails the whole deploy
props['Log_Details'] = props['expected'] + '; found ' + props['actual']
// GOOD — use a dash or period instead
props['Log_Details'] = props['expected'] + ' - found ' + props['actual']
```

**Prevention (verified):** `validate_assembly` flags this (`MVEL_SEMICOLON_IN_STRING`). Belt-and-braces before any deploy: extract every `cc:expression` text, `choose-route/@expression`, and `cc:set/@value`, and compile each with `org.mvel.MVEL.compileExpression()` against Studio's own jar:

```
/Applications/WorkdayStudio/Eclipse.app/Contents/Eclipse/plugins/com.workday.wtp.cloud.runtime.a_*/script/lib/mvel-1.3.13-workday.*.jar
```

The offline compile reports the exact failing expression with `[Near:]` context. **Known blind spot:** offline compile success does NOT clear fully-qualified `java.*` class references — they compile fine offline, but Studio's per-message runtime can fail to *resolve* them at execution time (see the java.time per-message gotcha).

### Date arithmetic via Java Calendar (only reliable way)

```java
props['d']   = new java.text.SimpleDateFormat("yyyy-MM-dd").parse(props['Hire_Date'])
props['cal'] = java.util.Calendar.getInstance()
props['cal'].setTime(props['d'])
props['cal'].add(java.util.Calendar.DATE, -1)
props['end'] = new java.text.SimpleDateFormat("yyyy-MM-dd").format(props['cal'].getTime())
```

### `java.time` static methods fail in per-message evals — bootstrap-only

Studio runs MVEL 1.3. Fully-qualified `java.time` static calls — `java.time.LocalDate.parse(...)`, `java.time.temporal.ChronoUnit.DAYS.between(...)` — throw `org.mvel.CompileException: unable to resolve property: java` **at runtime** in any per-message eval (an eval executed once per split record / per message): in ternary branches, in if-bodies, and even at expression top-level. The ban is scoped by **evaluation context**, not by expression shape:

- **Bootstrap context** — the run-scoped init eval (`InitializeProperties` / `Init*`, executed once per run before any splitter): fully-qualified `java.time` calls work, even nested inside ternary branches and as method arguments (verified across three consecutive live runs with a timezone-pinned current date):

```java
// Bootstrap eval ONLY — nested FQCN as a method argument works here
props['Current_Date'] = (props['Tz'] == null || props['Tz'] == '')
    ? java.time.LocalDate.now()
    : java.time.LocalDate.now(java.time.ZoneId.of(props['Tz']))
```

- **Per-message contexts** (any eval executed per split element / per message): no `java.time` FQCN anywhere. Keep the bootstrap eval simple even though FQCN is allowed there.
- `java.lang` simple names (`Integer`, `Long`, `Math`) resolve fine per-message (production-verified). Constructor calls via `new` are unaffected — the canonical [Calendar / `new java.text.SimpleDateFormat("yyyy-MM-dd").parse(s)` pattern](#date-arithmetic-via-java-calendar-only-reliable-way) still works per-message (returns `java.util.Date`).

**Rule: never call `java.x.y.staticMethod(...)` in a per-message eval.**

1. In `InitializeProperties`, make the one bootstrap-safe static call and store the object in props.
2. In per-message evals, use only **instance methods** on that stored object, plus `YYYY-MM-DD` ISO-string comparison (`compareTo` on ISO strings gives chronological order).

```java
// Bootstrap (InitializeProperties) — FQCN static call allowed here
props['Current_Date'] = java.time.LocalDate.now()

// Per-message — instance methods + ISO string compare only
props['TodayIso']    = props['Current_Date'].toString()
props['CapFloorIso'] = props['Current_Date'].minusDays(props['MaxAgeDays']).toString()
props['IsBefore']    = (props['StartIso'].compareTo(props['CapFloorIso']) < 0) ? 'true' : 'false'
```

```java
// BAD — fails everywhere in per-message contexts, even at top-level
props['Date'] = java.time.LocalDate.parse(props['Iso'])
```

**Per-message date construction without `parse()`** — build any `LocalDate` from an ISO string using only instance methods on a bootstrap-stored date:

```java
props['EpStartDate'] = props['Current_Date'].withDayOfMonth(1)
    .withYear(Integer.parseInt(props['Iso'].substring(0, 4)))
    .withMonth(Integer.parseInt(props['Iso'].substring(5, 7)))
    .withDayOfMonth(Integer.parseInt(props['Iso'].substring(8, 10)))
```

(`withDayOfMonth(1)` first, so the intermediate year/month changes can never produce an invalid day-of-month.)

**Review gap:** offline MVEL compilation against Studio's `mvel-1.3.13` jar PASSES on these expressions — the failure is Studio's runtime class resolution — so the offline compile-check recipe cannot catch it. `validate_assembly` warns on `java.time.` in non-`Init*` evals (`JAVA_TIME_IN_PER_MESSAGE_EVAL`); additionally grep per-message evals for `java.` as a pre-deploy review step (verified live: 7/7 split workers succeeded after removing the statics). For anything more complex than comparisons, do the date math in XSLT with `xs:date` and `xs:dayTimeDuration`.

### Basic auth via MVEL (when `cc:http-basic-auth` doesn't fit)

```java
props['Auth'] = 'Basic ' + new String(java.util.Base64.getEncoder().encode(
    (props['user'] + ':' + props['pass']).getBytes()))
```

Then inject: `<cc:add-header name="Authorization" value="@{props['Auth']}"/>`.

### Integration map lookup

```java
props['target_val'] = intsys.integrationMapLookup('Ethnicity Type', props['source_val'])
props['source_val'] = intsys.integrationMapReverseLookup('Ethnicity Type', props['target_val'])
```

Requires `cloud:map` in `cloud:attribute-map-service` in `cc:workday-in`.

### `vars.isVariable` guard before read

```java
if (vars.isVariable('saved_xml')) { props['val'] = vars['saved_xml'].getText() }
if (!props.containsKey('counter')) { props['counter'] = 0 }
```

### `parts[0].getText()` for the message body — `toString()` returns the object handle

In `cc:eval`, `parts[0]` is a `com.capeclear.assembly.impl.MessageAdapterImpl`, not a String. `parts[0].toString()` returns the object identity string (`com.capeclear.assembly.impl.MessageAdapterImpl@12feeaa6`), NOT the payload — and it fails **silently**, because string operations run happily against the handle text (every search or token count just returns 0). To read the current message payload as a String, use `parts[0].getText()` with a null guard:

```java
// BAD: object handle, not content — every substring/count silently returns 0
props['Calc_CsvBody'] = (parts[0] == null) ? '' : parts[0].toString()

// GOOD: message payload as a String
props['Calc_CsvBody'] = (parts[0] == null || parts[0].getText() == null) ? '' : parts[0].getText()
```

Runtime-verified: token counting over an aggregated CSV body returned 0 for every count with `toString()`, and correct counts immediately after switching to `getText()`. (`getText()` confirmed via `javap` on `capeconnect-esbcore_2.12.jar`: `MessageAdapterImpl` exposes `public String getText()`.)

### `context.containsProperty()` vs `props.containsKey()`

In `cc:parameter` defaults, use `context.containsProperty()` — it's the null-safe check Studio supports for typed-parameter defaults.

```xml
<cc:parameter name="apiVersion" type="string"
  default="context.containsProperty('apiVersion') ? props['apiVersion'] : '43.0'">
```

### `#` is concatenation in attribute values

Inside `assembly.xml` attribute values (`cc:set value`, `cc:description text`), `#` is the string concatenation operator. This is different from `cc:eval` MVEL where `+` is used.

```xml
<!-- # in attribute value (assembly.xml) -->
<cc:set name="is.message.summary"
  value="props['inWebServiceApplication'] #' application HTTP request error'"/>

<!-- + in cc:eval MVEL -->
<cc:expression>props['msg'] = props['app'] + ' application HTTP request error'</cc:expression>
```

### Launch params

```xml
<cloud:param name="Pay Period End Date">
  <cloud:type><cloud:simple-type>date</cloud:simple-type></cloud:type>
  <cloud:launch-option>required</cloud:launch-option>
</cloud:param>
<cloud:param name="Pay Group WID">
  <cloud:type><cloud:simple-type>text</cloud:simple-type></cloud:type>
</cloud:param>
```

Access in MVEL: `lp.getDate('Pay Period End Date')` for date, `lp.getSimpleData('Pay Group WID')` for text.

### `cc:cloud-log` vs `cc:log`

- `cc:cloud-log` — Workday UI (Integration Events tab, audit trail). Use for business milestones.
- `cc:log` — Studio console only. Use for developer debugging.

```xml
<cc:cloud-log id="LogSuccess" level="info"
  message="Worker Hired" message-details="@{props['worker.id']}" reference-id="props['worker.wid']"/>
```

### `cc:validate-exp` and `cc:send-error`

```xml
<cc:validate-exp id="ValidateHasData">
  <cc:expression failure-message="No records returned">props['count'] > 0</cc:expression>
</cc:validate-exp>
```

Use inside `async-mediation` with `handle-downstream-errors="true"` and a `cc:send-error`.

### `context.isError()` for conditional sub-flows

```xml
<cc:local-out id="NotifyOnError" execute-when="context.isError() == true"
  endpoint="vm://INT999/Email_In" unset-properties="false">
  <cc:set name="Email_Failure_Reason" value="context.errorMessage"/>
</cc:local-out>
```

### `replace-with-soap-fault` on `cc:workday-out-soap`

```xml
<cc:workday-out-soap id="HireEmployee" routes-response-to="HandleHire"
  application="Staffing" version="v40.0" replace-with-soap-fault="true"/>
```

Makes Workday SOAP errors catchable as structured faults by `cc:send-error`.

### JSON null values become the string `"null"` — not Java null

When Studio converts a JSON payload to XML via `cc:json-to-xml`, null JSON values (e.g. `"value": null`) become the text node `null` in the XML element. XPath on that element returns the string `"null"`, not Java null.

Conditions like `== null`, `== empty`, and `== ''` all evaluate **false** against the string `"null"`. Always normalize at the extraction point:

```java
// Safe 3-line extraction pattern — use this any time a JSON field may be null
props['myProp'] = ''
props['myProp'] = parts[0].xpath('/path/to/value')
if (props['myProp'] == 'null') { props['myProp'] = '' }
```

After normalization, `props['myProp']` is either a real value or `''` — never the string `"null"`.

### Use `== ''` / `!= ''` in `execute-when`, not null/empty checks

After normalizing a prop to empty string at extraction (3-line pattern above), use only simple string equality for branching. `== null`, `!= null`, `== empty`, `!= empty` behave inconsistently when a prop holds the string `"null"` vs Java null vs empty string — two mutually exclusive conditions can both evaluate false simultaneously, causing silent double passthrough.

```xml
<!-- After normalization: conditions are simple and unambiguous -->

<!-- Fires when prop has a real value -->
execute-when="props['myProp'] != ''"

<!-- Fires when prop is absent or empty -->
execute-when="props['myProp'] == ''"
```

This works consistently across all MVEL evaluation contexts in Studio: `execute-when` attributes, `@{...}` interpolation, and `cc:expression` blocks.

---

## Custom Java Beans

Studio projects are Eclipse JDT projects. Custom Java code can be compiled and bundled in the CLAR.

### Project structure

```
project/
  src/main/java/com/example/integration/MyBean.java   # source
  build/classes/                                      # Eclipse output (auto-compiled)
  ws/WSAR-INF/assembly.xml
  .classpath     # includes src/main/java + runtime JARs
  .project       # includes org.eclipse.jdt.core.javabuilder
```

### Pattern A: `@Component` + `@ComponentMethod` called via `cc:custom`

Use when the bean needs to read/write props (the `MediationContext`).

```java
import com.capeclear.assembly.annotation.Component;
import com.capeclear.assembly.annotation.ComponentMethod;
import static com.capeclear.assembly.annotation.Component.Type.*;

@Component(name="MyComponent", type=mediation, scope="prototype",
           toolTip="...", smallIconPath="icons/x_16.png", largeIconPath="icons/x_24.png")
public class MyComponent {
    @ComponentMethod
    public void process(com.capeclear.mediation.MediationContext ctx) {
        String input = ctx.getProperty("my.input.prop").toString();
        // do work
        ctx.setProperty("my.output.prop", result);
    }
}
```

Assembly XML — called as a step inside `cc:steps`:

```xml
<cc:custom id="RunMyComponent" ref="MyComponent"/>
```

Spring bean declaration — outside `<cc:assembly>`, inside `<beans>`, with `scope="prototype"`:

```xml
<beans ...>
  <cc:assembly ...> ... </cc:assembly>
  <bean id="MyComponent" class="com.example.integration.MyComponent" scope="prototype"/>
</beans>
```

### Pattern B: Plain POJO called via MVEL

Use for pure helper logic that doesn't need props access.

```java
public class MyHelper {
    public String compute(String input) { return input.toUpperCase(); }
}
```

```xml
<bean id="myHelper" class="com.example.integration.MyHelper" scope="prototype"/>
```

```java
// MVEL call: Spring registers the bean ID as a direct MVEL variable
props['result'] = myHelper.compute(props['someInput']);
```

### Why this works (the DelegatingClassLoader bypass)

MVEL's `DelegatingClassLoader` blocks `Class.forName('org.apache.http.*')` — too restricted to load new classes at runtime. BUT: Spring beans are instantiated by the Studio CONTAINER classloader at startup time. MVEL can then call methods on that already-alive object without any class loading. This sidesteps the restriction entirely.

### `scope="prototype"` is required

`scope="prototype"` is required on the Spring bean for `@ComponentMethod` beans — singleton scope causes state leakage across integration runs.

### Studio runtime HttpClient — critical version note

Studio 2025.24 runtime ships Apache HttpClient **4.2.3** — NOT the modern 4.5+ API.

Add these three JARs to `.classpath` (path on macOS):

```xml
<classpathentry kind="lib" path="/Applications/WorkdayStudio/Eclipse.app/Contents/Eclipse/plugins/com.workday.wtp.cloud.runtime.a_2025.24.132/lib/httpclient-4.2.3.jar"/>
<classpathentry kind="lib" path="/Applications/WorkdayStudio/Eclipse.app/Contents/Eclipse/plugins/com.workday.wtp.cloud.runtime.a_2025.24.132/lib/httpcore-4.2.2.jar"/>
<classpathentry kind="lib" path="/Applications/WorkdayStudio/Eclipse.app/Contents/Eclipse/plugins/com.workday.wtp.cloud.runtime.a_2025.24.132/lib/commons-logging-1.1.1.jar"/>
```

**Do NOT use the 4.5+ API** (`CloseableHttpClient`, `HttpClients.custom()`, `CloseableHttpResponse`).
**DO use the 4.2.x API:** `DefaultHttpClient`, `httpClient.getConnectionManager().shutdown()`, `LaxRedirectStrategy`.

### Build process

1. Write `.java` file in `src/main/java/`.
2. Add required JARs to `.classpath`.
3. Eclipse auto-compiles on save (or Project → Build Project).
4. Studio's assembly builder packages compiled `.class` files into the CLAR on deploy.
5. After adding new `.java` file: Right-click project → Refresh (F5).

### Example: Resolving a 302 redirect that drops Basic auth

The Dayforce `train.dayforcehcm.com` host returns HTTP 302 to a tenant-specific hostname. Studio's `cc:http-basic-auth` drops credentials on redirect, producing 401.

**Strategy:** Run a one-time probe at integration init. Follow the redirect with auth, capture the final hostname, store it as the resolved base URL. All subsequent per-record `cc:http-out` calls use the resolved URL directly.

Three traps:

1. **HEAD requests don't trigger the 302** — only GET. Use `HttpGet`.
2. **Unauthenticated GET also doesn't redirect** — must include `Authorization: Basic ...` on the probe.
3. **Base URL returns HTTP 400, no redirect** — only real API endpoints (e.g. `/Employees`) trigger the 302. Probe URL must be `baseUrl + "Employees"`, not the bare base URL.

```java
@Component(name="DayforceUrlResolver", type=mediation, scope="prototype",
           toolTip="Resolves train.dayforcehcm.com 302 redirect to the concrete hostname",
           smallIconPath="icons/DayforceHttp_16.png", largeIconPath="icons/DayforceHttp_24.png")
public class DayforceUrlResolverComponent {

    @ComponentMethod
    public void process(com.capeclear.mediation.MediationContext ctx) {
        String trainUrl = ctx.getProperty("df.url").toString();
        String username = ctx.getProperty("df.username").toString();
        String password = ctx.getProperty("df.password").toString();
        final String authHeader = "Basic " + Base64.getEncoder().encodeToString(
            (username + ":" + password).getBytes(StandardCharsets.UTF_8));

        DefaultHttpClient httpClient = new DefaultHttpClient();
        httpClient.setRedirectStrategy(new LaxRedirectStrategy());
        // Preemptive auth: resend Authorization on every request including post-redirect
        httpClient.addRequestInterceptor(new HttpRequestInterceptor() {
            @Override
            public void process(HttpRequest req, HttpContext context)
                    throws HttpException, IOException {
                if (!req.containsHeader("Authorization")) {
                    req.addHeader("Authorization", authHeader);
                }
            }
        }, 0);

        try {
            String probeUrl = trainUrl.endsWith("/") ? trainUrl + "Employees" : trainUrl + "/Employees";
            HttpGet request = new HttpGet(probeUrl);
            BasicHttpContext localCtx = new BasicHttpContext();
            HttpResponse response = httpClient.execute(request, localCtx);
            EntityUtils.consume(response.getEntity());

            HttpHost finalHost = (HttpHost) localCtx.getAttribute(ExecutionContext.HTTP_TARGET_HOST);

            if (finalHost != null) {
                URI originalUri = new URI(trainUrl);
                if (!finalHost.getHostName().equalsIgnoreCase(originalUri.getHost())) {
                    String path = originalUri.getPath();
                    if (!path.endsWith("/")) { path = path + "/"; }
                    String resolved = finalHost.getSchemeName() + "://" + finalHost.getHostName() + path;
                    ctx.setProperty("df.resolved.url", resolved);
                    return;
                }
            }
            ctx.setProperty("df.resolved.url", trainUrl);
        } catch (Exception e) {
            ctx.setProperty("df.resolved.url", trainUrl);
        } finally {
            httpClient.getConnectionManager().shutdown();
        }
    }
}
```

Assembly wiring — call once during init, write resolved URL back to your URL prop:

```xml
<cc:eval id="MapUrlResolverProps">
    <cc:expression>props['df.url']      = props['df.direct.URL']</cc:expression>
    <cc:expression>props['df.username'] = props['df.direct.Username']</cc:expression>
    <cc:expression>props['df.password'] = props['df.direct.Password']</cc:expression>
</cc:eval>
<cc:custom id="ResolveDayforceUrl" ref="DayforceUrlResolver"/>
<cc:eval id="ApplyResolvedUrl">
    <cc:expression>props['df.direct.URL'] = props['df.resolved.url']</cc:expression>
</cc:eval>
```

---

## Sub-flow Decomposition

Break large assemblies into named sub-flows: `cc:local-out` calls a `cc:local-in` entry point.

- vm:// naming: `vm://{IntegrationSystemName}/{LocalInId}` — system name must match exactly.
- Sequential chaining: use `routes-response-to` on the caller local-out.
- Props are SHARED across all sub-flows.
- Each sub-flow gets its own named horizontal swimlane in the diagram.

### `cc:local-out`: `routes-response-to` present vs absent

- **Present** (`routes-response-to="NextStep"`): caller WAITS for the sub-flow to fully complete. Use for sequential pipelines.
- **Absent**: fire-and-forget — main chain does NOT wait. Use for per-record `cc:local-out` inside a splitter sub-route so the splitter can advance immediately after dispatch.

### Post-splitter continuation pattern

To do something AFTER all records are processed, wrap the RAAS fetch + splitter inside a local-in/local-out sub-flow. The sub-flow ends naturally when the splitter finishes all records. The calling `cc:local-out`'s `routes-response-to` then fires.

```
Main chain: CallInit (routes-response-to=CallGetWorkers) ->
            CallGetWorkers (local-out, routes-response-to=CallBuildAuditFile,
                            endpoint=vm://IntegrationName/GetWorkers)

GetWorkers sub-flow:
  GetWorkers (local-in, routes-to=FetchWorkers) ->
  FetchWorkers (workday-out-rest) ->
  PreSplitLog (async-med) ->
  SplitWorkers (cc:splitter, NO routes-to)
                       (per-record sub-route)
                  ExtractWdFields -> CallProcessOneWorker
```

### Extracting XML data before message transformation

After `cc:xslt-plus` transforms XML to CSV, the message is CSV and `xpath()` no longer works. Add `cc:eval` with `parts[0].xpath()` calls as the FIRST step in the async-mediation, before any xslt-plus. Store values in props.

---

## Outbound HTTP Patterns

### Top-level rule

`cc:http-out` is a TOP-LEVEL element. It cannot be placed inside `cc:async-mediation cc:steps`. Chain via `routes-response-to`.

### Basic POST/PATCH with credentials

```xml
<cc:http-out id="CallApi" routes-response-to="HandleResponse"
  endpoint="@{props['URL']}" http-method="PATCH"
  output-mimetype="application/json">
  <cc:http-basic-auth username="@{props['user']}" password="@{props['pass']}"/>
</cc:http-out>
```

### Dynamic URL building

```xml
<!-- Build the URL in an eval step first, then reference via @{...} -->
<cc:expression>props['URL'] = props['base'] + '/V1/employees/' + props['id']
                            + '?clientNamespace=' + props['ns']</cc:expression>
```

This avoids complex `@{...}` expressions inside the `endpoint` attribute itself.

### Guard chained lookups against empty query predicates (Oracle Fusion REST)

An Oracle Fusion REST query with an **empty predicate value is not an error**. `?q=PersonNumber=` with an empty right-hand side returns a default page of ALL records, and a follow-on xpath happily extracts the first record's id — a real id belonging to a **different person**. Runtime-confirmed: a worker missing from the upstream lookup flowed into the next hop with an empty `PersonNumber`, and the shadow-run output carried a real `ParticipantId` for a worker that did not exist in Oracle at all.

Empty **path segments** are the same class of bug: `.../ParticipantDetails//child/...` (empty id between slashes) fires a real HTTP call that 404s — wasted calls and log noise.

**Rules for multi-hop lookup chains** (user → participant → child rows):
1. Never let a `cc:http-out` lookup fire with an empty predicate value — gate it on the prior hop's result.
2. Derive layered miss flags in a decision eval BEFORE trusting any extracted id, precedence-ordered so a later flag can only be true when all earlier hops succeeded: `userNotFound` = key empty; `participantNotFound` = key present AND id empty; `detailUnresolved` = both present AND child lookup failed.
3. Give each layer its own blocked-reason token so support can see WHICH layer missed.

```xml
<cc:eval id="DeriveMissFlags">
  <cc:expression>props['Calc_IsBlockedUserNotFound'] = (props['PersonNumber'] == null || props['PersonNumber'] == '') ? 'true' : 'false'</cc:expression>
  <cc:expression>props['Calc_IsBlockedParticipantNotFound'] = (props['Calc_IsBlockedUserNotFound'] == 'false' &amp;&amp; (props['ParticipantId'] == null || props['ParticipantId'] == '')) ? 'true' : 'false'</cc:expression>
</cc:eval>
```

Structural fix: short-circuit routing after each hop on its miss flag (`cc:route` on the flag before the next `cc:http-out`), or at minimum precedence-order the flags so an id extracted from an unfiltered default page can never be acted on downstream.

### JSON payload via `cc:xslt-plus`

```xml
<cc:xslt-plus id="BuildJson" output-mimetype="application/json" url="WorkersToTarget.xsl"/>
```

`output-mimetype="application/json"` sets `Content-Type` automatically.

### OAuth2 token refresh pattern

```xml
<!-- 1. POST to token endpoint -->
<cc:http-out id="GetToken" routes-response-to="InjectToken"
  endpoint="https://auth.example.com/token?grant_type=refresh_token&amp;refresh_token=@{props['rt']}"
  http-method="POST"/>

<!-- 2. Parse JSON, extract token, set headers -->
<cc:async-mediation id="InjectToken" routes-to="CallApi">
  <cc:steps>
    <cc:json-to-xml id="Parse" nested-array-name="row" root-element-name="root"/>
    <cc:eval id="Extract">
      <cc:expression>props['access_token'] = parts[0].xpath('root/data/access_token')</cc:expression>
      <cc:expression>props['auth_header']  = 'Bearer ' + props['access_token']</cc:expression>
    </cc:eval>
    <cc:write id="ClearBody"><cc:message></cc:message></cc:write>
    <cc:set-headers id="Inject">
      <cc:remove-headers/>
      <cc:add-headers>
        <cc:add-header name="Authorization" value="@{props['auth_header']}"/>
        <cc:add-header name="x-api-key"     value="@{props['api_key']}"/>
      </cc:add-headers>
    </cc:set-headers>
  </cc:steps>
</cc:async-mediation>

<!-- 3. All subsequent cc:http-out calls carry the headers automatically -->
```

### Pagination loop pattern

```xml
<!-- Init: props['offset'] = 0, props['response_count'] = 999999, props['loop_break'] = false -->
<cc:route id="PagedFetch">
  <cc:loop-strategy condition="props['offset'] &lt;= props['response_count']"
    increment="props['offset'] = props['offset'] + 6000"/>
  <cc:sub-route name="SubRoute" routes-to="FetchBatch"/>
</cc:route>

<!-- FetchBatch: GET API -> json-to-xml -> extract count -> xslt-plus -> send to aggregator
     When last page: set props['loop_break'] = true to exit early
     Aggregator fires when: force-batch-when="props['offset'] >= props['response_count']" -->
```

### `cc:json-to-xml` then xpath

Always extract before any transform — after `xslt-plus` or `write`, xpath stops working.

```xml
<cc:json-to-xml id="JsonToXml" nested-object-name="record"/>             <!-- paginated list -->
<cc:json-to-xml id="JsonToXml" nested-array-name="row" root-element-name="root"/>  <!-- array response -->
<cc:eval id="Extract">
  <cc:expression>props['count'] = parts[0].xpath('root/record/count')</cc:expression>
</cc:eval>
```

### Routing on conditions: `cc:mvel-strategy`

```xml
<cc:route id="HireType">
  <cc:mvel-strategy>
    <cc:choose-route expression="props['Is_Rehire'] == 'Y'" route="Rehire"/>
    <cc:choose-route expression="true" route="New Hire"/>  <!-- default else -->
  </cc:mvel-strategy>
  <cc:sub-route name="New Hire" routes-to="NewHireFlow"/>
  <cc:sub-route name="Rehire"   routes-to="RehireFlow"/>
</cc:route>
```

### `cc:aggregator` with CSV header

```xml
<cc:aggregator id="Collect" routes-to="Save"
  force-batch-on-last-message="false" force-batch-when="props['data_count'] == 0">
  <cc:size-batch-strategy batch-size="-1"/>
  <cc:message-content-collater>
    <cc:header-text>Col1|Col2|Col3</cc:header-text>
  </cc:message-content-collater>
</cc:aggregator>
```

### Consolidated CSV across a splitter — per-row `cc:xslt-plus` + top-level `cc:aggregator`

Runtime-verified recipe for delivering ONE Excel-ready CSV (one row per split element, with a header row) from a splitter flow. Companion to the [accumulate-then-store-once cloud-log/HTML pattern](#consolidated-single-document-log-across-a-splitter--accumulate-then-store-once) for consolidated logging (Document Storage Patterns).

1. **Per row** — a `cc:xslt-plus` emits exactly ONE CSV line, starting with `&#10;` so collected rows stack under the header. Params auto-bind from same-named String props. RFC-4180-quote every field (wrap in quotes, double any internal quotes) and space-prefix a leading `=`, `+`, `-`, or `@` to block Excel formula injection.
2. **Collect** — rows route to a TOP-LEVEL `cc:aggregator` with `force-batch-on-last-message="true"`, `cc:size-batch-strategy batch-size="-1"`, and a `cc:message-content-collater` whose `cc:header-text` holds the column-header line. Unlike the pagination variant above (`force-batch-when`), splitter flows can rely on `force-batch-on-last-message="true"`.
3. **On release** — `cc:store` with `output-mimetype="text/csv"`, `contentDisposition` attachment, and a title, then deliver via `vm://wcc/PutIntegrationMessage` with `is.document.variable.name` / `is.document.deliverable`.

```xml
<!-- Top-level aggregator: releases when the splitter's last message arrives -->
<cc:aggregator id="CollectCsvRows" routes-to="DoFinalizeCsv"
    force-batch-on-last-message="true">
  <cc:size-batch-strategy batch-size="-1"/>
  <cc:message-content-collater>
    <cc:header-text>run_timestamp,Employee_ID,Status,Reason</cc:header-text>
  </cc:message-content-collater>
</cc:aggregator>

<!-- On release: store as CSV, then deliver -->
<cc:async-mediation id="DoFinalizeCsv" routes-to="PutCsvMessage">
  <cc:steps>
    <cc:store id="StoreCsvDoc" output="variable" output-variable="csv-doc-ref"
        createDocumentReference="true" output-mimetype="text/csv"
        contentDisposition="attachment" expiresIn="P30D"
        title="INT999_Report_@{props['Csv_RunDate']}.csv"/>
  </cc:steps>
</cc:async-mediation>
<cc:local-out id="PutCsvMessage" endpoint="vm://wcc/PutIntegrationMessage">
  <cc:set name="is.document.variable.name" value="'csv-doc-ref'"/>
  <cc:set name="is.document.deliverable" value="'true'"/>
</cc:local-out>
```

**Verified in live runs (178 rows):**
- The aggregator's batch context survives rows that each traverse 6+ `vm://` request-response hops (local-out/local-in sub-flow chains) before reaching the aggregator — a single CSV was delivered every run.
- The aggregator chain can route onward (`routes-response-to`) into a consolidated-HTML store-once sub-flow, so BOTH artifacts (CSV + HTML cloud-log) deliver from one run.

### Email out

```xml
<!-- 1. Build HTML body -->
<cc:write id="BuildEmail" output-mimetype="text/html">
  <cc:message><cc:text>Hello @{props['name']},&lt;br&gt;Error: @{props['Reason']}</cc:text></cc:message>
</cc:write>

<!-- 2. Send (prod vs impl split via execute-when) -->
<cc:email-out id="EmailProd" execute-when="props['Is_Impl'] == false"
  endpoint="mailto:@{props['Recruiter_Email']}" subject="..."
  host="email-smtp.us-east-1.amazonaws.com" port="587" starttls="true"
  user="@{props['smtp_user']}" password="@{props['smtp_pass']}"
  from="prehire@example.com">
  <cc:custom-headers/>
</cc:email-out>
<cc:email-out id="EmailImpl" execute-when="props['Is_Impl'] == true"
  endpoint="mailto:int-dev@example.com" ...>
  <cc:custom-headers/>
</cc:email-out>
```

### Proxy-vs-direct API: error handling path shifts entirely

When an integration moves from a proxy that wraps all responses in HTTP 200 (e.g. Boomi) to calling the real API directly, error handling shifts paths entirely. Knowing which path actually ran is essential for debugging.

| | Proxy era | Direct API era |
|---|---|---|
| HTTP error response | Proxy returns 200, error JSON in body | Real 4xx status code returned |
| Where errors land | `routes-response-to` chain fires (proxy never raises exception) | `cc:send-error` fires via `handle-downstream-errors` |
| Error source | `props['Error_Message']` set by response XSL | `context.errorMessage` (full exception text including response JSON) |
| `cc:send-error` in proxy era | Dead code — never fires | Active — primary error path |

**How to tell which path ran in logs:**
- Response chain fired → look for step log messages from your response-handler steps
- Send-error fired → look for `BadRequestException` from `HttpRetryControl` before your error-handler log

**Porting implication:** any error logic wired into the `routes-response-to` chain becomes dead code when switching to direct API. Recovery logic must move into the `cc:send-error` path and read from `context.errorMessage`, not `props['Error_Message']`.

### POST-then-PATCH upsert recovery via `cc:route` in send-error path

For self-healing "create-or-update" flows: if POST fails with a duplicate-key error code, fall through to PATCH automatically.

**Pattern:**
1. In the error-handler async-mediation, compute a recovery flag from `context.errorMessage.toString().contains('<ErrorCode>')`. Use the API error **code** (e.g. `HR_Employee_DuplicateXRefCodeFound`), not the message text — codes are stable API contract.
2. Always book-keep the original error first (append to audit log, increment error count) — even on recovery.
3. Route the error handler to a `cc:route` decision node with two branches: `Recover` → PATCH target, `LogAndExit` → terminal.

```xml
<cc:async-mediation id="HireErrorHandler" routes-to="HireErrorBranch">
    <cc:steps>
        <cc:eval>
            <cc:expression>props['p.error.log'].append(props['worker_id'] + ',ERROR,Hire,' + context.errorMessage.toString() + '\n')</cc:expression>
            <cc:expression>props['p.error.count'] = props['p.error.count'] + 1</cc:expression>
            <cc:expression>props['can_recover_hire'] =
                context.errorMessage.toString().contains('HR_Employee_DuplicateXRefCodeFound') ||
                context.errorMessage.toString().contains('HR_Search_EmployeeXRefCodeAlreadyExists')</cc:expression>
        </cc:eval>
    </cc:steps>
</cc:async-mediation>

<cc:route id="HireErrorBranch">
    <cc:mvel-strategy>
        <cc:choose-route expression="props['can_recover_hire'] == true" route="Recover"/>
        <cc:choose-route expression="true" route="LogAndExit"/>
    </cc:mvel-strategy>
    <cc:sub-route name="Recover"    routes-to="CallPatchEmployee"/>
    <cc:sub-route name="LogAndExit" routes-to="CallProcessErrorHire"/>
</cc:route>
```

The recovery PATCH operates on the same in-memory variables the original POST used — no data refresh needed within one Effective_Change scope. The audit log shows the failed POST attempt followed by the PATCH success, which is the expected recovery signature.

### Oracle Fusion IC REST write behaviors (verified live)

Verified against Oracle Fusion Incentive Compensation REST (`https://<host>/fscmRestApi/resources/latest/incentiveCompensationParticipants`) by scoped writes in a test environment, each confirmed by a next-run re-read. These are Oracle contract behaviors, not Studio behaviors — re-verify after Oracle quarterly updates.

1. **DFF update = POST + method override.** Send the PATCH as `POST` with header `X-HTTP-Method-Override: PATCH` to `.../ParticipantDetails/{id}/child/participantDetailsDFF/{id}`. Accepted; returns 200 with a JSON echo of the row.
2. **DFF PATCH is a MERGE.** Only the keys you send change; omitted keys are preserved. Exception: on a freshly POSTed ParticipantDetail the DFF starts empty, so merge semantics preserve nothing on the create path — send every key you need.
3. **Empty string clears a date-valued DFF attribute.** Sending `""` is accepted (no 400) and blanks the field — the next-run read shows it empty. Useful deliberately; dangerous accidentally — guard prop-driven payloads against unintended empties.
4. **Validate writes on the echo, and scan for `title` even on HTTP 200.** POST create returns the new id at JSON path `data/ParticipantDetailId` (`root/data/ParticipantDetailId` after `cc:json-to-xml`). Oracle error envelopes carry a top-level `title` key even on HTTP 200, so check both.
5. **POST auto-end-dates the prior open segment.** Creating a new ParticipantDetail closes the previously open one — a child query with `EndDate=null` returns exactly one open row per worker. No manual close is needed before create.

```xml
<!-- After POST create (response already through cc:json-to-xml) -->
<cc:eval id="CheckCreate">
  <cc:expression>props['NewId'] = parts[0].xpath('root/data/ParticipantDetailId')</cc:expression>
  <cc:expression>props['ErrTitle'] = parts[0].xpath('root/title')</cc:expression>
  <cc:expression>props['CreateOk'] = (props['NewId'] != '' &amp;&amp; props['ErrTitle'] == '') ? 'true' : 'false'</cc:expression>
</cc:eval>
```

---

## XSLT Patterns

### `xsl:param` dot-rename rule

XSL params can't have dots in their names (NCName rule). If your prop is `DF.XRefCode`, rename it to `DF_XRefCode` before passing to XSL. Props accessed only via MVEL can keep dots.

### `cc:xslt-plus` requires valid XML input

```xml
<!-- Write a stub message first if the current message is non-XML -->
<cc:write id="PrepareInput">
  <cc:message><cc:text>&lt;request/&gt;</cc:text></cc:message>
</cc:write>
<cc:xslt-plus id="BuildPayload" output-mimetype="application/json" url="WorkersToTarget.xsl"/>
```

The XSL ignores `<request/>` and reads only its `xsl:param` values from props.

### XSL file location

All XSL files referenced by `url=` in `cc:xslt-plus` must live in `ws/WSAR-INF/` — the same directory as `assembly.xml`. The `url=` value is a bare filename, not a path. Studio resolves it relative to `WSAR-INF/`.

After adding any XSL file outside Studio:

1. Right-click the project then Refresh (F5). Eclipse does not watch the filesystem — files created by external tools are invisible until refreshed.
2. Click the `cc:xslt-plus` step in the diagram to open its Properties panel.
3. Click the lookup button (magnifying glass) next to the Url field.
4. Browse and select the XSL file from the dialog.

Studio re-registers the reference and clears the validation error. Writing `url="filename.xsl"` in `assembly.xml` is necessary but not sufficient — Studio needs the UI registration step too.

### Launch params then XSL params pipeline

1. Declare `cloud:param` in `cc:workday-in`.
2. Add a `cc:eval` step BEFORE `cc:xslt-plus`: `props['key'] = lp.getSimpleData('Param Name')`.
3. XSL declares `<xsl:param name="key" select="''"/>` — `cc:xslt-plus` passes all props as params automatically.

### Only String-typed props bind to `xsl:param` — object-typed props bind EMPTY

`cc:xslt-plus` auto-binds props to same-named `xsl:param`s, but ONLY props whose value is a real `java.lang.String`. Object-typed props (`LocalDate`, `Long`, etc.) bind as EMPTY in the XSL — and the bug is masked because `@{props['x']}` interpolation in `cc:log` happily renders the object's `toString()`, so logs look correct while the delivered column is blank. Even MVEL 1.3's `x.toString()` can retain non-String typing in props. The reliable coercion is string concatenation:

```xml
<!-- BAD: prop holds a LocalDate object — <xsl:param name="Current_Date"/> binds empty -->
<cc:expression>props['Current_Date'] = java.time.LocalDate.now()</cc:expression>

<!-- GOOD: coerce to String under a dedicated key and bind that in the XSL -->
<cc:expression>props['Csv_RunDate'] = ('' + props['Current_Date'])</cc:expression>
<!-- XSL: <xsl:param name="Csv_RunDate"/>  ->  '2026-07-09' -->
```

Runtime-verified: a CSV column that came out blank in every delivered row populated after switching the XSL param to a prop set via `('' + props['Current_Date'])`.

### `cc:json-to-xml` adds a synthetic `<root>` wrapper

`cc:json-to-xml` wraps the entire JSON object in a synthetic `<root>` element. So `{"Data": {"EmployeeNumber": "123"}}` becomes `<root><Data><EmployeeNumber>123</EmployeeNumber></Data></root>`.

XSL paths MUST be `/*/Data/FieldName` — NOT `/*/FieldName`. Using `/*/FieldName` silently matches nothing.

### `format=simplexml` removes namespace prefixes

```xml
<cc:workday-out-rest id="GetPos" routes-response-to="Process"
  extra-path="@{intsys.reportService.getExtrapath('positionRAAS')}?Position_ID=@{props['pid']}&amp;format=simplexml"/>
<!-- XPath: parts[0].xpath('Report_Data/Report_Entry/Field') with no wd: prefix -->
```

Without `format=simplexml`, RAAS responses use the `wd:` namespace on every element.

### Streaming XSLT 3.0 (large datasets)

```xml
<xsl:mode streamable="yes" on-no-match="shallow-skip"/>
<xsl:mode name="in-memory" streamable="no" on-no-match="shallow-skip"/>

<!-- Stream one entry at a time, carry state across iterations -->
<xsl:iterate select="wd:Report_Data/wd:Report_Entry">
  <xsl:param name="counter" as="xs:integer" select="0"/>
  <xsl:try>
    <xsl:apply-templates select="copy-of()" mode="in-memory"/>
    <xsl:catch errors="*">
      <xsl:value-of select="$err:description"/>
    </xsl:catch>
  </xsl:try>
  <xsl:next-iteration>
    <xsl:with-param name="counter" select="$counter + 1"/>
  </xsl:next-iteration>
</xsl:iterate>
```

### `snapshot()` for in-memory key lookups inside streaming XSLT

```xml
<xsl:param name="lookupData1" as="document-node()" select="snapshot()"/>
<xsl:key name="lookupKey1" match="row" use="@id"/>

<!-- Later inside xsl:iterate: -->
<xsl:variable name="match" select="key('lookupKey1', $id, $lookupData1)"/>
```

### Dynamic library include via Studio prop

```xml
<xsl:param name="libMessage" static="yes"
  select="ctx:getProperty(tube:getCurrentMediationContext(), 'libMessage')"/>
<xsl:include _href="{$libMessage}"/>
```

`static="yes"` allows the include path to be resolved at compile time from a prop.

---

## RAAS Patterns

RAAS (Report as a Service) is the dominant pattern for reading bulk data FROM Workday. Preferred over `Get_*` SOAP for any list-of-records query.

### Step 1 — Declare report aliases in `cc:workday-in`

```xml
<cloud:report-service name="INT999_Reports">
  <!-- Alias-only: Workday matches alias to a report with the same name in the tenant -->
  <cloud:report-alias description="Active workers" name="INT999_Get_Workers"/>

  <!-- WID-bound: portable across report renames -->
  <cloud:report-alias description="Location tree" name="INT999_Locations">
    <cloud:report-reference description="Location tree" type="WID">55555555eeeeeeee66666666ffffffff</cloud:report-reference>
  </cloud:report-alias>
</cloud:report-service>
```

**Alias must exist in XML before runtime.** Every string passed to `intsys.reportService.getExtrapath('ALIAS')` must have a matching `cloud:report-alias` entry in the `cloud:report-service` block. Adding the `cc:workday-out-rest` step without the alias declaration causes a runtime "no alias found" failure — Studio does not validate this at build time.

The alias can be declared without a `report-reference` WID (Studio will prompt you to wire it in the Services tab after deploy). But the `<cloud:report-alias name="..."/>` entry MUST exist in the XML:

```xml
<!-- cc:workday-out-rest referencing a new alias -->
<cc:workday-out-rest id="MyRaasCall"
  extra-path="@{intsys.reportService.getExtrapath('MY_REPORT_ALIAS')}?Param=@{props['myParam']}&amp;format=simplexml"/>

<!-- Required BEFORE deploying: matching cloud:report-alias in the workday-in block -->
<cloud:report-service name="INT999_Reports">
  <cloud:report-alias description="Human-readable description" name="MY_REPORT_ALIAS"/>
  <!-- WID report-reference wired via Studio Services tab after XML deploy -->
</cloud:report-service>
```

### Step 2 — Call the report

Build the query string in an eval step (where MVEL `+` concatenation is easy) and store as a prop. Reference it in `extra-path` using `@{...}` interpolation:

```xml
<cc:expression>props['raas_params'] = '?Worker!WID=' + props['workerWID'] + '&amp;format=simplexml'</cc:expression>

<cc:workday-out-rest id="FetchWorkers" routes-response-to="PreSplitLog"
  extra-path="@{intsys.reportService.getExtrapath('INT999_Workers') + props['raas_params']}"/>
```

Filter syntax — use `!WID` suffix for object reference filters:

```xml
<cc:workday-out-rest id="GetByWorker"
  extra-path="@{intsys.reportService.getExtrapath('INT999_Get_Workers')}?Worker!WID=@{props['workerWID']}"/>

<!-- Multiple filters: join with &amp; -->
<cc:workday-out-rest id="GetByMgrOrg"
  extra-path="@{intsys.reportService.getExtrapath('INT999_Report')}?manager!WID=@{props['mgr']}&amp;Sup_Org!WID=@{props['supOrgWID']}"/>
```

### Prompted reports — passing prompt values in the query string

Reports built on a prompted data source accept their prompts as query-string parameters on the same `extra-path` (runtime-verified: the assembled URL was logged at RunStart and the returned population honored the URL window over the report's stored defaults):

- **Prompt names** are the report's **"Label For Prompt XML Alias"** values (e.g. `Start_Date`, `End_Date`, `Include_Subordinate_Organizations`) — not the display labels.
- **Org/object prompts** take WIDs via the `Name!WID=` form: `Organizations!WID=<org WID>`.
- **Dates**: plain ISO (`2026-04-10`) is accepted — the `-07:00` timezone suffix that a browser capture of the report URL shows is NOT required.
- **Rolling windows**: compute at launch time with instance methods on a `java.time.LocalDate` already stored in props at bootstrap: `'' + props['Current_Date'].minusDays(90)` (see the MVEL java.time rule — instance methods, not FQCN statics).
- **Escaping**: `&` between params is `&amp;` in the XML source; `!` needs no escaping.

**Why pass prompts at all**: prompt defaults stored in the report definition go stale — a fixed `End_Date` default silently excludes every row dated after it. Passing the window per run keeps the population correct.

**Degrade gracefully**: build the whole param string in ONE bootstrap eval, conditional on a launch attribute — an empty attribute yields `''`, the call falls back to the bare alias path, and the report's stored defaults take over:

```xml
<!-- InitializeProperties (bootstrap eval) -->
<cc:expression>props['Calc_RaasParams'] = (props['RaasOrganizationsWID'] == null || props['RaasOrganizationsWID'].toString().trim() == '') ? '' : ('?Organizations!WID=' + props['RaasOrganizationsWID'].toString().trim() + '&amp;Include_Subordinate_Organizations=1&amp;Start_Date=' + props['Current_Date'].minusDays(90) + '&amp;End_Date=' + props['Current_Date'])</cc:expression>

<!-- The call: params ride the same extra-path as the alias -->
<cc:workday-out-rest id="GetLeaveEvents" routes-response-to="CheckData"
  extra-path="@{intsys.reportService.getExtrapath('INT999_Leave_Events')}@{props['Calc_RaasParams']}"/>
```

### Step 3 — Split into records

Choice depends on expected record count:

```xml
<!-- Large datasets (>100 records): MUST use xml-stream-splitter -->
<cc:splitter id="Splitter">
  <cc:sub-route name="ProcessRecord" routes-to="ProcessRecord"/>
  <cc:xml-stream-splitter xpath="wd:Report_Data/wd:Report_Entry"/>
</cc:splitter>

<!-- Small datasets (<100 records): xpath-splitter loads all into memory -->
<cc:splitter id="Splitter">
  <cc:sub-route name="ProcessRecord" routes-to="ProcessRecord"/>
  <cc:xpath-splitter xpath="wd:Report_Data/wd:Report_Entry"/>
</cc:splitter>
```

`xml-stream-splitter` processes records SEQUENTIALLY. Props accumulation (StringBuilder, counters) is safe.

### Step 4 — Extract fields per record

```xml
<!-- Inside async-mediation: parts[0] is one wd:Report_Entry node -->
<cc:eval id="ExtractFields">
  <cc:expression>props['wid']    = parts[0].xpath('wd:Report_Entry/wd:Worker_WID')</cc:expression>
  <cc:expression>props['empID']  = parts[0].xpath('wd:Report_Entry/wd:Employee_ID')</cc:expression>
  <!-- Typed reference lookup: attribute predicate -->
  <cc:expression>props['orgWID'] = parts[0].xpath('wd:Report_Entry/wd:Org/wd:ID[@wd:type=&quot;WID&quot;]')</cc:expression>
  <cc:expression>props['orgRef'] = parts[0].xpath('wd:Report_Entry/wd:Org/wd:ID[@wd:type=&quot;Organization_Reference_ID&quot;]')</cc:expression>
</cc:eval>
```

### Response structure

Both with and without `format=simplexml`, the structure is:

- Root: `wd:Report_Data`
- Records: `wd:Report_Data/wd:Report_Entry`
- All fields inside `Report_Entry` are in the `wd:` namespace.

Single-record reports (no splitter needed) use absolute XPath:

```java
props['val'] = parts[0].xpath('/wd:Report_Data/wd:Report_Entry/wd:Field')
```

### Handling zero-record reports

When the report returns 0 rows, the splitter fires no sub-routes. Wrap the target of `routes-response-to` in an async-mediation with a send-error to handle the empty-report case:

```xml
<cc:workday-out-rest id="GetData" routes-response-to="CheckData" .../>
<cc:async-mediation id="CheckData" routes-to="Splitter" handle-downstream-errors="true">
  <cc:steps>
    <cc:eval id="SetFlag"><cc:expression>props['hasData'] = 1</cc:expression></cc:eval>
  </cc:steps>
  <cc:send-error id="NoDataError" routes-to="PutNoDataMessage"/>
</cc:async-mediation>
```

### Ask the user for sample XML during build

RAAS report schema (field names, nesting, namespace attributes) is defined in the Workday tenant, not in Studio. During the BUILD phase, ask the user:

> "Can you run this report in Workday and paste a few rows of the XML response? I'll use that to write the correct XPath expressions."

Even 1-2 rows is enough. Don't guess field names from report aliases alone — they can be anything (`wd:workdayID`, `wd:Employee`, `wd:Supervisory_Organization`). Accurate XPath requires seeing the actual XML.

### Use `cc:workday-out-rest` for RAAS — never `cc:workday-out-soap`

Custom report calls in Studio always use `cc:workday-out-rest` + `cloud:report-alias`. Never use `cc:workday-out-soap` for RAAS — SOAP-based report execution does not work with Workday custom reports, produces incorrect diagram rendering (`cc:xslt-plus` steps appear disconnected), and Studio's diagram validator will flag it.

```xml
<!-- WRONG: SOAP is not the path for custom report execution -->
<cc:workday-out-soap id="RunReport" application="..." version="v46.1"/>

<!-- CORRECT: REST via cloud:report-alias (ALL custom reports use this) -->
<cloud:report-service name="INT999_Reports">
  <cloud:report-alias description="Active employees" name="INT999_Active_Employees"/>
</cloud:report-service>

<cc:workday-out-rest id="GetWDWorkersRAAS" routes-response-to="CountWDWorkers"
  extra-path="@{intsys.reportService.getExtrapath('INT999_Active_Employees')}"/>
```

The response is `wd:Report_Data/wd:Report_Entry` directly with no SOAP envelope. Call `get_step_type_reference('workday-out-rest')` before writing any RAAS step to confirm the current alias and filter syntax.

---

## REST API Patterns

OAuth2 token refresh, pagination, and `cc:json-to-xml` extraction are covered in [Outbound HTTP Patterns](#outbound-http-patterns).

### Basic auth via `cc:base64-encode` (XML step alternative)

```xml
<cc:write id="PrepKey"><cc:message><cc:text>@{props['api_key']}:</cc:text></cc:message></cc:write>
<cc:base64-encode id="Encode" output="variable" output-variable="api_key_b64" input="message"/>
<!-- Inject: <cc:add-header name="Authorization" value="Basic @{vars['api_key_b64'].getText()}"/> -->
```

XML-step alternative to the pure-MVEL Base64 approach.

### `cloud:retrieval-service` — inbound file integrations

For integrations where the user uploads a file with the integration event:

```xml
<cloud:retrieval-service name="INT999_Retrieval"/>

<cc:local-out id="GetDocs" routes-response-to="ProcessFiles"
  endpoint="vm://wcc/GetEventDocuments">
  <cc:set name="ie.event.wid" value="lp.isSet() ? lp.getIntegrationEventWID() : null"/>
</cc:local-out>
```

---

## Document Storage Patterns

### Store document then attach to event — two patterns

**Pattern 1: Store to variable, then deliver explicitly**

Use when you need to pass the document reference around or attach it conditionally.

```xml
<cc:store id="StoreFile" output="variable" output-variable="doc_ref"
  input="message" createDocumentReference="false" expiresIn="P30D"
  title="@{props['filename']}" contentDisposition="attachment;filename=&quot;@{props['filename']}&quot;"
  schema="http://www.w3.org/2005/Atom"/>
<cc:local-out id="AttachDoc" endpoint="vm://wcc/PutIntegrationMessage" clone-request="true">
  <cc:set name="is.document.variable.name" value="'doc_ref'"/>
  <cc:set name="is.document.deliverable" value="'true'"/>
</cc:local-out>
```

**Pattern 2: Inline store, auto-attached (simpler)**

Use when the file is always delivered and no conditional logic is needed. `cc:store` is placed as the LAST step inside `cc:async-mediation cc:steps`, after `cc:write`. `is.document.deliverable` is NOT needed on the subsequent `PutIntegrationMessage` call — `cc:store` handles the attachment directly.

```xml
<!-- Inside DoBuildAuditFile cc:steps, after cc:write: -->
<cc:store id="Store" expiresIn="P30D" title="Audit_@{props['Pay_Period_End_Date']}.csv"/>

<!-- Then route to: -->
<cc:local-out id="DeliverAuditFile" endpoint="vm://wcc/PutIntegrationMessage">
  <cc:set name="is.document.name" value="'Audit_' + props['Pay_Period_End_Date'] + '.csv'"/>
  <cc:set name="is.document.encoding" value="'UTF-8'"/>
  <cc:set name="is.message.summary" value="'Audit complete: Total: ' + props['count.total']"/>
  <!-- DO NOT add is.document.deliverable here: cc:store already attached the file -->
</cc:local-out>
```

---

### Consolidated single-document log across a splitter — accumulate, then store once

A splitter whose per-record sub-route does `cc:store` (`createDocumentReference`) + a `PutIntegrationMessage` deliver INSIDE the loop materializes one output document per record (7 workers → 7 files). To emit ONE consolidated document, split the responsibilities:

1. **Per record — append only.** The per-record step only appends to a shared run-scoped variable via `cc:cloud-log variable-name="cloud-log-content"` (`cc:cloud-log` appends across all invocations into the same variable). No `cc:store`, no deliver inside the loop.
2. **Once at end of run — store and deliver.** A separate sub-flow does a single `cc:store` with `createDocumentReference="true"` on that variable plus a single deliverable `PutIntegrationMessage`. Wire it off the upstream data call's `routes-response-to` (see [Post-splitter continuation pattern](#post-splitter-continuation-pattern)): `routes-response-to` fires only after the entire downstream request path — including the terminal splitter draining every record — completes, which is exactly "store once after the split finishes."

```xml
<!-- PER RECORD (inside splitter): append only — no store, no deliver -->
<cc:async-mediation id="DoWriteLog" handle-downstream-errors="true">
  <cc:steps>
    <cc:cloud-log id="CloudLogWorkerResult" level="info"
        message="@{props['CloudLog_Message']}"
        message-details="@{props['CloudLog_Details']}"
        reference-id="props['Employee_ID']"
        variable-name="cloud-log-content"/>   <!-- appends to shared run-scoped var -->
  </cc:steps>
</cc:async-mediation>

<!-- END OF RUN: store-once sub-flow, fired via routes-response-to after the splitter drains -->
<cc:local-out id="Call_GetWorkersRAAS" store-message="none"
    routes-response-to="Call_StoreRunLog"
    endpoint="vm://INT999_Example/GetWorkersRAAS"/>
...
<cc:async-mediation id="DoStoreRunLog" routes-to="PutRunLogMessage">
  <cc:steps>
    <cc:store id="StoreRunLogDoc" output="variable" output-variable="run-log-doc-ref"
        input="variable" input-variable="cloud-log-content"
        createDocumentReference="true" expiresIn="P180D"
        title="INT999_RunLog_@{props['Current_Date']}.html"/>
  </cc:steps>
</cc:async-mediation>
<cc:local-out id="PutRunLogMessage" endpoint="vm://wcc/PutIntegrationMessage">
  <cc:set name="is.document.variable.name" value="'run-log-doc-ref'"/>
  <cc:set name="is.document.deliverable" value="'true'"/>
</cc:local-out>
```

**Verifying the fix in the server log** (runtime-verified differential):

- Fixed run: per-record `cc:cloud-log`/`cc:log` markers == record count, all preceding exactly ONE `Calling PutIntegrationMessage within StoreStep` line and one consolidated document title, plus one end-of-run marker.
- Broken run: N `StoreStep` `PutIntegrationMessage` deliveries interleaved one per record.
- Count the framework-level `Calling PutIntegrationMessage within StoreStep` lines — assembly element ids (e.g. the per-record deliver's step id) are NOT emitted at this log level, so grepping for them proves nothing (0 hits in both broken and fixed runs).
- `parse_server_log` does not surface `cc:log` / `cc:cloud-log` step output (it only extracts `xsl:message`-class lines) — verify with a direct grep of the raw server log, not the parsed summary.

For the consolidated CSV variant (one row per record via per-row `cc:xslt-plus` + a top-level `cc:aggregator`), see [Consolidated CSV across a splitter](#consolidated-csv-across-a-splitter--per-row-ccxslt-plus--top-level-ccaggregator) in Outbound HTTP Patterns.

---

## Server Log Diagnosis

When integrations fail in deployment, fetch the Workday server log and grep for these signatures:

| Signature | Meaning |
|---|---|
| `scala.MatchError` | Bad node type in `assembly-diagram.xml` (`cc:send-error`, `cc:note`, or unresolved `eProxyURI`) |
| `IWorkbenchWindow.getSelectionService()` is null | Editor part initialization failed; restart Studio |
| `org.mvel.ParseException: unknown class` | MVEL hit a `props['map'].method(complexExpr)` inside if/else; restructure with ternary |
| `org.mvel.CompileException: unable to resolve property: java` | Fully-qualified `java.time` static call in a per-message eval; move the static to `InitializeProperties`, use instance methods on the props-stored object per-message |
| `Resource '/.../filename.xsl' does not exist` | XSL file missing from `ws/WSAR-INF/` or Eclipse not refreshed (F5) |
| `XSLTC: Param ... not declared` | `xsl:param` name has dots (NCName violation); rename prop with underscores |
| `401 Unauthorized` post-redirect | Basic auth credentials dropped on 302; need preemptive auth interceptor or one-time URL resolution |
| HTTP 400 on bare base URL | The base URL alone may not redirect — probe a real endpoint to capture the post-redirect host |

Look for the FIRST exception in the log. Subsequent exceptions are usually cascades from the first one.

---

## Common Errors

### `scala.MatchError` on Studio open

**Cause:** Either a `cc:send-error` or `cc:note` is referenced as a diagram node, OR a deleted `assembly.xml` element is still referenced from `assembly-diagram.xml` via unresolved `eProxyURI`.

**Fix:** Find every diagram href that points at a non-existent assembly id, and either remove it or repoint it. See [Removing components](#removing-components-mirror-the-three-entries) above.

### `plan_integration` scaffolds dangling `End{SubFlowName}` diagram refs

A freshly scaffolded project (e.g. `INT999_Example`) crashes Studio's diagram editor on first open with `scala.MatchError` on `platform:/resource/.../assembly.xml#End{SubFlowName}` (unresolved `eProxyURI`).

**Cause:** the scaffold emits three references per sub-flow in `assembly-diagram.xml` — a `visualProperties` block, a `routesTo` connection from `Do{SubFlowName}`, and a swimlane `elements` entry — all pointing at `assembly.xml#End{SubFlowName}`, but `assembly.xml` contains no element with that id. (The `cc:note id="End{X}"` terminal stub was removed from the assembly skeleton because `cc:note` is schema-invalid; the diagram skeleton still references it.)

**Fix:** after every `plan_integration` scaffold and BEFORE the first Studio open, run `validate_assembly` — each dangling ref is reported as a `STALE_DIAGRAM_HREF` ERROR — then delete all three `End{SubFlowName}` entries per sub-flow from `assembly-diagram.xml`. Do NOT add an `End{X}` stub to `assembly.xml` instead: the correct sub-flow terminal is the `Do{SubFlowName}` `cc:async-mediation` with no `routes-to` (see [`cc:note` is schema-invalid in `assembly.xml`](#ccnote-is-schema-invalid-in-assemblyxml)).

```xml
<!-- Scaffolded (three per sub-flow) — remove all three -->
<visualProperties x="350" y="360">
  <element href="assembly.xml#EndGetWorkers"/>
</visualProperties>
<connections type="routesTo">
  <source href="assembly.xml#DoGetWorkers"/>
  <target href="assembly.xml#EndGetWorkers"/>
</connections>
<swimlanes x="30" y="340" name="GetWorkers Sub-flow" ...>
  <elements href="assembly.xml#EndGetWorkers"/>
</swimlanes>
<!-- assembly.xml has no id="EndGetWorkers" — Studio crashes on diagram open -->
```

### `IWorkbenchWindow.getSelectionService()` NPE persists until restart

After a `MatchError` during diagram render, Studio shows:

```
Cannot invoke "org.eclipse.ui.IWorkbenchWindow.getSelectionService()"
because the return value of "org.eclipse.ui.IWorkbenchPartSite.getWorkbenchWindow()" is null
```

The dialog reappears on every focus change. Even after fixing `assembly-diagram.xml`, the NPE keeps firing.

**Cause:** When the editor part fails to initialize (because of the upstream `MatchError`), its `WorkbenchPartSite` ends up half-constructed with a null window reference. Eclipse caches this broken site and continues asking for selection-service from it. There is no Studio API to reset a broken part site at runtime.

**Recovery attempt (works ~70% of the time when corruption is editor-local):**
1. Close the broken editor tab — click × on the `assembly.xml` tab to dispose the broken `IEditorPart`
2. **F5** on the project in Project Explorer (right-click → Refresh)
3. **Project → Clean…** → pick the project → OK
4. Re-open `assembly.xml` by double-clicking — Studio creates a fresh editor part
5. **Window → Show View → Error Log** → clear stale errors with the trash-can icon

If the dialog still appears after step 4, the broken part is cached at the workbench level — only a full Studio restart clears it.

**Prevention:** Always commit a known-good state to project-local git before structural assembly edits. Validate every diagram positional ref BEFORE letting Studio open the file.

### `cc:xslt-plus` "Resource does not exist" after F5

Even after F5 refresh, Studio may still report "cannot be found" for a `cc:xslt-plus` URL. Studio validates XSL references through its own workspace registry, not just filesystem presence.

**Fix:**
1. Click the `cc:xslt-plus` step in the diagram to open its Properties panel.
2. Click the lookup button (magnifying glass) next to the Url field.
3. Browse and select the XSL file from the dialog.
4. Studio re-registers the reference and clears the validation error.

### `cc:expression` XML parse error on `>`, `<`, or `if/else`

Wrap the entire expression in CDATA. See [MVEL Idioms](#cdata-for-comparison-operators-and-multi-statement-blocks).

### `cloud:launch-option>optional` schema error

`"optional"` is not a valid value. Omit `cloud:launch-option` entirely for optional params, or use `"required"` for mandatory ones.

---

## Backup Workflow

Always commit a known-good state to project-local git before editing `assembly.xml` or `assembly-diagram.xml` structurally. Single-attribute edits in XSL files don't need this. Structural assembly edits absolutely do.

### One-time setup per project

```bash
cd <project-root>
[ -d .git ] || git init -b main
cat > .gitignore <<'EOF'
build/
.DS_Store
*.bak
*.swp
EOF
git add -A
git commit -m "snapshot: <description of current state>"
git tag known-good-<short-name>
```

### Before any risky edit

```bash
git commit -am "snapshot: before <description>"
git tag known-good-before-<short-name>
```

### If Studio crashes

```bash
# Reset assembly + diagram to last known-good state (does NOT touch other files)
git checkout known-good-<short-name> -- ws/WSAR-INF/assembly.xml ws/WSAR-INF/assembly-diagram.xml

# OR full project reset to the tag:
git reset --hard known-good-<short-name>
```

### Rule

Before making more than a one-line structural change to `assembly.xml`, propose a commit with a clear message: `snapshot: before <what we're about to do>`. After the change is verified working in Studio, propose another commit with `snapshot: after <what we did>` and a tag.

---

## SSK Patterns

Studio Starter Kit (SSK) is the official Workday framework (v2025r1.02 confirmed). Its conventions are useful even outside SSK projects.

### `cc:parameter` and `cc:out-parameter` typed API contract

SSK sub-flow entry points use `cc:parameter` to declare typed, documented inputs and `cc:out-parameter` to document outputs.

```xml
<cc:local-in id="CallSoap" access="public" use-global-error-handlers="true"
  icon="icons/callSoap.png" routes-to="BuildSoapRequest">
  <cc:parameter name="soapRequestXml" type="xml" required="true">
    Complete SOAP envelope to send.
  </cc:parameter>
  <cc:parameter name="globalApiVersion" type="string"
    default="context.containsProperty('globalApiVersion') ? props['globalApiVersion'] : '43.0'">
    Workday API version (e.g. 43.0).
  </cc:parameter>
  <cc:out-parameter name="callStatus" type="string">
    "SUCCESS" or "FAULT" after the call returns.
  </cc:out-parameter>
</cc:local-in>
```

### `Finally_*` teardown pattern

Every SSK component has a paired `Finally_{ComponentName}` sub-flow called unconditionally after the component (both success and error paths). It resets component-scoped props and logs completion.

```xml
<!-- Call component -->
<cc:local-out id="CallSoap_1" store-message="none"
  routes-response-to="Finally_CallSoap_1" endpoint="vm://INT_SSK/CallSoap">
  <cc:set name="soapRequestXml" value="message"/>
  <cc:set name="globalApiVersion" value="props['globalApiVersion']"/>
</cc:local-out>

<!-- Unconditional cleanup (also called on error paths) -->
<cc:local-out id="Finally_CallSoap_1" store-message="none"
  routes-response-to="NextStep" endpoint="vm://INT_SSK/Finally_CallSoap"/>
```

### `ssk:createMessage()` structured CloudLog logging

```xml
<!-- Namespace: xmlns:ssk="urn:com.workday.custom.ssk.common" -->
<!-- Loaded via dynamic _href include from libMessage prop -->
<xsl:value-of select="ssk:createMessage('INFO', 'Worker processed', $workerId)"/>
<!-- Returns: <lm><l>INFO</l><m>Worker processed</m><id>12345</id></lm> -->
<!-- Overloaded: 2-8 params: (level, msg), (level, msg, id), (level, msg, id, detail), etc. -->
```

### `decorations` in `assembly-diagram.xml`

Colored text annotations on swimlanes. Use instead of `cc:note` (schema-invalid in `assembly.xml`).

```xml
<swimlanes x="30" y="800" name="CallSoap" alignment="START">
  <elements href="assembly.xml#CallSoap"/>
  <decorations bgColor="#E3F2FD" fontColor="#0D47A1" type="NOTE">
    Calls Workday SOAP. Inputs: soapRequestXml. Outputs: soapResponseXml, callStatus.
  </decorations>
</swimlanes>
```

### Framework globals

Set once at assembly entry; read by all SSK components automatically:

```java
props['sskIsDebugMode']   = intsys.getAttributeAsBoolean('SSK Debug Mode')
props['globalApiVersion'] = intsys.getAttribute('API Version')

// Auto-set by Studio (read-only):
props['cc.customer.id']   // Workday tenant name
```

### `cc:local-in` attributes

- `access="public"` — default; callable from other integrations.
- `access="private"` — internal use only.
- `use-global-error-handlers="true"` — connects this sub-flow to assembly-level global error handlers.
- `icon="icons/iconName.png"` — diagram icon.

---

## Workday PECI Event Code Reference

PECI (Payroll Effective Change Integration) drives outbound Workday integrations. Every event has an event code. The `-R` suffix universally means **Rescind** — undo the prior action. It does NOT mean "Rehire".

| Code | Name | Typical action |
|------|------|----------------|
| `HIR` | Hire | New employee → POST |
| `HIR-R` | **Hire Rescinded** | Hire undone (employee never started) → PATCH to Inactive |
| `TERM` | Termination | Employee leaves → PATCH status=Inactive |
| `TERM-R` | **Termination Rescinded** | Prior termination undone, employee stays → PATCH status=Active |
| `DTA` | Data Change | Profile update → PATCH affected fields |
| `LOA` | Leave of Absence | Start leave |
| `LOA-C` | LOA Continuation | Leave extends |
| `LOA-R` | LOA Return | Employee returns from leave |
| `RFL` | Reflect | Reorg / position effective change rolls forward |
| `PCI` | Payroll Compensation Initiate | Comp package attached at hire → treat as HIR if `Is_Rehire=='0'`, else as DTA |
| `PGI` / `PGO` | Pay Group In / Out | Pay group transfer |
| `PCO` | Payroll Cutoff | Period close action |

**Routing rule:** every PECI integration's `cc:route` block must have an explicit branch for each handled event code plus an `OTHER` fallback. A missing code causes events to fall through to `OTHER` — which typically just logs and exits without calling the target system.

**Rehire is `HIR` with a flag, not a separate event code:**
```java
// Inside HIR handler — distinguish first-time hire from rehire
props['Is_Rehire'] = parts[0].xpath('peci:Worker_Status/peci:Is_Rehire')
// '1' = rehire, '0' or '' = new hire
```

**XSL implication for rescind codes:**
- `HIR-R` XSL emits a termination body (status=Inactive, termination reason) — do NOT reuse `HIR.xsl`
- `TERM-R` XSL emits a re-activation body (status=Active, no termination reason) — do NOT reuse `TERM.xsl`

---

## How to Contribute

This document captures patterns confirmed against working integrations. To add a new pattern:

1. Verify the pattern works in at least one running integration. Patterns from documentation alone are not sufficient — Studio's behavior often differs from its docs.
2. Strip any tenant-identifying details (hostnames, ISU usernames, project numbers tied to specific business logic, internal package names).
3. Open a PR against `https://github.com/arjunsena-eze/Workday-studio-mcp` with:
   - The pattern in the appropriate section
   - A minimal code example
   - The error or symptom it fixes (if applicable)
   - The Studio version where it was confirmed

Patterns that crashed Studio or produced subtle bugs are especially welcome — those are the lessons that save other developers the most time.
