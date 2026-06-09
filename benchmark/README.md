# vix-cc Benchmark

Evaluates the [vix-cc](https://github.com/back1ply/vix-cc) Claude Code plugin against [Terminal-Bench 2.0](https://huggingface.co/datasets/terminal-bench/terminal-bench-2) using [Harbor](https://github.com/av/harbor).

## Layout

```
benchmark/
  run.py              # unified entry point — all providers, all agents
  agents/
    vix.py            # ClaudeCodeVix: Claude Code + vix-cc plugin
    openrouter.py     # OpenRouterAgent: any OpenRouter model, no Claude CLI
  configs/
    e2b.yaml          # E2B sandbox (recommended)
    modal.yaml        # Modal sandbox
    daytona.yaml      # Daytona sandbox
    openrouter.yaml   # E2B + OpenRouter agent
  providers/
    daytona.py        # Daytona sandbox management (list/delete sandboxes)
  jobs/               # run outputs (gitignored)
```

## Prerequisites

**Harbor** (Python 3.12+):
```bash
uv tool install 'harbor[daytona,e2b,modal]' --python python3.12
harbor --version   # 0.13.1+
```

**Known Harbor patch** — E2B free tier caps sandbox lifetime at 1 hour; Harbor hardcodes 24h.
Fix once after installing:
```python
# Edit: $(uv tool dir harbor)/Lib/site-packages/harbor/environments/e2b.py
# Find:    timeout=86_400,
# Replace: timeout=3_600,
```

**API keys** (set per provider):
```bash
# E2B (recommended)
export ANTHROPIC_API_KEY=sk-ant-...
export E2B_API_KEY=e2b_...

# Modal
export ANTHROPIC_API_KEY=sk-ant-...
modal token new          # writes ~/.modal.toml

# Daytona
export ANTHROPIC_API_KEY=sk-ant-...
export DAYTONA_API_KEY=dtn_...

# OpenRouter (no Anthropic key needed)
export OPENROUTER_API_KEY=sk-or-...
export E2B_API_KEY=e2b_...
```

## Quick start

```bash
# 5-task trial on E2B (default)
python benchmark/run.py

# Full 89-task run
python benchmark/run.py --full

# Different provider
python benchmark/run.py --provider modal
python benchmark/run.py --provider daytona

# Override model
python benchmark/run.py --model claude-sonnet-4-6

# OpenRouter — free models, no Anthropic key
python benchmark/run.py --agent openrouter
python benchmark/run.py --agent openrouter --model "google/gemini-2.0-flash-exp:free"
python benchmark/run.py --agent openrouter --model "deepseek/deepseek-r1-0528:free"
python benchmark/run.py --agent openrouter --model "meta-llama/llama-3.3-70b-instruct:free"
```

## Daytona sandbox management

Daytona sandboxes can leak on task failures and eat quota. Use these to inspect and clean up:

```bash
python benchmark/run.py --provider daytona --manage status
python benchmark/run.py --provider daytona --manage sandboxes
python benchmark/run.py --provider daytona --manage sandboxes --delete-errors
python benchmark/run.py --provider daytona --manage sandboxes --delete-all
python benchmark/run.py --provider daytona --manage snapshots
```

E2B and Modal are fully ephemeral — no management needed.

## Agents

| Agent | Key | Model | vix-cc active | Purpose |
|-------|-----|-------|---------------|---------|
| `vix` | `ANTHROPIC_API_KEY` | Claude Haiku/Sonnet/Opus | ✅ | Benchmark vix-cc |
| `openrouter` | `OPENROUTER_API_KEY` | Any OpenRouter model | ❌ | Baseline comparison |

The `vix` agent clones vix-cc into each sandbox and passes `--plugin-dir` to Claude Code.
The `openrouter` agent is a lightweight bash-loop with no CLI overhead.

## Provider comparison

| Provider | Sandbox | Concurrency | Management | Notes |
|----------|---------|-------------|------------|-------|
| E2B | Dockerfile-based | 2 | None (ephemeral) | Recommended |
| Modal | Dockerfile-based | 2 | None (ephemeral) | ~2× slower than E2B |
| Daytona | Snapshot-based | 1 (free tier) | Required | ~22/89 tasks fail on free tier (private snapshots) |

## Troubleshooting

**`SandboxException: 400: Timeout cannot be greater than 1 hours`**
→ Apply the Harbor E2B timeout patch (see Prerequisites).

**`DaytonaNotFoundError` on ~22 tasks**
→ Private snapshot images unavailable on Daytona free tier. Not fixable in config.

**`model_name` crash in Harbor 0.13.1**
→ `model_name` must be at agent level in YAML, not inside `kwargs`.

**`NonZeroAgentExitCodeError`**
→ The agent process exited non-zero inside the sandbox. Check `jobs/<run>/<task>/exception.txt`.

## Results

| Date | Provider | Agent | Model | Mean | Tasks |
|------|----------|-------|-------|------|-------|
| 2026-06-09 | Daytona | vix | Haiku 4.5 | 0.124 | 11/25 ran (64/89 infra failures) |
| 2026-06-09 | E2B | vix | Haiku 4.5 | 0.200 | 1/5 trial |
| 2026-06-09 | Modal | vix | Haiku 4.5 | 0.000 | 0/5 trial (small sample) |
