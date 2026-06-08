---
name: vix-workflow
description: Orchestrate the full vix Explore → Plan → Implement → Review cycle. Use when starting a non-trivial coding task that benefits from structured multi-agent execution. Trigger with /vix-workflow followed by the task description.
---

# vix Workflow

Orchestrates the full four-phase coding cycle: **Explore → Plan → Implement → Review**.

**Announce at start:** "Running vix-workflow: Explore → Plan → Implement → Review."

## Phase Sequence

Execute these phases in order using the `Agent` tool. Each phase hands its output to the next.

### Phase 1: Explore

Spawn `vix-explore` with the user's task as the prompt.

```
Agent(vix-explore, prompt: "<user task>")
```

Collect the 2-3 sentence output. This becomes context for Phase 2.

### Phase 2: Plan

Spawn `vix-plan` with the user task + explore output.

```
Agent(vix-plan, prompt: "Task: <user task>\n\nContext from exploration:\n<explore output>")
```

`vix-plan` will write a plan file and return its path. Collect the path.

### Phase 3: Implement

Spawn `vix-implement` with the task + plan file path.

```
Agent(vix-implement, prompt: "Task: <user task>\n\nPlan: <plan file path>\n\nExecute the plan.")
```

Collect the implementation summary.

### Phase 4: Review

Spawn `vix-reviewer` with the task + implementation summary.

```
Agent(vix-reviewer, prompt: "Task: <user task>\n\nImplementation summary:\n<implement output>")
```

Parse the JSON verdict block from `vix-reviewer`'s output.

## Loop Logic

```
if verdict == "DONE":
    Report success to user. Done.

if verdict == "NEEDS_FIX":
    Re-spawn vix-implement with:
      - Original task
      - Plan file path
      - Reviewer feedback from the "missing" field
    Then re-spawn vix-reviewer.
    Repeat until DONE or 3 cycles exhausted.
```

After 3 `NEEDS_FIX` cycles, stop and report the remaining gaps to the user — do not loop indefinitely.

## Reporting

After `DONE`, tell the user:
- What was built (files created/modified)
- How many review cycles it took
- Any notable decisions made during planning
