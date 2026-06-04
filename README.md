# vix-cc

A Claude Code plugin porting the core of [vix](https://github.com/get-vix/vix) — a token-efficient AI coding agent — into Claude Code as a hybrid skills + agents + MCP server plugin.

## What it does

- **Structured workflow**: Explore → Plan → Implement → Review cycle via 5 coordinated agents
- **Token-efficient reads**: `vix_read_minified` strips comments and collapses whitespace before returning file content
- **Minified edits**: `vix_edit_minified` matches and replaces in the minified representation, then formats
- **Background jobs**: `vix_background_bash` spawns detached processes and returns poll instructions
- **Batch tool chains**: `vix_tool_chain` runs a Python script that chains file operations in one round-trip
- **Behavioral skills**: Tool discipline, read-before-edit, reason-first, dependency-ordered todos

## Installation

### Via marketplace (recommended)

```
/plugin marketplace add back1ply/vix-cc
/plugin install vix@vix-cc
```

The compiled MCP server (`mcp-server/dist/`) ships in the repo — no build step needed after install. Node.js must be on PATH for the server to run.

### Manual (local dev / after modifying MCP server source)

```bash
cd mcp-server
npm install --ignore-scripts --legacy-peer-deps
npm run build
```

Then add the plugin directory in Claude Code settings.

**Runtime requirements:**
- Node.js 20+ on PATH (`node`)
- Python 3.x on PATH (for `vix_tool_chain`)
- Formatters on PATH (optional, fail gracefully): `prettier`, `black`, `gofmt`, `rustfmt`

## Agents

| Agent | Model | Role |
|-------|-------|------|
| `vix-explore` | Sonnet | Read-only codebase exploration, produces a 2-3 sentence report |
| `vix-plan` | Opus | Produces a written implementation plan, may spawn vix-explore |
| `vix-implement` | Opus | Executes a plan precisely, self-verifies, then stops |
| `vix-solver` | Opus | One-pass solver for self-contained tasks, no review loop |
| `vix-reviewer` | Sonnet | Evidence-based review, emits `DONE` or `NEEDS_FIX` JSON verdict |

## Skills

| Skill | Trigger | Purpose |
|-------|---------|---------|
| `vix-workflow` | `/vix-workflow` | Orchestrates Explore → Plan → Implement → Review |
| `vix-tool-discipline` | `/vix-tool-discipline` | Enforce Read/Edit/Glob/Grep over Bash for file ops |
| `vix-read-before-edit` | `/vix-read-before-edit` | Never edit a file not read this session |
| `vix-reason-first` | `/vix-reason-first` | State intent before each tool call |
| `vix-todo-deps` | `/vix-todo-deps` | Dependency-ordered task execution, one in-progress at a time |

## MCP Tools

All tools are prefixed `mcp__plugin_vix_vix__` when used in agent tool lists.

### `vix_read_minified`

Reads a file with comments stripped and whitespace collapsed. Marks the file as read (required before `vix_edit_minified`).

```
path: string        — absolute path
offset?: number     — start line (1-based)
limit?: number      — max lines
reason: string      — required: why this file
```

Supported languages: JS, TS, TSX, Python, Go, Rust, C, C++, Java, Ruby, JSON, CSS, HTML, Bash.
Unsupported extensions return raw content (no error).

### `vix_edit_minified`

Edit a file by matching `old_string` in its minified representation and replacing it. The file must have been read with `vix_read_minified` first. Runs the appropriate formatter after writing.

```
path: string        — absolute path
old_string: string  — must match exactly once in minified content
new_string: string  — replacement
reason?: string
```

**Note:** Editing via this tool removes comments from the file (by design — the minified content is written back and the formatter restores indentation, not comments). Use the native `Edit` tool to preserve comments.

Formatters: `prettier` (JS/TS), `black` (Python), `gofmt` (Go), `rustfmt` (Rust). Missing formatters fail gracefully.

### `vix_background_bash`

Spawns a shell command detached and returns immediately with job metadata.

```
command: string     — shell command to run
timeout?: number    — seconds, default/max 3600
reason: string
```

Returns `job_id`, `log` path, `rc` path, and poll commands. Poll with `type <rc>` (Windows) or check `<rc>` file existence.

### `vix_tool_chain`

Executes a Python script body that can chain multiple tool calls in one round-trip.

```
workflow: string      — Python function body; may use read_file, write_file,
                        edit_file, delete_file, bash, grep, glob_files
description: string   — short summary
```

Example:
```python
files = glob_files("**/*.ts", reason="find TypeScript files")
counts = {}
for f in files[:5]:
    content = read_file(f, reason="count lines")
    counts[f] = len(content.splitlines())
return counts
```

## Structure

```
vix-cc/
├── .claude-plugin/
│   └── plugin.json              — registers MCP server (mcpServers: vix)
├── agents/
│   ├── vix-explore.md
│   ├── vix-plan.md
│   ├── vix-implement.md
│   ├── vix-solver.md
│   └── vix-reviewer.md
├── skills/
│   ├── vix-workflow/SKILL.md
│   ├── vix-tool-discipline/SKILL.md
│   ├── vix-read-before-edit/SKILL.md
│   ├── vix-reason-first/SKILL.md
│   └── vix-todo-deps/SKILL.md
└── mcp-server/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts                — MCP server entry, session state, tool dispatch
        ├── minifier.ts             — web-tree-sitter comment stripping
        ├── vix-read-minified.ts    — vix_read_minified handler
        ├── vix-edit-minified.ts    — vix_edit_minified handler + read gate
        ├── vix-background-bash.ts  — vix_background_bash handler + job registry
        └── vix-tool-chain.ts       — vix_tool_chain Python IPC handler
```

## Attribution

Core behavioral patterns, agent system prompts, and tool designs ported from [get-vix/vix](https://github.com/get-vix/vix) (MIT License). This plugin is an independent reimplementation in TypeScript/Markdown — not a fork of the Go codebase.

## Implementation notes

- **web-tree-sitter (WASM)** is used instead of native `tree-sitter` bindings — the native bindings fail to compile on Windows with Node 24 (MSBuild/node-gyp errors). Grammar `.wasm` files ship inside each `tree-sitter-*` npm package.
- **Session state** (read file set, bash job registry) lives in the Node.js process and resets when Claude Code restarts the MCP server.
- **Read gate** only tracks files read via `vix_read_minified`. Files read with the native `Read` tool are invisible to the gate — which is intentional: the gate enforces discipline only when `vix_read_minified` is used as the primary read tool (which the `vix-read-before-edit` skill reinforces).
