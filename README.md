# vix-cc

A Claude Code plugin porting the core of [vix](https://github.com/get-vix/vix) — a token-efficient AI coding agent — into Claude Code as a hybrid skills + agents + MCP server plugin.

Synced with upstream vix at [`e68a25c`](https://github.com/get-vix/vix/commit/e68a25c) (2026-09-23).

## What it does

- **Plan workflow**: Explore → Plan → your approval → Execute, with Explore and Plan sharing one conversation (vix's "stem agent") so planning reuses the cached exploration; plus a Goal loop with independent completion audits
- **Token-efficient reads**: `vix_read_minified` reduces code to its tokens (no comments or formatting whitespace), typically 20–50% fewer tokens
- **Minified edits and writes**: `vix_edit_minified` matches in the minified view and splices the change into the original source, keeping comments and formatting; `vix_write_minified` writes minified code and runs the language's formatter
- **Background jobs**: `vix_background_bash` spawns detached processes and returns poll instructions
- **Batch tool chains**: `vix_tool_chain` runs a Python script that chains file operations in one round-trip
- **Behavioral skills**: Tool discipline, read-before-edit, reason-first, dependency-ordered todos
- **Brain**: remembers which files you use most in each project and adds them (minified) to every new session, like vix's "Frequently Accessed Files"

## Installation

### Via marketplace (recommended)

```
/plugin marketplace add back1ply/vix-cc
/plugin install vix@vix-cc
```

The MCP server ships ready to run: `mcp-server/dist/server.mjs` is one bundled file with all its npm dependencies, and the Tree-sitter grammars are in `mcp-server/grammars/`. No `npm install` or build step is needed after install. Node.js must be on PATH.

### Manual (local dev / after modifying MCP server source)

```bash
cd mcp-server
npm install --ignore-scripts --legacy-peer-deps
npm run build   # tsc, then bundles dist/server.mjs and copies grammars/
npm test
```

Then add the plugin directory in Claude Code settings, and run `/reload-plugins` after each build.

**Runtime requirements:**
- Node.js 20+ on PATH (`node`)
- Python 3.x on PATH (for `vix_tool_chain`)
- `rg` (ripgrep) on PATH, for `grep` inside `vix_tool_chain`

## Agents

All agents use the session's model (`model: inherit`), as upstream vix does.

| Agent | Role |
|-------|------|
| `vix-explore` | Read-only codebase exploration, produces a structured report |
| `vix-code-explorer` | Read-only Q&A and walkthroughs of how the code works |
| `vix-general` | General-purpose catch-all for open-ended coding, debugging, and mixed tasks |
| `vix-plan` | Produces a written implementation plan, may spawn vix-explore |
| `vix-implement` | Executes a plan precisely, self-verifies, then stops |
| `vix-reviewer` | Evidence-based review, emits `DONE` or `NEEDS_FIX` JSON verdict |

## Skills

| Skill | Trigger | Purpose |
|-------|---------|---------|
| `vix-workflow` | `/vix-workflow <task>` | Explore → Plan → Accept / Modify / Reject → Execute |
| `vix-goal` | `/vix-goal <objective>` | Loops toward a goal until an independent audit verifies it (max 30 iterations) |
| `vix-review-pr` | `/vix-review-pr <PR URL>` | Maintainer-style PR review: what it does, guidelines, architecture, security, roast |
| `vix-tool-discipline` | `/vix-tool-discipline` | Enforce Read/Edit/Glob/Grep over Bash for file ops |
| `vix-read-before-edit` | `/vix-read-before-edit` | Never edit a file not read this session |
| `vix-reason-first` | `/vix-reason-first` | State intent before each tool call |
| `vix-todo-deps` | `/vix-todo-deps` | Dependency-ordered task execution, one in-progress at a time |

## Brain

Port of vix's live brain feature, "Frequently Accessed Files". Two hooks (`hooks/hooks.json`):

- **After each file tool call** (`Read`, `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, and the `vix_*_minified` tools), `hooks/brain-log.mjs` records the file in a per-project log. It runs in the background and only records files inside the project.
- **At session start** (also after `/clear`, resume and compaction), `mcp-server/dist/brain-context.mjs` ranks files by how often they were used and adds the top 10 to the session: files over 500 lines keep their first 400, as in vix, and contents are minified.

Differences from vix:
- Claude Code caps a hook's added context at 10,000 characters, so files are packed into about 9,000 characters and the rest are listed by path.
- The log is kept in the plugin's data folder (`~/.claude/plugins/data/<plugin>/brain/`), not in a `.vix/` folder in each project. Without that folder it falls back to `<project>/.vix/`, with a `.gitignore` so it stays out of git.
- vix's docs also describe a project scan with an AI-written summary. In vix's code that step is never called, so it isn't ported.

To reset a project's ranking, delete its log file from the brain folder.

## MCP Tools

All tools are prefixed `mcp__plugin_vix_vix__` when used in agent tool lists.

### `vix_read_minified`

Reads a file minified with Tree-sitter: the code is reduced to its tokens with only the separators the language needs (comments and formatting whitespace removed). Python keeps its line structure with one space per indent level; Bash keeps its whitespace. Marks the file as read (required before `vix_edit_minified`).

```
path: string        — absolute path
offset?: number     — start line (1-based)
limit?: number      — max lines
reason: string      — required: why this file
```

Supported languages: JS, TS, TSX, Python, Go, Rust, C, C++, C#, Java, Kotlin, PHP, Ruby, JSON, CSS, HTML, Bash.
Unsupported extensions are returned as-is with line numbers. If minifying fails (or would produce invalid syntax), the raw text is returned.

### `vix_edit_minified`

Edit a file by matching `old_string` in its minified representation. The match is mapped back to the original source and only that range is replaced, so comments and formatting elsewhere in the file are kept. The file must have been read with `vix_read_minified` first. Files that can't be minified get a plain literal edit.

```
path: string        — absolute path
old_string: string  — must match exactly once in minified content
new_string: string  — replacement
reason?: string
```

**Notes:**
- A comment that sits *inside* the matched range is replaced along with it, since it isn't visible in the minified view.
- Python: multi-line `new_string` is re-indented from the minified one-space levels to the file's indent unit. CRLF files get CRLF line breaks in `new_string`.
- Copy `old_string` from a whole-file read where possible. A partial (`offset`/`limit`) read of nested Python can show different indentation than the whole-file view, and then the match fails.

### `vix_write_minified`

Writes content given in minified form, then runs the language's formatter to restore normal source. Creates parent directories. Marks the file as read.

```
path: string        — absolute path
content: string     — full file content, minified
reason?: string
```

Formatters (must be on PATH): `gofmt`, `clang-format` (C/C++), `rustfmt`, `black`, `prettier` (JS/TS/HTML/CSS/JSON), `google-java-format`, `ktfmt`, `csharpier`, `rubyfmt`, `php-cs-fixer`, `shfmt`. If the formatter is missing or fails, the file stays minified and the result says so.

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
├── hooks/
│   ├── hooks.json               — brain hooks (PostToolUse log, SessionStart context)
│   └── brain-log.mjs            — file access logger (no dependencies)
├── agents/
│   ├── vix-explore.md
│   ├── vix-code-explorer.md
│   ├── vix-general.md
│   ├── vix-plan.md
│   ├── vix-implement.md
│   └── vix-reviewer.md
├── skills/
│   ├── vix-workflow/SKILL.md
│   ├── vix-goal/SKILL.md
│   ├── vix-review-pr/SKILL.md
│   ├── vix-tool-discipline/SKILL.md
│   ├── vix-read-before-edit/SKILL.md
│   ├── vix-reason-first/SKILL.md
│   └── vix-todo-deps/SKILL.md
└── mcp-server/
    ├── package.json
    ├── tsconfig.json
    ├── grammars/               — Tree-sitter .wasm files + licenses (copied by scripts/bundle.mjs)
    ├── scripts/bundle.mjs      — bundles dist/server.mjs, copies grammars/
    ├── test/                   — upstream golden fixtures, edit and tool-chain tests (npm test)
    └── src/
        ├── index.ts                — MCP server entry, session state, tool dispatch
        ├── minifier.ts             — Tree-sitter token minifier + position map (port of upstream treesitter.go)
        ├── file-lock.ts            — per-file lock for edits and writes
        ├── vix-read-minified.ts    — vix_read_minified handler
        ├── vix-edit-minified.ts    — vix_edit_minified handler + read gate
        ├── vix-write-minified.ts   — vix_write_minified handler + formatters
        ├── vix-background-bash.ts  — vix_background_bash handler + job registry
        └── vix-tool-chain.ts       — vix_tool_chain Python IPC handler
```

## License

AGPL-3.0, the same license as upstream vix. See [LICENSE](LICENSE).

## Attribution

Core behavioral patterns, agent system prompts, and tool designs ported from [get-vix/vix](https://github.com/get-vix/vix), which is licensed under AGPL-3.0. The minifier (`mcp-server/src/minifier.ts`) is a port of vix's `internal/daemon/treesitter.go`, and `mcp-server/test/fixtures/` are copied from vix's `internal/daemon/testdata/`. This plugin is an independent reimplementation in TypeScript/Markdown — not a fork of the Go codebase.

## Implementation notes

- **web-tree-sitter (WASM)** is used instead of native `tree-sitter` bindings — the native bindings fail to compile on Windows with Node 24 (MSBuild/node-gyp errors). Grammar `.wasm` files ship inside each `tree-sitter-*` npm package.
- **Minifier parity** is checked against upstream vix's own golden files (`mcp-server/test/fixtures`, from `internal/daemon/testdata`): output must match byte-for-byte for every language in both comment modes, and minifying twice must give the same result. Swift is the one upstream language not supported (no grammar build that loads in web-tree-sitter).
- **Minifying is on by default** for every supported language, with comments stripped. Upstream vix ships with it off and enables it per language in `languages.json`.
- **Session state** (read file set, bash job registry) lives in the Node.js process and resets when Claude Code restarts the MCP server.
- **Read gate** only tracks files read via `vix_read_minified`. Files read with the native `Read` tool are invisible to the gate — which is intentional: the gate enforces discipline only when `vix_read_minified` is used as the primary read tool (which the `vix-read-before-edit` skill reinforces).
