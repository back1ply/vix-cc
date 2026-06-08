---
name: vix-todo-deps
description: Enforce dependency-ordered task management — declare deps explicitly, never start a task whose dependencies are incomplete, no circular deps, one in-progress at a time. Load at session start. Trigger with /vix-todo-deps.
---

# vix Todo Deps

Enforce dependency-ordered task execution. This guidance remains active for the duration of the session.

## The Rules

**1. Declare dependencies explicitly.** Every task that depends on another must say so when created.

```
✅ TaskCreate("Write auth middleware", blockedBy: ["Set up database connection"])
❌ TaskCreate("Write auth middleware")  — if it actually depends on DB setup
```

**2. Never start a task whose dependencies are not completed.** Check before marking `in_progress`.

```
✅ DB setup is DONE → mark auth middleware in_progress
❌ DB setup is PENDING → auth middleware cannot start
```

**3. No circular dependencies.** If A depends on B and B depends on A, restructure: find the actual sequencing and break the cycle.

```
❌ A blockedBy B, B blockedBy A  — restructure into A → B or B → A
✅ A: "create schema"  →  B: "seed data"  →  C: "write queries"
```

**4. Keep at most one task `in_progress` at a time.** Finish what you started before starting something new. Complete or block the current task before picking up the next.

## Workflow

```
1. TaskCreate all tasks with their dependencies
2. Find tasks with no blockers (all deps completed or no deps)
3. Mark exactly one in_progress
4. Execute it
5. Mark completed
6. Go to step 2
```

## Why This Matters

Dependency-ordered execution:
- Prevents building on incomplete foundations
- Makes progress visible and predictable
- Avoids work that has to be redone because a prerequisite changed
- Keeps the task list an accurate reflection of actual state, not wishful thinking

When you mark a task completed prematurely (tests not actually passing, build still broken), all dependent tasks inherit the breakage silently. Only mark `completed` when the task is verifiably done.
