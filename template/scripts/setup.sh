#!/bin/bash
# One-time local setup: use the repo's hooks folder, so the pre-push hook runs the fast checks.
set -euo pipefail
cd "$(dirname "$0")/.."
git config core.hooksPath .githooks
chmod +x .githooks/* scripts/*.sh .claude/hooks/*.sh 2>/dev/null || true
echo "hooks path set to .githooks; run 'bash scripts/pre-push.sh' to try the checks"
