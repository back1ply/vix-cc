# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Earlier changes are in the [git history](https://github.com/back1ply/vix-cc/commits/master).

## [Unreleased]

### Added
- Tool annotations on all four tools; `vix_background_bash` and `vix_tool_chain` are destructive and open-world.
- Arguments are checked against each tool's `inputSchema` (required fields, primitive types); unknown tool names list the available tools.
- `npm run probe` (in `mcp-server/`): lists tools via the MCP Inspector CLI.
- CI: build, check that committed `dist/` matches `src/`, probe.

### Changed
- `vix_edit_minified` errors say how to recover (re-read with `vix_read_minified`, or widen `old_string`).
- `@modelcontextprotocol/sdk` ^1.32.1; dependencies updated, `npm audit` clean.
