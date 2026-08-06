# Studio Learnings

Append-only intake log. When Claude Code discovers a new Studio pattern, schema rule, or gotcha during a build session, it appends an entry here.

Entries get promoted to `docs/studio-integration-patterns.md`, `src/tools/get-step-type-reference.mjs`, or `src/tools/validate-assembly.mjs` during periodic review.

**This repo is public — generalize every entry.** No client integration IDs, project names, tenant or environment names, custom field names, or run/log identifiers. Use the placeholder conventions: `INT999` for integration IDs, `<TENANT>` for tenants, `Example` for project/field names. Describe provenance generically ("verified in a live run", "observed in a production build") — the technical pattern is the value, not where it came from.

---

## Entry format

```
### [YYYY-MM-DD] Short title
**Category**: Schema | Diagram | MVEL | XSLT | Assembly | HTTP | Error | Other
**Trigger**: What caused the discovery (e.g. "build failed with scala.MatchError on splitter step")
**Pattern**: What we learned — specific and actionable
**Example** (optional):
​```xml
<!-- minimal reproduction or correct form -->
​```
**Promote to**: patterns.md | get-step-type-reference.mjs | validate-assembly.mjs | all
**Status**: raw
```

---

<!-- newest entries first -->

### [2026-05-05] Conditional cc:local-out chaining — routes-response-to is the skip fallthrough
**Category**: Assembly
**Trigger**: Splitting one cc:local-out into two mutually exclusive conditional alternatives. The second local-out was never reached because the sync-mediation still routed directly to it, and the first local-out's routes-response-to pointed to the final destination instead of the second step.
**Pattern**: When a cc:sync-mediation needs to choose between two conditional cc:local-out steps, chain them sequentially:
1. sync-mediation.routes-to = FIRST local-out
2. FIRST local-out.routes-response-to = SECOND local-out (NOT the final destination)
3. SECOND local-out.routes-response-to = final destination

When a cc:local-out is skipped (execute-when=false), Studio fires its routes-response-to as a pass-through fallthrough — it does NOT automatically proceed to the next sibling. The fallthrough chain must be explicit via routes-response-to.

Both paths converge at the final destination:
- Path A (conditionA true): StepA executes → sub-flow → returns → StepB skipped → Destination
- Path B (conditionB true): StepA skipped → StepB executes → sub-flow → returns → Destination
**Example**:
```xml
<!-- WRONG: mediator routes directly to StepB; StepA is unreachable dead code -->
<cc:sync-mediation id="LogStep" routes-to="StepB" .../>
<cc:local-out id="StepA" execute-when="conditionA" routes-response-to="Destination" .../>
<cc:local-out id="StepB" execute-when="conditionB" routes-response-to="Destination" .../>

<!-- CORRECT: mediator routes to StepA first; StepA falls through to StepB when skipped -->
<cc:sync-mediation id="LogStep" routes-to="StepA" .../>
<cc:local-out id="StepA" execute-when="conditionA" routes-response-to="StepB" .../>
<cc:local-out id="StepB" execute-when="conditionB" routes-response-to="Destination" .../>
```
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-05-01

### [2026-05-05] RAAS alias must be declared in cloud:report-service before getExtrapath() works
**Category**: Assembly
**Trigger**: A new cc:workday-out-rest step using intsys.reportService.getExtrapath('MY_ALIAS') was added to assembly.xml but the alias was missing from the cloud:report-service block — the step fails at runtime with no alias found.
**Pattern**: Every string passed to intsys.reportService.getExtrapath('ALIAS') must have a matching cloud:report-alias entry inside the cloud:report-service block of the workday-in service in assembly.xml. The alias can be declared without a report-reference WID (Studio UI then prompts you to wire it), but the entry MUST exist in the XML. After adding, open the report service in the Studio Services tab to set the Report Reference WID.
**Example**:
```xml
<!-- cc:workday-out-rest referencing an alias -->
<cc:workday-out-rest id="MyRaasCall"
  extra-path="@{intsys.reportService.getExtrapath('MY_REPORT_ALIAS')}?Param=@{props['myParam']}&amp;format=simplexml"/>

<!-- Required: matching cloud:report-alias in the workday-in service block -->
<cloud:report-service name="MyReportService">
  <!-- existing aliases ... -->
  <cloud:report-alias description="Human-readable description"
    name="MY_REPORT_ALIAS"/>
  <!-- WID report-reference wired via Studio UI after XML deploy -->
</cloud:report-service>
```
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-05-01

### [2026-05-05] Add standalone cc:local-out at END of assembly to avoid @mixed index cascade
**Category**: Diagram
**Trigger**: Adding a new local-out (e.g. an error handler) inline near the sub-flow elements shifted all subsequent @mixed indices by +2, requiring a full diagram audit and bulk update of every positional connection reference downstream.
**Pattern**: When adding a cc:local-out that does not need to appear in the XML adjacent to its caller (error handlers, utility steps), add it at the END of the assembly — just before </cc:assembly>. This guarantees zero @mixed index shift for all existing diagram connections. The diagram target reference uses assembly.xml#ELEMENT_ID (not an @mixed path), so physical XML position does not affect how it is referenced in connections.
**Example**:
```xml
<!-- Add at the very end of assembly — nothing above shifts -->
<cc:local-out id="MyError" endpoint="vm://MY_INT/UMsgH_Do">
    <cc:set name="UMsgH_Number" value="1"/>
    <cc:set name="UMsgH_Summary" value="'Descriptive error message for this sub-flow.'"/>
    <cc:set name="UMsgH_ToWorkday" value="true"/>
    <cc:set name="UMsgH_Detail" value="context.errorMessage"/>
</cc:local-out>
</cc:assembly>

<!-- Diagram connection targets it by ID — @mixed index of source is unaffected -->
<connections type="routesTo">
    <source href="assembly.xml#//@beans/@mixed.1/@mixed.N/@mixed.3"/>
    <target href="assembly.xml#MyError"/>
</connections>
```
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-05-01

### [2026-05-05] Give each sub-flow swimlane its own local error handler
**Category**: Diagram
**Trigger**: A sub-flow's cc:async-mediation SendError routed to a global error handler in a distant swimlane, producing a long diagonal arrow spanning the entire canvas. The global handler's error message text was also wrong for the sub-flow's failure context.
**Pattern**: Every sub-flow swimlane with a cc:async-mediation that has handle-downstream-errors="true" should declare its OWN cc:local-out error handler and include it in the swimlane's elements list. Name it after the sub-flow (e.g. MySubFlowError). Add it at the END of assembly.xml to avoid @mixed shifts. The SendError arrow stays entirely within the swimlane and the error message accurately describes what failed.
**Example**:
```xml
<!-- async-mediation routes error to local handler, not a distant global one -->
<cc:async-mediation id="MySubFlow_Mediation" routes-to="MyRestCall"
    handle-downstream-errors="true">
    <cc:send-error id="SendError" routes-to="MySubFlowError"/>
</cc:async-mediation>

<!-- Error handler at end of assembly -->
<cc:local-out id="MySubFlowError" endpoint="vm://MY_INT/UMsgH_Do">
    <cc:set name="UMsgH_Summary" value="'Error in MySubFlow: describe the specific failure.'"/>
</cc:local-out>

<!-- Diagram: error handler is a member of the sub-flow swimlane -->
<swimlanes name="My Sub-Flow">
    <elements href="assembly.xml#MySubFlow_Mediation"/>
    <elements href="assembly.xml#MyRestCall"/>
    <elements href="assembly.xml#MySubFlowError"/>
</swimlanes>
```
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-05-01

### [2026-05-05] XML position does not define execution order — always update routes-to when inserting a new step
**Category**: Assembly
**Trigger**: A new conditional cc:local-out was added to assembly.xml before an existing step, but the preceding cc:sync-mediation still had routes-to pointing to the OLD step. The new step was unreachable dead code — the flow bypassed it entirely regardless of its XML position.
**Pattern**: XML element order in assembly.xml does NOT define execution order. Only the explicit routes-to / routes-response-to chain does. Whenever a new step is inserted before an existing step in a flow, update the predecessor's routes-to to point to the new step. After any insertion, trace the full routing chain from the entry local-in to the exit and verify every routes-to points to the intended next step.
**Example**:
```xml
<!-- BEFORE: mediator still routes to OldStep; NewStep inserted above it but is dead code -->
<cc:sync-mediation id="EntryLog" routes-to="OldStep" .../>
<cc:local-out id="NewStep" execute-when="conditionA" .../>  <!-- never reached! -->
<cc:local-out id="OldStep" execute-when="conditionB" .../>

<!-- AFTER: mediator routes-to updated; NewStep falls through to OldStep when skipped -->
<cc:sync-mediation id="EntryLog" routes-to="NewStep" .../>
<cc:local-out id="NewStep" execute-when="conditionA" routes-response-to="OldStep" .../>
<cc:local-out id="OldStep" execute-when="conditionB" routes-response-to="FinalDestination" .../>
```
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-05-01

### [2026-05-06] Proxy-vs-Direct API: error handling chain shifts from response-handler to send-error path
**Category**: Assembly
**Trigger**: Ported a "POST → AsyncMediation20 → AsyncMediation122 → AsyncMediation124 → CallDTA1" upsert recovery pattern from one country build into another's direct-Dayforce assembly. Wiring compiled fine, but on real Dayforce 400 errors (HR_Employee_DuplicateXRefCodeFound) the recovery never fired. Logs showed `BadRequestException` from `HttpRetryControl` going to `AsyncMediation12` (the HIR send-error handler) — never touching the response chain.
**Pattern**: When an integration moves from a proxy that wraps everything in HTTP 200 (e.g., a middleware proxy such as Boomi) to direct API calls returning real status codes (the vendor API host), error handling shifts paths entirely.

**Proxy era:** proxy returns 200 regardless of downstream outcome. Real error JSON is in the body. Studio's HTTP client never raises BadRequestException, so `cc:send-error` never fires. Errors are detected by parsing the body via `responsehandle.xsl` → setting `props['Error_Check']` → branching in the `routes-response-to` chain (e.g., `AsyncMediation20 → AsyncMediation122 → AsyncMediation124`). The `cc:send-error` handler on the wrapping async-mediation is effectively dead code.

**Direct API era:** real HTTP status. 200 → response chain fires. 400 → `BadRequestException` → `handle-downstream-errors="true"` on the wrapping `cc:async-mediation` traps the exception → its `cc:send-error` child fires, routing to the named error handler (e.g., `AsyncMediation12`). The `routes-response-to` chain only fires on HTTP 200; it is bypassed entirely on 400.

**Implication for porting flows:** any error logic wired into the response-handler chain (e.g., `AsyncMediation124`) becomes dead code on real direct-API errors. Recovery logic must move into the `cc:send-error` path of the wrapping async-mediation and use `context.errorMessage` (the raw exception message containing the full Dayforce JSON with code fields) as the source of truth, NOT `props['Error_Message']` (which is only set by the response chain that didn't fire).

**How to tell which path actually ran in logs:** response-chain → the body-parse error-check marker followed by the error JSON. Send-error path → the send-error handler's log marker preceded by `BadRequestException` from `HttpRetryControl`.
**Example**:
```xml
<![CDATA[<!-- Wrapping async-mediation that handles both happy and error paths -->
<cc:async-mediation id="AsyncMediation4" routes-to="POST_Employee" handle-downstream-errors="true">
    <cc:steps>
        <cc:copy input-variable="Process_Effective_Change"/>
        <cc:xslt-plus url="Hire_Employee.xsl" output-mimetype="application/json"/>
    </cc:steps>
    <!-- This is where errors actually land in direct-API integrations -->
    <cc:send-error id="SendError" routes-to="AsyncMediation12"/>
</cc:async-mediation>

<cc:http-out id="POST_Employee" routes-response-to="AsyncMediation20"
    endpoint="@{props['df.direct.URL']}Employees" http-method="POST"/>

<!-- Response chain — fires ONLY on HTTP 200 in direct-API integrations -->
<cc:async-mediation id="AsyncMediation20" routes-to="AsyncMediation122">
    <cc:steps>
        <cc:json-to-xml/>
        <cc:xslt-plus url="responsehandle.xsl"/>
        <cc:eval><cc:expression>props['Error_Check'] = parts[0].xpath('root/data/level')</cc:expression></cc:eval>
    </cc:steps>
</cc:async-mediation>

<!-- Error handler — this is the path on direct-API 400 -->
<cc:async-mediation id="AsyncMediation12" routes-to="CallProcessErrorHire">
    <cc:steps>
        <cc:eval>
            <!-- context.errorMessage contains the full BadRequestException message
                 including the Dayforce JSON response — match codes from here, not Error_Message -->
            <cc:expression>props['p.error.log'].append(... + 'ERROR,Hire Employee,'+context.errorMessage.toString() +'\n')</cc:expression>
        </cc:eval>
    </cc:steps>
</cc:async-mediation>]]>
```
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-05-01

### [2026-05-06] POST-then-PATCH upsert recovery: gate via cc:route in send-error path, match on error code substring
**Category**: Assembly
**Trigger**: Needed to handle the case where POST /Employees fails with HR_Employee_DuplicateXRefCodeFound or HR_Search_EmployeeXRefCodeAlreadyExists (employee was created in a prior run). Wanted to fall through to PATCH for self-healing without breaking other error cases (BirthDate missing, etc.) by attempting a doomed PATCH.
**Pattern**: In a direct-API integration, code-gate recovery paths inside the `cc:send-error` handler using a `cc:route` decision node. The pattern:

1. In the wrapping async-mediation's `cc:send-error` handler, add an `<cc:eval>` step that computes a recovery flag from `context.errorMessage.toString().contains('<ErrorCode>')`. Always book-keep the original error first (append to p.error.log, increment p.error.count) — even on recoverable errors, the audit trail should show the failed attempt.
2. Change the error-handler async-mediation's `routes-to` from the terminal log local-out to a new `cc:route` decision node.
3. The `cc:route` uses `cc:mvel-strategy` with two `cc:choose-route` clauses: one matching the recovery flag, fallback `expression="true"` for terminal log.
4. Two `cc:sub-route` blocks point at recovery target (e.g., `CallDTA1` re-entering the DTA flow) and terminal log target.

**Why match on error code (`HR_Employee_DuplicateXRefCodeFound`), not message text ("Employee already exists"):** codes are stable API contract; messages can be re-worded. `context.errorMessage` contains the full JSON response text from BadRequestException, so substring-matching the `code` field value is reliable.

**Variable scope check:** `Process_Effective_Change` is set in the wrapping async-mediation's first step (the `<cc:copy input-variable="Process_Effective_Change"/>`). Studio assembly variables persist for the duration of one Effective_Change. When the recovery target re-enters the DTA flow, its body builder copies from the same variable, so the recovery PATCH operates on identical PECI data the original POST tried to use. No data refresh needed.

**Logging behavior on recovery:** error-handler still appends `ERROR,Hire Employee,...` to p.error.log BEFORE the branch decision. On successful recovery, the log shows the failed HIR attempt followed by `SUCCESS,Data Change,,` — distinguishable as a recovery pattern; ops can grep for the sequence.

**When NOT to use:** if the recovery endpoint has different validation than the failing endpoint (PATCH might reject what POST would accept), the secondary error creates noise. Test both endpoints against representative payloads before adopting.
**Example**:
```xml
<![CDATA[<cc:async-mediation id="AsyncMediation12" routes-to="HireErrorBranch">
    <cc:steps>
        <cc:log id="Log"><cc:log-message><cc:text>-- Error Log ---</cc:text><cc:message-content/></cc:log-message></cc:log>
        <cc:eval id="Eval">
            <cc:expression>props['p.error.log'].append(props['worker_id'] +','+props['Event_Code']+ ',' + 'ERROR,Hire Employee,'+context.errorMessage.toString() +'\n')</cc:expression>
            <cc:expression>props['p.error.count'] = props['p.error.count'] + 1</cc:expression>
            <cc:expression>props['Error_Event_Code'] = 'HIR'</cc:expression>
            <cc:expression>props['can_recover_hire'] = context.errorMessage.toString().contains('HR_Employee_DuplicateXRefCodeFound') || context.errorMessage.toString().contains('HR_Search_EmployeeXRefCodeAlreadyExists')</cc:expression>
        </cc:eval>
    </cc:steps>
</cc:async-mediation>

<cc:route id="HireErrorBranch">
    <cc:mvel-strategy>
        <cc:choose-route expression="props['can_recover_hire'] == true" route="Recover"/>
        <cc:choose-route expression="true" route="LogAndExit"/>
    </cc:mvel-strategy>
    <cc:sub-route name="Recover" routes-to="CallDTA1"/>
    <cc:sub-route name="LogAndExit" routes-to="CallProcessErrorHire"/>
</cc:route>

<!-- CallDTA1 re-enters the DTA flow which patches the same Process_Effective_Change -->
<cc:local-out id="CallDTA1" store-message="none" endpoint="vm://INT999_<TENANT>/DTA"/>]]>
```
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-05-01

### [2026-05-06] Workday PECI event code "-R" suffix means Rescind, NOT Rehire
**Category**: Other
**Trigger**: While planning a Dayforce PECI integration, was about to wire HIR-R as if it meant "Hire Rehire" — would have produced a PATCH to set status Active, which is the wrong action. User corrected that HIR-R = "Hire Rescinded" (the hire never happened, employee never started) and TERM-R = "Termination Rescinded" (the termination is being undone, employee stays).
**Pattern**: The `-R` suffix on PECI event codes universally means **Rescind** — undo the prior action of the same root code. It does NOT mean "Rehire". A rehire is a fresh `HIR` event with `peci:Worker_Status/peci:Is_Rehire = '1'` — that's how routing distinguishes "first-time hire" from "rehire" within the same `HIR` event code.

| Code | Name | Action when received |
|------|------|----------------------|
| HIR | Hire | New employee starting → POST /Employees |
| **HIR-R** | **Hire Rescinded** | A hire was entered but is being undone (employee never started) → PATCH to terminate (Dayforce has no delete) |
| TERM | Termination | Employee leaves → PATCH `EmploymentStatus.XRefCode = "Inactive"` |
| **TERM-R** | **Termination Rescinded** | A prior termination is being undone — employee stays after all → PATCH `EmploymentStatus.XRefCode = "Active"` |
| DTA | Data Change | Profile update → PATCH affected fields |
| LOA / LOA-C / LOA-R | Leave / Continuation / Return | LOA lifecycle |
| RFL | Reflect | Reorg / position effective change rolls forward |
| PCI | Payroll Compensation Initiate | Comp pkg attached at hire → treat as HIR if Is_Rehire=='0', else as DTA |
| PGI / PGO | Pay Group In/Out | Pay group transfer |
| PCO | Payroll Cutoff | Period close action |

**Routing rule:** every PECI integration's `cc:route` block should have an explicit branch for each event code it handles, plus an `OTHER` fallback. Missing a code (e.g., a missing TERM-R branch caused silent termination drops on rehired employees) means events fall through to OTHER which usually just logs and exits — Dayforce never gets the change.

**XSL implication:** HIR-R XSL emits a termination body (status=Inactive, termination reason). TERM-R XSL emits a re-activation body (status=Active, NOT a termination reason). Don't reuse TERM.xsl for TERM-R — the inversion is real.
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-05-01

### [2026-05-06] @mixed positional XPath refs in assembly-diagram.xml shift by 2N when adding/removing top-level elements
**Category**: Diagram
**Trigger**: After removing an 8-element sub-flow from an existing integration and adding a comment, Studio loaded the diagram with multiple "floating" components and edges drawn from wrong source nodes. Specifically AsyncMediation12 looked disconnected because the diagram's `<source href="...@mixed.95"/>` (originally global-error-handler) now resolved to AsyncMediation12 itself.
**Pattern**: Many connection edges in `assembly-diagram.xml` use positional EMF XPath instead of id-based hrefs:
```
<source href="assembly.xml#//@beans/@mixed.1/@mixed.75/@mixed.3"/>
```
This is necessary for `cc:send-error` edges because every `<cc:send-error>` shares `id="SendError"` (not unique). The path means: 76th positional child of `<cc:assembly>` (the wrapping mediation), then its 4th positional child (the `<cc:send-error>` inside).

**Critical counting rule:** `@mixed` indices count ALL child node types — elements, XML comments, and whitespace text nodes. Each `<cc:foo>` element is typically preceded by whitespace, so each top-level addition adds 2 slots (text + element). XML comments add another 2 (text + comment).

**Shift formula:**
- Adding N elements + their preceding whitespace → all subsequent indices shift +2N
- Adding 1 XML comment (with its preceding whitespace) → +2
- Removing N elements (with whitespace) → all subsequent indices shift -2N
- A reference at `@mixed.95` BEFORE a 6-element deletion + 1-comment add becomes `@mixed.95 - 12 + 2 = @mixed.85`

**Verification script (run after every structural edit to assembly.xml):**
```python
from lxml import etree
import re
parser = etree.XMLParser(remove_blank_text=False, remove_comments=False)
asm = etree.parse('ws/WSAR-INF/assembly.xml').getroot().find('{http://www.capeclear.com/assembly/10}assembly')
idx_map = {}
i = 0
if asm.text is not None: idx_map[i] = ('<ws>', None); i += 1
for child in asm.iterchildren():
    if isinstance(child, etree._Comment):
        idx_map[i] = ('COMMENT', None)
    else:
        tag = etree.QName(child.tag).localname
        cid = child.get('id', '')
        idx_map[i] = (f"{tag}#{cid}" if cid else tag, child)
    i += 1
    if child.tail is not None: idx_map[i] = ('<ws>', None); i += 1
diag = etree.parse('ws/WSAR-INF/assembly-diagram.xml').getroot()
for elem in diag.iter():
    href = elem.get('href')
    if not href: continue
    m = re.match(r'assembly\.xml#//@beans/@mixed\.1/@mixed\.(\d+)(?:/@mixed\.(\d+))?$', href)
    if not m: continue
    outer = int(m.group(1)); inner = m.group(2)
    label, el = idx_map.get(outer, ('???', None))
    # ... walk inner if present, compare to expected target in <target href> sibling
```
Compare each resolved label against the diagram's stated `<target href>` for that connection. If the connection says `target=AsyncMediation12` and the resolved source is `AsyncMediation4 routes-to=AsyncMediation12`, it's correct.

**Strategy when removing elements that are referenced by `#//@swimlanes.N` indices:** don't delete the `<swimlanes>` container — empty it instead. Removing a swimlane shifts every `#//@swimlanes.N` reference and breaks unrelated parts of the diagram. An empty `<swimlanes x="..." name="..."/>` keeps the index slot live.
**Example**:
```xml
<![CDATA[<!-- BEFORE 6-element JobCreation flow deletion + 1-comment insert: -->
<source href="assembly.xml#//@beans/@mixed.1/@mixed.95"/>  <!-- resolves to global-error-handler -->
<source href="assembly.xml#//@beans/@mixed.1/@mixed.129/@mixed.3"/>  <!-- AsyncMediation60 send-error → AsyncMediation1210 -->

<!-- AFTER (shift = -12 + 2 = -10 for indices ≥ 95): -->
<source href="assembly.xml#//@beans/@mixed.1/@mixed.85"/>  <!-- now resolves to global-error-handler -->
<source href="assembly.xml#//@beans/@mixed.1/@mixed.115/@mixed.3"/>  <!-- now AsyncMediation60 (-14 because also removed AsyncMediation123 later) -->]]>
```
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-05-01

### [2026-05-06] Studio's IWorkbenchWindow.getSelectionService() NPE only fixable by full Studio restart
**Category**: Diagram
**Trigger**: After a `scala.MatchError` during diagram render (caused by stale `eProxyURI` references to deleted elements), Studio displayed a "Problem Occurred" dialog: `Cannot invoke "org.eclipse.ui.IWorkbenchWindow.getSelectionService()" because the return value of "org.eclipse.ui.IWorkbenchPartSite.getWorkbenchWindow()" is null`. The dialog kept reappearing on every focus change. Even after fixing assembly-diagram.xml so all references resolved correctly, the NPE kept firing on subsequent editor opens.
**Pattern**: When the editor part fails to initialize (because of an upstream MatchError or any other initialization exception), its `WorkbenchPartSite` ends up half-constructed with a null `IWorkbenchWindow` reference. Eclipse caches this broken site at the workbench level and continues asking it for the selection service on every focus change → cascading NPEs.

**There is no in-Studio recovery API for this NPE.** Once it appears, save your work and restart Studio. The following sequence is what the harness tries before recommending restart, and it works ~70% of the time when the corruption is editor-local:

1. **Close the broken editor tab** — click the × on the assembly.xml editor tab. Forces Studio to dispose the broken IEditorPart.
2. **F5 on the project** in Project Explorer (right-click → Refresh) — re-syncs filesystem.
3. **Project menu → Clean…** → pick the project, OK. Forces a rebuild and re-validation.
4. **Re-open assembly.xml** by double-clicking. Studio creates a fresh editor part with a clean part site.
5. **Window → Show View → Error Log**, click the trash-can icon to clear stale errors.

If the dialog still appears after step 4, the broken part is cached at the workbench level — only a full Studio restart clears it.

**Prevention:** the NPE is a symptom; the cause is the underlying MatchError or initialization failure. Address those first:
- Don't make structural assembly edits without committing a recovery point first (project-local git tag)
- Validate every diagram positional ref BEFORE letting the user open Studio (use the verification Python script — see "@mixed positional XPath refs" learning)
- Run `xmllint --noout` on both assembly.xml and assembly-diagram.xml after any edit
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-05-01

### [2026-05-06] Preferred visual layout for cc:route code-gated recovery: three-lane left-to-right
**Category**: Diagram
**Trigger**: User reviewed a freshly-built code-gated recovery flow (POST→PATCH upsert) and confirmed the resulting Studio diagram layout was the preferred shape. Captured here as the visual template for any future "log error then branch to recovery vs terminal" pattern so subsequent builds emulate it.
**Pattern**: Three swimlanes left-to-right, one concern per lane:

```
[error-handler swimlane]              [decision swimlane]                [terminal swimlane]
┌──────────────────────────┐    ┌──────────────────────────┐    ┌──────────────────────┐
│  AsyncMediation12        │    │  HireErrorBranch         │    │  CallDTA1            │
│  ┌─────┐  ┌──────┐       │───▶│  (cc:route)              │───▶│  (recovery target)   │
│  │ Log │─▶│ Eval │       │    │  ┌─ MVEL Strategy ─┐     │    └──────────────────────┘
│  └─────┘  └──────┘       │    │  │  Recover         │     │    ┌──────────────────────┐
│  (logs error,            │    │  │  LogAndExit      │     │───▶│  CallProcessErrorHire│
│   sets can_recover_*)    │    │  └─ Sub Routes ────┘     │    │  (terminal log)      │
└──────────────────────────┘    └──────────────────────────┘    └──────────────────────┘
```

**Layout rules:**
1. Three swimlanes — error handler → decision → terminal targets. Each lane is a single concern.
2. The error-handler async-mediation always shows its inner steps (Log + Eval) inline. Studio renders them automatically when the mediation is collapsed; don't fight the rendering.
3. The `cc:route` decision node renders three sub-blocks Studio creates automatically: `Strategy` (with the strategy type chip — `MVEL` or `XPath`), `Sub Routes` (each named branch as a child block). Place the route in its own swimlane; don't share with mediations.
4. Two outgoing arrows from the route, one per sub-route. Studio draws them parallel to each terminal lane.
5. Terminal targets stack vertically in a single swimlane: recovery on top, terminal log below — reads top-down in order of preference.

**Coordinate convention:**
- Error-handler async-mediation: x ≈ 460–500
- `cc:route` decision: x ≈ 640 (180px right of error handler)
- Terminal targets: x ≈ 800 (160px right of route), y-coords ~100px apart so arrows don't overlap
- Route node sits at the y-coordinate of the upstream error handler

**Reusable XML scaffolding (template; rename ids, recovery flag, and codes per use case):**
```xml
<cc:async-mediation id="<ErrorHandler>" routes-to="<DecisionRoute>">
    <cc:steps>
        <cc:log .../>
        <cc:eval>
            <!-- always book-keep the original error first -->
            <cc:expression>props['p.error.log'].append(... + 'ERROR,<Step>,'+context.errorMessage.toString() +'\n')</cc:expression>
            <cc:expression>props['can_<recover_flag>'] = context.errorMessage.toString().contains('<RecoverableCode1>') || context.errorMessage.toString().contains('<RecoverableCode2>')</cc:expression>
        </cc:eval>
    </cc:steps>
</cc:async-mediation>
<cc:route id="<DecisionRoute>">
    <cc:mvel-strategy>
        <cc:choose-route expression="props['can_<recover_flag>'] == true" route="Recover"/>
        <cc:choose-route expression="true" route="LogAndExit"/>
    </cc:mvel-strategy>
    <cc:sub-route name="Recover" routes-to="<RecoveryTarget>"/>
    <cc:sub-route name="LogAndExit" routes-to="<TerminalLogTarget>"/>
</cc:route>
```

This shape is the template for any "log error then branch to recovery vs terminal" pattern. Reuse it for: manager-not-found → auto-create manager flow, leave-status-conflict → re-fetch flow, missing-XSL-mapping → fallback default flow, etc.
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-05-01

### [2026-05-12] Multiple cc:send-error → single terminal creates diagram spaghetti in direct-chain assemblies
**Category**: Diagram
**Trigger**: Every async-mediation had its own cc:send-error routes-to="PutError". Studio drew one crossing arrow per mediation, resulting in 7+ lines converging on PutError — unreadable diagram.
**Pattern**: In a direct async-mediation chain (no local-in/local-out sub-flows), put handle-downstream-errors="true" and cc:send-error on the FIRST mediation ONLY. That single handler catches errors from all downstream components transitively — every http-out, workday-out-soap, and subsequent async-mediation in the chain. All other mediations need neither handle-downstream-errors nor cc:send-error. Result: one clean arrow to the error terminal.
**Example**:
```xml
<![CDATA[
<!-- CORRECT: error handler on first mediation only -->
<cc:async-mediation id="LoadAttrs" routes-to="PrepareAzureToken" handle-downstream-errors="true">
  <cc:steps>...</cc:steps>
  <cc:send-error id="LoadAttrsError" rethrow-error="false" routes-to="PutError"/>
</cc:async-mediation>

<!-- All subsequent mediations: no send-error, no handle-downstream-errors -->
<cc:async-mediation id="PrepareAzureToken" routes-to="GetAzureTokenHttp">
  <cc:steps>...</cc:steps>
</cc:async-mediation>

<cc:http-out id="GetAzureTokenHttp" routes-response-to="ParseAzureToken" .../>

<cc:async-mediation id="ParseAzureToken" routes-to="PrepareGraphRequest">
  <cc:steps>...</cc:steps>
</cc:async-mediation>

<!-- WRONG: individual send-error on every mediation -->
<!-- produces N crossing arrows to the same terminal -->
]]>
```
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-05-01

### [2026-05-12] CORRECTION: each cc:async-mediation must have its own cc:send-error — do NOT consolidate to one handler
**Category**: Assembly
**Trigger**: Previously logged the opposite: "put handle-downstream-errors on first mediation only." User corrected: each async-mediation needs its own send-error so errors are caught at the right scope with the right context. Consolidating to one handler loses per-step error context and is the wrong pattern.
**Pattern**: Every cc:async-mediation must have its own cc:send-error child. The multiple arrows converging on PutError in the diagram are normal Studio rendering — not a problem to fix. Do NOT remove individual send-error elements to "clean up" the diagram.
**Example**:
```xml
<![CDATA[
<!-- CORRECT: each mediation has its own handler -->
<cc:async-mediation id="PrepareAzureToken" routes-to="GetAzureTokenHttp" handle-downstream-errors="true">
  <cc:steps>...</cc:steps>
  <cc:send-error id="PrepareTokenError" rethrow-error="false" routes-to="PutError"/>
</cc:async-mediation>

<cc:async-mediation id="ParseAzureToken" routes-to="PrepareGraphRequest" handle-downstream-errors="true">
  <cc:steps>...</cc:steps>
  <cc:send-error id="ParseTokenError" rethrow-error="false" routes-to="PutError"/>
</cc:async-mediation>
]]>
```
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-05-01

### [2026-05-13] JSON null values become the string "null" in Studio XPath results
**Category**: MVEL
**Trigger**: prop set from XPath on a null JSON field printed as "null" in logs, and MVEL condition `== null` evaluated false — the value was the string "null" not Java null
**Pattern**: When Workday Studio converts a JSON payload to XML, null JSON values (e.g. `"value": null`) become the text node `null` in the XML element. XPath on that element returns the string "null", not Java null. Conditions like `== null`, `== empty`, and `== ''` all evaluate false against the string "null". Always normalize at the extraction point using the 3-line pattern already established in the codebase.
**Example**:
```xml
// Safe 3-line initialization pattern
props['myProp'] = ''
props['myProp'] = parts[0].xpath('/path/to/value')
if (props['myProp'] == 'null') { props['myProp'] = '' }
```
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-05-01

### [2026-05-13] cc:local-out passthrough chain: skipped steps still fire routes-response-to
**Category**: Assembly
**Trigger**: Two sequential conditional cc:local-out steps were both skipped, causing the flow to jump two steps forward silently with no log output — appeared as if an entire sub-flow was never called
**Pattern**: When a conditional `cc:local-out` is skipped (execute-when evaluates false), Studio still fires its `routes-response-to` as a passthrough. Two skipped steps in sequence produce a silent double passthrough. If both steps in a mutually-exclusive pair are skipped (e.g. due to a value that matches neither condition), the flow jumps ahead with no RAAS call, no SOAP call, and no log output. Add a debug cc:log before the conditional pair logging the raw prop value AND the boolean result of each execute-when expression to diagnose this quickly.
**Example**:
```xml
// Debug log pattern — add before conditional cc:local-out pair
props['myProp']: @{props['myProp']}
Condition A (will fire StepA): @{props['myProp'] != ''}
Condition B (will fire StepB): @{props['myProp'] == ''}
```
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-05-01

### [2026-05-13] Use string comparison == '' not null/empty checks in cc:local-out execute-when
**Category**: MVEL
**Trigger**: execute-when conditions using == null, == empty, != null, != empty behaved inconsistently when prop contained the string "null" vs Java null vs empty string — caused both conditions in a mutually-exclusive pair to evaluate false simultaneously
**Pattern**: In Workday Studio execute-when and @{} MVEL contexts, null/empty comparisons are unreliable when props may hold the string "null". After normalizing the prop to empty string at extraction (3-line pattern), use only simple string equality for branching: `!= ''` to detect a real value, `== ''` to detect absent/empty. This is unambiguous and works consistently across all MVEL evaluation contexts in Studio.
**Example**:
```xml
// After normalization at source, conditions are simple and reliable:
// Fires when prop has a real value
execute-when="props['myProp'] != ''"

// Fires when prop is absent or empty  
execute-when="props['myProp'] == ''"
```
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-05-01

### [2026-05-15] validate_assembly does not check diagram/assembly sync — diagram must be updated manually after every assembly change
**Category**: Diagram
**Trigger**: Added 6 new components and changed AsyncMediation routing in assembly.xml. validate_assembly returned 0 errors. Studio diagram still showed the old AsyncMediation → CallTestProcess arrow and the new components were completely absent from the diagram. User caught this by opening the project in Studio.
**Pattern**: validate_assembly only validates assembly.xml logic (routes-to targets exist, required attributes present, vm:// local-in refs). It does NOT read assembly-diagram.xml at all. The diagram can be completely stale — wrong connections, missing components, broken swimlanes — and validate_assembly will still report clean.

After ANY assembly.xml edit that adds, removes, or reroutes components, the diagram MUST be updated separately:
1. New component added → add a <visualProperties> entry for it
2. routes-to changed on an existing component → update the <connections> source/target
3. New local-out/local-in pair → add both to diagram + add the routesTo connection
4. New swimlane grouping needed → add <swimlanes> block with <elements> refs
5. Error paths (send-error) → add sendError type <connections>

The validate step after assembly edits should be treated as two steps:
  - validate_assembly (logic check)
  - Manual diagram review: grep new component IDs in assembly-diagram.xml to confirm they exist
**Example**:
```xml
<![CDATA[
<!-- assembly.xml — new routing -->
<cc:async-mediation id="AsyncMediation" routes-to="GetBearerToken_Out">

<!-- assembly-diagram.xml — must update connection from old target to new -->
<!-- OLD (stale after assembly change): -->
<connections type="routesTo" ...>
  <source href="assembly.xml#AsyncMediation"/>
  <target href="assembly.xml#CallTestProcess"/>  <!-- WRONG after routing change -->
</connections>

<!-- NEW (correct): -->
<connections type="routesTo" ...>
  <source href="assembly.xml#AsyncMediation"/>
  <target href="assembly.xml#GetBearerToken_Out"/>
</connections>
<connections type="routesResponseTo" ...>
  <source href="assembly.xml#GetBearerToken_Out"/>
  <target href="assembly.xml#CallTestProcess"/>
</connections>

<!-- Also must add visualProperties for every new component: -->
<visualProperties>
  <element href="assembly.xml#GetBearerToken_Out"/>
</visualProperties>

<!-- And add to appropriate swimlane: -->
<swimlanes name="Jira Token Fetch" orientation="VERTICAL">
  <elements href="assembly.xml#FetchTokenMediation"/>
  <elements href="assembly.xml#FetchToken"/>
  <elements href="assembly.xml#ProcessTokenMediation"/>
  <elements href="assembly.xml#FetchTokenError"/>
</swimlanes>
]]>
```
**Promote to**: validate-assembly.mjs
**Status**: promoted
**Promoted**: 2026-06-10

### [2026-05-15] Inserting a new swimlane shifts all #//@swimlanes.N index refs and breaks the diagram
**Category**: Diagram
**Trigger**: Added a new swimlane block between Master and the next swimlane. All downstream swimlane cross-references (href="#//@swimlanes.N") shifted by 1. Studio rendered a spaghetti diagram with all connections going to wrong nodes.
**Pattern**: Swimlane cross-references in assembly-diagram.xml use zero-based positional indices (#//@swimlanes.0, #//@swimlanes.1, etc.), not IDs. Inserting any new swimlane at any position other than the very end will silently corrupt every reference with a higher index.

Safe rules:
- NEVER insert a swimlane between existing ones
- Only append new swimlanes at the end of the swimlanes list
- When adding new components, put them inside an existing swimlane (Master is safest for startup-flow steps)
- If a dedicated swimlane is truly needed, append it at the very end of the file
**Example**:
```xml
<![CDATA[
<!-- WRONG — inserting in the middle shifts all #//@swimlanes.N refs downstream -->
<swimlanes name="Master"> ... </swimlanes>
<swimlanes name="New Swimlane">   <!-- inserted here — breaks everything below -->
  <elements href="assembly.xml#NewStep"/>
</swimlanes>
<swimlanes name="Swimlane">      <!-- was index 1, now index 2 — all hrefs broken -->
  ...
</swimlanes>

<!-- SAFE — add new components into the existing Master swimlane instead -->
<swimlanes name="Master">
  <elements href="assembly.xml#AsyncMediation"/>
  <elements href="assembly.xml#GetBearerToken_Out"/>   <!-- added here, safe -->
  <elements href="assembly.xml#FetchTokenMediation"/>
  <elements href="assembly.xml#CallTestProcess"/>
</swimlanes>
]]>
```
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-06-10

### [2026-05-21] Renaming a step ID in assembly.xml requires the same rename in assembly-diagram.xml
**Category**: Diagram
**Trigger**: scala.MatchError on diagram open: eProxyURI referenced assembly.xml#GetDisabledUsersHttp which no longer existed after rename to PostGraphBatch. Studio crashed trying to resolve the stale href.
**Pattern**: assembly-diagram.xml holds element hrefs like `assembly.xml#SomeStepId`. When any step id is renamed or removed in assembly.xml, every matching href in assembly-diagram.xml must be updated in the same commit. The validate_assembly tool only checks assembly.xml — it does NOT scan assembly-diagram.xml for stale hrefs. Always grep assembly-diagram.xml for the old id after any rename and replace_all before opening Studio.
**Example**:
```xml
<!-- assembly.xml renamed GetDisabledUsersHttp → PostGraphBatch -->
<!-- assembly-diagram.xml must also change: -->
<!-- BAD  --> <element href="assembly.xml#GetDisabledUsersHttp"/>
<!-- GOOD --> <element href="assembly.xml#PostGraphBatch"/>
```
**Promote to**: validate-assembly.mjs
**Status**: promoted
**Promoted**: 2026-06-10

### [2026-05-21] cc:message-content has no maxlength attribute
**Category**: Schema
**Trigger**: Studio XML validation error: Attribute 'maxlength' is not allowed to appear in element 'cc:message-content'
**Pattern**: cc:message-content takes no attributes. To truncate log output use MVEL in a cc:text expression instead — e.g. `@{parts[0].text.length() > 2000 ? parts[0].text.substring(0,2000) + '...' : parts[0].text}` inside a cc:log cc:text element.
**Example**:
```xml
<!-- BAD -->
<cc:message-content maxlength="2000"/>

<!-- GOOD — truncate via cc:text if needed -->
<cc:log id="LogRaw">
  <cc:log-message>
    <cc:text>Response: @{parts[0].text.length() > 2000 ? parts[0].text.substring(0,2000) + '...' : parts[0].text}</cc:text>
  </cc:log-message>
</cc:log>
```
**Promote to**: get-step-type-reference.mjs
**Status**: promoted
**Promoted**: 2026-06-10

### [2026-05-21] Use cc:workday-out-rest for RAAS — never cc:workday-out-soap + cc:xslt-plus
**Category**: Assembly
**Trigger**: Used cc:workday-out-soap with application= and a cc:xslt-plus to build an Execute_Report_Request envelope for a RAAS call. Wrong pattern — Studio showed the XSLT step incorrectly in the diagram and the SOAP application name for custom reports is not discoverable without checking the report's web service endpoint.
**Pattern**: RAAS calls use cc:workday-out-rest (top-level, never inside cc:steps) with extra-path resolving a cloud:report-alias via intsys.reportService.getExtrapath(). No request body XSL needed. The cloud:report-alias must be declared inside cloud:report-service inside cc:integration-system in cc:workday-in. Response is wd:Report_Data/wd:Report_Entry directly — no SOAP envelope wrapper. Always call get_step_type_reference('workday-out-rest') before writing any RAAS integration.
**Example**:
```xml
<!-- In cc:workday-in: -->
<cloud:report-service name="INT999_Reports">
  <cloud:report-alias description="INT999 Active Employees" name="INT999_Active_Employees"/>
</cloud:report-service>

<!-- Top-level in cc:assembly: -->
<cc:workday-out-rest id="GetWDWorkersRAAS" routes-response-to="CountWDWorkers"
    extra-path="@{intsys.reportService.getExtrapath('INT999_Active_Employees')}"/>

<!-- Response XPath (no envelope): -->
count(/wd:Report_Data/wd:Report_Entry)
```
**Promote to**: all
**Status**: promoted
**Promoted**: 2026-06-10

### [2026-06-09] Naming conventions for Studio palette components (cc:async-mediation, cc:local-in, cc:route, etc.)
**Category**: Assembly
**Trigger**: Existing integrations used auto-generated names like AsyncMediation0, AsyncMediation3, AsyncMediation17 — unreadable in the palette and impossible to reason about without opening the XML
**Pattern**: Use verb+object (or noun) patterns per element type so the palette is self-documenting:

cc:async-mediation → Verb + Object (PascalCase)
  Examples: InitBatch, SetTransactionProps, SetEmployeeProps, CheckDuplicate, PrepareTermination, ParseGraphUsers, CountWDWorkers

cc:local-in → Sub-flow entry noun (the name of what this sub-flow does)
  Examples: LoadAttrs, AzureToken, GraphUsers, WDWorkers, GeneratePayload, LookupEmployee, TermProcess

cc:local-out (calling a sub-flow) → Call + SubFlowName
  Examples: Call_LoadAttrs, Call_AzureToken, Call_GraphUsers, Call_WDWorkers

cc:local-out (error delivery) → Put + SubFlowName + Fail
  Examples: PutLoadAttrsFail, PutAzureTokenFail, PutGraphUsersFail

cc:route → RouteBy + Criteria
  Examples: RouteByTransactionType, RouteByPositionExists, RouteByWorkerType

cc:splitter → SplitBy + Element
  Examples: SplitByEmployee, SplitByTransaction

cc:send-error (inside async-mediation) → SubFlowName + Error
  Examples: LoadAttrsError, PrepareTokenError, ParseGraphError

cc:workday-out-* → Call + Api + Operation (PascalCase)
  Examples: CallStaffingTerminateEmployee, GetWDWorkersRAAS, PostGraphBatch

Error handler local-out for global errors → DeliverError (singleton)
Error handler cc:send-error global → GlobalErrorHandler (singleton)

Rationale: Studio shows all IDs flat in the palette. Without verb+object naming you cannot distinguish 5 async-mediations from each other. Names also appear in server logs — readable names make log triage 10x faster.
**Example**:
```xml
<!-- BAD — auto-generated, unreadable -->
<cc:async-mediation id="AsyncMediation0" .../>
<cc:async-mediation id="AsyncMediation3" .../>
<cc:async-mediation id="AsyncMediation17" .../>
<cc:local-in id="SubFlow0" .../>
<cc:local-out id="LocalOut1" .../>

<!-- GOOD — verb+object, self-documenting -->
<cc:async-mediation id="InitBatch" .../>
<cc:async-mediation id="SetTransactionProps" .../>
<cc:async-mediation id="PrepareTermination" .../>
<cc:local-in id="LookupEmployee" .../>
<cc:local-out id="Call_LookupEmployee" .../>
```
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-06-10

### [2026-06-09] rename_steps tool concept: atomic rename across assembly.xml AND assembly-diagram.xml
**Category**: Diagram
**Trigger**: Manually renaming a step ID in assembly.xml without updating the matching href in assembly-diagram.xml caused a scala.MatchError crash when Studio tried to open the diagram. The reverse (renaming in diagram but not assembly) causes the same crash. This happened twice across two different builds.
**Pattern**: Any ID rename in assembly.xml requires a matching update in assembly-diagram.xml. The diagram file references assembly element IDs via href attributes in three forms:
  1. visualProperties: <element href="assembly.xml#OldID"/>
  2. connections source/target: <source href="assembly.xml#OldID"/> / <target href="assembly.xml#OldID"/>
  3. swimlanes elements: <elements href="assembly.xml#OldID"/>

Missing any one of these causes scala.MatchError on diagram open (no meaningful error message — Studio just crashes the editor).

The studio-mcp should have a rename_steps tool that:
  1. Takes project_name, old_id, new_id
  2. Reads both assembly.xml and assembly-diagram.xml
  3. Does a safe string replace of id="OldID" in assembly.xml (with surrounding quotes to avoid partial matches)
  4. Does a safe string replace of #OldID" in assembly-diagram.xml (all href forms use #ID" suffix)
  5. Writes both files atomically
  6. Runs validate_assembly on the result
  7. Returns a diff summary of every location changed

Until the tool exists: ALWAYS use studio-mcp write_integration_file to write both files in the same operation, never rename by hand in the XML editor.
**Example**:
```xml
<!-- assembly.xml — must change id= attribute -->
<cc:async-mediation id="AsyncMediation3" .../>   <!-- OLD -->
<cc:async-mediation id="SetTransactionProps" .../> <!-- NEW -->

<!-- assembly-diagram.xml — must change ALL three href forms -->
<!-- OLD -->
<element href="assembly.xml#AsyncMediation3"/>
<source href="assembly.xml#AsyncMediation3"/>
<elements href="assembly.xml#AsyncMediation3"/>

<!-- NEW -->
<element href="assembly.xml#SetTransactionProps"/>
<source href="assembly.xml#SetTransactionProps"/>
<elements href="assembly.xml#SetTransactionProps"/>
```
**Promote to**: all
**Status**: promoted
**Promoted**: 2026-06-10

### [2026-06-26] Removing top-level steps via raw Edit leaves dangling diagram references
**Category**: Diagram
**Trigger**: After deleting cc:local-out Call_GetWorkers and cc:local-in GetWorkers from assembly.xml via Edit (to wire a workday-out-rest + splitter pattern directly to DoGetWorkers), validate_assembly reported zero errors but assembly-diagram.xml still contained 15 dangling href references to the removed step IDs (element href, source href, target href, elements href).
**Pattern**: When restructuring a plan_integration-scaffolded flow to inline the RaaS pattern (workday-out-rest + splitter directly to an async-mediation), the Call_X local-out and X local-in scaffold pieces become orphans. Deleting them via raw Edit removes them from assembly.xml cleanly, but assembly-diagram.xml retains href="assembly.xml#Call_X" references that Studio cannot resolve. validate_assembly does not currently inspect the diagram for dangling refs. Either (a) add a diagram dangling-ref check to validate_assembly, OR (b) provide a delete_assembly_step / remove_step tool that updates both files atomically, OR (c) document this gotcha in the workday-out-rest reference (since the RaaS pattern inherently bypasses the Call_X → X local-in indirection).
**Example**:
```xml
&lt;!-- BEFORE: scaffolded chain with sub-flow indirection --&gt;
&lt;cc:workday-in routes-to="Call_GetWorkers"/&gt;
&lt;cc:local-out id="Call_GetWorkers" routes-response-to="Call_FindResource" endpoint="vm://INT/GetWorkers"/&gt;
&lt;cc:local-in id="GetWorkers" routes-to="DoGetWorkers"/&gt;
&lt;cc:async-mediation id="DoGetWorkers".../&gt;

&lt;!-- AFTER: RaaS pattern bypasses the local-out/in pair --&gt;
&lt;cc:workday-in routes-to="GetWorkersRaaS"/&gt;
&lt;cc:workday-out-rest id="GetWorkersRaaS" routes-response-to="SplitWorkers" extra-path="..."/&gt;
&lt;cc:splitter id="SplitWorkers"&gt;&lt;cc:sub-route routes-to="DoGetWorkers"/&gt;...&lt;/cc:splitter&gt;
&lt;cc:async-mediation id="DoGetWorkers" routes-to="Call_FindResource".../&gt;

&lt;!-- Diagram still has dangling: --&gt;
&lt;element href="assembly.xml#Call_GetWorkers"/&gt;  (× 15 occurrences)
```
**Promote to**: validate-assembly.mjs
**Status**: already-covered (STALE_DIAGRAM_HREF error added to src/assembly-validator.mjs in d47ef95; verified 2026-07-13 against the entry's exact scenario)

### [2026-06-26] plan_integration scaffolds diagram with dangling End{SubFlowName} refs
**Category**: Diagram
**Trigger**: Studio crashed with scala.MatchError on platform:/resource/.../assembly.xml#EndGetWorkers (eProxyURI) when opening the diagram of a freshly scaffolded INT999_O_Example_LOA project. Root cause: plan_integration generated 27 references in assembly-diagram.xml (9 visualProperties + 9 routesTo connections + 9 swimlanes elements, all named End{SubFlowName}) but never added any corresponding cc:* steps with those IDs to assembly.xml. Every single sub-flow scaffolded by plan_integration produces this drift.
**Pattern**: For each sub-flow that plan_integration scaffolds, the assembly-diagram.xml gets three references to assembly.xml#End{SubFlowName} — but plan_integration's assembly.xml emission has no matching step IDs. This causes Studio's diagram editor to crash on open with scala.MatchError at com.workday.sh.sa.editor.assembly.impl.editparts.Factory.createEditPart line 19 — the EMF proxy URI fails to resolve. Fix: either (a) plan_integration should emit a sentinel step (e.g., a tiny cc:eval id="EndGetWorkers" with no expressions, or a cc:log id="EndGetWorkers" emitting a "sub-flow complete" message) for each sub-flow, OR (b) plan_integration should omit the End{X} visualProperties/connections/swimlane references entirely. Without either fix, every scaffold-then-open cycle crashes Studio.
**Example**:
```xml
&lt;!-- ASSEMBLY-DIAGRAM.XML emits (× 9 sub-flows) --&gt;
&lt;visualProperties x="350" y="360"&gt;
  &lt;element href="assembly.xml#EndGetWorkers"/&gt;
&lt;/visualProperties&gt;
&lt;connections type="routesTo"&gt;
  &lt;source href="assembly.xml#DoGetWorkers"/&gt;
  &lt;target href="assembly.xml#EndGetWorkers"/&gt;
&lt;/connections&gt;
&lt;swimlanes ...&gt;
  &lt;elements href="assembly.xml#EndGetWorkers"/&gt;
&lt;/swimlanes&gt;

&lt;!-- ASSEMBLY.XML emits NOTHING with id="EndGetWorkers" --&gt;
&lt;!-- Studio crashes on diagram open with scala.MatchError --&gt;

&lt;!-- WORKAROUND we applied: strip all 27 dangling End* refs from assembly-diagram.xml via regex --&gt;
```
**Promote to**: all
**Status**: promoted (patterns.md; validator already covered by STALE_DIAGRAM_HREF since d47ef95; step-reference skipped — no matching step type)
**Promoted**: 2026-07-13

### [2026-06-26] cc:send-error elements cannot be referenced by ID in assembly-diagram.xml — must use @mixed XPath
**Category**: Diagram
**Trigger**: Studio crashed with scala.MatchError on platform:/resource/.../assembly.xml#GlobalErrorHandler (eProxyURI) even though cc:send-error id="GlobalErrorHandler" exists in assembly.xml and validate_assembly passes. Diagram refs assembly.xml#GlobalErrorHandler look correct by ID, but EMF cannot resolve them.
**Pattern**: cc:send-error elements (including GlobalErrorHandler and each per-sub-flow XError) are NOT first-class routable steps in Studio's EMF model. They have an id="..." attribute that is meaningful for routes-to/send-error connections at runtime, but the diagram editor cannot resolve diagram href references to send-error elements by their named ID — the editor's Factory.createEditPart calls scala.MatchError on any unrecognized proxy. The original plan_integration scaffold worked around this by emitting opaque @mixed XPaths like assembly.xml#//@beans/@mixed.1/@mixed.75 — but those indices shift whenever any top-level step is added or removed, making them brittle. SAFEST PATTERN: omit send-error elements from the diagram entirely (no visualProperties, no connections, no swimlane elements). Send-error still works at runtime; the diagram just doesn't visualize the catch handler. This produces a stable diagram across assembly edits. If visualization of the global error handler is critical, the @mixed.N index must be recomputed every time assembly.xml's top-level structure changes.
**Example**:
```xml
&lt;!-- BAD: works at runtime but crashes Studio diagram editor --&gt;
&lt;visualProperties x="300" y="65"&gt;
  &lt;element href="assembly.xml#GlobalErrorHandler"/&gt;
&lt;/visualProperties&gt;

&lt;!-- BAD-but-functional: brittle @mixed path that shifts with assembly edits --&gt;
&lt;visualProperties&gt;
  &lt;element href="assembly.xml#//@beans/@mixed.1/@mixed.75"/&gt;
&lt;/visualProperties&gt;

&lt;!-- SAFE: omit send-error from diagram entirely. Runtime unaffected. --&gt;
&lt;!-- (no visualProperties, no connection, no swimlane elements entry) --&gt;
```
**Promote to**: all
**Status**: promoted
**Promoted**: 2026-07-13 (validate-assembly.mjs rule only — patterns.md §"cc:send-error cannot be a diagram node" and the send-error step-type reference DIAGRAM RULES already covered the docs targets)

### [2026-06-26] Canonical assembly-diagram.xml patterns for RaaS-driven integrations
**Category**: Diagram
**Trigger**: After multiple Studio diagram editor crashes (scala.MatchError on Call_GetWorkers, then EndGetWorkers, then DeliverErrorRouter, then GlobalErrorHandler), user manually fixed assembly-diagram.xml in Studio and shared the working version. Comparing the working diagram against my attempts surfaced five distinct Studio conventions I did not know about.
**Pattern**: Canonical assembly-diagram.xml conventions for any plan_integration-scaffolded project that uses workday-out-rest + splitter + multiple sub-flows:

1. cc:send-error elements (GlobalErrorHandler and per-async-mediation X-Error): MUST be referenced by @mixed XPath, NEVER by named id. Studio's diagram editor crashes on ID-based refs. The indices are arithmetic, not random: every top-level cc:async-mediation occupies 4 mixed positions in cc:assembly, so successive async-mediations are at @mixed.K, K+4, K+8, ... and each async-mediation's embedded cc:send-error is always at child @mixed.3. The top-level GlobalErrorHandler send-error sits at @mixed.{last_async_mediation_index + 2}. Pattern observed in a production build: GetWorkersError at @beans/@mixed.1/@mixed.19/@mixed.3, FindResourceError at @mixed.23/@mixed.3, FindParticipantError at @mixed.27/@mixed.3, ..., WriteLogError at @mixed.51/@mixed.3, GlobalErrorHandler at @mixed.53.

2. Call_X (cc:local-out) → X (cc:local-in) dispatch connections should NOT be drawn in the diagram. The vm:// endpoint on the local-out implicitly routes; drawing the connection creates redundant diagonal arrows. Only emit: StartHere→GetWorkersRaaS (routesTo), GetWorkersRaaS→SplitWorkers (routesResponseTo), splitter-sub-route→DoGetWorkers, DoGetWorkers→Call_FindResource, the linear Call_X routes-response-to Call_X+1 chain, X→DoX (per sub-flow), DoXError→PutXError (per sub-flow via @mixed XPath), GlobalErrorHandler→DeliverError (via @mixed XPath).

3. Splitter sub-route arrow source: use the @splitter.N/@subRoute.M XPath, NOT the splitter id. Pattern: <source href="assembly.xml#//@beans/@mixed.1/@splitter.0/@subRoute.0"/>. This anchors the arrow at the sub-route slot inside the splitter box, not the splitter as a whole.

4. Two distinct nested-swimlane syntaxes — pick by content:
   - Self-closing attribute form (parent has ONLY a nested child reference): <swimlanes ... elements="//@swimlanes.N"/>
   - Container child-element form (parent has nested AND other elements inline): <swimlanes ...><elements href="assembly.xml#X"/><elements href="#//@swimlanes.N"/></swimlanes>
   Note the URI fragment difference: attribute form uses //@swimlanes.N (no leading #), child element form uses #//@swimlanes.N.

5. Outer Master swimlane composes the layout. Every Studio diagram needs a top-level vertical swimlane at the end with name="Master" orientation="VERTICAL" whose elements attribute lists every PARENT swimlane (not nested children). Example: <swimlanes x="-26" y="-287" name="Master" orientation="VERTICAL" elements="//@swimlanes.0 //@swimlanes.1 //@swimlanes.4 //@swimlanes.6 //@swimlanes.8 //@swimlanes.10 //@swimlanes.12 //@swimlanes.14 //@swimlanes.16 //@swimlanes.18"/>. The space-separated list references parents only; vertical children are reached through their parents.

Each DoX and PutXError step has BOTH a top-level visualProperties block AND membership in its vertical child swimlane (not either/or).
**Example**:
```xml
&lt;!-- send-error reference: USE @mixed XPath --&gt;
&lt;visualProperties&gt;
  &lt;element href="assembly.xml#//@beans/@mixed.1/@mixed.53"/&gt;
&lt;/visualProperties&gt;
&lt;connections type="routesTo"&gt;
  &lt;source href="assembly.xml#//@beans/@mixed.1/@mixed.53"/&gt;
  &lt;target href="assembly.xml#DeliverError"/&gt;
&lt;/connections&gt;

&lt;!-- send-error inside an async-mediation --&gt;
&lt;connections type="routesTo"&gt;
  &lt;source href="assembly.xml#//@beans/@mixed.1/@mixed.19/@mixed.3"/&gt;
  &lt;target href="assembly.xml#PutGetWorkersError"/&gt;
&lt;/connections&gt;

&lt;!-- splitter sub-route arrow --&gt;
&lt;connections type="routesTo"&gt;
  &lt;source href="assembly.xml#//@beans/@mixed.1/@splitter.0/@subRoute.0"/&gt;
  &lt;target href="assembly.xml#DoGetWorkers"/&gt;
&lt;/connections&gt;

&lt;!-- nested swimlane: self-closing attribute form --&gt;
&lt;swimlanes x="30" y="320" name="RaaS Processing Sub-flow" elements="//@swimlanes.3" alignment="MIDDLE" labelAlignment="LEFT"/&gt;

&lt;!-- nested swimlane: container form (Main Flow with inline contents AND nested sub-flow) --&gt;
&lt;swimlanes x="30" y="140" name="Main Flow" alignment="MIDDLE" labelAlignment="LEFT"&gt;
  &lt;elements href="assembly.xml#SplitWorkers"/&gt;
  &lt;elements href="#//@swimlanes.2"/&gt;
  &lt;elements href="assembly.xml#Call_FindResource"/&gt;
&lt;/swimlanes&gt;

&lt;!-- Master swimlane at end of file --&gt;
&lt;swimlanes x="-26" y="-287" name="Master" orientation="VERTICAL" elements="//@swimlanes.0 //@swimlanes.1 //@swimlanes.4 //@swimlanes.6 //@swimlanes.8 //@swimlanes.10 //@swimlanes.12 //@swimlanes.14 //@swimlanes.16 //@swimlanes.18"/&gt;
```
**Promote to**: all
**Status**: promoted
**Promoted**: 2026-07-13 — points 2–4 promoted to patterns.md + get-step-type-reference.mjs (splitter, local-out) + assembly-validator.mjs (SWIMLANE_REF_FRAGMENT_FORM, REDUNDANT_VM_DISPATCH_ARROW). Point 1 send-error-by-XPath already covered (patterns.md 'cc:send-error cannot be a diagram node' + send-error step reference); its K+4 index arithmetic superseded by the 2026-07-09 @mixed formula entry (2k+1). Point 5 (Master swimlane) already in 'Swimlane layout template'; attribute-form example folded into the point-4 subsection.

### [2026-06-26] cc:log does not accept condition attribute — use cc:cloud-log or compute status in cc:eval
**Category**: Schema
**Trigger**: Studio build reported "Attribute 'condition' is not allowed to appear in element 'cc:log'" (cvc-complex-type.3.2.2) on two cc:log steps that used condition="props['X'] != null" for conditional logging. validate_assembly did not catch this — Studio's full schema check did.
**Pattern**: cc:log is for simple text/payload logging and does NOT support the `condition` attribute. Only cc:cloud-log accepts `condition` (e.g. `<cc:cloud-log condition="props['LogType']=='Info'" .../>`). For conditional discrimination via cc:log, compute a status prop via cc:eval first, then embed it in the log text using @{props['Status']}: e.g. `[INT999][@{props['Status']}] Employee_ID=...`. This produces one log line with a greppable status token, and works in all Studio assembly versions. validate_assembly should flag `condition` on cc:log as a schema error rather than waiting for the Studio build.
**Example**:
```xml
&lt;!-- BAD: validate_assembly passes but Studio rejects --&gt;
&lt;cc:log id="LogOk" condition="props['X'] != null"&gt;...&lt;/cc:log&gt;
&lt;cc:log id="LogFail" condition="props['X'] == null"&gt;...&lt;/cc:log&gt;

&lt;!-- GOOD: compute status, embed in single log --&gt;
&lt;cc:eval id="SetStatus"&gt;
  &lt;cc:expression&gt;props['Status'] = (props['X'] != null) ? 'OK' : 'FAIL';&lt;/cc:expression&gt;
&lt;/cc:eval&gt;
&lt;cc:log id="LogResult"&gt;
  &lt;cc:log-message&gt;
    &lt;cc:text&gt;[INT999][@{props['Status']}] X=@{props['X']}&lt;/cc:text&gt;
  &lt;/cc:log-message&gt;
&lt;/cc:log&gt;

&lt;!-- ALSO GOOD: cc:cloud-log does support condition --&gt;
&lt;cc:cloud-log condition="props['LogType']=='Info'" level="info" message="..." variable-name="cloud-log-content"/&gt;
```
**Promote to**: validate-assembly.mjs
**Status**: promoted
**Promoted**: 2026-07-13

### [2026-06-28] Each (Do{X} + Put{X}Error) pair in a sub-flow gets its own nested VERTICAL swimlane child
**Category**: Diagram
**Trigger**: When extending an existing sub-flow swimlane (e.g. ReadCurrentDetail Sub-flow) with an additional async-mediation + error router (DoReadDFF + PutReadDFFError), my first attempt was to add the new Do/PutError pair to the SAME existing nested vertical child swimlane that already held DoReadCurrentDetail + PutReadCurrentDetailError. User manually split them into a separate nested vertical swimlane to preserve the canonical "one boxed work unit per pair" visual.
**Pattern**: Each cc:async-mediation that does substantive work (a Do{X}) plus its dedicated error router (Put{X}Error) MUST live in its own nested VERTICAL swimlane child of the parent sub-flow swimlane — even when multiple Do/PutError pairs belong to the same logical sub-flow. The parent swimlane lists MULTIPLE elements href="#//@swimlanes.N"/> references, one per vertical child. Studio renders each vertical child as a distinct boxed work unit; cramming pairs into a shared vertical child collapses them into one box and loses the visual hierarchy. Pattern example: ReadCurrentDetail Sub-flow (parent at swimlanes.11) contains ReadCurrentDetail local-in + ReadParticipantDetail http-out + ReadParticipantDetailDFF http-out + TWO nested vertical refs: swimlanes.12 (DoReadCurrentDetail + PutReadCurrentDetailError) AND swimlanes.23 (DoReadDFF + PutReadDFFError). The send-error connection for the new DoReadDFF uses @beans/@mixed.1/@mixed.N/@mixed.3 where N is the 1-indexed position of the new async-mediation in cc:assembly's direct children (for appended elements, N = 19 + 4*K where K is the count of additional async-mediations added after the initial scaffold).
**Example**:
```xml
&lt;!-- Parent swimlane with TWO nested vertical children, one per Do/PutError pair --&gt;
&lt;swimlanes x="30" y="1120" name="ReadCurrentDetail Sub-flow"&gt;
  &lt;elements href="assembly.xml#ReadCurrentDetail"/&gt;
  &lt;elements href="assembly.xml#ReadParticipantDetail"/&gt;
  &lt;elements href="assembly.xml#ReadParticipantDetailDFF"/&gt;
  &lt;elements href="#//@swimlanes.12"/&gt;
  &lt;elements href="#//@swimlanes.23"/&gt;
&lt;/swimlanes&gt;

&lt;!-- First Do/PutError pair --&gt;
&lt;swimlanes x="170" y="1135" name="Swimlane" orientation="VERTICAL"&gt;
  &lt;elements href="assembly.xml#DoReadCurrentDetail"/&gt;
  &lt;elements href="assembly.xml#PutReadCurrentDetailError"/&gt;
&lt;/swimlanes&gt;

&lt;!-- Second Do/PutError pair — SEPARATE vertical child --&gt;
&lt;swimlanes x="644" y="1634" name="Swimlane" orientation="VERTICAL"&gt;
  &lt;elements href="assembly.xml#DoReadDFF"/&gt;
  &lt;elements href="assembly.xml#PutReadDFFError"/&gt;
&lt;/swimlanes&gt;

&lt;!-- send-error connection uses @mixed XPath for the new async-mediation --&gt;
&lt;connections type="routesTo"&gt;
  &lt;source href="assembly.xml#//@beans/@mixed.1/@mixed.95/@mixed.3"/&gt;
  &lt;target href="assembly.xml#PutReadDFFError"/&gt;
&lt;/connections&gt;
```
**Promote to**: all
**Status**: promoted
**Promoted**: 2026-07-13 (patterns.md + get-step-type-reference.mjs + validate-assembly.mjs; the "N = 19 + 4*K" @mixed aside was NOT promoted — superseded by the general 2k+1 formula in the 2026-07-09 "@mixed positional index formula" entry)

### [2026-06-28] MVEL cannot resolve fully-qualified class references inside ternary expressions
**Category**: MVEL
**Trigger**: org.mvel.CompileException: unable to resolve property: java — thrown at runtime for every worker in DoBuildDecision when a cc:expression used a ternary with java.time.LocalDate.parse(...) as one branch: `props['X'] = cond ? java.time.LocalDate.parse(s) : null;`. The SAME call works at expression top-level (InitializeProperties uses `props['Current_Date'] = java.time.LocalDate.now()` successfully). The integration ran with status CompletedWithError; the BuildDecision send-error fired 7 times and no [DECISION] lines appeared.
**Pattern**: MVEL's expression compiler treats fully-qualified Java class references (e.g. `java.time.LocalDate`, `java.time.temporal.ChronoUnit`) as identifier chains. When such a reference appears as the THEN or ELSE branch of a ternary `?:`, the parser tries to resolve `java` as a property in scope first (e.g. `props['java']`, a local variable, etc.) and throws `unable to resolve property: java` when it fails. At expression top-level (immediately after `props['X'] = `), the compiler correctly recognizes the package-class-method chain. FIX: wrap any `java.x.y.z.method(...)` call inside an `if (cond) { props['X'] = java.x.y.z.method(...); }` block instead of using it as a ternary branch. Each if-statement still fits in one cc:expression. ALSO: MVEL does not support C-style casts — `(long) props['X']` throws parse errors. Just call the method directly; autoboxing handles the long primitive parameter (e.g. `props['date'].minusDays(props['days'])` where props['days'] is a Long works fine).
**Example**:
```xml
&lt;!-- BAD: throws "unable to resolve property: java" --&gt;
&lt;cc:expression&gt;props['Calc_LeaveStartDate'] = props['Valid'] == 'true' ? java.time.LocalDate.parse(props['Iso']) : null;&lt;/cc:expression&gt;

&lt;!-- BAD: MVEL has no C-style cast syntax --&gt;
&lt;cc:expression&gt;props['Floor'] = props['Date'].minusDays((long) props['Days']);&lt;/cc:expression&gt;

&lt;!-- GOOD: package-class-method chain at expression top-level inside if-body --&gt;
&lt;cc:expression&gt;props['Calc_LeaveStartDate'] = null;&lt;/cc:expression&gt;
&lt;cc:expression&gt;if (props['Valid'] == 'true') { props['Calc_LeaveStartDate'] = java.time.LocalDate.parse(props['Iso']); }&lt;/cc:expression&gt;

&lt;!-- GOOD: drop the cast, rely on autoboxing --&gt;
&lt;cc:expression&gt;props['Floor'] = props['Date'].minusDays(props['Days']);&lt;/cc:expression&gt;

&lt;!-- GOOD: top-level works because `java` is the first token after `=` --&gt;
&lt;cc:expression&gt;props['Current_Date'] = java.time.LocalDate.now();&lt;/cc:expression&gt;
```
**Promote to**: all
**Status**: superseded (see [2026-06-28] VERIFIED — MVEL 1.3 in Studio: avoid java.time static methods in per-message contexts, learnings.md line 1012; do not promote — claims disproven)

### [2026-06-28] CORRECTION — MVEL cannot resolve java.x.y.z anywhere except direct top-level RHS — if-bodies also fail
**Category**: MVEL
**Trigger**: After initial fix (wrap java.time.LocalDate.parse in if-body), the SAME error reappeared: org.mvel.CompileException: unable to resolve property: java — but this time the stack trace included org.mvel.ast.IfNode.getReducedValueAccelerated, proving that the body inside `if (cond) { props['X'] = java.time.LocalDate.parse(s); }` is compiled as a NESTED expression and fails class resolution the same as a ternary branch.
**Pattern**: UPDATE to the earlier learning. MVEL's fully-qualified class resolution only works when the class reference is the IMMEDIATE RHS of an assignment at expression top-level — `props['X'] = java.time.LocalDate.now()`. Any wrapping context fails: ternary branches, if-bodies, while-bodies, parenthesized subexpressions. Even moving the call into an if-body does NOT help because MVEL compiles the body as its own nested ExecutableAccessor and re-runs identifier resolution without the package-resolution path.

CORRECT FIX: NEVER guard a `java.x.y.z.method(...)` call with a conditional. Instead:
1. Compute a 'safe' input via a string-only ternary (no java.x.y.z anywhere): `props['SafeInput'] = props['IsValid'] == 'true' ? props['RealInput'] : 'sentinel-value';`
2. Call the java.x.y.z method UNCONDITIONALLY at top-level with the safe input: `props['Parsed'] = java.time.LocalDate.parse(props['SafeInput']);`
3. Use a separate ternary on the validity flag to null out the sentinel result: `props['Real'] = props['IsValid'] == 'true' ? props['Parsed'] : null;`

This works because step 2 has `java.time.LocalDate.parse(...)` as the immediate RHS of `props['X'] = ` — no nesting, no conditional. The parse call always runs (with a real value or sentinel), and the validity check filters the result afterward.

Pattern applies to LocalDate.parse, ChronoUnit.DAYS.between, and any other fully-qualified Java static call. For ChronoUnit specifically: call unconditionally on the parsed (sentinel-safe) dates, then ternary the result against validity:
`props['DaysOnLeaveParsed'] = java.time.temporal.ChronoUnit.DAYS.between(props['LeaveStartDateParsed'], props['Current_Date']);`
`props['DaysOnLeave'] = props['LeaveStartIsoValid'] == 'true' ? props['DaysOnLeaveParsed'] : null;`
**Example**:
```xml
&lt;!-- BAD (still fails — if-body is a nested expression context) --&gt;
&lt;cc:expression&gt;if (props['IsValid'] == 'true') { props['Date'] = java.time.LocalDate.parse(props['Iso']); }&lt;/cc:expression&gt;

&lt;!-- GOOD (3-step sentinel pattern) --&gt;
&lt;cc:expression&gt;props['IsoSafe'] = props['IsValid'] == 'true' ? props['Iso'] : '1970-01-01';&lt;/cc:expression&gt;
&lt;cc:expression&gt;props['DateParsed'] = java.time.LocalDate.parse(props['IsoSafe']);&lt;/cc:expression&gt;
&lt;cc:expression&gt;props['Date'] = props['IsValid'] == 'true' ? props['DateParsed'] : null;&lt;/cc:expression&gt;

&lt;!-- For ChronoUnit, same pattern but the parsed dates from above are already safe --&gt;
&lt;cc:expression&gt;props['DaysParsed'] = java.time.temporal.ChronoUnit.DAYS.between(props['LeaveStartDateParsed'], props['Current_Date']);&lt;/cc:expression&gt;
&lt;cc:expression&gt;props['Days'] = props['IsValid'] == 'true' ? props['DaysParsed'] : null;&lt;/cc:expression&gt;
```
**Promote to**: all
**Status**: superseded (see [2026-06-28] VERIFIED "avoid java.time static methods in per-message contexts" + [2026-07-09] REFINEMENT — this entry's sentinel pattern was an unverified theory that proved wrong)

### [2026-06-28] VERIFIED — MVEL 1.3 in Studio: avoid java.time static methods in per-message contexts
**Category**: MVEL
**Trigger**: A per-message decision eval failed 3 times with org.mvel.CompileException unable to resolve property java — across ternaries, if-bodies, and sentinel-pattern top-level usages of java.time.LocalDate.parse. Verified-working fix removed all java.time static calls from per-message contexts and used instance methods on Current_Date plus ISO string compareTo. Serverlog now shows 7/7 workers with successful DECISION lines, zero errors.
**Pattern**: Workday Studio runs MVEL 1.3 per official docs. java.time.LocalDate.now() works in InitializeProperties bootstrap context but java.time.LocalDate.parse and java.time.temporal.ChronoUnit.DAYS.between fail in per-message contexts even at expression top-level. The fix is to never call java.x.y.staticMethod in per-message evals: store a LocalDate in props in InitializeProperties using the one bootstrap-safe call, then use only instance methods on that LocalDate (props['Current_Date'].minusDays(N).toString()) plus YYYY-MM-DD ISO string comparison (compareTo gives chronological order). For complex date parsing use the canonical Workday pattern new java.text.SimpleDateFormat("yyyy-MM-dd").parse(s) returning java.util.Date. For anything more complex than comparisons do the math in XSLT with xs:date and xs:dayTimeDuration. SUPERSEDES the two earlier MVEL learnings logged 2026-06-28 about if-body wrapping and sentinel-pattern — those were unverified theories that proved wrong.
**Example**:
```xml
BAD pattern (fails everywhere in per-message contexts): props['Date'] = java.time.LocalDate.parse(props['Iso']); GOOD pattern: props['TodayIso'] = props['Current_Date'].toString(); props['CapFloorIso'] = props['Current_Date'].minusDays(props['MaxAge']).toString(); props['IsAbove'] = props['LeaveStartIso'].compareTo(props['CapFloorIso']) less-than-zero ? 'true' : 'false'
```
**Promote to**: all
**Status**: promoted
**Promoted**: 2026-07-13

### [2026-06-30] Consolidated single-document logging: accumulate-then-store-once across a splitter
**Category**: Assembly
**Trigger**: A splitter that logs per worker produced N separate output HTML documents (7 workers → 7 files) instead of one consolidated document, because the per-worker mediation did cc:store(createDocumentReference) + a deliver (local-out to PutIntegrationMessage) INSIDE the splitter loop, materializing one document per element.
**Pattern**: To emit ONE consolidated output document for a splitter processing N elements, split the responsibilities: (1) PER ELEMENT — the per-worker step only APPENDS to a shared run-scoped variable via cc:cloud-log variable-name="cloud-log-content" (cc:cloud-log appends across all invocations into the same variable); no cc:store and no deliver inside the loop. (2) ONCE AT END OF RUN — a separate sub-flow does a single cc:store(createDocumentReference="true") of that variable plus a single deliverable PutIntegrationMessage. Wire the end-of-run sub-flow off the upstream data call's routes-response-to (e.g. the RAAS local-out): routes-response-to fires only AFTER the entire downstream request path — including the terminal splitter draining every element — completes, which is exactly "store once after the split finishes." Runtime-verified in a live run (server log: status Completed, 0 errors). VERIFICATION SIGNATURE in the server log: cc:cloud-log/cc:log markers ('[WriteLog]') == worker count, all preceding exactly one 'Calling PutIntegrationMessage within StoreStep' and one consolidated document title, plus exactly one end-of-run cc:log marker ('[RunComplete]'). DIFFERENTIAL: the broken pre-fix run shows N (=7) StoreStep PutIntegrationMessage deliveries interleaved one-per-worker; the fixed run shows exactly 1. TWO CAVEATS for whoever verifies this next: (a) do NOT grep the per-worker deliver's element id (e.g. 'PutWorkerLogMessage') to prove the fix — assembly element ids are not emitted at this log level, so that token is 0 in BOTH broken and fixed runs; count the framework-level 'Calling PutIntegrationMessage within StoreStep' lines (N vs 1) instead. (b) studio-mcp parse_server_log does not surface cc:log / cc:cloud-log lines (xslt_messages.count=0), so verify with direct grep of the raw server log, not the parsed summary.
**Example**:
```xml
<![CDATA[<!-- PER WORKER (inside splitter): append only, no store, no deliver -->
<cc:async-mediation id="DoWriteLog" handle-downstream-errors="true">
  <cc:steps>
    <cc:cloud-log id="CloudLogWorkerResult" level="info"
        message="@{props['CloudLog_Message']}"
        message-details="@{props['CloudLog_Details']}"
        reference-id="props['Employee_ID']"
        variable-name="cloud-log-content"/>   <!-- APPENDS to shared run-scoped var -->
  </cc:steps>
</cc:async-mediation>

<!-- end-of-run store-once, fired AFTER the splitter drains via routes-response-to -->
<cc:local-out id="Call_GetWorkersRAAS" store-message="none"
    routes-response-to="Call_StoreRunLog"
    endpoint="vm://INT999_O_Example_LOA/GetWorkersRAAS"/>
...
<cc:async-mediation id="DoStoreRunLog" routes-to="PutRunLogMessage">
  <cc:steps>
    <cc:store id="StoreRunLogDoc" output="variable" output-variable="run-log-doc-ref"
        input="variable" input-variable="cloud-log-content"
        createDocumentReference="true" expiresIn="P180D"
        title="INT999_LOA_Reconciliation_@{props['Current_Date']}.html"/>
  </cc:steps>
</cc:async-mediation>
<cc:local-out id="PutRunLogMessage" endpoint="vm://wcc/PutIntegrationMessage">
  <cc:set name="is.document.variable.name" value="'run-log-doc-ref'"/>
  <cc:set name="is.document.deliverable" value="'true'"/>
</cc:local-out>]]>
```
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-07-13

### [2026-07-09] MVEL 1.3.13: a semicolon INSIDE a string literal fails the entire deploy with [Error: unterminated literal]
**Category**: MVEL
**Trigger**: A deploy failed on an implementation tenant with 'Error compiling expression … reason: Failed to compile: [Error: unterminated literal] [Near: { … ops[Calc_ExampleField] + … }]'. Every launch died at collection deploy; looked like a data problem (all employees failing) but was a static compile error. Culprit: a cc:expression building CloudLog_Details contained the string literal '; Oracle currently has them as ' — the semicolon inside the quotes.
**Pattern**: Studio's bundled MVEL 1.3.13 treats ';' as a statement separator EVEN INSIDE single-quoted string literals. Any `;` in a string literal ('a; b', '; b', 'b; c' — leading, middle, anywhere) fails compilation of that expression, which fails the whole assembly deploy. Parens and brackets inside strings are FINE ('a (b', ' [Technical: x' all compile). Fix: replace in-string semicolons with a dash or period. Verified by minimal probes against Studio's own jar (mvel-1.3.13-workday.12.jar) and by the subsequent successful deploy. PREVENTION RECIPE (verified): before deploy, extract every cc:expression text + choose-route/@expression + cc:set/@value with ElementTree, then compile each with org.mvel.MVEL.compileExpression() using the jar at /Applications/WorkdayStudio/Eclipse.app/Contents/Eclipse/plugins/com.workday.wtp.cloud.runtime.a_*/script/lib/mvel-1.3.13-workday.*.jar — it reports the exact failing expression with [Near:] context. validate_assembly does NOT catch this (checks XML/routing only). KNOWN BLIND SPOT of the offline check: it compiles fully-qualified java.x.y.z references fine, but Studio's per-message runtime fails to RESOLVE them (see the java.time per-message learning) — offline compile success does not clear FQCN usage.
**Example**:
```xml
BAD (fails whole deploy): props['x'] = 'a' + '; b';   GOOD: props['x'] = 'a' + ' - b';   Offline check: java -cp mvel-1.3.13-workday.12.jar:. CompileTest exprs/  -> "FAIL expr_160.txt :: [Error: unterminated literal]"
```
**Promote to**: all
**Status**: promoted
**Promoted**: 2026-07-13

### [2026-07-09] Read the message body as a string in cc:eval with parts[0].getText() — toString() returns the object handle
**Category**: MVEL
**Trigger**: A run-summary eval needed the aggregated CSV body to count decision tokens. props['Body'] = parts[0].toString() returned 'com.capeclear.assembly.impl.MessageAdapterImpl@12feeaa6' (the object handle), so every count was 0. Diagnosed by javap on capeconnect-esbcore_2.12.jar: MessageAdapterImpl exposes public String getText().
**Pattern**: In cc:eval, parts[0] is a com.capeclear.assembly.impl.MessageAdapterImpl. To get the current message payload as a String use parts[0].getText() (null-guard it). parts[0].toString() gives the object identity string, NOT the content — and it fails silently (string ops run happily against the handle text). Runtime-verified: token counting over an aggregated CSV body worked immediately after switching to getText() (RunComplete SUMMARY showed correct Rows/NOOP/Blocked counts).
**Example**:
```xml
BAD: props['Calc_CsvBody'] = (parts[0] == null) ? '' : parts[0].toString();  -> 'MessageAdapterImpl@12feeaa6'
GOOD: props['Calc_CsvBody'] = (parts[0] == null || parts[0].getText() == null) ? '' : parts[0].getText();
```
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-07-13

### [2026-07-09] cc:xslt-plus binds props to same-named xsl:param — but only String-typed props; object-typed props bind EMPTY
**Category**: XSLT
**Trigger**: A CSV row transform declared &lt;xsl:param name="Current_Date"/&gt; and the column came out blank in every delivered row, even though [RunStart] logged Current_Date=2026-07-01 correctly via @{props['Current_Date']}. The prop held a java.time.LocalDate object (from LocalDate.now()), not a String.
**Pattern**: cc:xslt-plus auto-binds props to same-named xsl:param, but ONLY props whose value is a real java.lang.String. Object-typed props (LocalDate, Long, etc.) bind as EMPTY in the XSL — and the bug is masked because @{props['x']} interpolation in cc:log happily renders the object's toString(). Even MVEL 1.3's x.toString() can retain non-String typing in props. Reliable coercion: props['y'] = '' + props['x']; then pass y to the XSL. Runtime-verified: the blank run_timestamp CSV column populated after switching the XSL param to a prop set via ('' + Current_Date).
**Example**:
```xml
BAD: props['Current_Date'] = java.time.LocalDate.now();  + &lt;xsl:param name="Current_Date"/&gt;  -> param binds empty
GOOD: props['Csv_RunDate'] = ('' + props['Current_Date']);  + &lt;xsl:param name="Csv_RunDate"/&gt;  -> '2026-07-09'
```
**Promote to**: all
**Status**: promoted
**Promoted**: 2026-07-13

### [2026-07-09] RaaS prompt parameters via extra-path query string on cc:workday-out-rest — verified working format
**Category**: HTTP
**Trigger**: A report on a prompted leave data source needed Organizations + a rolling 90-day date window at RaaS call time; hardcoded report defaults went stale (fixed End_Date silently excluded all future leave events).
**Pattern**: Append prompt parameters to the report alias path: extra-path="@{intsys.reportService.getExtrapath('ALIAS')}@{props['Calc_RaasParams']}" where Calc_RaasParams is built in InitializeProperties. Verified working elements: (1) prompt names are the report's 'Label For Prompt XML Alias' values (e.g. Start_Date, End_Date, Include_Subordinate_Organizations); (2) org prompts accept WID via the 'Name!WID=' form: Organizations!WID=<the org WID>; (3) PLAIN ISO dates ('2026-04-10') are accepted — the browser-captured -07:00 TZ suffix is not required; (4) rolling windows computed with instance methods: '' + props['Current_Date'].minusDays(90); (5) make the whole param string conditional on a launch attribute so an empty attribute degrades to the bare alias path (report defaults take over). Runtime-verified: RunStart logged the assembled params and the returned population demonstrably honored the URL window over the report's stored defaults (rows whose dates only qualify under the URL window were present). Ampersands are &amp;amp; in the XML source; '!' needs no escaping.
**Example**:
```xml
props['Calc_RaasParams'] = (props['RaasOrganizationsWID'] == null || props['RaasOrganizationsWID'].toString().trim() == '') ? '' : ('?Organizations!WID=' + props['RaasOrganizationsWID'].toString().trim() + '&amp;Include_Subordinate_Organizations=1&amp;Start_Date=' + props['Current_Date'].minusDays(90) + '&amp;End_Date=' + props['Current_Date']);
```
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-07-13

### [2026-07-09] Oracle REST with an EMPTY query predicate returns arbitrary records — guard each lookup hop on the prior hop's result
**Category**: HTTP
**Trigger**: A worker missing from Oracle (resourceUsers miss → PersonNumber empty) flowed into the next hop, which called .../incentiveCompensationParticipants?q=PersonNumber= with an EMPTY value. Oracle returned an unfiltered page and the xpath extracted the first record's ParticipantId — a real id belonging to a DIFFERENT person. Only a later coincidental block prevented downstream steps from acting on the wrong participant. Empirically confirmed in a shadow run CSV (a row carried a real ParticipantId for a worker not in Oracle at all).
**Pattern**: Never let a chained Oracle Fusion REST lookup fire with an empty predicate value: '?q=Field=' with empty RHS is NOT an error — Oracle returns a default page of ALL records and your extraction happily grabs someone else's ids. In multi-hop chains (user → participant → child rows), derive layered miss flags in the decision eval BEFORE trusting extracted ids: userNotFound = PersonNumber empty; participantNotFound = PersonNumber present AND ParticipantId empty; detailUnresolved = both present AND child lookup failed. Give each its own BlockedReason token so support can see WHICH layer missed. Empty path segments have the same class of problem: .../ParticipantDetails//child/... (empty id between slashes) fires a real HTTP call that 404s — wasted calls + log noise. Structural fix: short-circuit routing after each hop on the miss flag, or at minimum precedence-order the flags so a spurious downstream id can never be used.
**Example**:
```xml
props['Calc_IsBlockedUserNotFound'] = (props['PersonNumber'] == null || props['PersonNumber'] == '') ? 'true' : 'false';
props['Calc_IsBlockedParticipantNotFound'] = (props['Calc_IsBlockedUserNotFound'] == 'false' &amp;&amp; (props['ParticipantId'] == null || props['ParticipantId'] == '')) ? 'true' : 'false';
```
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-07-13

### [2026-07-09] Oracle Fusion Incentive Compensation write behaviors — verified live against a test environment
**Category**: HTTP
**Trigger**: Five write-path unknowns flagged by review (method-override acceptance, empty-string date into DFF, POST response shape, prior-segment auto-close, merge-PATCH semantics) were all exercised by real scoped writes on 2026-07-01/07-08 and verified by next-run re-reads.
**Pattern**: Verified against Oracle Fusion IC REST (fscmRestApi/resources/latest/incentiveCompensationParticipants): (1) DFF updates work as POST + header X-HTTP-Method-Override: PATCH to .../ParticipantDetails/{id}/child/participantDetailsDFF/{id} — accepted, returns 200 with a JSON echo; (2) DFF PATCH is a MERGE: only keys sent change, omitted keys are preserved — BUT on a freshly POSTed ParticipantDetail the DFF starts empty, so merge semantics cannot 'preserve' anything on the create path; (3) sending "" (empty string) for a date-valued DFF attribute (e.g. a leave-end-date segment) is ACCEPTED and clears/blanks the field — next-run read shows it empty, no 400; (4) POST create of a ParticipantDetail returns the new id at JSON path data/ParticipantDetailId (after cc:json-to-xml: root/data/ParticipantDetailId) — validate write success on presence of this echo, and Oracle error envelopes carry a top-level 'title' key (root/title after json-to-xml) even on HTTP 200, so scan for it; (5) POSTing a new ParticipantDetail AUTO-END-DATES the prior open segment — next-run child query with EndDate=null returned exactly ONE open row per worker (no MULTIPLE_OPEN), so no manual close is needed before create.
**Example**:
```xml
Success check after POST (json-to-xml'd): props['NewId'] = parts[0].xpath('root/data/ParticipantDetailId'); created = (NewId != ''). Error check after PATCH: props['ErrTitle'] = parts[0].xpath('root/title'); ok = (ErrTitle == '').
```
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-07-13

### [2026-07-09] Consolidated CSV across a splitter: per-row cc:xslt-plus + cc:aggregator with header-text — survives vm-hop chains
**Category**: Assembly
**Trigger**: Needed one delivered CSV (one row per split element, column header, Excel-ready) alongside the existing consolidated HTML cloud-log. Unknowns: whether cc:aggregator's last-message detection survives each row traversing a chain of vm:// local-out/local-in sub-flows, and how to get a header row. First shadow run answered all of them.
**Pattern**: Runtime-verified recipe (companion to the 2026-06-30 accumulate-then-store-once entry, which covers the cloud-log/HTML variant): (1) per row, a cc:xslt-plus emits ONE CSV line, starting with &amp;#10; so collected rows stack under the header; params are auto-bound String props; RFC-4180-quote every field (wrap in quotes, double internal quotes) and space-prefix leading =+-@ to block Excel formula injection; (2) rows route to a TOP-LEVEL cc:aggregator with force-batch-on-last-message="true", cc:size-batch-strategy batch-size="-1", and cc:message-content-collater with cc:header-text holding the column-header line; (3) on release: cc:store output-mimetype="text/csv" with contentDisposition attachment + title, then deliver via vm://wcc/PutIntegrationMessage with is.document.variable.name/is.document.deliverable. VERIFIED: the batch context survives rows that each traverse 6+ vm:// request-response hops before reaching the aggregator (178-row live runs, single CSV + single HTML both delivered every run); the aggregator chain can then route onward (routes-response-to) into the HTML store-once sub-flow so BOTH artifacts deliver from one run.
**Example**:
```xml
&lt;cc:aggregator id="CollectCsvRows" routes-to="DoFinalizeCsv" force-batch-on-last-message="true"&gt;&lt;cc:size-batch-strategy batch-size="-1"/&gt;&lt;cc:message-content-collater&gt;&lt;cc:header-text&gt;run_timestamp,Employee_ID,...&lt;/cc:header-text&gt;&lt;/cc:message-content-collater&gt;&lt;/cc:aggregator&gt;
```
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-07-13

### [2026-07-09] @mixed positional index formula for assembly-diagram.xml refs: index = 2 x (element position among assembly children) + 1
**Category**: Diagram
**Trigger**: Needed to reference a top-level cc:send-error (GlobalErrorHandler) in a regenerated diagram — send-errors cannot be referenced by id (existing learning), only by //@beans/@mixed.1/@mixed.N. Derived N by reverse-engineering a Studio-generated diagram: its @mixed.19 mapped to DoGetWorkers, which was the 10th element (0-based position 9) of cc:assembly → 2*9+1=19. Confirmed against multiple other refs.
**Pattern**: EMF counts the assembly's @mixed feature as interleaved [whitespace-text, element, whitespace-text, element, ...], so with pretty-printed XML every element at 0-based position k among cc:assembly's child ELEMENTS has mixed index 2k+1. To compute: parse assembly.xml, take the ordered list of cc:assembly's direct children, find your element's position k, ref = assembly.xml#//@beans/@mixed.1/@mixed.{2k+1}. This makes positional refs COMPUTABLE instead of copied-and-prayed. Corollary (matches the earlier 'shift by 2N' learning): inserting/removing a top-level element before position k shifts the index by 2 per element — so regenerate the ref (or the whole diagram) after structural edits. Rendered correctly in Studio: the computed ref placed GlobalErrorHandler with coordinates and inside a named swimlane, with its routesTo connection drawn.
**Example**:
```xml
children = list(assembly_element); k = children.index(target); ref = f"assembly.xml#//@beans/@mixed.1/@mixed.{2*k+1}"
```
**Promote to**: all
**Status**: promoted
**Promoted**: 2026-07-13

### [2026-07-09] Diagram legibility: vm:// local-out/local-in hops are never drawn — insert adjacent local-outs to eliminate cross-canvas arrows
**Category**: Diagram
**Trigger**: Two route sub-routes targeted steps in distant regions (a shared terminator mediation and a patch-entry local-out), producing canvas-crossing arrows that no repositioning could fix — one target had multiple far-apart feeders, so SOME arrow was always long.
**Pattern**: Studio draws connections only for routes-to / routes-response-to; vm:// local-out → local-in pairs are logical links with NO arrow. So when a step has multiple distant feeders, give EACH feeder its own small cc:local-out placed right beside it, all pointing at one vm endpoint whose cc:local-in routes to the real target: the drawn arrows become tiny feeder→local-out hops and the long spans vanish into the invisible vm link. Flow semantics are unchanged (same request-response vm pattern the assembly already uses between sub-flows; store-message="none", no routes-response-to on the fan-in local-outs). Cost: two extra elements per distant feeder. This is a deliberate assembly refactor for readability — name the local-outs by intent (Call_Phase5Skip, Call_Phase5Done → vm://.../Phase5NoOp). Also verified while doing this: swimlane MEMBERSHIP can override a member's explicit x/y during render — keep free-floating positioned nodes OUT of swimlane elements lists if their coordinates must stick.
**Example**:
```xml
&lt;cc:local-out id="Call_Phase5Skip" store-message="none" endpoint="vm://INT/Phase5NoOp"/&gt; (placed beside feeder A)
&lt;cc:local-out id="Call_Phase5Done" store-message="none" endpoint="vm://INT/Phase5NoOp"/&gt; (placed beside feeder B)
&lt;cc:local-in id="Phase5NoOp" routes-to="DoPhase5NoOpTerminator"/&gt;
```
**Promote to**: patterns.md
**Status**: promoted
**Promoted**: 2026-07-13

### [2026-07-09] REFINEMENT to java.time per-message rule: bootstrap-context (InitializeProperties) tolerates FQCN even inside ternary branches
**Category**: MVEL
**Trigger**: Timezone-pinned Current_Date was implemented as a TERNARY whose branches both contain fully-qualified java.time calls — including a nested one: (tz empty) ? java.time.LocalDate.now() : java.time.LocalDate.now(java.time.ZoneId.of(tz)). Per the 2026-06-28 VERIFIED learning this shape fails in per-message contexts; it was deployed in the bootstrap InitializeProperties eval and executed the ZoneId branch successfully in three consecutive live runs (RunStart logged the correct tz-pinned date each time).
**Pattern**: The 2026-06-28 rule ('avoid java.time statics in per-message contexts') stands unchanged for per-message evals — a per-message LocalDate.parse() inside a ternary was caught pre-deploy today ONLY because the rule was in this file (offline MVEL compile passes on FQCNs; the failure is Studio's runtime resolution, so the compile-check recipe cannot catch it — grep per-message evals for 'java.' as a separate review step). NEW data point: in the run-scoped bootstrap context (InitializeProperties, executed once per run), FQCN java.time calls work even nested inside ternary branches and as method arguments (ZoneId.of inside now()). So the practical rule: bootstrap eval = FQCN allowed (still keep it simple); per-message eval = NO FQCN anywhere, use instance methods on objects already stored in props (e.g. build an arbitrary LocalDate from an ISO string without parse(): Current_Date.withDayOfMonth(1).withYear(Integer.parseInt(iso.substring(0,4))).withMonth(...).withDayOfMonth(...) — java.lang simple names like Integer/Long resolve fine per-message, verified in production).
**Example**:
```xml
Per-message safe date construction from ISO string (no FQCN): props['EpStartDate'] = props['Current_Date'].withDayOfMonth(1).withYear(Integer.parseInt(props['Iso'].substring(0, 4))).withMonth(Integer.parseInt(props['Iso'].substring(5, 7))).withDayOfMonth(Integer.parseInt(props['Iso'].substring(8, 10)));
```
**Promote to**: all
**Status**: promoted (patterns.md MVEL section + eval step reference + validator rule JAVA_TIME_IN_PER_MESSAGE_EVAL)
**Promoted**: 2026-07-13

### [2026-08-06] cc:integration-system children are an xsd:sequence — order is mandatory
**Category**: Schema
**Trigger**: Opening a freshly scaffolded project in Studio produced: cvc-complex-type.2.4.a: Invalid content was found starting with element '{"urn:com.workday/esb/cloud/10.0":attribute-map-service}'. One of '{...retrieval-service, ...report-service, ...listener-service, ...}' is expected. The elements were all individually legal — only their order was wrong.
**Pattern**: The children of cc:integration-system are declared as an xsd:sequence in Studio's integration-system.xsd, so their order is MANDATORY, not stylistic. The required order is: param, attribute-map-service, sequence-generator-service, transaction-log-service, delivery-service, retrieval-service, report-service, listener-service, custom-object-service, service-reference, data-initialization-service. Any other order fails schema validation on Studio open. The error message is misleading: it names the element it rejected and lists only the elements still legal at that position, which makes it look like the named element is unsupported when in fact it merely came too late. Read the "One of {...}" list as "everything from here onward in the sequence" — if the rejected element is absent from that list, it belongs EARLIER, not later. Two consequences worth remembering: cloud:param must precede every service element, and attribute-map-service must precede retrieval-service, report-service and listener-service. Verified against integration-system.xsd in the Studio install (plugins/com.workday.sh.common.ui_&lt;version&gt;/schemas/assembly/) and confirmed by schema-validating generated assemblies with javax.xml.validation against Studio's own assembly.xsd — four scaffold combinations failed before reordering and all four passed after.</pattern>
<parameter name="example">&lt;!-- INVALID — attribute-map-service after retrieval-service --&gt;
&lt;cc:integration-system name="INT999"&gt;
  &lt;cloud:retrieval-service name="INT999_Retrieval"/&gt;
  &lt;cloud:attribute-map-service name="INT999_Attributes"&gt;...&lt;/cloud:attribute-map-service&gt;
&lt;/cc:integration-system&gt;

&lt;!-- VALID — schema sequence order --&gt;
&lt;cc:integration-system name="INT999"&gt;
  &lt;cloud:param name="Effective Date"&gt;...&lt;/cloud:param&gt;
  &lt;cloud:attribute-map-service name="INT999_Attributes"&gt;...&lt;/cloud:attribute-map-service&gt;
  &lt;cloud:retrieval-service name="INT999_Retrieval"/&gt;
  &lt;cloud:report-service name="INT999_Reports"&gt;...&lt;/cloud:report-service&gt;
  &lt;cloud:listener-service name="INT999_Listener"/&gt;
&lt;/cc:integration-system&gt;
**Promote to**: all
**Status**: raw

### [2026-08-06] Studio projects need ws/META-INF/MANIFEST.MF
**Category**: Assembly
**Trigger**: A scaffolded project was compared file-by-file against hand-built projects in the same workspace. Every project created through Studio itself had ws/META-INF/MANIFEST.MF; the scaffolded one did not.
**Pattern**: A Workday Studio project carries a JAR-style manifest at ws/META-INF/MANIFEST.MF alongside ws/WSAR-INF/. Studio creates it automatically; any tool that scaffolds a project directory by hand must create it too, or the project diverges from what Studio produces and the WSAR packaging step has no manifest to build from. The content is minimal but format-sensitive: the JAR manifest spec requires CRLF line endings, a trailing space after "Class-Path:", and a blank line at the end. Do not normalise it to LF or strip the trailing whitespace. Checked across multiple hand-built projects in one workspace — the file was byte-identical in all of them.
**Example**:
```xml
ws/META-INF/MANIFEST.MF  (CRLF line endings, note the space after Class-Path:)

Manifest-Version: 1.0
Class-Path: 

Full expected project layout:
  .project  .classpath  .settings/
  src/main/java/
  build/classes/
  ws/META-INF/MANIFEST.MF
  ws/WSAR-INF/assembly.xml
  ws/WSAR-INF/assembly-diagram.xml
```
**Promote to**: patterns.md
**Status**: raw
