#!/usr/bin/env python3
"""
Daytona sandbox management + benchmark runner for vix-cc.

Usage:
  python benchmark/daytona_manage.py status
  python benchmark/daytona_manage.py sandboxes              # list
  python benchmark/daytona_manage.py sandboxes --delete-errors
  python benchmark/daytona_manage.py sandboxes --delete-all
  python benchmark/daytona_manage.py snapshots
  python benchmark/daytona_manage.py run                    # clean + 5-task trial (haiku by default)
  python benchmark/daytona_manage.py run --tasks 10
  python benchmark/daytona_manage.py run --full             # full benchmark, no task limit
  python benchmark/daytona_manage.py run --model claude-sonnet-4-5  # override model
  python benchmark/daytona_manage.py clean                  # sandboxes + harbor cache only
"""

import asyncio
import os
import shutil
import subprocess
import sys
from pathlib import Path

from daytona import AsyncDaytona, DaytonaConfig, SandboxState

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG = REPO_ROOT / "benchmark" / "config.yaml"
JOBS_DIR = REPO_ROOT / "benchmark" / "jobs"
HARBOR_CACHE = Path.home() / ".cache" / "harbor"
DATASET = "terminal-bench/terminal-bench-2"


# ── Daytona helpers ──────────────────────────────────────────────────────────

def _client() -> AsyncDaytona:
    key = os.environ.get("DAYTONA_API_KEY", "")
    if not key:
        sys.exit("DAYTONA_API_KEY not set")
    return AsyncDaytona(config=DaytonaConfig(api_key=key))


async def list_sandboxes(delete_errors: bool = False, delete_all: bool = False) -> None:
    async with _client() as d:
        sandboxes = [s async for s in d.list()]
        by_state: dict[str, list] = {}
        for s in sandboxes:
            by_state.setdefault(str(s.state), []).append(s)

        print(f"{len(sandboxes)} sandboxes total")
        for state, group in sorted(by_state.items()):
            print(f"  {state}: {len(group)}")
            for s in group:
                print(f"    {s.id}")

        to_delete = []
        if delete_all:
            to_delete = sandboxes
        elif delete_errors:
            to_delete = [s for s in sandboxes if s.state == SandboxState.ERROR]

        if to_delete:
            print(f"\nDeleting {len(to_delete)} sandbox(es)...")
            results = await asyncio.gather(
                *[d.delete(s) for s in to_delete], return_exceptions=True
            )
            ok = sum(1 for r in results if not isinstance(r, Exception))
            for i, r in enumerate(results):
                if isinstance(r, Exception):
                    print(f"  FAIL {to_delete[i].id}: {r}")
            print(f"  deleted {ok}/{len(to_delete)}")


async def list_snapshots() -> None:
    async with _client() as d:
        result = await d.snapshot.list()
        snaps = list(result.items) if hasattr(result, "items") else list(result)  # type: ignore[arg-type]
        print(f"{len(snaps)} snapshots")
        for s in snaps:
            print(f"  {getattr(s, 'state', '?'):<30s} {getattr(s, 'name', '?')}")


async def status() -> None:
    async with _client() as d:
        sandboxes = [s async for s in d.list()]
        snap_result = await d.snapshot.list()
        snaps = list(snap_result.items) if hasattr(snap_result, "items") else list(snap_result)  # type: ignore[arg-type]

        by_state: dict[str, int] = {}
        for s in sandboxes:
            by_state[str(s.state)] = by_state.get(str(s.state), 0) + 1

        print("=== Daytona account status ===")
        print(f"Sandboxes : {len(sandboxes)}")
        for state, count in sorted(by_state.items()):
            print(f"  {state}: {count}")
        print(f"Snapshots : {len(snaps)}")


# ── Cleanup ──────────────────────────────────────────────────────────────────

async def _delete_all_sandboxes() -> None:
    async with _client() as d:
        sandboxes = [s async for s in d.list()]
        if not sandboxes:
            print("  0 sandboxes to delete")
            return
        results = await asyncio.gather(
            *[d.delete(s) for s in sandboxes], return_exceptions=True
        )
        ok = sum(1 for r in results if not isinstance(r, Exception))
        print(f"  deleted {ok}/{len(sandboxes)} sandboxes")


def _clear_harbor_cache() -> None:
    if HARBOR_CACHE.exists():
        shutil.rmtree(HARBOR_CACHE, ignore_errors=True)
        print(f"  cleared {HARBOR_CACHE}")
    else:
        print("  harbor cache already empty")


def clean() -> None:
    print("=== Cleaning up ===")
    asyncio.run(_delete_all_sandboxes())
    _clear_harbor_cache()


# ── Run ──────────────────────────────────────────────────────────────────────

def _check_env() -> bool:
    ok = True
    for var in ("ANTHROPIC_API_KEY", "DAYTONA_API_KEY"):
        val = os.environ.get(var, "")
        if val:
            print(f"  + {var:<25s} {val[:12]}...")
        else:
            print(f"  - {var:<25s} NOT SET")
            ok = False
    return ok


def run(tasks: int | None = 5, full: bool = False, model: str | None = None) -> None:
    print("=== Pre-flight checks ===")
    if not _check_env():
        sys.exit("Set missing env vars and retry.")

    print("\n=== Cleanup ===")
    asyncio.run(_delete_all_sandboxes())
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


# ── CLI dispatch ─────────────────────────────────────────────────────────────

COMMANDS = {
    "sandboxes": list_sandboxes,
    "snapshots": list_snapshots,
    "status": status,
}

if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)

    cmd = args[0]

    if cmd == "clean":
        clean()
    elif cmd == "run":
        full = "--full" in args
        tasks_idx = next((i for i, a in enumerate(args) if a == "--tasks"), None)
        tasks = int(args[tasks_idx + 1]) if tasks_idx is not None else 5
        model_idx = next((i for i, a in enumerate(args) if a == "--model"), None)
        model = args[model_idx + 1] if model_idx is not None else None
        run(tasks=tasks, full=full, model=model)
    elif cmd in COMMANDS:
        kwargs: dict = {}
        if "--delete-errors" in args:
            kwargs["delete_errors"] = True
        if "--delete-all" in args:
            kwargs["delete_all"] = True
        asyncio.run(COMMANDS[cmd](**kwargs))
    else:
        print(__doc__)
        sys.exit(1)
