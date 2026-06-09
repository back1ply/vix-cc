# vix-cc Benchmark

Evaluates the [vix-cc](https://github.com/back1ply/vix-cc) Claude Code plugin against [Terminal-Bench 2.0](https://huggingface.co/datasets/terminal-bench/terminal-bench-2) using [Harbor](https://github.com/av/harbor).

## How it works

`ClaudeCodeVix` (in `agent.py`) extends Harbor's built-in `ClaudeCode` agent:
- Clones vix-cc into `/opt/vix-cc` inside each sandbox
- Passes `--plugin-dir /opt/vix-cc` to every `claude` invocation
- Sets `ENABLE_PROMPT_CACHING_1H=1` to reduce API cost (~6× savings vs default 5-min cache TTL)

## Setup

```bash
# Install Harbor with all sandbox providers
uv tool install 'harbor[daytona,e2b,modal]' --python python3.12

# Required env vars (provider-dependent)
export ANTHROPIC_API_KEY=...
export E2B_API_KEY=...         # E2B
export OPENROUTER_API_KEY=...  # OpenRouter (no Anthropic key needed)
# Modal uses ~/.modal.toml — run: modal token new
```

## Running

### E2B (recommended)

E2B builds sandbox images from Dockerfiles — no private-snapshot quota issues.

```bash
python benchmark/e2b_run.py              # 5-task trial
python benchmark/e2b_run.py --tasks 20
python benchmark/e2b_run.py --full       # all 89 tasks
```

### Modal

```bash
python benchmark/modal_run.py            # 5-task trial
python benchmark/modal_run.py --full
```

### Daytona

```bash
python benchmark/daytona_manage.py run            # 5-task trial
python benchmark/daytona_manage.py run --full
python benchmark/daytona_manage.py sandboxes --delete-all  # cleanup
```

### OpenRouter (no Anthropic key — baseline only, vix-cc not active)

```bash
python benchmark/openrouter_run.py                                           # 5-task trial, Gemini Flash
python benchmark/openrouter_run.py --model "google/gemini-2.0-flash-exp:free"
python benchmark/openrouter_run.py --model "deepseek/deepseek-r1-0528:free"
python benchmark/openrouter_run.py --full
```

## Files

| File | Purpose |
|------|---------|
| `agent.py` | `ClaudeCodeVix` Harbor agent (vix-cc + Claude Code) |
| `openrouter_agent.py` | Lightweight bash-loop agent for any OpenRouter model |
| `config-e2b.yaml` | E2B environment, Haiku model |
| `config-modal.yaml` | Modal environment, Haiku model |
| `config.yaml` | Daytona environment, Haiku model |
| `config-openrouter.yaml` | E2B environment, OpenRouter model |
| `e2b_run.py` | E2B runner |
| `modal_run.py` | Modal runner |
| `daytona_manage.py` | Daytona runner + sandbox management |
| `openrouter_run.py` | OpenRouter runner |
| `check_env.sh` | Preflight key/import check |

## Known issues

- **Harbor E2B timeout**: Harbor 0.13.1 hardcodes `timeout=86400` when creating E2B sandboxes. E2B free tier caps at 3600 s. Patch: change `timeout=86_400` → `timeout=3_600` in `harbor/environments/e2b.py`.
- **Daytona free tier**: ~22 tasks require private snapshot images unavailable on the free tier (`build-pov-ray`, `make-mips-interpreter`, `circuit-fibsqrt`, etc.) — expect ~64/89 infra failures.
- **Harbor `model_name` placement**: must be at the agent level in config YAML, not inside `kwargs`.

## Results

| Provider | Agent | Model | Mean | Passed | Notes |
|----------|-------|-------|------|--------|-------|
| Daytona | ClaudeCodeVix | Haiku 4.5 | 0.124 | 11/25 ran | 64/89 infra failures (free tier) |
| E2B | ClaudeCodeVix | Haiku 4.5 | 0.200 | 1/5 trial | Clean infra |
| Modal | ClaudeCodeVix | Haiku 4.5 | 0.000 | 0/5 trial | Clean infra, small sample |
