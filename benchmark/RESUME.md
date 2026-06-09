# Session Resume Prompt

Paste this into a fresh Claude Code session to pick up where we left off.

---

We're benchmarking the vix-cc Claude Code plugin against Terminal-Bench 2.0 using Harbor + sandbox providers (Daytona, E2B, Modal).

## Repo

Public repo: https://github.com/back1ply/vix-cc

vix-cc is a Claude Code plugin: 6 agents (vix-explore, vix-plan, vix-implement, vix-reviewer, vix-solver, vix-general), skills, and a TypeScript MCP server (vix_read_minified, vix_edit_minified, vix_background_bash, vix_tool_chain).

## What's already done

`benchmark/` directory has:

- `agent.py` — `ClaudeCodeVix(ClaudeCode)` subclass. Clones vix-cc into `/opt/vix-cc`, npm installs it, passes `--plugin-dir /opt/vix-cc`, and injects `ENABLE_PROMPT_CACHING_1H=1`.
- `config.yaml` — Daytona environment, Haiku model, ephemeral sandboxes.
- `config-e2b.yaml` — E2B environment, Haiku model.
- `config-modal.yaml` — Modal environment, Haiku model.
- `daytona_manage.py` — Daytona-specific: sandbox list/delete, snapshot list, run, clean.
- `e2b_run.py` — E2B runner (no sandbox cleanup needed).
- `modal_run.py` — Modal runner (uses `~/.modal.toml`).
- `check_env.sh` — verifies keys + import.

## Harbor setup

Harbor **0.13.1** installed as a uv tool (Python 3.12) with `harbor[daytona,e2b,modal]` extras:

```bash
uv tool install 'harbor[daytona,e2b,modal]' --reinstall --python python3.12
harbor --version   # 0.13.1
```

## Completed benchmark results (Daytona, Haiku)

Run on 2026-06-09, job dir: `benchmark/jobs/2026-06-09__01-06-58/`

- **Mean: 0.124** across 89 tasks
- **11/25 passed (44%)** on tasks that actually ran
- 64 infra failures (DaytonaNotFoundError + DaytonaError) — private snapshot images on free tier

**Passed tasks:** log-summary-date-ranges, vulnerable-secret, openssl-selfsigned-cert, extract-elf, constraints-scheduling, multi-source-data-merger, kv-store-grpc, nginx-request-logging, cobol-modernization, modernize-scientific-stack, code-from-image

**Failed tasks (ran but scored 0):** video-processing, polyglot-rust-c, cancel-async-tasks, chess-best-move, extract-moves-from-video, sqlite-with-gcov, raman-fitting, sparql-university, polyglot-c-py, password-recovery, sam-cell-seg, sqlite-db-truncate, qemu-startup, configure-git-webserver

## Current focus: E2B

Switching to E2B because it builds sandbox templates from Dockerfiles — avoids the private-snapshot quota failures that blocked 64/89 Daytona tasks.

E2B API key is set as `E2B_API_KEY` in the environment.

**Next step:** run 5-task E2B trial:

```bash
export E2B_API_KEY=your_key
python benchmark/e2b_run.py
```

Full run once trial is clean:

```bash
python benchmark/e2b_run.py --full
```

## Known issues

- **Daytona private snapshot tasks** (~22): `build-pov-ray`, `make-mips-interpreter`, `circuit-fibsqrt` and others always fail on free tier — inherent limitation.
- **Harbor model_name bug (fixed):** In Harbor 0.13.1, `model_name` must be at the agent level in config.yaml, NOT inside `kwargs` — otherwise `create_agent_from_import_path` gets it twice and crashes.
- **`auto_delete_interval_mins: 0`** in Daytona config makes sandboxes ephemeral — prevents 30 GiB quota exhaustion. Harbor log-download errors ("Sandbox not found") are expected and harmless.

## Run commands

```bash
# Daytona (has quota/private-snapshot issues on free tier)
python benchmark/daytona_manage.py run            # 5-task trial
python benchmark/daytona_manage.py run --full
python benchmark/daytona_manage.py sandboxes --delete-all   # cleanup

# E2B (recommended — builds images from Dockerfiles, no quota issues)
python benchmark/e2b_run.py                       # 5-task trial
python benchmark/e2b_run.py --full

# Modal (alternative, uses ~/.modal.toml)
python benchmark/modal_run.py                     # 5-task trial
python benchmark/modal_run.py --full
```
