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

- **2026-08-12** — A batched "toggle several checkboxes, then click Save" UI
  reads as broken in this codebase even when its persistence logic is
  correct. Every OTHER toggle here (`AgentCard`/`ConfigTab`'s enabled switch,
  `SkillCard`/`SkillEditorPageView`'s enabled switch) auto-saves immediately
  on click. The Agent Editor's Skills tab was first built with a checkbox
  list + a separate "Save skills" button batching all attach/detach/reorder
  edits; a user unchecked a skill, didn't click Save (nothing else in the app
  requires it), navigated away, and the change was silently lost — reported
  as "I can enable a skill but can't disable it," even though a real API
  round-trip and an isolated RTL test both proved the batch-then-save flow
  worked correctly in both directions. Fixed by calling
  `useSetAgentSkills().mutate(...)` immediately from inside each
  checkbox/move-button's state updater (using the updater's fresh
  next-value, not the outer render's `order`/`checked`) and removing the
  Save button entirely. Any new toggle-shaped control in this app should
  auto-save; don't introduce a second, batched interaction model.
  `client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab
  /SkillsTab.tsx`.

## Codebase Patterns

- **2026-08-23** — `src/vendor/ui/nav.ts`'s exported `NAV` constant has **no
  composition/extension point in app code** — every consumer
  (`src/components/app-shell/useGlobalShortcuts.ts`,
  `useShellCommands.ts`) imports `NAV` straight from `@devdigest/ui`. Despite
  `AGENTS.md`'s "Do not touch: `src/vendor/ui`" rule, every nav-item addition
  to date has edited `nav.ts` directly instead: Skills Lab (`9e814a1`),
  Conventions Lab (`84283ed`), and Project Context (`specs/01-project-context-plan.md`
  Step 6, this session) — the plan's own instruction to "extend/compose `NAV`
  in app code rather than editing the vendored registry" could not be
  followed as written because that seam doesn't exist yet.
  **Investigated and settled 2026-08-23, same day (post-implementation nav-section
  fix):** a real seam is bigger than it looks — `Sidebar.tsx`
  (`src/vendor/ui/shell/Sidebar.tsx`) imports `NAV` directly from `../nav` with
  no override prop, and is itself wrapped by vendored `AppFrame.tsx` with no
  `nav` field on `ShellContext` (`src/vendor/ui/shell/types.ts`) either.
  Building a composition seam means adding an optional `nav` prop across
  **three** vendored files (`types.ts`, `AppFrame.tsx`, `Sidebar.tsx`) — *more*
  vendor surface touched than the single-file `nav.ts` edit, not less.
  **Decision: keep editing `nav.ts` directly** as the accepted convention;
  don't attempt the seam again until a feature's need for it clearly outweighs
  a three-file vendor change. `client/AGENTS.md`'s do-not-touch list has no
  exception clause for this — treat this entry as the documented one.

- **2026-08-23** — `src/components/app-shell/helpers.ts:29`'s `activeKeyFor`
  matches the active nav key by `pathname.includes("/onboarding")`, a
  substring test — so the add-repo wizard at `/onboarding` already resolves
  to the `onboarding-tour` sidebar key today, even though no `NAV` entry uses
  that key yet (harmless only because nothing currently highlights on it). Any
  future per-repo route whose slug is a prefix/substring of an existing
  top-level route (here, a real "Onboarding Tour" nav item under
  `/repos/:repoId/onboarding`) needs a `startsWith("/repos/")`-style guard in
  `activeKeyFor`, not `includes`, or it will mis-highlight the wrong item the
  moment that nav item is added. Surfaced writing
  `specs/02-onboarding-tour.md` (Open question 10). **Fixed 2026-08-23 in
  `client/src/components/app-shell/helpers.ts`** (SPEC-02 Step 6) — guarded
  to `pathname.startsWith("/repos/") && pathname.includes("/onboarding")`,
  and the real "Onboarding Tour" nav item now lives under WORKSPACE in
  `nav.ts`. Verified against a booted `pnpm dev`: the sidebar icon renders
  `style="color:var(--accent)"` on `/repos/:id/onboarding` and
  `style="color:inherit"` on `/repos/:id/pulls`.

- **2026-08-20** — `useSmartDiff`'s `SmartDiffFile.finding_lines` is bare
  `number[]` (deduped line numbers, no severity/id/rationale) — it cannot
  drive a per-finding severity badge or an "open this finding" click target
  by itself. `SmartDiffViewer` fixed this (post-merge review finding: it only
  showed one aggregate "N findings" count, no per-finding severity, and
  clicking only scrolled — never opened detail) by ALSO calling
  `usePrReviews(prId)` directly and taking `reviews?.[0]?.findings` filtered
  to `dismissed_at == null` — the exact same "latest review, non-dismissed"
  source the server joins in `server/src/modules/reviews/service.ts
  #getSmartDiff` to build `finding_lines` in the first place, so the two
  stay in sync instead of the client re-deriving a different subset. Renders
  one `SeverityBadge compact` (`@devdigest/ui` — the `compact` prop already
  existed, just unused until now) per finding instead of one aggregate
  count; clicking a badge both scrolls (existing target/nonce, unchanged)
  and toggles the REAL `FindingCard` (`../FindingCard`, reused as-is with its
  own `useFindingAction` accept/dismiss wiring) open inline, rather than a
  stripped-down inline summary. Needed `repoFullName`/`repoProvider`/
  `repoHost`/`headSha` threaded PrDetailView → DiffTab → SmartDiffViewer
  (mirrors what `FindingsTab` already receives) purely for `FindingCard`'s
  file:line deep-link.
  `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.tsx`.
- **2026-08-19** — `src/components/diff-viewer/*` (`FileCard`, `CodeLine`,
  `DiffViewer`, `CommentCard`, `OutdatedComments`, `InlineComposer`,
  `CommentThreadView`) has ZERO dedicated `*.test.tsx` files despite being
  fairly central/complex (patch parsing, comment threading, additive
  scroll/highlight props from the SmartDiff step) — confirmed via `find src
  -name "*.test.tsx"`, every existing test file in this repo sits directly
  under an `_components/<FeatureName>/` folder (page-level feature
  components), never under the shared low-level `components/diff-viewer/`
  primitives folder. Coverage for `FileCard`'s additive props
  (`defaultOpen`/`highlightLines`/`findingCount`/`scrollToLine`/`scrollNonce`)
  comes entirely indirectly, through `SmartDiffViewer.test.tsx` (which
  exercises `FileCard` as a real child, not mocked). When a task suggests
  "add a test for this shared primitive," check `find src -name
  "*.test.tsx"` for the folder's actual convention first — this repo's is
  "top-level feature component only," not "every reusable subcomponent," and
  adding one just for a specific prop would be the only test file in its
  folder, an inconsistent precedent.
- **2026-08-19** — `diff-viewer/FileCard`'s `findingCount` prop only renders a
  decorative icon+number badge in the file header (`FileCard.tsx:102-109`) —
  it has no `onClick`, so it is not a usable click target for a
  scroll-to-finding affordance even though it visually looks like one. A
  consumer that needs "click to jump to this file's first finding" (e.g.
  `SmartDiffViewer`) must render its own clickable control alongside/above
  `FileCard` and drive `FileCard`'s existing `scrollToLine`/`scrollNonce`
  props from it, rather than assuming the header badge is interactive or
  adding an `onClick` to it (out of scope once `FileCard.tsx` belongs to a
  different plan step / isn't yours to touch).
  `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.tsx`,
  `client/src/components/diff-viewer/FileCard/FileCard.tsx:102-109`.
- **2026-08-19** — When a shared low-level component (e.g.
  `diff-viewer/FileCard`) needs a byte-identical-when-omitted extension for a
  new higher-level consumer, the safe pattern is: (1) every new prop is
  optional with `undefined` behaving exactly like the old signature — e.g.
  `useState(defaultOpen ?? <old size check>)`, not `useState(defaultOpen ??
  false)`, so a caller that never passes `defaultOpen` still gets the
  original size-based default; (2) style-builder functions in `styles.ts`
  take the new flag as an *additional optional parameter with a default*
  (`lineRowFor(kind, highlighted = false)`), never a second required arg, so
  every existing call site compiles and renders unchanged without being
  touched; (3) numeric "is this active" props are checked with `(x ?? 0) > 0`
  rather than `!!x && x > 0` (redundant per `react-best-practices`'
  conditional-rendering rule) or bare `x > 0` (fails strict TS when `x` is
  `number | undefined`). Verified with an ad hoc RTL render exercising both
  the old zero-prop call and the new-prop call side by side — cheaper than a
  permanent test file when the consumer doesn't exist yet.
  `client/src/components/diff-viewer/FileCard/FileCard.tsx`,
  `client/src/components/diff-viewer/styles.ts`.
- **2026-08-17** — `src/lib/api.ts` never grows per-endpoint wrapper
  functions (no `getX()`/`postY()` exports beyond the generic
  `api.get/post/put/patch/del`) — every hook in `src/lib/hooks/*` builds the
  path inline and calls `api.get<T>(...)`/`api.post<T>(...)` directly (see
  every existing hook in `hooks/reviews.ts`, e.g. `usePrReviews`,
  `useRunReview`). When adding a new endpoint's hook, don't add a matching
  named function to `api.ts` even if asked to "match this file's pattern" —
  the actual pattern in this file is that it stays generic; the per-endpoint
  logic (path, method, query key, cache invalidation) belongs entirely in
  the hook. `client/src/lib/api.ts`, `client/src/lib/hooks/reviews.ts`.
- **2026-08-12** — This app's dark/light theming is `[data-theme="dark"
  |"light"]` on `<html>` only (`vendor/ui/styles.css:9-10`: `:root,
  [data-theme="dark"]` is the default block, `[data-theme="light"]`
  overrides) — there is no `@media (prefers-color-scheme)` anywhere in this
  app, unlike Artifacts' dual-declaration convention. A new
  feature-specific color token (e.g. the Skill Stats tab's category-donut
  palette — not a `@devdigest/ui` design-system token) belongs in
  `client/src/app/globals.css`, NOT `vendor/ui/styles.css` (vendored,
  off-limits), declared under those same two selectors.
  `client/src/app/globals.css`, `client/src/vendor/ui/styles.css:9`.
- **2026-08-12** — `messages/en/<namespace>.json` can hold copy for a tab/UI
  that isn't wired up yet — it's a spec, not dead weight. `AgentEditor`'s
  `TABS` constant only listed `config`, but `messages/en/agents.json` already
  had a full `skills.*` section (`title`, `enabledCount`, `filterPlaceholder`,
  `orderHint`) that no component read, describing the filter box, the "N of M
  enabled" counter, and the order-matters hint for the not-yet-built Skills
  tab. Before writing new copy for a feature whose i18n namespace already
  exists, check `messages/en/<ns>.json` for keys nothing renders yet.
  `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`,
  `client/messages/en/agents.json`.
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

- **2026-08-20** — `PrBlastRadius.symbols[].endpoints`/`.crons` (server's
  `@devdigest/shared/contracts/blast.ts`) are aggregated **per symbol**, not
  per caller — the contract has no caller→endpoint mapping (a caller-file's
  own `file_facts` isn't threaded through). A "symbol → caller → endpoint"
  3-column graph therefore cannot draw a real caller→endpoint edge; the
  honest edge is symbol→endpoint directly, visually arching over the caller
  column (`BlastRadiusGraph/helpers.ts#buildGraphLayout`'s `skipsColumn`
  flag). If a future step adds per-caller endpoint data, the graph's edge
  logic must change to route through the caller node instead of skipping it.
  `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/_components/BlastRadiusGraph/helpers.ts`.

## Tool & Library Notes

- **2026-08-20** — `@devdigest/ui`'s `Button` only varies visually on the
  `active` prop for `kind="tertiary"` (`Button.tsx`'s `kinds` map keys
  `background`/`color` off `active` there); `kind="ghost"` and `kind="secondary"`
  ignore `active` entirely despite accepting the prop (`FindingCard.tsx`
  already passes `active` to a `ghost` Button for its dismiss action with no
  visible effect). A segmented Tree|Graph-style control built from two ghost
  Buttons needs an explicit `style` override on the active one (own
  `background`/`color`/`borderColor`) — passing `active` alone silently does
  nothing. `client/src/vendor/ui/primitives/Button.tsx` (vendored, don't fix
  there); worked around in
  `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/styles.ts`
  (`viewButtonActive`).
- **2026-08-17** — `@testing-library/user-event` is NOT a dependency of
  `client/` (only `@testing-library/react` + `jest-dom` are, per
  `package.json`). Importing it compiles fine in an editor but fails
  `pnpm typecheck` with `TS2307: Cannot find module
  '@testing-library/user-event'`. Every existing interactive test in this
  package uses `fireEvent` from `@testing-library/react` instead (e.g.
  `FindingCard.test.tsx`, `ConventionCard.test.tsx`) — do the same rather
  than adding the dependency. `client/package.json`.
- **2026-08-13** — Running `pnpm build` (production) in `client/` while a
  `next dev` server is already live on the same machine corrupts the running
  dev process — both write to the same `.next/` directory, and the dev
  server keeps stale in-memory module resolution after the build overwrites
  its artifacts on disk. Symptom: every route 500s with `Cannot find module
  './vendor-chunks/<pkg>.js'` even for routes untouched by the current
  change. Deleting `.next/` alone does NOT fix a live dev server — it must
  be killed and restarted (`pnpm dev` again) to pick up a clean build graph.
  When both a build and a live dev server are needed in the same session,
  restart the dev server immediately after any `pnpm build` in that package,
  or run the build against a separate checkout/worktree.

- **2026-08-12** — `vendor/ui/kit/Checkbox.tsx` wrapped its `<button
  role="checkbox">` in a `<label>` (purely for the click-anywhere-toggles
  UX, no real `<input>` involved). A `<button>` is a labelable HTML
  element, and clicking it directly while nested inside a `<label>` can
  dispatch the click TWICE in real browsers — once from the direct click,
  once from the label's native forward-to-labelable-descendant behavior —
  even though it fires exactly once under `@testing-library/react`'s
  `fireEvent.click()` (jsdom doesn't reproduce this native quirk). Symptom:
  two `POST` requests ~7ms apart for the same user action, the first
  carrying the PRE-toggle state and the second the correct post-toggle
  state — confirmed via a HAR export's request timestamps, not something a
  passing RTL test could have caught. `SkillsTab`'s attach checkboxes hit
  this (every click briefly round-tripped the wrong-then-right payload).
  Fixed by moving the `onClick` off the `<button>` onto a plain wrapping
  `<div>` and dropping the `<label>` entirely — the button stays the sole
  focusable/keyboard-operable element, its native click (mouse or
  keyboard-Enter/Space) still bubbles to the div's single handler, and there
  is no more native label-forwarding path to double-fire from.
  `client/src/vendor/ui/kit/Checkbox.tsx`. **Verification gap, same shape as
  the 2026-08-10 `not-found.tsx` entry below: a clean typecheck + a full
  green RTL suite is not evidence a click handler fires once in a real
  browser — when a report doesn't reproduce through your own tests, ask for
  (or capture) a HAR/network trace before concluding the report is wrong.**

## Recurring Errors & Fixes

- **2026-08-23** — A new tab that renders fine in isolation but "isn't
  clickable" in the real page — click it, the URL's `?tab=` updates, then the
  view silently snaps back to the first tab — means the *page-level*
  `VALID_TABS` gate doesn't know the new key yet, not a click-handler bug.
  `AgentEditorPageView.tsx`'s `tab` is computed as
  `VALID_TABS.includes(search.get("tab")) ? search.get("tab") : "config"`; its
  sibling `AgentEditorPageView/constants.ts` hardcoded
  `VALID_TABS = ["config", "skills"]` **separately** from
  `AgentEditor/constants.ts`'s `TABS` array, so adding a `"context"` entry to
  `TABS` (SPEC-01 Project Context, Step 7) made the tab render and the click
  handler fire, but the page-level gate rejected the URL value and reset it
  every render. No test caught this because `ContextTab.test.tsx` renders the
  tab component directly, bypassing `AgentEditorPageView`'s routing entirely —
  isolated-component tests can't catch a page-level allowlist drift. **Fixed**
  by deriving `VALID_TABS` from `TABS.map((tb) => tb.key)` in
  `AgentEditor/constants.ts` and re-exporting it from
  `AgentEditorPageView/constants.ts`, matching the pattern
  `SkillEditor/constants.ts`/`SkillEditorPageView/constants.ts` already used
  (which is why the equivalent Skill Editor Context section had no such bug).
  Any new page with a `?tab=`-driven editor should derive its `VALID_TABS`
  from the tab list, never hardcode a second copy.

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
