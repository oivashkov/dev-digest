# Insights — client

UI decisions and dead ends. Read before restructuring pages, state, or the data
layer.

Read at the start of a task, written at the end of one, by the
`engineering-insights` skill. Sections are fixed — add to the one that fits,
newest first. If it would be obvious to anyone reading the code, leave it out.

Formats — `Decisions` takes prose; every other section takes a dated bullet:

```markdown
### YYYY-MM-DD — <short title>

**What:** the decision, in one sentence.
**Why:** the constraint that forced it.
**Rejected:** what we tried or considered, and how it failed.
```

```markdown
- **YYYY-MM-DD** — <the claim, specific enough to act on cold>.
  `src/path/to/file.tsx:42`
```

Roughly 5 entries per section. Promote stable entries into `docs/` and delete
them here.

---

## Decisions

### 2026-08-06 — Hover popovers render through a portal, not `position: absolute`

**What:** the FINDINGS column's per-severity hover tooltip
(`src/components/hover-popover/HoverPopover.tsx`) renders its panel via
`createPortal(document.body)`, positioned with `position: fixed` computed
from the trigger's `getBoundingClientRect()` on open, instead of an
`absolute` child of the trigger like `@devdigest/ui`'s `Dropdown`.
**Why:** the PR list's `pulls/styles.ts` `s.tableCard` has `overflow:
"hidden"` (needed so row-hover backgrounds respect the card's rounded
corners) — any `absolute` panel inside it gets clipped at the card's edge,
which breaks a tooltip meant to float over the rows below.
**Rejected:** copying `Dropdown`'s `position: absolute` pattern directly —
works fine for `Dropdown` because none of its call sites sit inside an
`overflow: hidden` ancestor; the PR list table is the first place that
constraint bites.

## What Works

_None yet._

## What Doesn't Work

_None yet._

## Codebase Patterns

- **2026-08-10** — `@devdigest/ui`'s barrel (`vendor/ui/index.ts`)
  unconditionally re-exports `./charts` (Recharts-based `LineChart` etc.),
  which is not safe to evaluate in the RSC/server bundle — importing
  anything from `@devdigest/ui` in a Server Component throws `TypeError:
  Super expression must either be null or a function` at
  `vendor/ui/charts/LineChart.tsx` (a class `extends` resolves to
  `undefined` server-side). Every route segment shares the same module
  graph, so this crashes the *entire app* (`GET / 500`), not just the one
  broken page. **Rule: any file importing from `@devdigest/ui` MUST be
  `"use client"`** — no exceptions, even for a component that otherwise
  needs zero interactivity (e.g. `not-found.tsx` needed it only for
  `EmptyState`). `client/src/app/not-found.tsx`, `vendor/ui/index.ts:60`.
  **Verification gap**: `next build`'s static-generation path did NOT
  reproduce this — it prerendered `/_not-found` successfully both broken
  and fixed. Only `next dev` + an actual `curl` against a booted server
  surfaced it. `next build`/`tsc`/vitest passing is not sufficient
  evidence a Server Component boundary is safe — boot `pnpm dev` and hit
  the real routes when adding or changing one.
- **2026-08-06** — A component that is a direct child of `PRRow`'s CSS grid
  (`pulls/styles.ts` `s.row`, `gridTemplateColumns: GRID`) must never
  `return null` for its "empty" state, even though that's the normal React
  idiom — grid track assignment follows DOM children in order, and a `null`
  render drops the node from the DOM entirely, shifting every later column
  one track to the left (STATUS renders under FINDINGS' header, etc.).
  Render an empty `<div />` instead so the cell still claims its track.
  `FindingsCell` hit this for the "reviewed, zero outstanding findings" case.
  `src/app/repos/[repoId]/pulls/_components/PRRow/_components/FindingsCell/FindingsCell.tsx`
- **2026-08-05** — `ReviewRecord` (from `/pulls/:id/reviews`) has no
  `cost_usd`/tokens fields, but `ReviewRecord.run_id` and `RunSummary.run_id`
  (from `/pulls/:id/runs`) are the same key — already relied on by
  `RunHistory`'s `onGoToReview(runId)` to scroll to `#review-run-${run_id}`.
  When a `ReviewRecord`-based row needs a value that only lives on
  `RunSummary`, build a `Map(run_id → value)` from the already-fetched
  `prRuns` where both lists are in scope (`FindingsTab.tsx`) and pass it down
  as a prop, instead of extending the `ReviewRecord` Zod contract end-to-end.
  Used to add the cost badge to `ReviewRunAccordion`'s header — zero
  contract/server changes. `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx`

## Tool & Library Notes

_None yet._

## Recurring Errors & Fixes

- **2026-08-01** — A vitest failure whose two sides look identical —
  `expected '9 119 tok' to be '9 119 tok'` — is a look-alike Unicode space, not
  an environment difference. `formatTokenCount` had a literal THIN SPACE
  (U+2009) typed into `.replace(/,/g, " ")`, invisible in the diff and in the
  test output. Dump code points first —
  `[...s].map((c) => c.charCodeAt(0).toString(16))` — before theorising about
  ICU or jsdom locale data, which is where this was initially misdiagnosed.
  Group digits with `.replace(/\B(?=(\d{3})+(?!\d))/g, " ")` rather than
  `toLocaleString` plus a separator swap, so the separator is a plain U+0020 a
  test can type. Find strays with `rg '\x{2009}' src/`.
  `client/src/lib/format.ts:40`

## Open Questions

_None yet._
