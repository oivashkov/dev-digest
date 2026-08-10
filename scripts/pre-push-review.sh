#!/usr/bin/env bash
#
# DevDigest pre-push PR self-review gate.
#
# Runs the `pr-self-review` skill (.claude/skills/pr-self-review/) headlessly
# via `claude -p`, and — in `enforce` mode only — fails the push if the
# skill's verdict is BLOCK (a grounded CRITICAL finding survived). Installed
# via ./scripts/install-hooks.sh (symlinks this into .git/hooks/pre-push;
# that directory itself isn't tracked by git, so nothing runs until you do).
#
#   PR_SELF_REVIEW_MODE=warn     (default) print the verdict, never fail the push
#   PR_SELF_REVIEW_MODE=enforce  actually fail the push on BLOCK
#   SKIP_PR_SELF_REVIEW=1        skip entirely (same effect as `git push --no-verify`)
#
# COST NOTE: this shells into a real `claude -p` invocation — every push of a
# non-main branch costs API usage/latency. Headless mode needs a
# non-interactive permission profile (--dangerously-skip-permissions below,
# or your own pre-approved settings) to run without prompting — that's a
# deliberate trust decision made by installing this hook, not a default you
# should ship silently. Start in `warn` mode until you trust it.
#
# KNOWN LIMITATION: pre-push hooks technically receive the full list of refs
# being pushed on stdin (you can push a ref that isn't your checked-out
# HEAD). This script reviews the checked-out branch as a proxy for "what's
# being pushed" — correct for the common case, not a full implementation of
# the pre-push ref-update protocol.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
err()  { printf '\033[1;31m✗ %s\033[0m\n' "$*"; }

MODE="${PR_SELF_REVIEW_MODE:-warn}"

if [ "${SKIP_PR_SELF_REVIEW:-0}" = "1" ]; then
  warn "pr-self-review: skipped (SKIP_PR_SELF_REVIEW=1)"
  exit 0
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" = "main" ]; then
  exit 0
fi

if ! command -v claude >/dev/null; then
  warn "pr-self-review: 'claude' CLI not found on PATH — skipping (fail-open)"
  exit 0
fi

if ! command -v node >/dev/null; then
  warn "pr-self-review: 'node' not found on PATH (needed to parse the verdict) — skipping (fail-open)"
  exit 0
fi

log "pr-self-review: reviewing '$BRANCH' vs main (mode=$MODE)…"

set +e
OUTPUT="$(claude -p "Run the pr-self-review skill (.claude/skills/pr-self-review/SKILL.md) against the current branch's diff. Follow its procedure exactly, including the trailing JSON verdict block." --dangerously-skip-permissions 2>&1)"
CLAUDE_EXIT=$?
set -e

if [ "$CLAUDE_EXIT" -ne 0 ]; then
  warn "pr-self-review: claude invocation failed (exit $CLAUDE_EXIT) — skipping (fail-open)"
  echo "$OUTPUT" >&2
  exit 0
fi

echo "$OUTPUT"

# Extract the LAST ```json ... ``` fenced block and pull verdict+critical
# count out of it. A regex grep on prose is fragile — the model's phrasing
# drifts — so this only trusts a structural JSON block per SKILL.md's
# contract.
VERDICT_LINE="$(node -e '
  const fs = require("fs");
  const out = fs.readFileSync(0, "utf8");
  const matches = [...out.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (matches.length === 0) { console.log("PARSE_FAIL"); process.exit(0); }
  try {
    const obj = JSON.parse(matches[matches.length - 1][1]);
    console.log(`${obj.verdict}|${obj.critical ?? 0}`);
  } catch {
    console.log("PARSE_FAIL");
  }
' <<< "$OUTPUT")"

if [ "$VERDICT_LINE" = "PARSE_FAIL" ]; then
  warn "pr-self-review: couldn't parse a verdict JSON block from the output above — fail-open, push allowed. If this keeps happening, the skill may not be completing its procedure; investigate rather than ignoring it."
  exit 0
fi

VERDICT="${VERDICT_LINE%%|*}"
CRITICAL_COUNT="${VERDICT_LINE##*|}"

if [ "$VERDICT" = "BLOCK" ]; then
  err "pr-self-review: BLOCK — $CRITICAL_COUNT critical finding(s). See report above."
  if [ "$MODE" = "enforce" ]; then
    err "Push aborted (PR_SELF_REVIEW_MODE=enforce). Fix the findings, add a '// pr-self-review-ignore: <rule-id>' suppression if it's a false positive, or bypass with 'git push --no-verify' / SKIP_PR_SELF_REVIEW=1."
    exit 1
  else
    warn "Push allowed anyway (PR_SELF_REVIEW_MODE=warn, the default). Set PR_SELF_REVIEW_MODE=enforce in your shell profile once you trust this gate."
    exit 0
  fi
fi

log "pr-self-review: ALLOW"
exit 0
