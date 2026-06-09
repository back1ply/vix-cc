"""
Daytona sandbox management utilities.

Called by run.py via `--manage` flag:
  python benchmark/run.py --provider daytona --manage status
  python benchmark/run.py --provider daytona --manage sandboxes
  python benchmark/run.py --provider daytona --manage sandboxes --delete-all
  python benchmark/run.py --provider daytona --manage sandboxes --delete-errors
  python benchmark/run.py --provider daytona --manage snapshots
"""

from __future__ import annotations

import asyncio
import os
import sys


def _client():
    try:
        from daytona import AsyncDaytona, DaytonaConfig
    except ImportError:
        sys.exit("daytona package not installed — run: pip install daytona")

    key = os.environ.get("DAYTONA_API_KEY", "")
    if not key:
        sys.exit("DAYTONA_API_KEY not set")
    return AsyncDaytona(config=DaytonaConfig(api_key=key))


async def _status() -> None:
    from daytona import AsyncDaytona

    async with _client() as d:
        sandboxes = [s async for s in d.list()]
        snap_result = await d.snapshot.list()
        snaps = list(snap_result.items) if hasattr(snap_result, "items") else list(snap_result)  # type: ignore[arg-type]

        by_state: dict[str, int] = {}
        for s in sandboxes:
            by_state[str(s.state)] = by_state.get(str(s.state), 0) + 1

        print(f"Sandboxes : {len(sandboxes)}")
        for state, count in sorted(by_state.items()):
            print(f"  {state}: {count}")
        print(f"Snapshots : {len(snaps)}")


async def _sandboxes(delete_errors: bool = False, delete_all: bool = False) -> None:
    from daytona import SandboxState

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
            results = await asyncio.gather(*[d.delete(s) for s in to_delete], return_exceptions=True)
            ok = sum(1 for r in results if not isinstance(r, Exception))
            for i, r in enumerate(results):
                if isinstance(r, Exception):
                    print(f"  FAIL {to_delete[i].id}: {r}")
            print(f"  deleted {ok}/{len(to_delete)}")


async def _snapshots() -> None:
    async with _client() as d:
        result = await d.snapshot.list()
        snaps = list(result.items) if hasattr(result, "items") else list(result)  # type: ignore[arg-type]
        print(f"{len(snaps)} snapshots")
        for s in snaps:
            print(f"  {getattr(s, 'state', '?'):<30s} {getattr(s, 'name', '?')}")


def manage(command: str, delete_all: bool = False, delete_errors: bool = False) -> None:
    if command == "status":
        asyncio.run(_status())
    elif command == "sandboxes":
        asyncio.run(_sandboxes(delete_errors=delete_errors, delete_all=delete_all))
    elif command == "snapshots":
        asyncio.run(_snapshots())
    else:
        sys.exit(f"Unknown manage command: {command!r}. Use: status, sandboxes, snapshots")
