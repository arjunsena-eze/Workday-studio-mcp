# AGENTS.md — read this first

Entry point for **any** AI coding agent working on Workday Studio integrations with this
repo as its knowledge base. Written for cross-tool use: Claude Code, Codex, Cursor, Aider,
Gemini, GLM, Kimi, or a chat session with plain file access.

If your tool reads `CLAUDE.md` instead, read that too — it covers contributing *to this
MCP server*. **This** file covers using the repo's knowledge to *build and fix Studio
integrations*, which is a different job.

---

## 1. Orient yourself in 30 seconds

This repo is three things:

| | What | Where |
|---|---|---|
| **Curated rules** | Reviewed, cross-cutting Studio patterns | `docs/studio-integration-patterns.md` |
| **Raw field findings** | Unreviewed, newest-first; **may correct the curated rules** | `learnings.md` |
| **Tooling** | MCP server: read/write/validate assemblies | `src/tools/` |

**Without MCP support**, you still have everything: read those two markdown files directly.
`learnings.md` uses `### [YYYY-MM-DD] Title` entries with `**Category**`, `**Trigger**`,
`**Pattern**` fields — grep it for the literal error text you are facing.

**With MCP support**, prefer the tools; they index and filter for you:

| Tool | Use it for |
|---|---|
| `search_learnings` | An error you have not seen. **Search the literal error text.** |
| `get_patterns` | Cross-cutting rules — diagram math, MVEL, XSLT, RAAS, HTTP |
| `get_step_type_reference` | One `cc:*` / `cloud:*` element |
| `validate_assembly` | **Before every deploy.** Non-negotiable. |
| `parse_server_log` | A failed run's server log |
| `log_learning` | Anything you discovered that is not already documented |

---

## 2. Non-negotiable rules

These are not style preferences. Each one below has cost a real deploy cycle.

### Search before you theorise

When you hit an unfamiliar error, look it up **before** forming a hypothesis. Use
`search_learnings` with a distinctive fragment of the literal error text, then
`get_patterns`. A previous session may have already paid for this answer.

> This rule exists because a session hit a `cvc-complex-type.2.4.a` ordering error and
> rediscovered the rule from the raw XSDs — while the answer sat in `learnings.md`, logged
> the same day. Grep first. It costs one tool call.

### Validate before every deploy

Run `validate_assembly`. It now includes two schema-derived checks that catch errors Studio
only reveals on open: `SCHEMA_SEQUENCE_ORDER` and `MVEL_BRACE_IMBALANCE`. A deploy cycle
costs minutes; the check costs a second.

### Close the Studio editor before editing files externally

Eclipse does not re-read a file from disk while an editor is open on it. If `assembly.xml`
is open in Studio and you write to it, Studio's next save **silently overwrites your
change** and the error you just fixed comes back. Sequence: close the tab (choosing *Don't
Save*), refresh (F5), edit, reopen, verify, deploy. Tell the user to do this — you cannot
do it for them.

### Never guess where runtime data lives — log it

Before writing xpath or field extraction, emit the actual payload with `cc:log` +
`cc:message-content` and read it. Studio's silent failures make this essential:
`parts[0].xpath()` on a non-matching path returns **empty string**, not an error, so a
wrong path produces a well-formed request full of blanks and an error that describes the
blanks rather than the path.

### Diagram `@mixed` indices are positional — recompute, never eyeball

In a comment-free `assembly.xml`, the element at 0-based position `k` among `cc:assembly`'s
child elements is `@mixed.(2k+1)`. Inserting or removing a top-level element shifts every
later index by ±2. Get it wrong and Studio dies with `scala.MatchError` on open. After any
structural edit, resolve every positional ref back to its intended target and check it
against the connection's `<target>`. See `get_patterns topic="Diagram Rules"`.

### No XML comments in `assembly.xml`

Comments occupy `@mixed` slots and break the `2k+1` arithmetic. Put explanation in the
project README instead.

### Control-test any check before trusting a clean result

A validator that silently validates nothing also reports zero errors. Before believing a
pass, feed it a known-bad input and confirm it fails. This applies to your own ad-hoc
scripts as much as to the repo's tests.

### Generalise before logging

`learnings.md` is **public** and shared across clients. Never log integration IDs, project
or client names, tenant or host names, custom field names, WIDs, or run/log identifiers.
Use `INT999` and `<TENANT>`. Describe provenance as "verified in a live run". The pattern
is the value; where it came from is not.

---

## 3. Building a new integration

1. **Gather requirements before generating anything.** Trigger, data source, destination,
   record volume, external auth, error-handling policy, partial-failure behaviour. Ask;
   don't assume. Wrong assumptions here cause rework that touches every file.
2. `get_patterns topic="Mandatory Build Process"` — skeleton assembly first, skeleton
   diagram second, then fill sub-flows one at a time.
3. Write `assembly.xml` comment-free.
4. Write `assembly-diagram.xml` with computed indices; verify each ref resolves.
5. `validate_assembly` until clean.
6. Deploy, run, **read the server log**, and log anything new with `log_learning`.

Design for partial failure from the start: a per-record `cc:send-error` that records and
continues beats a batch that aborts halfway, because Workday REST has no transaction
rollback and you will otherwise get a partial write plus a hard failure.

---

## 4. Fixing someone else's broken integration

1. **Read before changing.** `list_project_files`, then the assembly and diagram in full.
2. `validate_assembly` for a fast structural baseline.
3. Get the **server log** for a failed run, not just the UI error message. The UI shows the
   handler's summary; the log shows the cause, the actual payloads, and the framework lines
   around it.
4. Look up each distinct error in `docs/diagnosing.md`, then `search_learnings`.
5. Fix one cause at a time and re-validate. Several errors often share one root.
6. Report what you changed and what you did **not** — and state which conclusions came
   from evidence versus inference.

---

## 5. Honesty rules that matter here

Studio's error messages are frequently misleading — they name the symptom, not the cause,
and sometimes name the wrong subsystem entirely (`Unable to retrieve OAuth bearer token`
wrapping a plain 404 is the canonical example). Consequences:

- **Distinguish verified from inferred.** If you have not seen a log line confirming it,
  say so. "This is my leading hypothesis, confirm with the log" is worth more than a
  confident wrong diagnosis that sends someone auditing credentials for an hour.
- **Do not stack speculative fixes.** Change one thing, redeploy, read the log. Two
  simultaneous guesses make the result uninterpretable.
- **Report failures with the actual output.** If tests fail or a step was skipped, say
  that plainly.

---

## 6. Keeping this repo intelligent

The feedback loop is the point. When you discover something:

- New finding → `log_learning`.
- A curated source is **wrong** → `log_learning` with the `corrects` field naming the stale
  source. These are the highest-value entries in the file. "Already documented" is only a
  reason to skip when the existing documentation is *correct*.
- Then tell the user to commit it, so the next session — on any machine, in any tool —
  starts ahead of where you started.
