/**
 * ConventionsService — extraction job body (hermetic: stubbed repository,
 * mocked LLM, real fs against a temp clone directory). Asserts the WIRING:
 *   - samples come from `repoIntel.getConventionSamples` (never reimplemented),
 *   - re-scan deletes non-accepted candidates BEFORE inserting the fresh batch,
 *   - it degrades silently (no throw, no writes) with no clone / no samples.
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { ConventionsService } from '../src/modules/conventions/service.js';
import type { ConventionsRepository, NewConventionCandidate } from '../src/modules/conventions/repository.js';
import type { Container } from '../src/platform/container.js';

interface RepoBasics {
  id: string;
  fullName: string;
  clonePath: string | null;
}

/** Container stub: `db` only needs to satisfy `resolveFeatureModel`'s
 *  settings lookup (no workspace override → falls back to the registry
 *  default), everything else is overridden directly. */
function makeContainer(opts: {
  samples: string[];
  llm: MockLLMProvider;
}): Container {
  const db = {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  };
  return {
    db,
    repoIntel: { getConventionSamples: async () => opts.samples },
    llm: async () => opts.llm,
  } as unknown as Container;
}

function makeRepoStub(basics: RepoBasics | undefined) {
  const calls: string[] = [];
  const inserted: NewConventionCandidate[] = [];
  const stub = {
    getRepo: async () => basics,
    deleteUnacceptedForRepo: async () => {
      calls.push('delete');
    },
    insertMany: async (_ws: string, _repoId: string, rows: NewConventionCandidate[]) => {
      calls.push('insert');
      inserted.push(...rows);
    },
  } as unknown as ConventionsRepository;
  return { stub, calls, inserted };
}

function makeService(container: Container, repoStub: ConventionsRepository) {
  const service = new ConventionsService(container);
  (service as unknown as { repo: ConventionsRepository }).repo = repoStub;
  return service;
}

async function runExtraction(service: ConventionsService, workspaceId: string, repoId: string) {
  await (
    service as unknown as { runExtraction: (w: string, r: string) => Promise<void> }
  ).runExtraction(workspaceId, repoId);
}

const tempDirs: string[] = [];
function makeClone(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'devdigest-conventions-'));
  tempDirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const FIXTURE_CANDIDATE = {
  category: 'error_handling' as const,
  rule: 'Always wrap DB calls in a Result type',
  evidence_path: 'src/api/users.ts',
  evidence_line_range: '10-14',
  evidence_snippet: 'return ok(user);',
  confidence: 0.8,
};

describe('ConventionsService extraction', () => {
  it('samples via repoIntel.getConventionSamples, extracts, and writes candidates (delete before insert)', async () => {
    const clonePath = makeClone({ 'src/api/users.ts': 'export function get() {}' });
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { ConventionExtraction: { candidates: [FIXTURE_CANDIDATE] } },
    });
    const container = makeContainer({ samples: ['src/api/users.ts'], llm });
    const { stub, calls, inserted } = makeRepoStub({
      id: 'r1',
      fullName: 'acme/app',
      clonePath,
    });
    const service = makeService(container, stub);

    await runExtraction(service, 'w1', 'r1');

    expect(calls).toEqual(['delete', 'insert']); // re-scan replaces before it re-adds
    expect(inserted).toEqual([
      {
        category: 'error_handling',
        rule: FIXTURE_CANDIDATE.rule,
        evidencePath: FIXTURE_CANDIDATE.evidence_path,
        evidenceLineRange: FIXTURE_CANDIDATE.evidence_line_range,
        evidenceSnippet: FIXTURE_CANDIDATE.evidence_snippet,
        confidence: FIXTURE_CANDIDATE.confidence,
      },
    ]);
    // The prompt reached the model with the sampled file's content.
    const call = llm.calls.find((c) => c.method === 'completeStructured');
    const req = call?.req as { messages: { content: string }[] };
    expect(req.messages[1]?.content).toContain('export function get() {}');
  });

  it('degrades silently (no writes) when the repo has no clone yet', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { ConventionExtraction: { candidates: [FIXTURE_CANDIDATE] } },
    });
    const container = makeContainer({ samples: ['src/a.ts'], llm });
    const { stub, calls } = makeRepoStub({ id: 'r1', fullName: 'acme/app', clonePath: null });
    const service = makeService(container, stub);

    await runExtraction(service, 'w1', 'r1');

    expect(calls).toEqual([]);
    expect(llm.calls).toEqual([]);
  });

  it('degrades silently when repoIntel has no samples to offer', async () => {
    const clonePath = makeClone({});
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { ConventionExtraction: { candidates: [FIXTURE_CANDIDATE] } },
    });
    const container = makeContainer({ samples: [], llm });
    const { stub, calls } = makeRepoStub({ id: 'r1', fullName: 'acme/app', clonePath });
    const service = makeService(container, stub);

    await runExtraction(service, 'w1', 'r1');

    expect(calls).toEqual([]);
    expect(llm.calls).toEqual([]);
  });
});
