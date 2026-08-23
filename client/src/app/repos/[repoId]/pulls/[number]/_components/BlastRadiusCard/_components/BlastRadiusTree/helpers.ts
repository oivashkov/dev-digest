import type { PrBlastSymbol } from "@devdigest/shared";

/** Stable React/expansion-state key for a symbol — `name` alone can collide
   across two changed files (e.g. two `index.ts`'s both declaring `run`). */
export function symbolKey(symbol: Pick<PrBlastSymbol, "file" | "name">): string {
  return `${symbol.file}::${symbol.name}`;
}
