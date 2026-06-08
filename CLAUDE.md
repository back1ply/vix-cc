# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build MCP server (TypeScript → dist/)
cd mcp-server && npm run build

# Install dependencies (first time or after package.json changes)
cd mcp-server && npm install --ignore-scripts --legacy-peer-deps
```

`npm run build` compiles TypeScript with `tsc` then runs `sync-local.mjs` (gitignored, local-dev only) which kills the running MCP server PID. After building, run `/reload-plugins` in Claude Code to restart the MCP server with the new dist/.

The compiled `mcp-server/dist/` is committed to the repo so end users don't need to build after installing the plugin.

There are no test or lint scripts defined.

## Architecture

This is a Claude Code plugin with three component types that Claude Code auto-discovers:

**Agents** (`agents/*.md`) — Markdown files with YAML frontmatter (`name`, `model`, `description`, `tools`, `color`). The `description` field controls when FleetView auto-triggers the agent. The body is the agent's system prompt. Ported word-for-word from [get-vix/vix](https://github.com/get-vix/vix) `internal/config/defaults/agents/`, adapting vix daemon tool names (`read_file` → `Read`, `glob_files` → `Glob`, etc.) for Claude Code.

**Skills** (`skills/*/SKILL.md`) — Each subdirectory with a `SKILL.md` is a skill. Invoked via `/skill-name` slash commands.

**MCP server** (`mcp-server/`) — A Node.js stdio MCP server exposing 4 tools. Entry point is `src/index.ts` which holds session state and dispatches to handlers:

| File | Tool | Key detail |
|------|------|-----------|
| `vix-read-minified.ts` | `vix_read_minified` | Minifies with Tree-sitter, adds file to `readFiles` Set |
| `vix-edit-minified.ts` | `vix_edit_minified` | Read-gated: throws if path not in `readFiles`; matches on minified content, writes back, runs formatter |
| `vix-background-bash.ts` | `vix_background_bash` | Spawns detached process, stores job in `bashJobs` Map, writes log/rc files to tmpdir |
| `vix-tool-chain.ts` | `vix_tool_chain` | Runs Python subprocess; tool calls go over stdin/stdout JSON IPC |

**Session state** (`readFiles`, `bashJobs`) lives in the Node process and resets on MCP server restart.

### Minifier (`minifier.ts`)

Uses **web-tree-sitter (WASM)** instead of native `tree-sitter` bindings — native bindings fail to compile on Windows with Node 24 (MSBuild/node-gyp). Grammar `.wasm` files ship inside each `tree-sitter-*` npm package. `ensureInit()` must be awaited before the server accepts requests (done in `index.ts`). Unsupported file extensions return raw content without error.

### Read gate

`vix_edit_minified` enforces that the file was previously read with `vix_read_minified` in the same session. It checks the `readFiles` Set. Files read with the native `Read` tool are **invisible** to this gate by design — the gate only applies when `vix_read_minified` is the primary read tool (reinforced by the `vix-read-before-edit` skill).

### `vix_tool_chain` IPC

Python receives a function body as `workflow`, wrapped in a `_workflow()` def by the server. Tool calls are expressed as JSON on stdout (`{"call": "read_file", "params": {...}}`), the server dispatches and writes the result back on stdin. `print()` is redirected to stderr so workflow output stays clean.

### Plugin manifest

`.claude-plugin/plugin.json` registers the MCP server via `${CLAUDE_PLUGIN_ROOT}` — Claude Code substitutes the plugin's install path at runtime. `marketplace.json` is the listing metadata for the Claude Code marketplace.
