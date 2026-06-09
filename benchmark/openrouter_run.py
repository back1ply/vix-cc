#!/usr/bin/env python3
"""
OpenRouter benchmark runner for vix-cc on Terminal-Bench 2.0.

Uses OpenRouter API (OpenAI-compatible) — no Anthropic key required.
Works with free models (Gemini Flash, Llama, DeepSeek, Phi-4, etc.).

Usage:
  python benchmark/openrouter_run.py                             # 5-task trial
  python benchmark/openrouter_run.py --tasks 10
  python benchmark/openrouter_run.py --full                      # all 89 tasks
  python benchmark/openrouter_run.py --model google/gemini-2.5-flash-preview-05-20
  python benchmark/openrouter_run.py --model meta-llama/llama-3.3-70b-instruct:free

Free models on OpenRouter (no cost):
  google/gemini-2.0-flash-exp:free
  meta-llama/llama-3.3-70b-instruct:free
  deepseek/deepseek-r1-0528:free
  microsoft/phi-4-reasoning-plus:free
  qwen/qwen3-235b-a22b:free
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG = REPO_ROOT / "benchmark" / "config-openrouter.yaml"
JOBS_DIR = REPO_ROOT / "benchmark" / "jobs"
HARBOR_CACHE = Path.home() / ".cache" / "harbor"
DATASET = "terminal-bench/terminal-bench-2"


def _check_env() -> bool:
    ok = True
    key = os.environ.get("OPENROUTER_API_KEY", "")
    if key:
        print(f"  + {'OPENROUTER_API_KEY':<25s} {key[:12]}...")
    else:
        print(f"  - {'OPENROUTER_API_KEY':<25s} NOT SET")
        ok = False

    e2b_key = os.environ.get("E2B_API_KEY", "")
    if e2b_key:
        print(f"  + {'E2B_API_KEY':<25s} {e2b_key[:12]}...")
    else:
        print(f"  - {'E2B_API_KEY':<25s} NOT SET")
        ok = False

    return ok


def _clear_harbor_cache() -> None:
    if HARBOR_CACHE.exists():
        shutil.rmtree(HARBOR_CACHE, ignore_errors=True)
        print(f"  cleared {HARBOR_CACHE}")
    else:
        print("  harbor cache already empty")


def run(
    tasks: int | None = 5,
    full: bool = False,
    model: str | None = None,
    provider: str = "e2b",
) -> None:
    print("=== Pre-flight checks ===")
    if not _check_env():
        sys.exit("Set missing env vars and retry.")

    print("\n=== Cleanup ===")
    _clear_harbor_cache()

    # Allow overriding provider via env (e2b / modal / daytona)
    config_map = {
        "e2b": CONFIG,
        "modal": REPO_ROOT / "benchmark" / "config-openrouter-modal.yaml",
        "daytona": REPO_ROOT / "benchmark" / "config-openrouter-daytona.yaml",
    }
    config_path = config_map.get(provider, CONFIG)

    cmd = [
        "harbor", "run",
        "-c", str(config_path),
        "-d", DATASET,
        "-o", str(JOBS_DIR),
    ]
    if model:
        cmd += ["-m", model]
    if not full:
        n = tasks if tasks is not None else 5
        cmd += ["-l", str(n)]

    print(f"\n=== Launching: {' '.join(cmd)} ===")
    env = {**os.environ, "PYTHONPATH": str(REPO_ROOT), "PYTHONUTF8": "1"}
    subprocess.run(cmd, env=env, cwd=str(REPO_ROOT))


if __name__ == "__main__":
    args = sys.argv[1:]

    if "--help" in args or "-h" in args:
        print(__doc__)
        sys.exit(0)

    full = "--full" in args
    tasks_idx = next((i for i, a in enumerate(args) if a == "--tasks"), None)
    tasks = int(args[tasks_idx + 1]) if tasks_idx is not None else 5
    model_idx = next((i for i, a in enumerate(args) if a == "--model"), None)
    model = args[model_idx + 1] if model_idx is not None else None
    provider_idx = next((i for i, a in enumerate(args) if a == "--provider"), None)
    provider = args[provider_idx + 1] if provider_idx is not None else "e2b"

    run(tasks=tasks, full=full, model=model, provider=provider)
