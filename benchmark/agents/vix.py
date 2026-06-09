"""
ClaudeCodeVix — Harbor agent for benchmarking the vix-cc Claude Code plugin.

Extends Harbor's built-in ClaudeCode agent to:
  1. Clone vix-cc into /opt/vix-cc and npm install it.
  2. Pass --plugin-dir /opt/vix-cc to every `claude` invocation.
  3. Enable 1-hour prompt cache TTL (ENABLE_PROMPT_CACHING_1H=1).
"""

import os
import shlex
from pathlib import Path
from typing import Any

from harbor.agents.installed.claude_code import ClaudeCode
from harbor.environments.base import BaseEnvironment

VIX_CC_PATH = "/opt/vix-cc"
_REPO_HOST = "github.com/back1ply/vix-cc"


class ClaudeCodeVix(ClaudeCode):
    """ClaudeCode + vix-cc plugin (MCP tools + skills + agents)."""

    def __init__(self, logs_dir: Path, memory_dir: str | None = None, *args: Any, **kwargs: Any) -> None:
        extra_env: dict[str, str] = dict(kwargs.pop("extra_env", None) or {})
        extra_env.setdefault("ENABLE_PROMPT_CACHING_1H", "1")
        super().__init__(logs_dir, memory_dir=memory_dir, *args, extra_env=extra_env, **kwargs)

    async def install(self, environment: BaseEnvironment) -> None:
        await super().install(environment)

        await self.exec_as_root(
            environment,
            command=(
                "if command -v apk &>/dev/null; then apk add --no-cache git nodejs npm; "
                "elif command -v apt-get &>/dev/null; then DEBIAN_FRONTEND=noninteractive apt-get install -y git nodejs npm; "
                "elif command -v yum &>/dev/null; then yum install -y git nodejs npm; fi"
            ),
        )

        token = os.environ.get("GITHUB_TOKEN", "")
        auth = f"{token}@" if token else ""
        repo_url = f"https://{auth}{_REPO_HOST}"

        await self.exec_as_root(
            environment,
            command=(
                f"git clone --depth=1 {shlex.quote(repo_url)} {VIX_CC_PATH} && "
                f"chmod -R 755 {VIX_CC_PATH}"
            ),
        )

        await self.exec_as_agent(
            environment,
            command=(
                'export PATH="$HOME/.local/bin:$PATH"; '
                f"cd {VIX_CC_PATH}/mcp-server && "
                "npm install --ignore-scripts --legacy-peer-deps --omit=dev"
            ),
        )

    def build_cli_flags(self) -> str:
        parent = super().build_cli_flags() or ""
        plugin_flag = f"--plugin-dir {shlex.quote(VIX_CC_PATH)}"
        return f"{parent} {plugin_flag}".strip()
