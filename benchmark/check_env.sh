#!/usr/bin/env bash
# Run from the vix-cc repo root before any benchmark.
set -euo pipefail

ok=true

check() {
    local label=$1 val=$2
    if [[ -n "$val" ]]; then
        printf "  + %-22s %s\n" "$label" "${val:0:8}..."
    else
        printf "  - %-22s NOT SET\n" "$label"
        ok=false
    fi
}

check_optional() {
    local label=$1 val=$2 note=$3
    if [[ -n "$val" ]]; then
        printf "  + %-22s %s\n" "$label" "${val:0:8}..."
    else
        printf "  ~ %-22s NOT SET (%s)\n" "$label" "$note"
    fi
}

echo ""
echo "=== env vars ==="
check "ANTHROPIC_API_KEY" "${ANTHROPIC_API_KEY:-}"
check "DAYTONA_API_KEY"   "${DAYTONA_API_KEY:-}"
check_optional "GITHUB_TOKEN" "${GITHUB_TOKEN:-}" "only needed for private repo"

echo ""
echo "=== tools ==="
for tool in harbor python; do
    if command -v "$tool" &>/dev/null; then
        printf "  + %-22s %s\n" "$tool" "$($tool --version 2>&1 | head -1)"
    else
        printf "  - %-22s not on PATH\n" "$tool"
        ok=false
    fi
done

echo ""
echo "=== import check ==="
if PYTHONUTF8=1 PYTHONPATH=. python -c "from benchmark.agent import ClaudeCodeVix; print('  + benchmark.agent imports OK')" 2>/dev/null; then
    :
else
    echo "  - benchmark.agent import failed -- run from vix-cc root with PYTHONPATH=."
    ok=false
fi

echo ""
if "$ok"; then
    echo "All checks passed. Suggested run order:"
    echo ""
    echo "  # 1. Oracle — proves Daytona + verifier (no API key needed)"
    echo "  harbor run -d terminal-bench/terminal-bench-2 -a oracle --n-concurrent 2"
    echo ""
    echo "  # 2. Baseline — stock claude-code (proves API key + install pipeline)"
    echo "  harbor run -d terminal-bench/terminal-bench-2 -a claude-code --n-concurrent-trials 1 --n-tasks 5"
    echo ""
    echo "  # 3. vix-cc benchmark"
    echo "  PYTHONPATH=. harbor run -c benchmark/config.yaml --n-tasks 5"
else
    echo "Fix the issues above before running."
fi
echo ""
