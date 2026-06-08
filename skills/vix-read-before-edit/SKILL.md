---
name: vix-read-before-edit
description: Enforce read-before-edit discipline — never call Edit on a file not read this session. Load at session start to prevent blind edits. Trigger with /vix-read-before-edit.
---

# vix Read-Before-Edit

Never edit a file you haven't read. This guidance remains active for the duration of the session.

## The Rule

**Before calling `Edit` on any file, you must have called `Read` (or `vix_read_minified`) on that file in this session.**

```
✅ Read("src/auth.ts")  →  Edit("src/auth.ts", ...)   — allowed
✅ Write("src/new.ts")  →  Edit("src/new.ts", ...)    — allowed (you just created it)
❌ Edit("src/auth.ts", ...)  without prior Read        — BLOCKED
```

## When About to Edit an Unread File

Stop. Read the file first. Then edit.

```
About to Edit("src/auth.ts") but haven't read it?
→ Read("src/auth.ts")
→ Now Edit("src/auth.ts", ...)
```

## Why This Matters

Editing without reading leads to:
- Applying a change to code that has already changed
- Mismatched `old_string` (your assumed state ≠ actual state)
- Introducing bugs by not understanding the surrounding code
- Silent no-ops when `old_string` doesn't match

Reading first means:
- Your edit targets the actual current content
- You understand what you're changing and why it's correct
- `old_string` matches precisely

## Session Tracking

Files are "known" after any of:
- `Read` — explicit read
- `vix_read_minified` — minified read (also marks the file)
- `Write` — you created it, so its content is in your context

Files are NOT automatically known after `Glob` or `Grep` — those find files but don't read their content.
