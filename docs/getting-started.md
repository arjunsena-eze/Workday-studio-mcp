# Getting started

A setup guide for Workday Studio developers who have never used an MCP server.

No prior AI-tooling knowledge assumed. Budget about 15 minutes.

---

## 1. What this actually is

You keep building integrations in **Workday Studio, exactly as you do now**. This adds
an AI assistant that can read and write the files in your Studio workspace directly — so
instead of pasting assembly XML back and forth into a chat window, you say *"add a
retry to the vendor call"* and it edits `assembly.xml` in place.

MCP (Model Context Protocol) is just the plumbing that lets an AI tool call functions on
your machine. You will never interact with it directly.

### What it does NOT do — read this before you worry

| Concern | Reality |
|---|---|
| Does it connect to my Workday tenant? | **No.** Never. There is no tenant code in this repo. |
| Does it need ISU credentials? | **No.** None are stored, requested, or transmitted. |
| Does it open a network port? | **No.** It runs over stdio — a local pipe between two processes on your laptop. |
| What can it see? | Only the workspace folder you point it at. Path traversal outside it is blocked. |
| Does my integration code leave my machine? | Only the parts your AI client sends to its model, exactly as if you had pasted them into a chat. The server itself sends nothing anywhere. |

If your security team asks: it is a local Node.js process that reads and writes files in
one folder you nominate, with no outbound connections.

---

## 2. Prerequisites

- **Node.js 18 or newer** — check with `node --version`. Get it from [nodejs.org](https://nodejs.org).
- **Git** — [git-scm.com](https://git-scm.com).
- **Workday Studio** with at least one project in your workspace.
- **An MCP-capable AI client** — see the next section.

---

## 3. Pick your AI client

MCP is an open protocol supported across Claude, ChatGPT, Gemini, Microsoft Copilot,
GitHub Copilot, Cursor, Windsurf, VS Code and Zed. You do **not** need a Claude
subscription.

In order of "least friction for someone at a consultancy":

| Client | Why |
|---|---|
| **VS Code + GitHub Copilot** (agent mode) | Most firms already license it — nothing to procure. |
| **Cursor** | Free tier is enough; very reliable tool execution. |
| **Claude Desktop / Claude Code** | Simplest setup if you can get a subscription. |
| **Cline / Roo Code** (VS Code extensions) | Bring your own API key — point it at whatever model your company already pays for. |

> **One honest caveat.** Every client gets the same 26 tools and the same knowledge base.
> But writing correct Studio XML — the EMF `@mixed` index arithmetic, swimlane rules,
> MVEL quirks — is hard reasoning. A frontier model does it well. A small local model
> will produce plausible-looking XML that crashes the diagram view. Judge the tool on a
> capable model.

---

## 4. Install

### Windows (PowerShell)

```powershell
cd $HOME
git clone https://github.com/arjunsena-eze/Workday-studio-mcp.git
cd Workday-studio-mcp
npm install
copy config.json.example config.json
```

> ⚠️ **Do not clone into OneDrive or any deeply nested folder.** Git fails with
> `fatal: '$GIT_DIR' too big`. Keep it directly under your user profile.

### macOS / Linux

```bash
git clone https://github.com/arjunsena-eze/Workday-studio-mcp.git ~/Workday-studio-mcp
cd ~/Workday-studio-mcp
npm install
cp config.json.example config.json
```

---

## 5. Point it at your Studio workspace

Open `config.json` and set `workspace_path` to the folder Eclipse opens — the one
containing your project folders and a `.metadata` directory.

**Windows — backslashes must be doubled:**

```json
{
  "workspace_path": "C:\\Users\\yourname\\workspace",
  "max_file_size_kb": 500,
  "backup_on_write": true
}
```

**macOS / Linux:**

```json
{ "workspace_path": "/Users/yourname/Documents/Studio Workspace" }
```

`config.json` is gitignored — your local path is never committed.

### Check it works

```bash
npm test
```

All 75 tests should pass. *(Two suites fail if `config.json` is missing — that is the
usual cause.)*

```bash
node src/index.mjs
```

You should see:

```
[studio-mcp] Server started. Workspace: C:\Users\yourname\workspace
```

Press `Ctrl+C`. Your AI client will start it on demand from now on.

---

## 6. Register it with your client

Use the **absolute** path to `src/index.mjs` in every case. If your client cannot find
`node`, use its full path (`where node` on Windows, `which node` elsewhere).

**VS Code** — create `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "studio-mcp": {
      "command": "node",
      "args": ["C:\\Users\\yourname\\Workday-studio-mcp\\src\\index.mjs"]
    }
  }
}
```

**Cursor** — create `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "studio-mcp": {
      "command": "node",
      "args": ["C:\\Users\\yourname\\Workday-studio-mcp\\src\\index.mjs"]
    }
  }
}
```

**Claude Desktop** — edit `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), same
`mcpServers` shape as Cursor. Restart the app afterwards.

**Claude Code (CLI)** — one command:

```bash
claude mcp add -s user studio-mcp node /absolute/path/to/Workday-studio-mcp/src/index.mjs
```

**Restart your client after registering.** Tool lists are built at startup, so a running
session will not see the server until it reloads. This trips up nearly everyone once.

Confirm by asking: **"List my Studio projects."** You should get every project in your
workspace back.

---

## 7. Build your first integration

Just describe what you need:

> "I need to build a new integration"

It will not scaffold anything until it has answers to six questions — data source,
destination, trigger, record volume, external auth, and error handling. **This is
deliberate.** Skipping the design phase is what produces diagram rewrites and broken
`@mixed` indices later.

You get a matched `assembly.xml` + `assembly-diagram.xml` that opens in Studio
immediately, plus an `aidlc-docs/` folder recording *why* the integration is shaped the
way it is. Commit that folder alongside your integration.

### Import it into Studio

A new project on disk is invisible to Eclipse until you import it once:

**File → Import… → General → Existing Projects into Workspace →** select your workspace
root → tick the new project → **Finish**.

> ⚠️ **Leave "Copy projects into workspace" unticked.** The project is already there.
> Ticking it creates a nested duplicate, and you will end up editing one copy while
> Studio builds the other.

After that, external edits just need **F5** on the project — never a re-import.

### Day-to-day

| Say this | What happens |
|---|---|
| "What's the status of INT145?" | Reports phase, which sub-flows are stubs, next action. Add `retrofit=true` for older projects. |
| "Fill in the GetWorkers sub-flow — here's the RAAS sample: …" | Replaces the TODO stub and validates. |
| "Validate the assembly for INT145" | Runs ~29 Studio-specific rules. |
| "Rename AsyncMediation3 to SetTransactionProps" | Renames atomically across **both** files. |
| "Show me the diagram rules" | Serves the curated knowledge base. |
| "Parse my latest server log" | Finds the newest `server-*.log` in Downloads and structures it. |

---

## 8. The one habit that matters

**Never hand-edit `assembly.xml` and `assembly-diagram.xml` separately.**

The diagram references assembly elements by EMF positional index (`@mixed.21`), and
those indices count whitespace. Editing one file without the other produces a
`scala.MatchError` and a diagram that will not open.

Use `rename_steps` and `delete_assembly_step` — they update both files atomically. Ask
for `get_patterns` before touching the diagram by hand.

Everything else worth knowing is in [`quick-reference.md`](quick-reference.md) —
tools, validator codes, the SOAP catalog, and the highest-value patterns.

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `workspace_path not configured` | Create `config.json` from the example. |
| `Workspace path does not exist` | Check the path, and that Windows backslashes are doubled. |
| Tools do not appear | Restart the client. Check the path in your config is absolute. |
| `node: command not found` | Use the full path to the node binary. |
| `fatal: '$GIT_DIR' too big` on clone | Cloning into OneDrive or too deep a path. Move it. |
| `npm test` fails 2 suites | `config.json` is missing. |
| Studio shows errors after an external edit | Select the project, press **F5**. Then **Project → Clean** if they persist. |
| Studio keeps showing stale content | Close the editor tab **before** refreshing — saving a stale open tab overwrites the change on disk. |

---

## 10. Where the Studio knowledge lives

The knowledge base in [`studio-integration-patterns.md`](studio-integration-patterns.md)
is ~2,200 lines of hard-won rules — schema gotchas, diagram index arithmetic, MVEL
traps, RAAS and XSLT patterns, log diagnosis recipes.

It is served **through the MCP** by the `get_patterns` tool, so your assistant can pull
any section on demand regardless of which client you use. You do not need this repo open
to benefit from it.

When you hit something undocumented, ask your assistant to log it — `log_learning`
appends it to `learnings.md` for review and promotion. That is how the base grows.

---

## 11. What this will not do for you

Set expectations honestly:

- It **does not deploy**. No tenant connection — you deploy from Studio as always.
- It **does not test against a tenant**. Local files only.
- It **does not know your tenant's data model** — report aliases, custom fields and
  organisation types must be told to it, or read from a sample XML you paste.
- It **will confidently produce wrong XPath** if you have not shown it real sample
  output. Paste a sample; always validate before trusting a mapping.
- **`validate_assembly` is not Studio's validator.** It catches Studio-specific rules
  that Eclipse misses, not XSD violations. Open the project in Studio to get the full
  schema check.
