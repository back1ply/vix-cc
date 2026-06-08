---
name: vix-reason-first
description: Require explicit intent before every non-trivial tool call — state why this file, what you expect, how it helps. Mirrors vix's reason field discipline. Load at session start. Trigger with /vix-reason-first.
---

# vix Reason First

State your intent before each tool call. This guidance remains active for the duration of the session.

## The Rule

Before each tool call, state in one sentence in your text output:
1. **Why this file/command** — what specifically you need from it
2. **What you expect to find** — your hypothesis about the content
3. **How it advances the current goal** — why this is the right next step

## Format

The narration goes in the text between tool calls, not as a parameter. Keep it to one sentence.

```
Reading auth.ts to find the token validation logic — expecting a JWT.verify call — needed to understand the signing key before I can add the new claim check.
[Read("src/auth.ts")]

The token check uses HS256 with a hardcoded secret — I'll patch the claim extraction in the verify callback.
[Edit("src/auth.ts", ...)]
```

## When to Skip

Skip for trivially obvious follow-up calls in a tight sequence where the reason is already stated:

```
Reading the three test files for the auth module.
[Read("tests/auth.test.ts")]
[Read("tests/auth-integration.test.ts")]
[Read("tests/auth-fixtures.ts")]
```

Here the reason covers all three reads — no need to re-state it per call.

## Why This Matters

Narrating intent before acting:
- Catches wrong assumptions before they become wrong edits
- Makes tool call sequences readable and reviewable
- Forces you to have a concrete question before making a call
- Prevents exploratory fishing (reading files "to understand" without a specific question)

If you can't state a concrete reason for a tool call in one sentence, that's a signal the call isn't necessary yet.
