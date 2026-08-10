# Examples — frontend-architecture

Concrete good/bad pairs for each rule in [SKILL.md](SKILL.md).

## Component folder shape

**Good** — split by folder, one concern per file:

```
src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/
├── FindingCard.tsx
├── FindingCard.test.tsx
├── styles.ts
├── constants.ts
├── helpers.ts
└── index.ts
```

**Bad** — one file growing without bound:

```
src/app/repos/[repoId]/pulls/[number]/_components/FindingCard.tsx
# 400 lines: component + inline styles + magic strings + parsing helpers + tests missing
```

When `FindingCard` itself needs sub-parts, nest — don't flatten into the
parent file:

```
FindingCard/
├── FindingCard.tsx
├── constants.ts
├── helpers.ts
├── index.ts
└── _components/
    └── SeverityBadge/
        ├── SeverityBadge.tsx
        ├── constants.ts
        └── index.ts
```

## Pages stay thin

**Good** — `src/app/agents/page.tsx`:

```tsx
import { AgentsListView } from "./_components/AgentsListView";

/* Route: /agents (Agents list). Thin route entry — the view, its create
   modal, styles, constants, helpers and i18n are colocated under
   _components/AgentsListView. */
export default function AgentsPage() {
  return <AgentsListView />;
}
```

**Bad** — logic inlined into the route file:

```tsx
// app/agents/page.tsx
"use client";
export default function AgentsPage() {
  const { data } = useAgents(); // should be in _components/AgentsListView
  const [filter, setFilter] = useState("");
  const filtered = data?.filter((a) => a.name.includes(filter));
  // ...100 more lines of markup, filtering, modal state...
}
```

## Data fetching through hooks, never `fetch` in components

**Good**:

```tsx
// src/lib/hooks/agents.ts
export function useAgents() {
  return useQuery({ queryKey: ["agents"], queryFn: () => api.get("/agents") });
}

// _components/AgentsListView/AgentsListView.tsx
import { useAgents } from "@/lib/hooks";

export function AgentsListView() {
  const { data, isLoading } = useAgents();
  // render only
}
```

**Bad**:

```tsx
// _components/AgentsListView/AgentsListView.tsx
export function AgentsListView() {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetch("/api/agents").then((r) => r.json()).then(setData); // bypasses src/lib/api.ts + hooks layer
  }, []);
}
```

## Constants: colocated, not global

**Good**:

```
src/components/diff-viewer/constants.ts       # only diff-viewer uses these
src/app/repos/[repoId]/pulls/constants.ts      # shared by everything under /pulls
src/vendor/ui/primitives/tokens.ts             # design tokens, reuse don't recreate
```

**Bad**:

```
src/constants.ts   # a growing dumping ground unrelated features import from
```

## Utils vs. helpers

**Good** — component-local logic stays local until reused:

```ts
// _components/FindingCard/helpers.ts — only FindingCard uses this
export function severityRank(sev: Severity): number { ... }
```

Once a second, unrelated component needs the same logic, promote it:

```ts
// src/lib/format.ts — generic, app-wide, reused by multiple features
export function formatTokenCount(n: number): string { ... }
```

**Bad** — creating `src/utils/` (or `src/helpers/`) as a generic top-level
folder "just in case." This project deliberately has neither; new shared
logic goes in flat `src/lib/*.ts` once it's actually shared.

## Rejected: container/presentational split

**Bad** — reintroducing a wrapper container component that only fetches and
passes props down; the hook already does this without a wrapper:

```tsx
// Don't do this — AgentsListViewContainer adds indirection for nothing
function AgentsListViewContainer() {
  const { data } = useAgents();
  return <AgentsListView agents={data} />;
}
function AgentsListView({ agents }: { agents: Agent[] }) { /* render */ }
```

**Good** — the hook-driven component does both, since React hooks already
give the separation the container pattern used to provide:

```tsx
function AgentsListView() {
  const { data: agents } = useAgents();
  // render
}
```
