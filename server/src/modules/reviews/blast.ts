import type { PrBlastCaller, PrBlastRadius, PrBlastSymbol } from '@devdigest/shared';
import type { BlastCallerRow, BlastResult, IndexState } from '../repo-intel/types.js';
import { MAX_CALLERS_PER_SYMBOL } from '../repo-intel/constants.js';

/**
 * Blast Radius — pure mapper (`repo-intel`'s `BlastResult` + `IndexState` →
 * the `PrBlastRadius` wire contract). Per `docs/plans/blast-radius.md` Step 3:
 * NO I/O, NO imports of `fastify`/`db` — same shape and reasoning as
 * `smart-diff.ts`'s `buildSmartDiff` (a pure classifier/builder colocated with
 * the route that calls it, not inside `repo-intel` itself, because grouping
 * callers by symbol and deciding `full`/`partial`/`degraded` is a
 * presentation concern of THIS route, not part of the facade's read model).
 *
 * `MAX_CALLERS_PER_SYMBOL` is imported (not re-derived) purely as a numeric
 * constant to detect a per-symbol truncation signal — this does NOT reach
 * into `repo-intel/repository.ts` or touch `file_edges`, so it stays inside
 * the Onion boundary (`backend-onion-architecture`: only `repo-intel`
 * builds queries against its own tables; a shared read-only constant is not
 * that).
 */

export interface BlastMapperInput {
  prId: string;
  repoId: string;
  result: BlastResult;
  indexState: IndexState;
}

/**
 * `BlastResult.callers` arrives ALREADY capped to `MAX_CALLERS_PER_SYMBOL`
 * per `viaSymbol` (`repo-intel/service.ts`'s `capCallersPerSymbol`) — the
 * mapper never sees the pre-cap count, so "was this symbol's caller list
 * truncated?" can only be inferred from hitting the cap exactly. This is a
 * heuristic (a symbol with EXACTLY 20 real callers reads as truncated too),
 * documented here rather than re-plumbed through the facade, since a false
 * positive only shows an (accurate, if slightly overcautious) "may be
 * truncated" hint, never a false "not truncated".
 */
function groupCallersBySymbol(callers: BlastCallerRow[]): Map<string, BlastCallerRow[]> {
  const byViaSymbol = new Map<string, BlastCallerRow[]>();
  for (const c of callers) {
    const group = byViaSymbol.get(c.viaSymbol);
    if (group) group.push(c);
    else byViaSymbol.set(c.viaSymbol, [c]);
  }
  return byViaSymbol;
}

function toCallerDto(c: BlastCallerRow): PrBlastCaller {
  return { file: c.file, symbol: c.symbol, line: c.line, rank: c.rank };
}

export function buildPrBlastRadius(input: BlastMapperInput): PrBlastRadius {
  const { prId, repoId, result, indexState } = input;
  const callersBySymbol = groupCallersBySymbol(result.callers);
  const factsByFile = result.factsByFile ?? {};

  let callersTruncatedAny = false;
  const symbols: PrBlastSymbol[] = result.changedSymbols.map((sym) => {
    const group = callersBySymbol.get(sym.name) ?? [];
    const callersTruncated = group.length >= MAX_CALLERS_PER_SYMBOL;
    if (callersTruncated) callersTruncatedAny = true;

    const endpoints = new Set<string>();
    const crons = new Set<string>();
    for (const file of new Set(group.map((c) => c.file))) {
      const facts = factsByFile[file];
      if (!facts) continue;
      for (const e of facts.endpoints) endpoints.add(e);
      for (const c of facts.crons) crons.add(c);
    }

    return {
      name: sym.name,
      file: sym.file,
      kind: sym.kind,
      callers: group.map(toCallerDto),
      endpoints: [...endpoints],
      crons: [...crons],
      callers_truncated: callersTruncated,
    };
  });

  const counts = {
    symbols: symbols.length,
    callers: symbols.reduce((sum, s) => sum + s.callers.length, 0),
    endpoints: result.impactedEndpoints.length,
    crons: result.impactedCrons.length,
  };

  let status: PrBlastRadius['status'];
  let reason: PrBlastRadius['reason'];
  if (result.degraded) {
    status = 'degraded';
    reason = result.reason;
  } else if (indexState.status === 'partial') {
    status = 'partial';
    reason = 'index_partial';
  } else if (result.truncated || callersTruncatedAny) {
    status = 'partial';
    reason = 'truncated';
  } else {
    status = 'full';
    reason = undefined;
  }

  return {
    pr_id: prId,
    repo_id: repoId,
    symbols,
    impacted_endpoints: result.impactedEndpoints,
    impacted_crons: result.impactedCrons,
    counts,
    status,
    reason,
  };
}
