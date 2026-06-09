#!/usr/bin/env python3
"""
Unified benchmark runner for vix-cc on Terminal-Bench 2.0.

Usage:
  python benchmark/run.py                                      # E2B, vix+Haiku, 5-task trial
  python benchmark/run.py --full                               # full 89-task run
  python benchmark/run.py --tasks 20
  python benchmark/run.py --provider modal
  python benchmark/run.py --provider daytona
  python benchmark/run.py --model claude-sonnet-4-6
  python benchmark/run.py --agent openrouter                   # OpenRouter, no Anthropic key
  python benchmark/run.py --agent openrouter --model deepseek/deepseek-r1-0528:free

  # Daytona sandbox management
  python benchmark/run.py --provider daytona --manage status
  python benchmark/run.py --provider daytona --manage sandboxes
  python benchmark/run.py --provider daytona --manage sandboxes --delete-all
  python benchmark/run.py --provider daytona --manage sandboxes --delete-errors
  python benchmark/run.py --provider daytona --manage snapshots

Providers : e2b (default) | modal | daytona
Agents    : vix (default) | openrouter
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIGS_DIR = REPO_ROOT / "benchmark" / "configs"
JOBS_DIR = REPO_ROOT / "benchmark" / "jobs"
HARBOR_CACHE = Path.home() / ".cache" / "harbor"
DATASET = "terminal-bench/terminal-bench-2"

_REQUIRED_KEYS: dict[str, list[str]] = {
    "e2b":        ["ANTHROPIC_API_KEY", "E2B_API_KEY"],
    "modal":      ["ANTHROPIC_API_KEY"],
    "daytona":    ["ANTHROPIC_API_KEY", "DAYTONA_API_KEY"],
    "openrouter": ["OPENROUTER_API_KEY", "E2B_API_KEY"],
}


def _check_env(provider: str, agent: str) -> bool:
    key = "openrouter" if agent == "openrouter" else provider
    required = _REQUIRED_KEYS.get(key, [])
    ok = True
    for var in required:
        val = os.environ.get(var, "")
        if val:
            print(f"  + {var:<28s} {val[:12]}...")
        else:
            print(f"  - {var:<28s} NOT SET")
            ok = False

    if provider == "modal":
        toml = Path.home() / ".modal.toml"
        if toml.exists():
            print(f"  + ~/.modal.toml               found")
        else:
            print(f"  - ~/.modal.toml               NOT FOUND  →  run: modal token new")
            ok = False

    return ok


def _clear_harbor_cache() -> None:
    if HARBOR_CACHE.exists():
        shutil.rmtree(HARBOR_CACHE, ignore_errors=True)
        print(f"  cleared {HARBOR_CACHE}")
    else:
        print("  harbor cache already empty")


def _config_path(provider: str, agent: str) -> Path:
    if agent == "openrouter":
        return CONFIGS_DIR / "openrouter.yaml"
    return CONFIGS_DIR / f"{provider}.yaml"


def run(
    provider: str = "e2b",
    agent: str = "vix",
    model: str | None = None,
    tasks: int = 5,
    full: bool = False,
) -> None:
    print(f"=== Pre-flight ({provider} / {agent}) ===")
    if not _check_env(provider, agent):
        sys.exit("Set missing credentials and retry.")

    print("\n=== Cleanup ===")
    _clear_harbor_cache()

    config = _config_path(provider, agent)
    if not config.exists():
        sys.exit(f"Config not found: {config}")

    cmd = ["harbor", "run", "-c", str(config), "-d", DATASET, "-o", str(JOBS_DIR)]
    if model:
        cmd += ["-m", model]
    if not full:
        cmd += ["-l", str(tasks)]

    print(f"\n=== Launching: {' '.join(cmd)} ===\n")
    env = {**os.environ, "PYTHONPATH": str(REPO_ROOT), "PYTHONUTF8": "1"}
    subprocess.run(cmd, env=env, cwd=str(REPO_ROOT))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="vix-cc terminal-bench runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--provider", default="e2b", choices=["e2b", "modal", "daytona"],
                        help="Sandbox provider (default: e2b)")
    parser.add_argument("--agent", default="vix", choices=["vix", "openrouter"],
                        help="Agent to use (default: vix)")
    parser.add_argument("--model", default=None,
                        help="Override model (e.g. claude-sonnet-4-6, deepseek/deepseek-r1-0528:free)")
    parser.add_argument("--tasks", type=int, default=5,
                        help="Number of tasks for trial run (default: 5)")
    parser.add_argument("--full", action="store_true",
                        help="Run all 89 tasks")
    parser.add_argument("--manage", default=None, choices=["status", "sandboxes", "snapshots"],
                        help="Daytona management command")
    parser.add_argument("--delete-all", action="store_true",
                        help="With --manage sandboxes: delete all sandboxes")
    parser.add_argument("--delete-errors", action="store_true",
                        help="With --manage sandboxes: delete only errored sandboxes")

    args = parser.parse_args()

    if args.manage:
        if args.provider != "daytona":
            sys.exit("--manage is only available for --provider daytona")
        from benchmark.providers.daytona import manage
        manage(args.manage, delete_all=args.delete_all, delete_errors=args.delete_errors)
        return

    run(
        provider=args.provider,
        agent=args.agent,
        model=args.model,
        tasks=args.tasks,
        full=args.full,
    )


if __name__ == "__main__":
    main()
