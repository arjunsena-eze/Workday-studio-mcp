# Quick reference

A single-page digest of what this MCP exposes and the rules that bite hardest when building
Studio integrations. For the full detail see [`studio-integration-patterns.md`](studio-integration-patterns.md);
for setup see the [README](../README.md).

---

## Verify an install

```bash
npm test          # 109 tests, node:test, zero deps
node src/index.mjs   # should print: [studio-mcp] Server started. Workspace: <path>
claude mcp list      # studio-mcp should report Connected
```

Point it at a different workspace by editing `workspace_path` in `config.json`, or by setting
`STUDIO_WORKSPACE_PATH` (the env var wins over the file).

---

## The 29 tools

Each tool's full description (the text Claude reads when choosing a tool) lives at the top of
its file in [`src/tools/`](../src/tools/).

**Navigate (7)**

| Tool | What it does |
|---|---|
| `list_workspaces` | Lists the configured workspace profiles and which one is active |
| `set_active_workspace` | Switches to another workspace profile for the rest of the session |
| `get_workspace_structure` | Directory tree of the workspace, or of one project (pass `project_name` on large workspaces) |
| `list_studio_projects` | Every project, with last-modified time and transform count |
| `list_project_files` | Files in one project, focused on `ws/WSAR-INF/` |
| `read_integration_file` | Reads one file |
| `search_studio_files` | Case-insensitive text search across all projects |

**Plan and track (3)**

| Tool | What it does |
|---|---|
| `plan_integration` | Collects the full design brief, then generates a skeleton assembly, diagram and `aidlc-docs/` |
| `get_workflow` | Where an integration stands and the single next action (`retrofit=true` for older projects) |
| `create_studio_project` | Scaffolds an empty project with a blank `assembly.xml` that opens in Studio |

**Build and edit (11)**

| Tool | What it does |
|---|---|
| `add_assembly_step` | Inserts a step and rewires the predecessor's `routes-to` |
| `update_sub_flow` | Replaces the `cc:steps` body of a named sub-flow (fills TODO stubs) |
| `rename_steps` | Renames a step ID in `assembly.xml` and `assembly-diagram.xml` together |
| `delete_assembly_step` | Deletes a step from both files together |
| `list_assembly_steps` | Every step with ID, type and routing, without reading the whole file |
| `list_integration_params` | Launch parameters and integration attributes on StartHere |
| `write_integration_file` | Writes a file after an XML well-formedness check, with a `.bak` backup |
| `create_xsl_transform` | Blank XSLT 2.0 file with Workday namespaces |
| `copy_file_from_project` | Copies a file (usually an XSL) between projects |
| `rename_file` | Renames a file; refuses the core project files |
| `delete_file` | Deletes a file with a `.bak` backup; refuses the core project files |

**Validate (2)**

| Tool | What it does |
|---|---|
| `validate_assembly` | The 31 Studio-specific checks listed under [Validator rule codes](#validator-rule-codes) |
| `validate_xml_file` | Well-formedness of any XML or XSLT file, with line and column |

**Reference (3)**

| Tool | What it does |
|---|---|
| `get_step_type_reference` | Confirmed XML examples and rules for 35 step types |
| `lookup_soap_operations` | Application name, operations and WSDL link for 38 SOAP services |
| `get_patterns` | The curated patterns guide, by section or keyword |

**Learn and diagnose (3)**

| Tool | What it does |
|---|---|
| `parse_server_log` | Focused errors from a `server-*.log` (auto-finds the newest in `~/Downloads`) |
| `log_learning` | Records a new gotcha in `learnings.md` (or the private overlay) |
| `search_learnings` | Searches the recorded learnings |

---

## Driving it

### Build a new integration

> "I need to build a new integration"

`plan_integration` will not scaffold until the design brief is complete. It asks for:

| Field | Options |
|---|---|
| `data_source` | `raas` · `soap-get` · `inbound-file` · `webhook` · `external-rest` · `multiple` |
| `data_destination` | `workday-soap-write` · `workday-rest-write` · `external-rest` · `file-delivery` · `email-only` · `multiple` |
| `trigger` | `scheduled` · `event-driven` · `launch-params-manual` · `inbound-file` |
| `record_volume` | `single` · `small` (<100, xpath-splitter) · `large` (>100, **must** use `xml-stream-splitter`) |
| `external_auth` | `none` · `oauth2` · `basic` · `api-key` |
| `error_handling` | `integration-messages` (always) + `email-notification` / `rethrow` |
| plus | `raas_reports[]`, `soap_operations[]`, `integration_attributes[]`, `conditional_logic`, `notes` |

Output: a skeleton `assembly.xml` + matching `assembly-diagram.xml` that opens in Studio
immediately, plus an `aidlc-docs/` folder at the project root:

```
<project>/aidlc-docs/
  ├── plan.md      # design brief, per-sub-flow prop contracts, gaps, tenant handoff checklist
  └── state.json   # lifecycle state — sub-flow status, decisions log
```

Regenerating preserves `created` and the `decisions` log. **Attribute names are recorded,
never credential values.** Commit `aidlc-docs/` alongside the integration.

### Resume work

> "What's the status of INT999_Employee_Sync?"

`get_workflow` reads `state.json` — phase, which sub-flows are real vs TODO stubs, last
validation result, next action, without reading the XML. For projects that predate
`aidlc-docs/`, call it with `retrofit=true` to derive state from the existing assembly.

### Fill in one sub-flow

> "Fill in the GetWorkers sub-flow — here's the RAAS sample: [paste XML]"

`update_sub_flow` surgically replaces the TODO stub and validates the result.

### Rename or delete a step — never by hand

`rename_steps` and `delete_assembly_step` update `assembly.xml` **and** every href in
`assembly-diagram.xml` atomically. Editing only one file crashes Studio's diagram view.

### Validate

> "Validate the assembly for INT145"

Or use the packaged `/validate-integration INT145` command — it loops
validate → read → fix → write until clean, bailing if the same error repeats 3×.

---

## Validator rule codes

The 31 checks `validate_assembly` can raise — worth knowing so you also know what it does
*not* catch. 29 live in [`src/assembly-validator.mjs`](../src/assembly-validator.mjs); the two
schema-derived ones live in [`src/schema-validator.mjs`](../src/schema-validator.mjs) and are
generated from the XSDs that ship with Studio.

Severity: **ERROR** — Studio rejects it or the deploy fails · **WARNING** — fails at runtime ·
**INFO** — awareness. The rules come from failures seen in real builds.

| Area | Code | Severity | Catches |
|---|---|---|---|
| Routing and structure | `BROKEN_ROUTES_TO` | ERROR | `routes-to` points at an id that does not exist |
| | `BROKEN_ROUTES_RESPONSE_TO` | ERROR | `routes-response-to` points at an id that does not exist |
| | `UNRESOLVED_LOCAL_IN` | WARNING | `vm://` call to a `cc:local-in` that is missing or misspelled |
| | `ELEMENT_INSIDE_STEPS` | ERROR | A top-level element nested inside `cc:steps` |
| | `SPLITTER_HAS_ROUTES_TO` | ERROR | `routes-to` on a `cc:splitter` (schema-invalid) |
| | `CC_NOTE_IN_ASSEMBLY` | ERROR | `cc:note` in the assembly (schema-invalid, crashes the diagram) |
| | `SCHEMA_SEQUENCE_ORDER` | ERROR | Child elements out of the order the Studio XSD requires |
| Diagram sync | `STALE_DIAGRAM_HREF` | ERROR | Diagram references an id that no longer exists (`scala.MatchError` on open) |
| | `DIAGRAM_MISSING_ELEMENT` | WARNING | Assembly element with no diagram entry |
| | `XML_COMMENTS_PRESENT` | ERROR | XML comments, which shift every `@mixed` index |
| | `POSITIONAL_REF_EVEN_INDEX` | ERROR | Even `@mixed` index in a diagram href |
| | `POSITIONAL_REF_OUT_OF_RANGE` | ERROR | `@mixed` index past the last element |
| | `SEND_ERROR_ID_IN_DIAGRAM` | ERROR | `cc:send-error` referenced by id (crashes the diagram) |
| | `SWIMLANE_REF_FRAGMENT_FORM` | WARNING | Malformed swimlane reference |
| | `CROWDED_VERTICAL_SWIMLANE` | INFO | Several work units crammed into one vertical swimlane |
| | `REDUNDANT_VM_DISPATCH_ARROW` | INFO | Drawn `vm://` arrow that Studio never draws itself |
| Required attributes | `MISSING_ATTR_APPLICATION` | ERROR | `cc:workday-out-soap` without `application=` |
| | `MISSING_ATTR_VERSION` | ERROR | `cc:workday-out-soap` without `version=` |
| | `MISSING_ATTR_EXTRA_PATH` | ERROR | `cc:workday-out-rest` without `extra-path=` |
| | `MISSING_ATTR_ENDPOINT` | ERROR | `cc:http-out` without `endpoint=` |
| | `MISSING_ATTR_URL` | ERROR | `cc:xslt-plus` without `url=` |
| | `MISSING_XSL_FILE` | WARNING | Referenced XSL file not found in `WSAR-INF` |
| | `XSL_PARAM_OBJECT_PROP` | WARNING | Object-typed prop bound to an `xsl:param` (arrives empty) |
| Right Workday call | `RAAS_VIA_SOAP` | ERROR | A report called over SOAP; RAAS must use `cc:workday-out-rest` |
| | `SOAP_WITH_EXTRA_PATH` | ERROR | `extra-path` on `cc:workday-out-soap` |
| | `LOG_HAS_CONDITION` | ERROR | `condition` on `cc:log`; use `cc:cloud-log` |
| MVEL | `MVEL_SEMICOLON_IN_STRING` | ERROR | `;` inside a string literal (fails the whole deploy) |
| | `MVEL_BRACE_IMBALANCE` | ERROR | Unbalanced `{` `}` in an MVEL value |
| | `JAVA_TIME_IN_PER_MESSAGE_EVAL` | WARNING | `java.time` statics in a per-message eval (fails at runtime) |
| Completeness | `TODO_STUBS_REMAINING` | INFO | Sub-flows still holding TODO stubs |
| | `TODO_PLACEHOLDERS_REMAINING` | INFO | Tenant placeholders still to replace before deploy |

---

## Step types in `get_step_type_reference`

`workday-in` `transform` `xslt-plus` `http-out` `workday-out-rest` `workday-out-soap`
`local-out` `local-in` `async-mediation` `splitter` `json-splitter`
`xml-stream-splitter` `decision` `route` `sub-assembly` `note` `eval` `send-error`
`log-error` `cloud-log` `xml-to-csv` `csv-to-xml` `json-to-xml` `copy` `set` `set-headers`
`validate-exp` `aggregator` `xslt` `write` `store` `base64-encode` `email-out` `custom`
`decorations` `ssk-component-pattern`

Each entry returns confirmed XML examples, `routes_via`, schema rules, and gotchas.

---

## SOAP catalog (`lookup_soap_operations`) — WWS v46.1 / 2026R1

38 services with common operations and WSDL links:

- **HCM Core** — `Human_Resources`, `Staffing`, `Compensation`, `Talent`,
  `Performance_Management`, `Recruiting`, `Learning`, `Flex_Team`, `Adoption`
- **Payroll** — `Payroll`, `Payroll_Interface` ⚠️ (the correct service for outbound
  pay-result extracts — *not* `Payroll`), `Payroll_GBR`, `Payroll_AUS`
- **Benefits & Time** — `Benefits_Administration`, `Benefits_Partner_Program_Integrations`,
  `Absence_Management`, `Time_Tracking`
- **Financials** — `Financial_Management`, `Revenue_Management`, `Cash_Management`,
  `Resource_Management`, `Inventory`, `Requests`, `Settlement_Services`,
  `Compensation_Review`, `Professional_Services_Automation`
- **Student** — `Academic_Foundation`, `Academic_Advising`, `Admissions`, `Student_Core`,
  `Student_Records`, `Student_Finance`, `Student_Transfer_Credit`, `Student_Recruiting`
- **Platform** — `Integrations`, `Prism_Analytics`, `Workday_Connect`,
  `ACA_Partner_Integrations`

---

## The rules that bite hardest

Distilled from [`studio-integration-patterns.md`](studio-integration-patterns.md). Pull any
section live with `get_patterns` — no args for the index, `topic="Diagram Rules"` for a
section, `search="swimlane"` by keyword.

**Build order is mandatory** — requirements → plan sub-flows → skeleton `assembly.xml` (all
routing, steps as `cc:log` stubs) → skeleton `assembly-diagram.xml` → fill sub-flows one at a
time, opening Studio after each. Skipping planning means diagram rewrites, swimlane surgery,
and broken EMF XPath indices.

**Diagram / assembly sync is manual and unforgiving**

- `assembly-diagram.xml` EMF XPath indices **count whitespace and comments**. Inserting a
  top-level element shifts every `@mixed` positional ref by 2N.
- Adding a component requires **three** diagram entries; removing needs all three mirrored.
- `cc:send-error` can never be a diagram node by ID — it must be referenced via `@mixed` XPath.
- Renaming a step ID requires the identical rename in both files. Use `rename_steps`.
- Never insert a swimlane between existing ones (it shifts every `#//@swimlanes.N` ref).
  Don't delete swimlanes — empty them.
- Add new `cc:local-out` at the **end** of the assembly to avoid the index cascade.

**Schema gotchas**

- `cc:note` is schema-invalid inside `cc:assembly` — don't use it as a terminal marker.
- `cc:splitter` has no `routes-to`. A per-record `cc:local-out` from a splitter has no
  `routes-response-to`.
- `xsl:param` names cannot contain dots.
- `cc:log` does not accept `condition` — use `cc:cloud-log`, or compute status in `cc:eval`.
- Every `cc:async-mediation` needs its **own** `cc:send-error`. (An earlier
  "consolidate to one handler" learning was explicitly reversed — see `learnings.md`.)
- **XML position does not define execution order** — always update `routes-to` when inserting
  a step.

**MVEL**

- Use CDATA for comparison operators and multi-statement blocks.
- `props['map'].method(complexExpr)` fails inside if/else.
- A semicolon inside a string literal fails the whole deploy.
- `java.time` statics fail in per-message evals (bootstrap-only) — use Java `Calendar` for
  date arithmetic.
- `parts[0].getText()` for the message body; `toString()` returns the object handle.
- `#` is concatenation in attribute values.
- JSON nulls arrive as the literal string `"null"`, not Java null — so compare with `== ''`
  in `execute-when` rather than null/empty checks.

**RAAS** — use `cc:workday-out-rest`, **never** `cc:workday-out-soap`. Declare report aliases
in `cc:workday-in` before `getExtrapath()` works. `format=simplexml` strips namespace
prefixes. Handle the zero-record case explicitly.

**XSLT** — only String-typed props bind to `xsl:param`; object-typed props bind **empty**.
`cc:json-to-xml` adds a synthetic `<root>` wrapper.

**PECI** — the event code `-R` suffix means **Rescind**, not Rehire.

---

## Capturing new findings

When something undocumented turns up mid-session, `log_learning` appends it to `learnings.md`
(append-only intake, `**Status**: raw`). `/promote-learnings` moves raw entries into
`studio-integration-patterns.md` and, for element-scoped rules, into
`get-step-type-reference.mjs`. Don't hand-edit the curated patterns doc during a session.

`get_patterns` reads the curated doc **live**, so promoting a rule reaches every user of the
MCP without a redeploy.

---

## Tenant-aware tools are deliberately excluded

The public MCP is file-ops only. Tenant tools (SOAP launch/poll, fetch document URL, ISU
credentials) belong in a gitignored `src/local-extensions.mjs` exporting
`registerLocalTools(server)` — `src/index.mjs` auto-loads it at boot and reports the count in
its startup line. Already gitignored: `local-extensions.mjs`, `workday-soap.mjs`,
`launch-integration-event.mjs`, `watch-integration-event.mjs`, `fetch-server-log.mjs`,
`.studio-mcp/`, `credentials.json`.

---

## Windows notes

- Cloning into a deep path (e.g. a synced OneDrive folder) can fail with
  `fatal: '$GIT_DIR' too big`. Keep the repo in a short path under your user profile.
- `npm test` fails two suites until `config.json` exists — they load the real config module.
- Use escaped backslashes in `config.json`:
  `"workspace_path": "C:\\Users\\<you>\\workspace"`.
