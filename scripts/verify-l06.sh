#!/usr/bin/env bash
#
# pnpm verify:l06 — SPEC-04 Eval Pipeline verification gate.
#
# Runs server + client typecheck and full test suites, then asserts the
# four acceptance gates the spec's own Non-functional-requirements section
# names (specs/04-eval-pipeline.md, "Verification"):
#
#   1. The seeded case set reaches >=8 cases (AC 1).
#   2. One-click case creation works both directions — must_find (accepted)
#      and must_not_flag (dismissed), including idempotency (ACs 9-14).
#   3. A system-prompt change + re-run moves recall/precision between two
#      runs of the same case set, at two different agent_versions (ACs 30,
#      53, 64, 66).
#   4. Scoring makes zero LLM calls (AC 35).
#
# Gates 2-4 are implemented as NAMED TESTS already owned by Steps 3/4 of
# specs/04-eval-pipeline-plan.md — this script only re-invokes those exact
# tests narrowly (by file + `-t` title match) to produce one clean
# pass/fail line per gate. It does not duplicate their assertions or write
# new test logic.
#
# Gate 1 is checked STATICALLY against the seed fixture's own array length
# (server/src/db/fixtures/eval-cases.ts), not against a live database.
# Chosen deliberately over querying a running dev DB: a live count would
# depend on external, mutable state (whether `./scripts/dev.sh --db-only`
# was run, whether some other test or manual click has since deleted a
# seeded case) that this script cannot guarantee or reset, whereas the
# fixture array's length is exactly what `pnpm db:seed` inserts
# (server/src/db/seed.ts, onConflictDoNothing on (owner_id, name) — see
# server/INSIGHTS.md 2026-08-12) and is deterministic on every run,
# including in CI where no persistent Postgres is guaranteed to exist. The
# actual insert path is still exercised for real, just not by this gate —
# every `*.it.test.ts` file below calls `seed()` against a real
# testcontainers Postgres in its own `beforeAll`.
#
# Usage: pnpm verify:l06   (from repo root)  ==  ./scripts/verify-l06.sh
#
# Prereqs: Docker running (server's *.it.test.ts suite + gates 2-3 need it;
# they self-skip without it, which this script treats as a gate FAILURE,
# not a pass — "verify:l06 ends green" means the gates were actually
# exercised). `./scripts/dev.sh --db-only` is not required by this script
# itself (every integration test brings up its own ephemeral Postgres via
# testcontainers), but running it first matches the plan's stated
# clean-checkout verification flow.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log()   { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn()  { printf '\033[1;33m! %s\033[0m\n' "$*"; }
sect()  { printf '\n\033[1;35m== %s ==\033[0m\n' "$*"; }
ok()    { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
bad()   { printf '\033[1;31m✗ %s\033[0m\n' "$*"; }

command -v pnpm >/dev/null || { bad "pnpm not found on PATH"; exit 1; }
command -v node >/dev/null || { bad "node not found on PATH"; exit 1; }

FAILED=0

TMPDIR_L06="$(mktemp -d)"
cleanup() { rm -rf "$TMPDIR_L06"; scrub_stray_root_lockfile; }
trap cleanup EXIT

# Root `package.json` is deliberately dependency-free — this repo is NOT a
# pnpm workspace (root AGENTS.md: "Not a monorepo workspace"; this file's
# own header comment repeats it) and must never grow a root lockfile.
# Confirmed empirically while building this script: `pnpm run verify:l06`
# (the exact command this file's usage line above documents) writes a
# stub `pnpm-lock.yaml` at the repo root within seconds — before this
# script's own first line even runs — as a side effect of pnpm v11
# resolving *any* `pnpm run <script>` against a package.json-having
# directory, even one with zero dependencies. This is pnpm's own behavior,
# not something this script's body causes, so it can't be prevented from
# inside the script's normal flow — only cleaned up after. `scrub_stray_
# root_lockfile` removes ONLY a file that is (a) untracked by git (a real,
# intentionally-committed lockfile would never be silently deleted) and
# (b) matches pnpm's known empty-importer stub shape (an actual dependency
# lockfile — the thing this repo must never accidentally grow — looks
# nothing like this and would NOT match, and is therefore left alone).
scrub_stray_root_lockfile() {
  local f="$ROOT/pnpm-lock.yaml"
  [ -f "$f" ] || return 0
  git -C "$ROOT" ls-files --error-unmatch "$f" >/dev/null 2>&1 && return 0 # tracked — never touch
  grep -q "^  \.: {}$" "$f" 2>/dev/null || return 0 # not the known empty stub — leave it, surface it instead
  rm -f "$f"
  warn "removed a stray root pnpm-lock.yaml — pnpm's own 'run' resolution wrote it as a side effect of this invocation (see this script's header comment); root stays lockfile-free by design"
}
scrub_stray_root_lockfile

# -----------------------------------------------------------------------
# 1. Full suites — server typecheck + test (hermetic AND .it.test), then
#    client typecheck + test.
# -----------------------------------------------------------------------

sect "server: typecheck"
(cd server && pnpm typecheck)
[ $? -eq 0 ] && ok "server typecheck" || { bad "server typecheck"; FAILED=1; }

sect "server: hermetic unit tests"
(cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' --reporter=dot)
[ $? -eq 0 ] && ok "server hermetic tests" || { bad "server hermetic tests"; FAILED=1; }

sect "server: integration tests (.it.test)"
(cd server && pnpm exec vitest run .it.test --reporter=dot)
[ $? -eq 0 ] && ok "server integration tests" || { bad "server integration tests"; FAILED=1; }

sect "client: typecheck"
(cd client && pnpm typecheck)
[ $? -eq 0 ] && ok "client typecheck" || { bad "client typecheck"; FAILED=1; }

sect "client: tests"
(cd client && pnpm exec vitest run --reporter=dot)
[ $? -eq 0 ] && ok "client tests" || { bad "client tests"; FAILED=1; }

# -----------------------------------------------------------------------
# Helper: run one named test (by file + `-t` title substring) in isolation
# via the JSON reporter, and classify the outcome. Reused for gates 2-4 so
# each gate gets one unambiguous line instead of grepping prose output.
# -----------------------------------------------------------------------

# run_named_test <pkg_dir> <relative_test_file> <title_substring_or_empty>
# Echoes: "PASS:<n> passed" | "FAIL:<n> failing" | "SKIP:<reason>"
run_named_test() {
  local pkg="$1" file="$2" pattern="$3"
  local out="$TMPDIR_L06/$(basename "$file")-$$-$RANDOM.json"
  if [ -n "$pattern" ]; then
    (cd "$pkg" && pnpm exec vitest run "$file" -t "$pattern" --reporter=json --outputFile="$out") >/dev/null 2>&1
  else
    (cd "$pkg" && pnpm exec vitest run "$file" --reporter=json --outputFile="$out") >/dev/null 2>&1
  fi
  node -e '
    const fs = require("fs");
    let j;
    try { j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch { console.log("SKIP:no JSON report produced (test file failed to load, or Docker is unavailable and the *.it.test.ts self-skipped before writing a report)"); process.exit(0); }
    if (j.numFailedTests > 0) { console.log(`FAIL:${j.numFailedTests} failing`); process.exit(0); }
    if (j.numPassedTests < 1) {
      console.log(`SKIP:0 tests matched/ran (numTotal=${j.numTotalTests}, numPending=${j.numPendingTests}) — likely Docker unavailable (integration suites self-skip) or the test title changed`);
      process.exit(0);
    }
    console.log(`PASS:${j.numPassedTests} passed`);
  ' "$out"
}

report_gate() {
  local gate_label="$1" result="$2"
  local status="${result%%:*}" detail="${result#*:}"
  case "$status" in
    PASS) ok "$gate_label — $detail" ;;
    FAIL) bad "$gate_label — $detail"; FAILED=1 ;;
    SKIP) bad "$gate_label — SKIPPED: $detail"; FAILED=1 ;;
    *)    bad "$gate_label — unrecognized result: $result"; FAILED=1 ;;
  esac
}

sect "Gate checks (specs/04-eval-pipeline.md, Non-functional requirements — Verification)"

# --- Gate 1: seeded set reaches >=8 cases (AC 1) ------------------------
GATE1_COUNT="$(cd server && pnpm exec tsx -e "
  import('./src/db/fixtures/eval-cases.ts').then(m => {
    console.log(m.SECURITY_REVIEWER_EVAL_CASES.length);
  });
" 2>/dev/null | tail -1)"

if ! grep -q "SECURITY_REVIEWER_EVAL_CASES" server/src/db/seed.ts; then
  bad "Gate 1 (>=8 seeded cases) — fixture exists but server/src/db/seed.ts never references SECURITY_REVIEWER_EVAL_CASES (dead fixture, would never actually seed)"
  FAILED=1
elif [ -n "$GATE1_COUNT" ] && [ "$GATE1_COUNT" -ge 8 ] 2>/dev/null; then
  ok "Gate 1 (>=8 seeded cases, AC 1) — $GATE1_COUNT cases in server/src/db/fixtures/eval-cases.ts, wired into server/src/db/seed.ts"
else
  bad "Gate 1 (>=8 seeded cases, AC 1) — expected >=8, found '${GATE1_COUNT:-<none>}' in server/src/db/fixtures/eval-cases.ts"
  FAILED=1
fi

# --- Gate 2: one-click case creation works both directions (ACs 9-14) --
# server/test/evals-cases.it.test.ts's single finding->case test covers
# both must_find (accepted) and must_not_flag (dismissed), the idempotent
# repeat click, the un-actioned 400, and the missing-patch 400.
GATE2_RESULT="$(run_named_test server test/evals-cases.it.test.ts "accepted becomes must_find")"
report_gate "Gate 2 (finding→case, both directions + idempotency, ACs 9-14)" "$GATE2_RESULT"

# --- Gate 3: a system-prompt change + re-run moves recall/precision ----
# between two runs (ACs 30, 53, 64, 66). NOTE (deviation from the plan):
# the plan named server/test/evals-runs.it.test.ts as the home of this
# scenario; the actual test living up to that description —
# two real batch runs of the same case at two different agents.version
# values via a PUT /agents/:id system_prompt edit between them, with
# MockLLMProvider swapped per run — is
# server/test/evals-dashboard.it.test.ts's first test instead. Invoked
# from its real location rather than papering over the plan's file
# reference.
GATE3_RESULT="$(run_named_test server test/evals-dashboard.it.test.ts "computes delta/alert across two runs")"
report_gate "Gate 3 (system-prompt change moves recall/precision across two runs, ACs 30/53/64/66)" "$GATE3_RESULT"

# --- Gate 4: scoring makes zero LLM calls (AC 35) -----------------------
# Primary evidence: server/test/evals-scoring.test.ts exercises
# matchesExpectation/computeRecall/computePrecision/computeCitationAccuracy/
# computePass/scoreEvalCase as plain data-in/data-out functions — it never
# imports the DI container or any adapter, so "zero LLM calls" holds by
# construction, not by assertion. Confirmed structurally below, then the
# whole file is run. Secondary evidence: evals-runs.it.test.ts's zero-cases
# test is the one place in the it.test suite that explicitly asserts
# MockLLMProvider.calls stays empty (there is no dedicated "scoring only,
# mid-batch" .calls assertion — noted as a gap, not papered over).
if grep -qE "adapters/mocks|platform/container|LLMProvider" server/test/evals-scoring.test.ts; then
  bad "Gate 4 (scoring, zero LLM calls, AC 35) — evals-scoring.test.ts references an adapter/container/LLMProvider; the 'zero calls by construction' argument no longer holds structurally"
  FAILED=1
  GATE4_STRUCTURAL_OK=0
else
  GATE4_STRUCTURAL_OK=1
fi
GATE4A_RESULT="$(run_named_test server test/evals-scoring.test.ts "")"
GATE4B_RESULT="$(run_named_test server test/evals-runs.it.test.ts "400s without enqueuing")"
if [ "${GATE4_STRUCTURAL_OK:-0}" -eq 1 ]; then
  report_gate "Gate 4a (pure scorer has no adapter/container import, so zero LLM calls by construction, AC 35)" "$GATE4A_RESULT"
fi
report_gate "Gate 4b (MockLLMProvider.calls stays empty when no cases exist to score)" "$GATE4B_RESULT"

# -----------------------------------------------------------------------
sect "Summary"
if [ "$FAILED" -eq 0 ]; then
  ok "pnpm verify:l06 — ALL GREEN"
  exit 0
else
  bad "pnpm verify:l06 — FAILED (see gates above)"
  exit 1
fi
