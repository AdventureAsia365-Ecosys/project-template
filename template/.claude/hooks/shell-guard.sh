#!/bin/bash
# Generic shell-mistake refusals for the Bash tool (PreToolUse hook): pkill -f, zsh word splitting, export $(...),
# silent background jobs, lane worktrees outside .tmp-session/wt/, infrastructure applies off the default branch,
# heavy commands on low memory. The rules: shell_guard_core.py. A project adds its own rules in a separate file that
# imports the core. Test: python3 .claude/hooks/test_shell_guard_core.py
exec python3 "$(dirname "$0")/shell_guard_core.py"
