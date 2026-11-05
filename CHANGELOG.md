# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Earlier changes are in the [git history](https://github.com/back1ply/vix-cc/commits/master).

## [Unreleased]

Synced with upstream vix `e68a25c` (2026-09-23).

### Added
- `vix-code-explorer` agent (upstream `code-explorer`).
- `vix-goal` skill (upstream Goal workflow): pursue → independent audit → loop, max 30 iterations.
- `vix-review-pr` skill (upstream `review-pr`).
- `vix_write_minified` tool (upstream `write_minified_file`): writes minified content, then runs the language's formatter.
- Minifier languages: C#, Kotlin, PHP.
- `npm test`: upstream's minifier golden files (62 cases) and edit-projection tests, plus vix-cc cases; runs in CI.
- `vix-general`: periodic user-engagement guidance, Mermaid diagrams, PDF reading. `vix-plan`: PDF reading.
- Tool annotations on all four tools; `vix_background_bash` and `vix_tool_chain` are destructive and open-world.
- Arguments are checked against each tool's `inputSchema` (required fields, primitive types); unknown tool names list the available tools.
- `npm run probe` (in `mcp-server/`): lists tools via the MCP Inspector CLI.
- CI: build, check that committed `dist/` matches `src/`, probe.

### Changed
- License changed from MIT to AGPL-3.0, matching upstream vix (which vix-cc ports prompts and code from).
- `vix_read_minified` uses a port of upstream's token minifier (comments and formatting whitespace removed, upstream reports 20–50% fewer tokens) instead of only stripping comments. Output matches upstream's golden files byte-for-byte. Minified reads are returned without line numbers, as upstream does.
- `/vix-workflow` follows upstream's Plan workflow: Explore and Plan run in the main conversation (stem agent, shared cache), then Accept / Modify / Reject, then a fresh `vix-general` executes. The implement → review loop is no longer part of it (the agents remain).
- `vix_edit_minified` splices the edit into the original source instead of writing the minified file back, so comments and formatting outside the edit are kept (upstream 3901a70). No formatter runs; files that can't be minified get a literal edit.
- All agents use `model: inherit` (upstream dropped pinned models).
- `vix_edit_minified` errors say how to recover (re-read with `vix_read_minified`, or widen `old_string`).
- `@modelcontextprotocol/sdk` ^1.32.1; dependencies updated, `npm audit` clean.

### Removed
- `vix-solver` agent (deleted upstream).

### Fixed
- Minifier: `return $x` and `return élan` (JS/TS) no longer merge into one identifier (upstream bug).
- `vix_edit_minified`: multi-line Python edits are re-indented to the file's indent unit, and CRLF files get CRLF line breaks (upstream splices `new_string` verbatim, which breaks Python blocks).
- Formatters that are `.cmd` shims on Windows (e.g. prettier) now run.
- CI installs with `--ignore-scripts`, matching the documented install.
- `$&`, `$1` etc. in `new_string` were expanded by `String.replace` in `vix_edit_minified` and in `vix_tool_chain`'s `edit_file`; they are now written literally.
