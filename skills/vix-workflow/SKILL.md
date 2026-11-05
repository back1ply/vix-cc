---
name: vix-workflow
description: Run vix's Plan workflow — Explore → Plan → user review (Accept / Modify / Reject) → Execute. Explore and Plan run in this conversation as phases of one "stem agent", so the planning phase reuses the cached exploration instead of starting fresh subagents. Use when starting a non-trivial coding task that should be planned and approved before any code changes. Trigger with /vix-workflow followed by the task description.
argument-hint: <task>
---

# vix Workflow

Port of vix's built-in **Plan** workflow: **Explore → Plan → Review → (Refine →)* Execute**.

**Announce at start:** "Running vix-workflow: Explore → Plan → Review → Execute."

The task is `$ARGUMENTS`. If it is empty, ask the user for the task and stop.

## Why phases run here, not in subagents

vix's "stem agent" idea: one conversation moves through the phases, and each phase is announced by a message rather than a different system prompt. The plan phase then reuses the cached history of the explore phase. So **do Explore, Plan and Refine yourself in this conversation**. Do not spawn vix-explore or vix-plan for them. Only Execute runs in a fresh agent (as in vix).

## Phase 1: Explore

Follow these instructions yourself, with `{{prompt}}` = the task:

````
---
## 🔍 Entering Phase: Explore
You are now in the **Explore** phase. Set aside any goals, plans, or assumptions from previous phases — they no longer apply. Your only objective is defined below.
---

# Phase: Explore

Your goal is to build a thorough understanding of this codebase as grounding for subsequent phases. Do not write or modify any code, and do not produce a plan.

## User Request

{{prompt}}

## Exploration Guidelines

**Minimize tool calls.** Every `Read`, `vix_read_minified`, `LSP`, `Grep`, or `Glob` call should answer a specific, targeted question. The context above is your primary source of truth — only reach for source files when it leaves a specific question unanswered.

**Legitimate reasons to use tools:**
- Inspecting a function signature or implementation you intend to reference
- Verifying that a utility or pattern you plan to rely on actually exists as described
- Resolving an ambiguity about how two components interact that isn't covered above
- Confirming a file path exists before referencing it

**Not legitimate reasons:**
- General orientation (`ls`, reading files to "understand the project")
- Re-reading anything already covered in the context above
- Exploring directories to rediscover structure that's already documented

**Deduplication:** Never call the same tool on the same file more than once. If you need multiple ranges from a file, read them in a single call.

---

## Output

First, use tools as needed to explore the codebase following the guidelines above. Once exploration is complete, respond with 2-3 sentences summarising what you found relevant to the user request and nothing else — no preamble, no markdown fences.
````

## Phase 2: Plan

Continue in this conversation, with `{{prompt}}` = the task:

````
---
## 📐 Entering Phase: Plan
You are now in the **Plan** phase. Set aside any exploration findings or assumptions from previous phases — they no longer apply. Your only objective is defined below.
---

# Phase: Plan

Produce a structured implementation plan for the user request below. Do not write or modify any code.

## User Request

{{prompt}}

---

## Plan Format

### Name
Short, specific label. 2–5 words. Not a sentence.

### Context
**Why** this change is needed. What problem does it solve? What degrades or breaks without it? Do not describe what the code will do — explain the motivation.

### Architecture
Structural or design-level changes only. Omit if this is a purely self-contained implementation. Cover: new abstractions introduced, interfaces changed, data flow affected, new dependencies added. For each architectural decision, briefly state **why** that approach was chosen.

### Files
Exhaustive list of every file that will be **created** or **modified**. No directories. No read-only files. Verify uncertain paths with a tool before listing them.

### Steps
Ordered implementation steps. Each step must:

- Name **specific identifiers**: file path, function/method, type, interface
- Call out **existing utilities to reuse** rather than reimplementing
- **Flag risky steps** inline (e.g. *"⚠ modifies shared interface — all implementors must be updated in subsequent steps"*)
- Include **inline verification** after significant steps where applicable
- End with a **final Verify step** — exact build and test commands confirming the full change is correct

**Step quality bar:**
- Specific enough to execute without ambiguity — not so detailed it dictates variable names or formatting
- One coherent unit of work per step — no bundling of unrelated changes
- Ordered so no step depends on the output of a later step
- No steps beyond what the request asks — note related problems as asides, do not fold them in

**Step anti-patterns to avoid:**
- Vague verbs: *"update"*, *"handle"*, *"improve"* — use *"add"*, *"replace"*, *"extract"*, *"delete"*, *"rename"*
- Referencing code that may not exist
- Adding unrequested refactoring or speculative improvements

---

## Output

Write the plan in full. Then, before finalising it, review it against these questions:

- Does every step reference real, verified identifiers — no invented file paths or function names?
- Is every step ordered such that no step depends on the output of a later step?
- Are there any steps that bundle unrelated changes?
- Are there any vague verbs that should be made more specific?
- Does the Files list match exactly what the steps touch — nothing missing, nothing extra?
- Does the final Verify step include exact commands?

If any answer reveals a problem, silently fix the plan. Then output the final, corrected plan.
````

## Phase 3: Review

Call `AskUserQuestion` with the question "Review the plan above. What would you like to do?" and these options:

- **Accept**: Approve the plan and proceed to execution → Phase 5
- **Modify**: Provide feedback to refine the plan → Phase 4. If the user picked Modify without typing feedback, ask what should change before refining.
- **Reject**: Reject the plan and stop the workflow → stop and say so

## Phase 4: Refine

Continue in this conversation, with `{{feedback}}` = "The user reviewed the plan and gave you the following feedback you need to address: " + the user's text:

````
# Phase: Refine

The plan you produced has been critiqued. Your job is to address the feedback and produce an updated plan.

## Critique

{{feedback}}

---

Address every issue raised in the critique. For each change you make, briefly note which piece of feedback it resolves. If you disagree with a critique point, keep the original and explain why.

If any critique point requires a decision you cannot make confidently from the codebase context alone, call `AskUserQuestion` before producing the updated plan.

Output a complete updated plan in the same format as the original — not a diff, not a list of patches.
````

Then go back to Phase 3 with the updated plan.

## Phase 5: Execute

Spawn a fresh agent with the approved plan pasted in full as `{{plan}}`:

```
Agent(vix-general, prompt: EXECUTE prompt below)
```

````
---
## ⚡ Entering Phase: Execute
You are now in the **Execute** phase. Set aside any planning considerations or review feedback from previous phases — they no longer apply. Your only objective is defined below.
---

# Phase: Execute

The plan following plan has been approved. Execute it now

<plan>
{{plan}}
</plan>

## Instructions

- Work through each task sequentially
- When reading files for editing, use `Read` (original content) to get exact content with line numbers
- After each significant change, verify it works
- Do not modify anything beyond what the plan specifies
````

When the agent returns, relay its result to the user: what changed, and whether its verification passed.
