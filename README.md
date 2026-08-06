# Workday Studio MCP

A local MCP (Model Context Protocol) server that gives Claude direct access to your Workday Studio workspace. Read, write, plan, and validate integration assemblies without copy-pasting XML back and forth.

Everything runs **locally** on your machine — no network calls, no tenant credentials, no shared state. The server only sees the Studio Workspace folder you point it at.

---

## What you get

26 tools across these categories:

| Category | What it does |
|---|---|
| **Navigation** | `list_studio_projects`, `list_project_files`, `read_integration_file`, `search_studio_files`, `get_workspace_structure` |
| **File management** | `write_integration_file`, `copy_file_from_project`, `rename_file`, `delete_file`, `validate_xml_file` |
| **Project setup** | `create_studio_project`, `create_xsl_transform` |
| **Assembly editing** | `list_assembly_steps`, `list_integration_params`, `add_assembly_step`, `update_sub_flow`, `rename_steps`, `delete_assembly_step`, `validate_assembly` |
| **Planning** | `plan_integration` — design elicitation + skeleton generator; `get_workflow` — where an integration stands and what to do next |
| **Reference** | `get_step_type_reference` — confirmed step type docs with production XML examples; `lookup_soap_operations` — WWS service/operation lookup with WSDL links; `get_patterns` — the curated cross-integration knowledge base (diagram rules, MVEL/XSLT/RAAS idioms) by section or search |
| **Diagnostics** | `parse_server_log` — parse a Workday integration server log from `~/Downloads` |
| **Knowledge capture** | `log_learning` — append a discovered pattern/gotcha to the shared intake log (`learnings.md`) |

A growing knowledge base lives at [`docs/studio-integration-patterns.md`](docs/studio-integration-patterns.md) — hard-won lessons captured from real Studio debugging sessions.

**New to MCP?** Start with [`docs/getting-started.md`](docs/getting-started.md) — a 15-minute setup walkthrough written for Studio developers who have never used an MCP server, covering any AI client (not just Claude).

For a single-page digest of the tools, the `plan_integration` design brief, validator rule codes, the SOAP catalog, and the highest-value patterns, see [`docs/quick-reference.md`](docs/quick-reference.md).

---

## Quick install

One line:

```bash
curl -fsSL https://raw.githubusercontent.com/krishnagutta/Workday-studio-mcp/main/bin/quickstart.sh | bash
```

This clones the repo to `~/Workday-studio-mcp`, installs dependencies, and prints the exact `claude mcp add` command for your machine.

Or do it manually — see **Manual setup** below.

---

## Prerequisites

- **Node.js 18+** — check with `node --version`
- **Workday Studio** installed with at least one project in your workspace
- **Claude Desktop** or **Claude Code (CLI)** — both work

---

## Manual setup

**1. Clone and install**

```bash
git clone https://github.com/krishnagutta/Workday-studio-mcp.git
cd Workday-studio-mcp
npm install
```

**2. Configure your workspace path**

```bash
cp config.json.example config.json
```

Open `config.json` and set `workspace_path` to the folder containing your Studio projects (the same one Eclipse opens):

```json
{
  "workspace_path": "/Users/yourname/Documents/Studio Workspace",
  "max_file_size_kb": 500,
  "backup_on_write": true,
  "excluded_dirs": [".git", ".settings", "bin", "build", "node_modules", ".metadata", ".plugins"],
  "excluded_extensions": [".class", ".jar", ".zip", ".bak"]
}
```

Or skip `config.json` entirely and use an env var:

```bash
export STUDIO_WORKSPACE_PATH="/Users/yourname/Documents/Studio Workspace"
```

**3. Verify it starts**

```bash
node src/index.mjs
```

You should see:
```
[studio-mcp] Server started. Workspace: /Users/yourname/Documents/Studio Workspace
```

Press `Ctrl+C` to stop — Claude will spawn it on demand.

---

## Connect to Claude

### Option A — Claude Code (CLI)

```bash
claude mcp add studio-mcp node /absolute/path/to/Workday-studio-mcp/src/index.mjs
```

Confirm:
```bash
claude mcp list
```

### Option B — Claude Desktop

Edit the config file:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add inside `mcpServers`:

```json
{
  "mcpServers": {
    "studio-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/Workday-studio-mcp/src/index.mjs"]
    }
  }
}
```

Save and **restart Claude Desktop**.

> **Tip:** Use `which node` to get your full node path if Claude can't find it.

---

## Use it

### List projects
> "List my Studio projects"

### Read a file
> "Read the assembly.xml from INT145"

### Plan a new integration
> "I need to build a new integration"

Claude asks design questions (data source, destination, trigger, record volume, auth, error handling) before generating anything. Then it writes a skeleton `assembly.xml` + `assembly-diagram.xml` you can open in Studio immediately.

It also writes an **`aidlc-docs/`** folder at the project root, so the design rationale outlives the conversation:

```
<your project>/aidlc-docs/
  ├── plan.md      # design brief, per-sub-flow prop contracts, open gaps, tenant handoff checklist
  └── state.json   # lifecycle state — sub-flow status, decisions log
```

Commit these with your integration: they are the record of *why* it is shaped this way. Regenerating the scaffold refreshes both files but preserves the `created` date and the `decisions` log. Attribute **names** are recorded, never credential values.

### Pick up where you left off
> "What's the status of INT999_Employee_Sync?"

`get_workflow` reads `aidlc-docs/state.json` and reports the phase, which sub-flows are built vs still TODO stubs, the last validation result, and the single next recommended action — without reading the XML. For a project that predates `aidlc-docs/`, call it with `retrofit=true` to derive state from the existing assembly.

### Fill in a sub-flow
> "Fill in the GetWorkers sub-flow — here's the RAAS sample: [paste XML]"

`update_sub_flow` surgically replaces the TODO stub with real steps and validates the result.

### Search across integrations
> "Find all uses of integrationMapLookup"

### Validate
> "Validate the assembly for INT145"

Returns errors (broken routes, illegal comments, missing attributes) and warnings (missing XSL files, unresolved sub-flow endpoints).

### Look up a step type
> "Show me the cc:http-out reference"

Returns confirmed XML examples, schema rules, and gotchas.

### Rename a step safely
> "Rename AsyncMediation3 to SetTransactionProps"

`rename_steps` updates the step ID in `assembly.xml` **and** every href in `assembly-diagram.xml` atomically — renaming in only one file crashes Studio's diagram view.

### Find a SOAP operation
> "Which WWS service has Put_Applicant?"

`lookup_soap_operations` searches the Workday Web Services catalog and returns the service, common operations, and WSDL link.

### Pull curated guidance before hand-editing a diagram
> "Show me the diagram rules before I edit assembly-diagram.xml"

`get_patterns` serves the curated knowledge base — the cross-integration rules that span step types (EMF `@mixed` index math, swimlane layout, the three-entry add/remove rule, MVEL/XSLT/RAAS idioms). Call it with no args for an index, `topic="Diagram Rules"` for a section, or `search="swimlane"` to find by keyword. These are the same lessons in [`docs/studio-integration-patterns.md`](docs/studio-integration-patterns.md), now reachable from any MCP session.

### Capture a discovery
When Claude hits an undocumented Studio behavior during a session, it logs the pattern to `learnings.md` via `log_learning` — entries are reviewed and promoted into the curated knowledge base.

### Parse a server log
After downloading a `server-{wid}.log` from Workday (View Integration Events → expand documents → click the `server-*.log`):

> "Parse my latest server log"

Returns structured timeline, unique errors, and XSLT messages. The parser auto-finds the most recent `server-*.log` in `~/Downloads`.

---

## Project structure

```
Workday-studio-mcp/
├── src/
│   ├── index.mjs               # Entry — registers tools, starts server
│   ├── config.mjs              # Loads workspace path
│   ├── fs.mjs                  # FS helpers + path traversal protection
│   ├── xml.mjs                 # XML validation wrapper
│   ├── assembly-validator.mjs  # Studio-specific assembly rules
│   ├── aidlc-docs.mjs          # Persists the integration plan + lifecycle state
│   └── tools/
│       ├── list-projects.mjs
│       ├── list-files.mjs
│       ├── read-file.mjs
│       ├── write-file.mjs
│       ├── search-files.mjs
│       ├── workspace-tree.mjs
│       ├── validate-xml.mjs
│       ├── create-project.mjs
│       ├── list-assembly-steps.mjs
│       ├── list-integration-params.mjs
│       ├── add-assembly-step.mjs
│       ├── create-xsl-transform.mjs
│       ├── copy-file-from-project.mjs
│       ├── rename-file.mjs
│       ├── delete-file.mjs
│       ├── get-step-type-reference.mjs   # Step type docs
│       ├── lookup-soap-operations.mjs    # WWS service/operation catalog
│       ├── get-patterns.mjs              # Serves the curated knowledge base
│       ├── plan-integration.mjs          # Design elicitation
│       ├── get-workflow.mjs              # Lifecycle status + next action
│       ├── update-sub-flow.mjs           # Surgical sub-flow replacement
│       ├── rename-steps.mjs              # Atomic step rename (assembly + diagram)
│       ├── delete-assembly-step.mjs      # Atomic step delete (assembly + diagram)
│       ├── validate-assembly.mjs         # Studio rules engine
│       ├── log-learning.mjs              # Knowledge-capture intake
│       └── parse-server-log.mjs          # Local log parser
├── docs/
│   └── studio-integration-patterns.md    # Shared knowledge base
├── learnings.md                # Append-only learnings intake queue
├── bin/
│   ├── install.sh
│   └── quickstart.sh
├── test/                       # `npm test` — node:test, no dependencies
│   ├── fixtures/
│   └── *.test.mjs
├── config.json.example
├── CLAUDE.md                   # Instructions for Claude when working in this repo
├── package.json
└── .gitignore
```

---

## Security

- The server only sees files inside your configured `workspace_path` — path traversal attempts are blocked.
- No credentials, API keys, or Workday tenant details are stored or transmitted.
- `config.json` (which contains your local workspace path) is gitignored.
- The server runs over stdio — no network ports are opened.

---

## Contributing patterns back

When you discover a new Studio quirk, schema rule, or assembly pattern, add it to [`docs/studio-integration-patterns.md`](docs/studio-integration-patterns.md) and open a PR. See [`CLAUDE.md`](CLAUDE.md) for guidance on what kinds of learnings belong there. The goal is a collective memory across the team — every debugging session that finds a new gotcha makes the next one cheaper.

---

## Troubleshooting

**`workspace_path not configured`**
Run `cp config.json.example config.json` and set the path.

**`Workspace path does not exist`**
Check the path in `config.json` matches your Studio workspace folder.

**Tools don't appear in Claude**
Ensure the path in your Claude config is absolute, not relative. Restart Claude Desktop after editing.

**`node: command not found` in Claude**
Use the full node path:
```
/usr/local/bin/node /full/path/to/src/index.mjs
```
Find it with `which node`.

---

## License

MIT
