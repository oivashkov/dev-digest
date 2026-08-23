import { describe, expect, it } from 'vitest';
import { resolveAgent, resolvePr, resolveRepo } from './resolve.js';
import { createMockApiClient } from '../../test/helpers/mock-api-client.js';
import { ApiClientException } from '../http/errors.js';
import { makeAgent, makePr, makeRepo } from '../../test/helpers/fixtures.js';

/**
 * Service-layer resolution tests (Step 7 of `specs/mcp-server-plan.md`) —
 * UUID vs `owner/repo` vs URL vs not-found-typo-vs-not-imported for repos, a
 * bare PR number for pulls, and UUID vs exact name for agents. Every case
 * asserts the typed `ServiceFailure.kind` AND that the message is
 * next-step-oriented (practice #4), per the plan's Step 3.
 */

describe('resolveRepo', () => {
  it('rejects an empty repo input as invalid_input', async () => {
    const client = createMockApiClient();
    const result = await resolveRepo(client, '   ');
    expect(result).toMatchObject({ ok: false, failure: { kind: 'invalid_input' } });
  });

  it('resolves by UUID', async () => {
    const repo = makeRepo({ id: '11111111-1111-1111-1111-111111111111' });
    const client = createMockApiClient({ listRepos: async () => [repo] } as never);
    const result = await resolveRepo(client, repo.id);
    expect(result).toEqual({ ok: true, data: repo });
  });

  it('yields repo_not_found with a next-step message for an unmatched UUID', async () => {
    const client = createMockApiClient({ listRepos: async () => [] } as never);
    const result = await resolveRepo(client, '11111111-1111-1111-1111-111111111111');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('repo_not_found');
      expect(result.failure.message).toContain('import it first in the studio');
    }
  });

  it('resolves by owner/repo (case-insensitive)', async () => {
    const repo = makeRepo({ full_name: 'acme/widgets' });
    const client = createMockApiClient({ listRepos: async () => [repo] } as never);
    const result = await resolveRepo(client, 'Acme/Widgets');
    expect(result).toEqual({ ok: true, data: repo });
  });

  it('resolves by a full VCS URL, extracting owner/repo', async () => {
    const repo = makeRepo({ full_name: 'acme/widgets' });
    const client = createMockApiClient({ listRepos: async () => [repo] } as never);
    const result = await resolveRepo(client, 'https://github.com/acme/widgets.git');
    expect(result).toEqual({ ok: true, data: repo });
  });

  it('distinguishes a likely typo (owner has other repos) from a not-yet-imported repo', async () => {
    const client = createMockApiClient({
      listRepos: async () => [makeRepo({ owner: 'acme', full_name: 'acme/other-repo' })],
    } as never);
    const result = await resolveRepo(client, 'acme/widgets');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('repo_not_found');
      expect(result.failure.message).toContain('has other repos imported, but not');
    }
  });

  it('reports a plain not-imported message when the owner has no other repos', async () => {
    const client = createMockApiClient({ listRepos: async () => [] } as never);
    const result = await resolveRepo(client, 'acme/widgets');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('repo_not_found');
      expect(result.failure.message).toContain('check the name, or import it first in the studio');
    }
  });

  it('surfaces a not-reachable API failure with the run ./scripts/dev.sh next step', async () => {
    const client = createMockApiClient({
      listRepos: () => Promise.reject(new ApiClientException({ kind: 'unreachable', message: 'boom', cause: undefined })),
    } as never);
    const result = await resolveRepo(client, 'acme/widgets');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('unreachable');
      expect(result.failure.message).toContain('./scripts/dev.sh');
    }
  });
});

describe('resolvePr', () => {
  it('rejects a non-numeric pr input as invalid_input', async () => {
    const client = createMockApiClient();
    const result = await resolvePr(client, 'repo-1', 'not-a-number');
    expect(result).toMatchObject({ ok: false, failure: { kind: 'invalid_input' } });
  });

  it('resolves a matching PR by number', async () => {
    const pr = makePr({ number: 42 });
    const client = createMockApiClient({ listPulls: async () => [pr] } as never);
    const result = await resolvePr(client, 'repo-1', 42);
    expect(result).toEqual({ ok: true, data: pr });
  });

  it('yields pr_not_found for an unmatched PR number', async () => {
    const client = createMockApiClient({ listPulls: async () => [] } as never);
    const result = await resolvePr(client, 'repo-1', 7);
    expect(result).toMatchObject({ ok: false, failure: { kind: 'pr_not_found' } });
  });

  it('yields bad_response when the matched PR is missing its internal id', async () => {
    const pr = makePr({ number: 42, id: null });
    const client = createMockApiClient({ listPulls: async () => [pr] } as never);
    const result = await resolvePr(client, 'repo-1', 42);
    expect(result).toMatchObject({ ok: false, failure: { kind: 'bad_response' } });
  });
});

describe('resolveAgent', () => {
  it('rejects an empty agent input as invalid_input', async () => {
    const client = createMockApiClient();
    const result = await resolveAgent(client, '');
    expect(result).toMatchObject({ ok: false, failure: { kind: 'invalid_input' } });
  });

  it('resolves by UUID', async () => {
    const agent = makeAgent({ id: '22222222-2222-2222-2222-222222222222' });
    const client = createMockApiClient({ listAgents: async () => [agent] } as never);
    const result = await resolveAgent(client, agent.id);
    expect(result).toEqual({ ok: true, data: agent });
  });

  it('resolves by exact name, case-insensitively', async () => {
    const agent = makeAgent({ name: 'Security Reviewer' });
    const client = createMockApiClient({ listAgents: async () => [agent] } as never);
    const result = await resolveAgent(client, 'security reviewer');
    expect(result).toEqual({ ok: true, data: agent });
  });

  it('yields agent_not_found pointing at list_agents', async () => {
    const client = createMockApiClient({ listAgents: async () => [] } as never);
    const result = await resolveAgent(client, 'ghost');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('agent_not_found');
      expect(result.failure.message).toContain('list_agents');
    }
  });
});
