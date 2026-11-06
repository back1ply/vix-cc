# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build MCP server (TypeScript → dist/)
cd mcp-server && npm run build

# Install dependencies (first time or after package.json changes)
cd mcp-server && npm install --ignore-scripts --legacy-peer-deps

# Tests (run against dist/, so build first)
cd mcp-server && npm test
```

`npm run build` compiles TypeScript with `tsc`, runs `scripts/bundle.mjs` (bundles `src/index.ts` and its npm dependencies into `dist/server.mjs`, copies the grammar `.wasm` files and their licenses into `grammars/`), then runs `sync-local.mjs` (gitignored, local-dev only) which kills the running MCP server PID. After building, run `/reload-plugins` in Claude Code to restart the MCP server with the new dist/.

`dist/` and `grammars/` are committed. The plugin runs `dist/server.mjs`, which needs no `node_modules`: Claude Code only auto-installs npm packages when `package.json` is at the plugin root, and ours is in `mcp-server/`. CI checks both folders are up to date and smoke-tests the bundle with `node_modules` deleted. Do not add a root `package.json`.

`npm test` runs `test/golden.test.mjs` (upstream vix's minifier golden files: byte-identical output and idempotency, both comment modes) `test/edit.test.mjs` (upstream's edit-projection cases plus vix-cc checks) and `test/toolchain.test.mjs` (needs `python` and `rg`). Any minifier change must keep all golden tests passing. There is no lint script.

## Architecture

This is a Claude Code plugin with three component types that Claude Code auto-discovers:

**Agents** (`agents/*.md`) — Markdown files with YAML frontmatter (`name`, `model`, `description`, `tools`, `color`). The `description` field controls when FleetView auto-triggers the agent. The body is the agent's system prompt. Ported word-for-word from [get-vix/vix](https://github.com/get-vix/vix) `internal/config/defaults/agents/`, adapting vix daemon tool names (`read_file` → `Read`, `glob_files` → `Glob`, etc.) for Claude Code.

**Upstream sync point:** get-vix/vix `e68a25c` (2026-09-23). To check for new upstream changes, compare `e68a25c...main` on `internal/config/defaults/` and `internal/daemon/` (tools, vfs, treesitter). Upstream features tied to the vix daemon/TUI (hooks, jobs, vix-help, workflow-authoring skills, whiteboard, auto-titles) are not ported.

**Skills** (`skills/*/SKILL.md`) — Each subdirectory with a `SKILL.md` is a skill. Invoked via `/skill-name` slash commands.

**MCP server** (`mcp-server/`) — A Node.js stdio MCP server exposing 5 tools. Entry point is `src/index.ts` which holds session state and dispatches to handlers:

| File | Tool | Key detail |
|------|------|-----------|
| `vix-read-minified.ts` | `vix_read_minified` | Minifies with Tree-sitter, adds file to `readFiles` Set |
| `vix-edit-minified.ts` | `vix_edit_minified` | Read-gated: throws if path not in `readFiles`; matches on minified content, maps the match back to source offsets and splices only that range (falls back to a literal edit if the file can't be minified) |
| `vix-write-minified.ts` | `vix_write_minified` | Writes minified content, then runs the language's formatter (found on PATH; `.cmd` shims run via shell on Windows); warns if missing/failed |
| `vix-background-bash.ts` | `vix_background_bash` | Spawns detached process, stores job in `bashJobs` Map, writes log/rc files to tmpdir |
| `vix-tool-chain.ts` | `vix_tool_chain` | Runs Python subprocess; tool calls go over stdin/stdout JSON IPC |

**Session state** (`readFiles`, `bashJobs`) lives in the Node process and resets on MCP server restart.

### Minifier (`minifier.ts`)

Uses **web-tree-sitter (WASM)** instead of native `tree-sitter` bindings — native bindings fail to compile on Windows with Node 24 (MSBuild/node-gyp). Grammars load from `mcp-server/grammars/` (dev and bundled runs alike); `Parser.init` gets a `locateFile` pointing there for web-tree-sitter's own runtime wasm. `ensureInit()` must be awaited before the server accepts requests (done in `index.ts`).

It is a port of upstream `internal/daemon/treesitter.go`: leaf tokens joined with minimal separators, per-language passes (Go/Kotlin/Ruby semicolon insertion, Python one-space indentation, Bash whitespace, HTML attribute spacing), and re-validation that the output still parses (otherwise `null` → callers fall back to raw text / literal edit). `minifyMapped` also returns a position map (`-1` for inserted separators); `projectSpan` maps a minified match back to source offsets for the edit splice. Offsets are JS string indices, which is what web-tree-sitter reports. Deliberate differences from upstream are listed at the top of `minifier.ts`.

### Read gate

`vix_edit_minified` enforces that the file was previously read with `vix_read_minified` in the same session. It checks the `readFiles` Set. Files read with the native `Read` tool are **invisible** to this gate by design — the gate only applies when `vix_read_minified` is the primary read tool (reinforced by the `vix-read-before-edit` skill).

### `vix_tool_chain` IPC

Python receives a function body as `workflow`, wrapped in a `_workflow()` def by the server. Tool calls are expressed as JSON on stdout (`{"call": "read_file", "params": {...}}`), the server dispatches and writes the result back on stdin. `print()` is redirected to stderr so workflow output stays clean.

### Plugin manifest

`.claude-plugin/plugin.json` registers the MCP server via `${CLAUDE_PLUGIN_ROOT}` — Claude Code substitutes the plugin's install path at runtime. `marketplace.json` is the listing metadata for the Claude Code marketplace.
