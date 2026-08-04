# Quick reference

A single-page digest of what this MCP exposes and the rules that bite hardest when building
Studio integrations. For the full detail see [`studio-integration-patterns.md`](studio-integration-patterns.md);
for setup see the [README](../README.md).

---

## Verify an install

```bash
npm test          # 69 tests, node:test, zero deps
node src/index.mjs   # should print: [studio-mcp] Server started. Workspace: <path>
claude mcp list      # studio-mcp should report Connected
```

Point it at a different workspace by editing `workspace_path` in `config.json`, or by setting
`STUDIO_WORKSPACE_PATH` (the env var wins over the file).

---

## The 26 tools

**Navigation** — `list_studio_projects`, `list_project_files`, `read_integration_file`,
`search_studio_files`, `get_workspace_structure`

**Files** — `write_integration_file`, `copy_file_from_project`, `rename_file`,
`delete_file`, `validate_xml_file`

**Project setup** — `create_studio_project`, `create_xsl_transform`

**Assembly editing** — `list_assembly_steps`, `list_integration_params`,
`add_assembly_step`, `update_sub_flow`, `rename_steps`, `delete_assembly_step`,
`validate_assembly`

**Planning / lifecycle** — `plan_integration` (design elicitation → skeleton generator),
`get_workflow` (where an integration stands + the single next action)

**Reference** — `get_step_type_reference`, `lookup_soap_operations`, `get_patterns`

**Diagnostics** — `parse_server_log` (auto-finds the newest `server-*.log` in `~/Downloads`)

**Knowledge capture** — `log_learning` (appends to `learnings.md`)

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

What `validate_assembly` can raise — worth knowing so you also know what it does *not* catch:

```
BROKEN_ROUTES_TO             BROKEN_ROUTES_RESPONSE_TO    UNRESOLVED_LOCAL_IN
CC_NOTE_IN_ASSEMBLY          XML_COMMENTS_PRESENT         ELEMENT_INSIDE_STEPS
SPLITTER_HAS_ROUTES_TO       LOG_HAS_CONDITION            SOAP_WITH_EXTRA_PATH
RAAS_VIA_SOAP                MISSING_ATTR_{URL,ENDPOINT,APPLICATION,VERSION,EXTRA_PATH}
MISSING_XSL_FILE             XSL_PARAM_OBJECT_PROP        MVEL_SEMICOLON_IN_STRING
JAVA_TIME_IN_PER_MESSAGE_EVAL
STALE_DIAGRAM_HREF           DIAGRAM_MISSING_ELEMENT      SEND_ERROR_ID_IN_DIAGRAM
POSITIONAL_REF_EVEN_INDEX    POSITIONAL_REF_OUT_OF_RANGE  SWIMLANE_REF_FRAGMENT_FORM
CROWDED_VERTICAL_SWIMLANE    REDUNDANT_VM_DISPATCH_ARROW  TODO_STUBS_REMAINING
```

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
