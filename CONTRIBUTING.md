# Contributing to vix-cc

## Prerequisites

- Node.js 20+ on PATH (`node --version`)
- Python 3.x on PATH (`python --version`) — required for `vix_tool_chain`
- Claude Code with the plugin installed locally

## Setup

```bash
git clone https://github.com/back1ply/vix-cc.git
cd vix-cc/mcp-server
npm install --ignore-scripts --legacy-peer-deps
```

`--ignore-scripts` skips native build steps. The MCP server uses **web-tree-sitter (WASM)** instead of native bindings — native bindings fail on Windows with Node 24 (MSBuild/node-gyp). Do not switch to native bindings.

## Build

```bash
cd mcp-server
npm run build        # tsc → dist/, then runs sync-local.mjs if present
```

`dist/` is committed to the repo so end users don't need to build after installing the plugin.

### Dev loop

After each build, the MCP server process must be restarted for changes to take effect:

1. `npm run build` — compiles TypeScript to `dist/`
2. `/reload-plugins` in Claude Code — Claude Code restarts the MCP server with the new `dist/`

To automate step 2 (killing the old server PID), create `mcp-server/sync-local.mjs` (gitignored):

```js
// sync-local.mjs — kill the running vix MCP server PID so /reload-plugins picks up the new dist/
import { execSync } from 'child_process';
// find and kill the node process running dist/index.js
// implementation is environment-specific
```

`npm run build` runs `sync-local.mjs` automatically via the `postbuild` script if the file exists.

### Watch mode

```bash
cd mcp-server
npm run dev          # tsc --watch — recompiles on save, but you still need /reload-plugins
```

## Project structure

```
vix-cc/
├── agents/*.md          — agent system prompts (YAML frontmatter + body)
├── skills/*/SKILL.md    — slash-command skills
├── mcp-server/src/      — TypeScript MCP server source
│   ├── index.ts         — entry point, session state, tool dispatch
│   ├── minifier.ts      — web-tree-sitter comment stripping
│   ├── vix-read-minified.ts
│   ├── vix-edit-minified.ts
│   ├── vix-background-bash.ts
│   └── vix-tool-chain.ts
└── mcp-server/dist/     — compiled output (committed)
```

## Testing changes

There are no automated tests. Verify manually in Claude Code:

| Component | How to test |
|-----------|-------------|
| Agent (`agents/*.md`) | Trigger via FleetView or `use vix-<name>` prompt; check system prompt loaded |
| Skill (`skills/*/SKILL.md`) | Run `/vix-<skill-name>` in Claude Code |
| MCP tool (`src/vix-*.ts`) | Build, `/reload-plugins`, call the tool directly in a prompt |
| Minifier (`src/minifier.ts`) | Call `vix_read_minified` on a supported file type and inspect output |
| Read gate | Call `vix_edit_minified` on a path not yet read — expect an error |

**Session state** (`readFiles` set, `bashJobs` map) lives in the Node process and resets on every MCP server restart. Keep this in mind when testing the read gate or background job polling.

## What to work on

Contributions welcome in this order:

1. **Bug fixes** — crashes, incorrect minification output, read gate bypasses
2. **Language support** — add Tree-sitter grammars for languages not yet in `minifier.ts`
3. **Agent/skill improvements** — prompt refinements, better description triggers
4. **Cross-platform fixes** — Windows/macOS/Linux path handling in the MCP tools
5. **Documentation** — fixes and clarifications

## Guidelines

- Keep PRs focused on a single change.
- Do not switch from `web-tree-sitter` to native bindings — see Setup note above.
- `dist/` must be rebuilt and committed with any `src/` changes.
- Agent and skill markdown files follow the patterns already established — read a few before writing new ones.
- No new npm dependencies without a clear reason; prefer the Node.js standard library.

## Reporting issues

Include:
- Steps to reproduce
- Expected vs actual behavior
- OS, Node.js version, Claude Code version
- Relevant MCP server logs (Claude Code → Settings → MCP Servers → view logs)

## Commit style

```
fix(minifier): handle empty files without throwing
feat(agents): add vix-debug agent for log analysis
docs: clarify read gate behavior in README
```
