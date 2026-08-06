# Instructions for Claude

This file is loaded automatically by Claude Code (and respected by Claude.ai when this repo is the active context). It tells Claude how to work in this codebase and — more importantly — how to keep the shared knowledge base growing.

> **Building or fixing a Studio integration rather than working on this server? Read [`AGENTS.md`](AGENTS.md) first.**
> It is the tool-agnostic entry point covering the non-negotiable rules for Studio work, how to
> reach this repo's knowledge with or without MCP support, and the diagnosis workflow. This file
> is about contributing to the MCP itself — a different job. Both apply if you are doing both.

---

## What this repo is

A Node.js MCP server that gives Claude file-level access to a Workday Studio workspace. It is **strictly local** — no network calls, no tenant credentials, no telemetry. Every tool reads or writes files under the workspace path the user configured in `config.json`.

If a teammate is reading this, the MCP is the second half of a workflow: Claude designs / writes / validates the assembly XML, then the human opens it in Studio. The MCP is the bridge that eliminates copy-paste.

---

## How to be useful in this repo

### When asked to add a new tool

1. Tools live in `src/tools/<tool-name>.mjs` and export `register(server)`.
2. Register the new tool in `src/index.mjs` under the appropriate section comment.
3. Use `zod` schemas for inputs. Match the existing error-shape: `{ error: true, code, message, suggestion }` returned as JSON inside the MCP `text` content.
4. Path traversal: every file write or read must go through `resolveSafe()` from `src/fs.mjs`.
5. Bump the version in `package.json` if the tool count changes.

### When asked to extend an existing tool

- Read the entire tool file first. Many tools have non-obvious helper functions or branch logic at the bottom.
- The `get_step_type_reference` tool is the documentation surface — adding a new step type should also include `xml_example`, `routes_via`, and `gotchas` if known.

### When asked to fix a bug

1. Reproduce with a small input first if possible.
2. Run the smoke test: `node src/index.mjs` should start without errors.
3. Don't add dependencies to fix bugs — this repo intentionally has a tiny dep list.

---

## Capturing learnings — the two-tier system

There are two files. Use both correctly.

### Tier 1 — `learnings.md` (intake queue)

**This is where you write during a session.** It is append-only, unreviewed, and low-friction.

When you discover a new Studio pattern, schema rule, or gotcha while helping a teammate:

1. Append an entry to `learnings.md` using the format in that file.
2. Tell the user: "I've logged this to learnings.md — commit it when you're done and it'll get promoted to patterns.md in the next review."

**Write here if any of these happen:**
- A build fails with an error that wasn't in patterns.md
- Studio behaves unexpectedly (schema rejection, diagram crash, MVEL exception)
- You discover a workaround for something that had no documented fix
- A tool or element behaves differently than the step-type reference says

**Do not:** edit `docs/studio-integration-patterns.md` directly during a session. That doc is curated. `learnings.md` is the intake queue.

### Tier 2 — `docs/studio-integration-patterns.md` (curated reference)

This is the reviewed, structured knowledge base. It captures hard-won lessons in full detail:

- Studio schema rules that aren't documented anywhere
- `scala.MatchError` triggers and how to avoid them
- MVEL gotchas (DelegatingClassLoader, `props['map'].method(complexExpr)` failures)
- EMF XPath @mixed counting rules for `assembly-diagram.xml`
- Sub-flow decomposition patterns
- Diagram swimlane layout rules
- Custom Java Bean integration patterns

Entries here come from promoted `learnings.md` entries. If asked to promote a learning, move it into the right section of this file with full context and a clean example, then mark the `learnings.md` entry `**Status**: promoted`.

**This file is delivered to users through the MCP.** The `get_patterns` tool reads this doc live and serves it by section or keyword search, so a teammate using the MCP in their own workspace can pull any of this guidance even though this repo's `CLAUDE.md`/`docs/` are not in their context. Promoting into this file is therefore sufficient to reach every user — no separate copy step is required for cross-cutting rules. Keep section (`## `) and subsection (`### `) headings descriptive: they are the index `get_patterns` returns and the keys users retrieve by.

### What belongs in `get-step-type-reference.mjs`

If a learning is about **how a specific cc:* / cloud:* / ssk:* element behaves**, ALSO co-locate it in the step type reference tool — append it to the relevant entry's `description`, `gotchas`, or `xml_example`. `get_patterns` now makes the patterns doc reachable, but duplicating an element-specific rule here still helps: Claude reads the step reference while planning that exact element, so the rule surfaces without a separate lookup. This is for element-scoped rules only; cross-cutting rules (diagram index math, swimlane layout, the add/remove three-entry rule) live solely in the patterns doc and reach users via `get_patterns`.

---

## Local extensions (tenant work)

The MCP server supports a gitignored `src/local-extensions.mjs` file. If it exists and exports `registerLocalTools(server)`, the server loads it after registering the public tools.

**This is for tenant-aware tools that should never be shared.** Examples:

- SOAP launchers that require ISU credentials
- Tools that hit a specific Workday endpoint
- Scripts tied to a particular tenant's data model

These tools stay on the user's local machine. They are NOT part of the public distribution and **must not be committed**. The `.gitignore` already excludes them.

If you (Claude) are asked to build something tenant-aware:

1. Confirm with the user whether it should live in `local-extensions.mjs` (local only) or in a separate private repo.
2. Never add tenant identifiers, hostnames, or credentials to any file in this repo.
3. If you're unsure whether something is tenant-specific, **ask before writing it**.

---

## Code style

- ESM modules (`.mjs`), no TypeScript
- Node 18+ stdlib only — no fancy bundlers
- Tools register via `server.tool(name, description, zodSchema, handler)` — match the existing pattern
- `process.stderr.write(...)` for logging (stdout is reserved for the MCP protocol)
- Error responses always go through `errorResponse(code, message, suggestion)` helpers per tool

---

## Testing

**Run `npm test` before opening a PR.** The suite uses the Node stdlib test runner (`node:test`) — no dependencies, no framework.

```
test/
├── fixtures/assembly.mjs        # shared synthetic assembly + diagram
├── aidlc-docs.test.mjs          # plan/state persistence
├── assembly-validator.test.mjs  # one fires/silent pair per rule
├── delete-assembly-step.test.mjs
├── get-patterns.test.mjs        # runs against the REAL curated doc
└── plan-integration.test.mjs    # scaffold output correctness
```

Conventions:

- Files are `*.test.mjs`; anything else under `test/` (fixtures, helpers) is not collected.
- **Every validator rule needs BOTH a fires-on-violation and a silent-on-clean case.** A rule tested only against bad input is indistinguishable from one that always fires.
- **Verify against an independent oracle where you can.** `plan-integration.test.mjs` resolves diagram `@mixed` refs by actually walking the generated XML's mixed-content model rather than re-using the scaffolder's own index formulas — otherwise a wrong formula would happily verify itself.
- Prefer real artifacts over mocks when they're cheap: `get-patterns.test.mjs` parses the actual `docs/studio-integration-patterns.md`, so a structural change to the doc fails the suite.
- Tests that touch the filesystem use `mkdtemp` and clean up in `finally`.

Still expected on top of the suite:

- Smoke test `node src/index.mjs` — the server should boot and print the workspace path.
- If you add a tool, exercise it via Claude or the MCP inspector before opening a PR — unit tests don't prove the MCP wiring.

---

## When in doubt

Read existing tools to find the pattern. The codebase is small enough to grok in 15 minutes. If a convention isn't obvious, ask the user before inventing a new one.
