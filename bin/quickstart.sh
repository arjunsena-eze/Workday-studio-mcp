#!/usr/bin/env bash
# Workday Studio MCP — one-shot installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/arjunsena-eze/Workday-studio-mcp/main/bin/quickstart.sh | bash
#
# What it does:
#   1. Checks prereqs (node 18+, git)
#   2. Clones the repo to ~/Workday-studio-mcp (or updates if it exists)
#   3. Runs npm install
#   4. Prompts for your Studio Workspace path and writes config.json
#   5. Runs `claude mcp add` to register with Claude Code
#
# Idempotent — safe to re-run.

set -euo pipefail

REPO_URL="https://github.com/arjunsena-eze/Workday-studio-mcp.git"
INSTALL_DIR="${STUDIO_MCP_INSTALL_DIR:-$HOME/Workday-studio-mcp}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { printf "${GREEN}==>${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}!!${RESET} %s\n" "$*"; }
error() { printf "${RED}xx${RESET} %s\n" "$*" >&2; }

# --- prereqs -----------------------------------------------------------------

info "Checking prerequisites..."

if ! command -v git >/dev/null 2>&1; then
  error "git is not installed. Install it from https://git-scm.com and re-run."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  error "node is not installed. Install Node.js 18+ from https://nodejs.org and re-run."
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
  error "Node $NODE_MAJOR is too old. Please install Node.js 18 or higher."
  exit 1
fi

NODE_PATH=$(command -v node)
info "Found node $(node --version) at $NODE_PATH"

# --- clone or update ---------------------------------------------------------

if [ -d "$INSTALL_DIR/.git" ]; then
  info "Repo already exists at $INSTALL_DIR — pulling latest..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  info "Cloning $REPO_URL → $INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

# --- npm install -------------------------------------------------------------

info "Installing npm dependencies..."
( cd "$INSTALL_DIR" && npm install --silent )

# --- workspace path ----------------------------------------------------------

DEFAULT_WORKSPACE="$HOME/Documents/Studio Workspace"

if [ -f "$INSTALL_DIR/config.json" ]; then
  # Already configured — extract current workspace_path for display
  CURRENT=$(node -p "require('$INSTALL_DIR/config.json').workspace_path" 2>/dev/null || echo "")
  if [ -n "$CURRENT" ] && [ "$CURRENT" != "undefined" ]; then
    info "config.json already set to: $CURRENT"
    WORKSPACE_PATH="$CURRENT"
  else
    read -r -p "Studio Workspace path [$DEFAULT_WORKSPACE]: " WORKSPACE_PATH
    WORKSPACE_PATH="${WORKSPACE_PATH:-$DEFAULT_WORKSPACE}"
  fi
else
  read -r -p "Studio Workspace path [$DEFAULT_WORKSPACE]: " WORKSPACE_PATH
  WORKSPACE_PATH="${WORKSPACE_PATH:-$DEFAULT_WORKSPACE}"
fi

if [ ! -d "$WORKSPACE_PATH" ]; then
  warn "Directory '$WORKSPACE_PATH' does not exist yet — writing config anyway. Create it before using the MCP."
fi

node - "$WORKSPACE_PATH" "$INSTALL_DIR/config.json" <<'JSEOF'
const fs = require('fs');
const workspacePath = process.argv[1];
const configPath    = process.argv[2];
let cfg = {};
if (fs.existsSync(configPath)) {
  try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
}
cfg.workspace_path = workspacePath;
if (!cfg.max_file_size_kb)   cfg.max_file_size_kb  = 500;
if (!cfg.backup_on_write)    cfg.backup_on_write    = true;
if (!cfg.excluded_dirs)      cfg.excluded_dirs      = [".git",".settings","bin","build","node_modules",".metadata",".plugins"];
if (!cfg.excluded_extensions) cfg.excluded_extensions = [".class",".jar",".zip",".bak"];
fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
JSEOF

info "Wrote config.json — workspace: $WORKSPACE_PATH"

# --- register with Claude Code -----------------------------------------------

if command -v claude >/dev/null 2>&1; then
  info "Registering with Claude Code..."
  claude mcp add studio-mcp "$NODE_PATH" "$INSTALL_DIR/src/index.mjs"
  info "Registered. Restart Claude Code (or start a new session) to pick it up."
else
  warn "Claude Code CLI not found — register manually:"
  printf '\n'
  printf '  claude mcp add studio-mcp %s %s/src/index.mjs\n' "$NODE_PATH" "$INSTALL_DIR"
  printf '\n'
  warn "Or add to Claude Desktop config (~/.../claude_desktop_config.json):"
  printf '  {\n    "mcpServers": {\n      "studio-mcp": {\n'
  printf '        "command": "%s",\n        "args": ["%s/src/index.mjs"]\n' "$NODE_PATH" "$INSTALL_DIR"
  printf '      }\n    }\n  }\n\n'
fi

# --- done --------------------------------------------------------------------

printf '\n%bInstall complete.%b\n\n' "$BOLD" "$RESET"
printf 'Smoke test (Ctrl+C to stop):\n'
printf '  node %s/src/index.mjs\n\n' "$INSTALL_DIR"
