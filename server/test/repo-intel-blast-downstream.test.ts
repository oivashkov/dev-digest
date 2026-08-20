/**
 * Blast Radius plan, Step 2 — reverse 2-level `file_edges` walk + the
 * per-symbol caller cap (`docs/plans/blast-radius.md`).
 *
 * Hermetic: `RepoIntelService`'s `repo` (RepoIntelRepository) is fully
 * stubbed — no Postgres, no clone — same pattern as
 * `repo-intel-facade-degraded.test.ts`. These tests exercise
 * `tryPersistentBlast`/`walkDownstreamFiles` THROUGH the public
 * `getBlastRadius(repoId, changedFiles)` entry point, since both are private.
 */
import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { MAX_REVERSE_FANOUT_PER_LEVEL } from '../src/modules/repo-intel/constants.js';
import type {
  FullSymbolRow,
  ImporterRow,
  IndexerFileFactsRow,
  ResolvedCallerRow,
} from '../src/modules/repo-intel/repository.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';

interface RepoStubOpts {
  /** Symbols declared per changed/caller file, keyed by file path. */
  declaredSymbols?: Record<string, FullSymbolRow[]>;
  /** Resolved cross-file callers returned for the changed symbol names. */
  resolvedCallers?: ResolvedCallerRow[];
  /** `file_edges` fan-in graph: `toFile` -> its direct importers. */
  importersByToFile?: Record<string, ImporterRow[]>;
  /** `file_facts` rows, keyed by file path. */
  fileFacts?: Record<string, IndexerFileFactsRow>;
}

/** A full ('full' status, non-degraded) persistent-index service stub. */
function buildPersistentService(opts: RepoStubOpts): RepoIntelService {
  const declaredSymbols = opts.declaredSymbols ?? {};
  const importersByToFile = opts.importersByToFile ?? {};
  const fileFacts = opts.fileFacts ?? {};

  const state: IndexState = {
    repoId: 'r1',
    status: 'full',
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 100,
    lastIndexedSha: 'deadbeef',
    indexerVersion: 2,
    updatedAt: new Date(),
  };

  const container = {
    config: { repoIntelEnabled: true },
    db: {} as never,
    codeIndex: { symbols: async () => [], references: async () => [] } as never,
  } as never;

  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    tryGetIndexState: async () => state,
    getSymbolRows: async (_repoId: string, paths: string[]) =>
      paths.flatMap((p) => declaredSymbols[p] ?? []),
    getResolvedCallers: async () => opts.resolvedCallers ?? [],
    getFileFacts: async (_repoId: string, files: string[]) =>
      files.map((f) => fileFacts[f]).filter((f): f is IndexerFileFactsRow => f !== undefined),
    // The method under test: `to_file IN files` fan-in, mirrors the real
    // `file_edges_repo_to_idx (repo_id, to_file)` targeted query — NOT
    // `getEdges()`'s whole-repo read.
    getImporters: async (_repoId: string, files: string[]): Promise<ImporterRow[]> =>
      files.flatMap((f) => importersByToFile[f] ?? []),
  };
  return svc;
}

describe('RepoIntelService.getBlastRadius — 2-level reverse-import walk', () => {
  it('walks exactly 2 levels, stops before a 3rd, and excludes changed files even on a cycle', async () => {
    // a.ts (changed) <- b.ts <- c.ts <- d.ts, plus a cycle back to a.ts at
    // depth 2 that must NOT resurrect it into the result.
    const svc = buildPersistentService({
      declaredSymbols: {}, // no declared symbols → downstream-only branch
      importersByToFile: {
        'a.ts': [{ fromFile: 'b.ts', toFile: 'a.ts', rank: 5 }],
        'b.ts': [
          { fromFile: 'c.ts', toFile: 'b.ts', rank: 3 },
          { fromFile: 'a.ts', toFile: 'b.ts', rank: 99 }, // cycle to the changed file
        ],
        'c.ts': [{ fromFile: 'd.ts', toFile: 'c.ts', rank: 1 }], // would be depth 3
      },
    });

    const blast = await svc.getBlastRadius('r1', ['a.ts']);

    expect(blast.degraded).toBe(false);
    expect(blast.truncated).toBeFalsy();
    const byFile = new Map(blast.downstreamFiles.map((d) => [d.file, d]));
    expect(byFile.get('b.ts')).toEqual({ file: 'b.ts', depth: 1, rank: 5 });
    expect(byFile.get('c.ts')).toEqual({ file: 'c.ts', depth: 2, rank: 3 });
    // Neither the changed file itself nor the depth-3 file made it in.
    expect(byFile.has('a.ts')).toBe(false);
    expect(byFile.has('d.ts')).toBe(false);
    expect(blast.downstreamFiles).toHaveLength(2);
  });

  it('caps a fanned-out level at MAX_REVERSE_FANOUT_PER_LEVEL and sets truncated', async () => {
    const wide = Array.from({ length: 300 }, (_, i) => ({
      fromFile: `caller-${i}.ts`,
      toFile: 'a.ts',
      rank: 300 - i, // caller-0 has the highest rank
    }));
    const svc = buildPersistentService({
      importersByToFile: { 'a.ts': wide },
    });

    const blast = await svc.getBlastRadius('r1', ['a.ts']);

    expect(blast.truncated).toBe(true);
    // Only depth-1 files (no importers of the survivors are stubbed), capped.
    expect(blast.downstreamFiles).toHaveLength(MAX_REVERSE_FANOUT_PER_LEVEL);
    expect(blast.downstreamFiles.every((d) => d.depth === 1)).toBe(true);
    // The highest-ranked callers survive the cut, not an arbitrary subset.
    expect(blast.downstreamFiles.some((d) => d.file === 'caller-0.ts')).toBe(true);
    expect(blast.downstreamFiles.some((d) => d.file === 'caller-299.ts')).toBe(false);
  });

  it('attributes impactedEndpoints/impactedCrons found via the reverse walk even with no direct symbol caller', async () => {
    const svc = buildPersistentService({
      declaredSymbols: {}, // no symbols declared in the changed file
      importersByToFile: {
        'lib/helper.ts': [{ fromFile: 'routes/api.ts', toFile: 'lib/helper.ts', rank: 8 }],
      },
      fileFacts: {
        'routes/api.ts': {
          filePath: 'routes/api.ts',
          endpoints: ['GET /api/items'],
          crons: ['nightly-cleanup'],
        },
      },
    });

    const blast = await svc.getBlastRadius('r1', ['lib/helper.ts']);

    expect(blast.callers).toEqual([]); // no direct symbol-level caller
    expect(blast.impactedEndpoints).toEqual(['GET /api/items']);
    expect(blast.impactedCrons).toEqual(['nightly-cleanup']);
    expect(blast.downstreamFiles.map((d) => d.file)).toContain('routes/api.ts');
  });
});

describe('RepoIntelService.getBlastRadius — per-symbol caller cap', () => {
  it('caps callers at 20 PER changed symbol, not globally across all symbols', async () => {
    const makeCallers = (viaSymbol: string, count: number): ResolvedCallerRow[] =>
      Array.from({ length: count }, (_, i) => ({
        fromPath: `${viaSymbol}-caller-${i}.ts`,
        toSymbol: viaSymbol,
        line: 1,
        rank: count - i,
      }));

    const svc = buildPersistentService({
      declaredSymbols: {
        'src/a.ts': [
          { path: 'src/a.ts', name: 'foo', kind: 'function', line: 1, endLine: 5, exported: true, signature: null },
          { path: 'src/a.ts', name: 'bar', kind: 'function', line: 10, endLine: 15, exported: true, signature: null },
        ],
      },
      resolvedCallers: [...makeCallers('foo', 25), ...makeCallers('bar', 25)],
    });

    const blast = await svc.getBlastRadius('r1', ['src/a.ts']);

    expect(blast.changedSymbols.map((s) => s.name).sort()).toEqual(['bar', 'foo']);
    const fooCallers = blast.callers.filter((c) => c.viaSymbol === 'foo');
    const barCallers = blast.callers.filter((c) => c.viaSymbol === 'bar');
    expect(fooCallers).toHaveLength(20);
    expect(barCallers).toHaveLength(20);
    // 40 total, not a global cap of 20 across both symbols.
    expect(blast.callers).toHaveLength(40);
  });
});
