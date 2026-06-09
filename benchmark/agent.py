"""
vix-cc Harbor agent.

Extends Harbor's built-in ClaudeCode agent to:
  1. Clone vix-cc into the sandbox at /opt/vix-cc and npm install it.
  2. Pass --plugin-dir /opt/vix-cc to every `claude` invocation so the
     vix MCP tools, skills, and agents are active for the whole task.
  3. Enable 1-hour prompt cache TTL via ENABLE_PROMPT_CACHING_1H=1
     (reduces cost ~6x on long benchmark runs vs the default 5-min TTL).

Usage in a Harbor job config (YAML):
    agents:
      - import_path: "benchmark.agent:ClaudeCodeVix"
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
        # Inject 1-hour prompt cache TTL into every sandbox exec call via extra_env.
        # BaseInstalledAgent merges extra_env into the env dict on every exec_as_root/agent call.
        extra_env: dict[str, str] = dict(kwargs.pop("extra_env", None) or {})
        extra_env.setdefault("ENABLE_PROMPT_CACHING_1H", "1")
        super().__init__(logs_dir, memory_dir=memory_dir, *args, extra_env=extra_env, **kwargs)

    async def install(self, environment: BaseEnvironment) -> None:
        # Parent installs: curl/bash/nodejs/npm (apk/apt/yum) + claude CLI
        await super().install(environment)

        # git + npm: parent installs npm only on Alpine (apk); apt/yum images only get curl
        # DEBIAN_FRONTEND=noninteractive prevents apt-get from blocking on prompts
        await self.exec_as_root(
            environment,
            command=(
                "if command -v apk &>/dev/null; then apk add --no-cache git nodejs npm; "
                "elif command -v apt-get &>/dev/null; then DEBIAN_FRONTEND=noninteractive apt-get install -y git nodejs npm; "
                "elif command -v yum &>/dev/null; then yum install -y git nodejs npm; fi"
            ),
        )

        # Build clone URL — inject GITHUB_TOKEN for private repo access
        token = os.environ.get("GITHUB_TOKEN", "")
        auth = f"{token}@" if token else ""
        repo_url = f"https://{auth}{_REPO_HOST}"

        # Clone to /opt/vix-cc (root-owned) and make world-readable
        await self.exec_as_root(
            environment,
            command=(
                f"git clone --depth=1 {shlex.quote(repo_url)} {VIX_CC_PATH} && "
                f"chmod -R 755 {VIX_CC_PATH}"
            ),
        )

        # npm install as agent user (PATH already set by parent install)
        # dist/ is committed; only node_modules needs installing
        await self.exec_as_agent(
            environment,
            command=(
                'export PATH="$HOME/.local/bin:$PATH"; '
                f"cd {VIX_CC_PATH}/mcp-server && "
                "npm install --ignore-scripts --legacy-peer-deps --omit=dev"
            ),
        )

    def build_cli_flags(self) -> str:
        """Append --plugin-dir to the parent's flags so vix-cc loads for the session."""
        parent = super().build_cli_flags() or ""
        plugin_flag = f"--plugin-dir {shlex.quote(VIX_CC_PATH)}"
        return f"{parent} {plugin_flag}".strip()
