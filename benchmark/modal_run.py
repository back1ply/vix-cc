#!/usr/bin/env python3
"""
Modal benchmark runner for vix-cc on Terminal-Bench 2.0.

Modal uses ~/.modal.toml for auth. Run `modal token new` once to set it up.
No manual sandbox cleanup needed; Modal handles teardown automatically.

Usage:
  python benchmark/modal_run.py                       # 5-task trial
  python benchmark/modal_run.py --tasks 10
  python benchmark/modal_run.py --full                # all 89 tasks
  python benchmark/modal_run.py --model claude-sonnet-4-5
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG = REPO_ROOT / "benchmark" / "config-modal.yaml"
JOBS_DIR = REPO_ROOT / "benchmark" / "jobs"
HARBOR_CACHE = Path.home() / ".cache" / "harbor"
MODAL_TOML = Path.home() / ".modal.toml"
DATASET = "terminal-bench/terminal-bench-2"


def _check_env() -> bool:
    ok = True
    val = os.environ.get("ANTHROPIC_API_KEY", "")
    if val:
        print(f"  + {'ANTHROPIC_API_KEY':<25s} {val[:12]}...")
    else:
        print(f"  - {'ANTHROPIC_API_KEY':<25s} NOT SET")
        ok = False

    if MODAL_TOML.exists():
        print(f"  + ~/.modal.toml                   found")
    else:
        print(f"  - ~/.modal.toml                   NOT FOUND — run: modal token new")
        ok = False

    return ok


def _clear_harbor_cache() -> None:
    if HARBOR_CACHE.exists():
        shutil.rmtree(HARBOR_CACHE, ignore_errors=True)
        print(f"  cleared {HARBOR_CACHE}")
    else:
        print("  harbor cache already empty")


def run(tasks: int | None = 5, full: bool = False, model: str | None = None) -> None:
    print("=== Pre-flight checks ===")
    if not _check_env():
        sys.exit("Set missing env vars and retry.")

    print("\n=== Cleanup ===")
    _clear_harbor_cache()

    cmd = [
        "harbor", "run",
        "-c", str(CONFIG),
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

    full = "--full" in args
    tasks_idx = next((i for i, a in enumerate(args) if a == "--tasks"), None)
    tasks = int(args[tasks_idx + 1]) if tasks_idx is not None else 5
    model_idx = next((i for i, a in enumerate(args) if a == "--model"), None)
    model = args[model_idx + 1] if model_idx is not None else None

    if "--help" in args or "-h" in args:
        print(__doc__)
        sys.exit(0)

    run(tasks=tasks, full=full, model=model)
