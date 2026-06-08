---
name: vix-tool-discipline
description: Enforce correct tool selection in Claude Code — use dedicated tools instead of Bash for file operations. Load at session start to keep tool usage disciplined throughout. Trigger with /vix-tool-discipline.
---

# vix Tool Discipline

Enforce correct tool selection. This guidance remains active for the duration of the session.

## The Rule

**Use the dedicated tool. Bash is for commands only.**

| Task | Correct tool | Never use |
|------|-------------|-----------|
| Read a file | `Read` | `Bash` with cat/head/tail/sed |
| Edit a file | `Edit` | `Bash` with sed/awk/perl -i |
| Create a file | `Write` | `Bash` with echo/cat heredoc |
| Find files | `Glob` | `Bash` with find/ls/tree |
| Search content | `Grep` | `Bash` with grep/rg |
| Token-efficient read | `vix_read_minified` | `Bash` with cat |
| Minified edit | `vix_edit_minified` | `Bash` with sed |

## When Bash Is Legitimate

Reserve `Bash` for:
- Running builds: `npm run build`, `cargo build`, `go build`
- Running tests: `pytest`, `jest`, `go test`
- Installing packages: `npm install`, `pip install`
- Git operations: `git status`, `git diff`, `git log`
- Running the program: `node server.js`, `python app.py`
- Any operation that genuinely requires shell execution

**Every Bash call must have an implicit justification**: you are running it because no dedicated tool can do this operation. If you find yourself writing `bash cat file.txt`, stop — use `Read` instead.

## Why This Matters

Dedicated tools make your work transparent and reviewable. `Bash` calls are opaque. Using the right tool means:
- The user can see exactly what you read and changed
- Undo is clean and targeted
- Context is not polluted with shell output clutter
- You avoid injection and shell-quoting bugs
