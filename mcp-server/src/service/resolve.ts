import type { Agent, PrMeta, Repo } from '@devdigest/shared';
import type { DevDigestApiPort } from '../http/types.js';
import { fail, guardApiCall, type ServiceResult } from './results.js';

/**
 * Repo/PR/agent resolution — auto-detects UUID vs `owner/repo`/URL for repos,
 * a bare PR number for pulls, and a UUID vs exact name for agents. There is
 * no server-side lookup-by-name route for any of these, so every non-UUID
 * input is resolved by listing and filtering client-side (per the plan's §5
 * Step 3). Every failure is a typed `ServiceFailure` with a next-step
 * message (practice #4) — never a bare "not found".
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** Extracts an `owner/repo` candidate from a bare slug or a full VCS URL (GitHub/GitLab, any host). */
function extractOwnerRepo(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) return trimmed.replace(/\.git$/i, '');
  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length >= 2) {
      const owner = segments[0] as string;
      const repoName = segments[1] as string;
      return `${owner}/${repoName.replace(/\.git$/i, '')}`;
    }
  } catch {
    // Not a URL — fall through; caller's message covers the plain-typo case.
  }
  return undefined;
}

export async function resolveRepo(client: DevDigestApiPort, input: string): Promise<ServiceResult<Repo>> {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return fail('invalid_input', 'repo must not be empty — pass a repo id, "owner/repo", or its VCS URL.');
  }

  const reposResult = await guardApiCall(() => client.listRepos());
  if (!reposResult.ok) return reposResult;
  const repos = reposResult.data;

  if (isUuid(trimmed)) {
    const match = repos.find((r) => r.id === trimmed);
    if (match) return { ok: true, data: match };
    return fail(
      'repo_not_found',
      `No repo found with id "${trimmed}" — check the id, or import it first in the studio.`,
    );
  }

  const ownerRepo = extractOwnerRepo(trimmed) ?? trimmed;
  const byFullName = repos.find((r) => r.full_name.toLowerCase() === ownerRepo.toLowerCase());
  if (byFullName) return { ok: true, data: byFullName };

  // Distinguish "not imported yet" from "plain typo" where possible: if the
  // owner has other repos imported, the name itself is likely the mismatch;
  // otherwise this owner/repo has never been imported at all.
  const [owner] = ownerRepo.split('/');
  const ownerHasOtherRepos = owner ? repos.some((r) => r.owner.toLowerCase() === owner.toLowerCase()) : false;
  const hint = ownerHasOtherRepos
    ? `"${owner}" has other repos imported, but not "${ownerRepo}" — check the name, or import it first in the studio.`
    : 'check the name, or import it first in the studio.';
  return fail('repo_not_found', `No repo found matching "${trimmed}" — ${hint}`);
}

export async function resolvePr(
  client: DevDigestApiPort,
  repoId: string,
  prInput: string | number,
): Promise<ServiceResult<PrMeta>> {
  const number = typeof prInput === 'number' ? prInput : Number(String(prInput).trim());
  if (!Number.isInteger(number) || number <= 0) {
    return fail('invalid_input', `pr must be a positive PR number — got "${String(prInput)}".`);
  }

  const pullsResult = await guardApiCall(() => client.listPulls(repoId));
  if (!pullsResult.ok) return pullsResult;
  const match = pullsResult.data.find((p) => p.number === number);
  if (!match) {
    return fail(
      'pr_not_found',
      `No PR #${number} found for this repo — check the PR number, or make sure DevDigest has synced this repo's pull requests.`,
    );
  }
  if (!match.id) {
    return fail('bad_response', `PR #${number} is missing its internal id in the DevDigest API response.`);
  }
  return { ok: true, data: match };
}

export async function resolveAgent(client: DevDigestApiPort, input: string): Promise<ServiceResult<Agent>> {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return fail(
      'invalid_input',
      'agent must not be empty — pass an agent id or its exact name (call list_agents to see options).',
    );
  }

  const agentsResult = await guardApiCall(() => client.listAgents());
  if (!agentsResult.ok) return agentsResult;
  const agents = agentsResult.data;

  if (isUuid(trimmed)) {
    const byId = agents.find((a) => a.id === trimmed);
    if (byId) return { ok: true, data: byId };
    return fail('agent_not_found', `No agent found with id "${trimmed}" — call list_agents to see available agents.`);
  }

  const byName = agents.find((a) => a.name.toLowerCase() === trimmed.toLowerCase());
  if (byName) return { ok: true, data: byName };
  return fail(
    'agent_not_found',
    `No agent named "${trimmed}" — call list_agents to see available agents and their exact names.`,
  );
}
