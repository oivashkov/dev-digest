#!/usr/bin/env bash
#
# DevDigest git-hook installer. `.git/hooks/` isn't tracked by git, so hooks
# live as versioned scripts here and get symlinked in explicitly — opt-in,
# not silently active after a clone/pull.
#
#   ./scripts/install-hooks.sh
#
# Installs: pre-push -> scripts/pre-push-review.sh (the pr-self-review gate;
# see that script's header for PR_SELF_REVIEW_MODE / SKIP_PR_SELF_REVIEW).
#
# Idempotent — re-running just re-links. To uninstall: rm .git/hooks/pre-push

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

if [ ! -d .git ]; then
  echo "Run this from the repo root (no .git/ found here)." >&2
  exit 1
fi

chmod +x scripts/pre-push-review.sh

HOOK_PATH=".git/hooks/pre-push"
if [ -e "$HOOK_PATH" ] && [ ! -L "$HOOK_PATH" ]; then
  warn "$HOOK_PATH already exists and isn't a symlink we manage — not overwriting it."
  warn "Move it aside first if you want the pr-self-review hook installed."
  exit 1
fi

ln -sf ../../scripts/pre-push-review.sh "$HOOK_PATH"
log "Installed: $HOOK_PATH -> scripts/pre-push-review.sh"
log "Default mode is 'warn' (prints the verdict, never fails a push)."
log "Set PR_SELF_REVIEW_MODE=enforce once you trust it. See scripts/pre-push-review.sh for details."
