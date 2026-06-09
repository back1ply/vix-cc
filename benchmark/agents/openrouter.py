"""
OpenRouterAgent — lightweight Harbor agent using OpenRouter API.

LLM calls go from the Harbor runner (host) directly to OpenRouter.
The sandbox is used only for bash execution — no CLI overhead.

Supports any OpenRouter model including free-tier models:
  google/gemini-2.5-flash-preview-05-20
  google/gemini-2.0-flash-exp:free
  meta-llama/llama-3.3-70b-instruct:free
  deepseek/deepseek-r1-0528:free
  microsoft/phi-4-reasoning-plus:free
  qwen/qwen3-235b-a22b:free

Requires: OPENROUTER_API_KEY env var.
Note: vix-cc plugin is NOT active with this agent.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from harbor.agents.installed.base import BaseInstalledAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

MAX_TURNS = 40
MAX_OUTPUT_CHARS = 10_000
DEFAULT_MODEL = "google/gemini-2.5-flash-preview-05-20"

SYSTEM_PROMPT = """\
You are a software engineering agent solving tasks inside a Linux sandbox.

You have one tool: `bash` — run any shell command and get stdout+stderr back.

Work iteratively:
1. Run a command to explore or implement.
2. Observe the output.
3. Decide the next step.

When the task is fully complete, stop calling tools and write a brief summary.
If you get stuck or cannot complete the task, stop and explain why.
"""

_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "bash",
            "description": "Execute a bash command in the sandbox. Returns combined stdout+stderr.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "The shell command to run."}
                },
                "required": ["command"],
            },
        },
    }
]


class OpenRouterAgent(BaseInstalledAgent):
    """Harbor agent that drives any OpenRouter model on terminal-bench tasks."""

    def __init__(self, logs_dir: Path, memory_dir: str | None = None, *args: Any, **kwargs: Any) -> None:
        super().__init__(logs_dir, memory_dir=memory_dir, *args, **kwargs)
        self._n_input = 0
        self._n_output = 0

    @staticmethod
    def name() -> str:
        return "openrouter"

    def version(self) -> str | None:
        return "1.0.0"

    def get_version_command(self) -> str | None:
        return None

    async def install(self, environment: BaseEnvironment) -> None:
        pass  # LLM runs on host — nothing to install in sandbox

    def _client(self):
        from openai import AsyncOpenAI

        api_key = os.environ.get("OPENROUTER_API_KEY", "")
        if not api_key:
            raise RuntimeError("OPENROUTER_API_KEY is not set")
        return AsyncOpenAI(
            api_key=api_key,
            base_url="https://openrouter.ai/api/v1",
            default_headers={
                "HTTP-Referer": "https://github.com/back1ply/vix-cc",
                "X-Title": "vix-cc terminal-bench",
            },
        )

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        client = self._client()
        model = self.model_name or DEFAULT_MODEL

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": instruction},
        ]

        for _ in range(MAX_TURNS):
            response = await client.chat.completions.create(
                model=model,
                messages=messages,  # type: ignore[arg-type]
                tools=_TOOLS,  # type: ignore[arg-type]
                tool_choice="auto",
                timeout=120,
            )

            choice = response.choices[0]
            msg = choice.message

            if response.usage:
                self._n_input += response.usage.prompt_tokens or 0
                self._n_output += response.usage.completion_tokens or 0

            if not msg.tool_calls:
                break

            assistant_entry: dict[str, Any] = {"role": "assistant"}
            if msg.content:
                assistant_entry["content"] = msg.content
            assistant_entry["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                }
                for tc in msg.tool_calls
            ]
            messages.append(assistant_entry)

            for tc in msg.tool_calls:
                if tc.function.name != "bash":
                    tool_output = f"Unknown tool: {tc.function.name}"
                else:
                    try:
                        args = json.loads(tc.function.arguments)
                        result = await environment.exec(command=args.get("command", ""), timeout_sec=120)
                        tool_output = (result.stdout or "") + (result.stderr or "")
                        if not tool_output:
                            tool_output = f"(exit {result.return_code})"
                    except Exception as exc:
                        tool_output = f"Error: {exc}"

                if len(tool_output) > MAX_OUTPUT_CHARS:
                    tool_output = tool_output[:MAX_OUTPUT_CHARS] + f"\n[...truncated — {len(tool_output)} chars total]"

                messages.append({"role": "tool", "tool_call_id": tc.id, "content": tool_output})

        context.n_input_tokens = self._n_input
        context.n_output_tokens = self._n_output
