/**
 * Blast Radius — pure mapper (server/src/modules/reviews/blast.ts).
 * Hermetic, no I/O — same style as `test/smart-diff.test.ts`: feed the mapper
 * hand-built `BlastResult`/`IndexState` fixtures (never a real DB/facade
 * call) and assert on the `PrBlastRadius` it produces. Covers the three
 * `status` branches (`full`/`partial`/`degraded`) and caller grouping by
 * `viaSymbol`, per `docs/plans/blast-radius.md` Step 3's test list.
 */
import { describe, it, expect } from 'vitest';
import { buildPrBlastRadius } from '../src/modules/reviews/blast.js';
import type { BlastResult, IndexState } from '../src/modules/repo-intel/types.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';
import { PrBlastRadius } from '@devdigest/shared';

const PR_ID = 'pr-1';
const REPO_ID = 'repo-1';

function indexState(overrides: Partial<IndexState> = {}): IndexState {
  return {
    repoId: REPO_ID,
    status: 'full',
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 100,
    lastIndexedSha: 'abc123',
    indexerVersion: 2,
    updatedAt: new Date('2026-08-20T00:00:00Z'),
    ...overrides,
  };
}

function blastResult(overrides: Partial<BlastResult> = {}): BlastResult {
  return {
    changedSymbols: [],
    callers: [],
    impactedEndpoints: [],
    impactedCrons: [],
    downstreamFiles: [],
    degraded: false,
    ...overrides,
  };
}

describe('buildPrBlastRadius', () => {
  it('status: full — non-degraded result over a fully-indexed repo, no truncation', () => {
    const result = blastResult({
      changedSymbols: [{ file: 'src/payments/service.ts', name: 'chargeCard', kind: 'function' }],
      callers: [
        { file: 'src/api/routes.ts', symbol: 'postCharge', viaSymbol: 'chargeCard', line: 42, rank: 0.9 },
      ],
      impactedEndpoints: ['POST /api/charge'],
      impactedCrons: [],
      factsByFile: { 'src/api/routes.ts': { endpoints: ['POST /api/charge'], crons: [] } },
    });

    const out = buildPrBlastRadius({ prId: PR_ID, repoId: REPO_ID, result, indexState: indexState() });

    expect(out.status).toBe('full');
    expect(out.reason).toBeUndefined();
    expect(out.symbols).toHaveLength(1);
    expect(out.symbols[0]).toMatchObject({
      name: 'chargeCard',
      file: 'src/payments/service.ts',
      callers: [{ file: 'src/api/routes.ts', symbol: 'postCharge', line: 42, rank: 0.9 }],
      endpoints: ['POST /api/charge'],
      crons: [],
      callers_truncated: false,
    });
    expect(out.counts).toEqual({ symbols: 1, callers: 1, endpoints: 1, crons: 0 });
    expect(() => PrBlastRadius.parse(out)).not.toThrow();
  });

  it('status: partial — from IndexState.status, from BlastResult.truncated, and from a callers_truncated symbol', () => {
    const base = blastResult({
      changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
    });

    const fromIndexState = buildPrBlastRadius({
      prId: PR_ID,
      repoId: REPO_ID,
      result: base,
      indexState: indexState({ status: 'partial' }),
    });
    expect(fromIndexState.status).toBe('partial');
    expect(fromIndexState.reason).toBe('index_partial');

    const fromDownstreamTruncation = buildPrBlastRadius({
      prId: PR_ID,
      repoId: REPO_ID,
      result: { ...base, truncated: true },
      indexState: indexState(),
    });
    expect(fromDownstreamTruncation.status).toBe('partial');
    expect(fromDownstreamTruncation.reason).toBe('truncated');

    const cappedCallers = Array.from({ length: MAX_CALLERS_PER_SYMBOL }, (_, i) => ({
      file: `src/caller${i}.ts`,
      symbol: `caller${i}`,
      viaSymbol: 'foo',
      line: 1,
      rank: 0,
    }));
    const fromCallerCap = buildPrBlastRadius({
      prId: PR_ID,
      repoId: REPO_ID,
      result: { ...base, callers: cappedCallers },
      indexState: indexState(),
    });
    expect(fromCallerCap.status).toBe('partial');
    expect(fromCallerCap.reason).toBe('truncated');
    expect(fromCallerCap.symbols[0]!.callers_truncated).toBe(true);
  });

  it('status: degraded — mirrors BlastResult.degraded/reason regardless of index state', () => {
    const result = blastResult({ degraded: true, reason: 'no_data' });

    const out = buildPrBlastRadius({
      prId: PR_ID,
      repoId: REPO_ID,
      result,
      indexState: indexState({ status: 'degraded', degraded: true, degradedReason: 'no_data' }),
    });

    expect(out.status).toBe('degraded');
    expect(out.reason).toBe('no_data');
    expect(out.symbols).toEqual([]);
    expect(() => PrBlastRadius.parse(out)).not.toThrow();
  });

  it('groups callers by viaSymbol into separate symbols, attributing only each symbol\'s own callers/facts', () => {
    const result = blastResult({
      changedSymbols: [
        { file: 'src/a.ts', name: 'foo', kind: 'function' },
        { file: 'src/b.ts', name: 'bar', kind: 'function' },
      ],
      callers: [
        { file: 'src/caller-foo.ts', symbol: 'useFoo', viaSymbol: 'foo', line: 5, rank: 0.5 },
        { file: 'src/caller-bar-1.ts', symbol: 'useBar', viaSymbol: 'bar', line: 9, rank: 0.4 },
        { file: 'src/caller-bar-2.ts', symbol: 'useBarToo', viaSymbol: 'bar', line: 3, rank: 0.2 },
      ],
      impactedEndpoints: ['GET /foo', 'GET /bar'],
      factsByFile: {
        'src/caller-foo.ts': { endpoints: ['GET /foo'], crons: [] },
        'src/caller-bar-1.ts': { endpoints: ['GET /bar'], crons: ['nightly-bar'] },
        'src/caller-bar-2.ts': { endpoints: [], crons: [] },
      },
      impactedCrons: ['nightly-bar'],
    });

    const out = buildPrBlastRadius({ prId: PR_ID, repoId: REPO_ID, result, indexState: indexState() });

    const foo = out.symbols.find((s) => s.name === 'foo')!;
    const bar = out.symbols.find((s) => s.name === 'bar')!;
    expect(foo.callers.map((c) => c.file)).toEqual(['src/caller-foo.ts']);
    expect(foo.endpoints).toEqual(['GET /foo']);
    expect(foo.crons).toEqual([]);
    expect(bar.callers.map((c) => c.file)).toEqual(['src/caller-bar-1.ts', 'src/caller-bar-2.ts']);
    expect(bar.endpoints).toEqual(['GET /bar']);
    expect(bar.crons).toEqual(['nightly-bar']);
    expect(out.counts.callers).toBe(3);
    expect(() => PrBlastRadius.parse(out)).not.toThrow();
  });
});
