import { type Repo, type RepoProvider } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { AppError } from '../../platform/errors.js';
import {
  GITHUB_URL_REGEX,
  GENERIC_GIT_URL_REGEX,
  GIT_TOKEN_USERNAME,
  GITHUB_HTTPS_HOST,
  GITLAB_TOKEN_USERNAME,
} from './constants.js';

/**
 * F1 — repos pure helpers (extracted from routes.ts; no behaviour change).
 * Pure functions only — no I/O, no DB, no container.
 */

export interface ParsedRepoUrl {
  owner: string;
  name: string;
  provider: RepoProvider;
  host: string;
}

/**
 * Parse `owner`/`name`/`provider`/`host` from a repo URL (https or ssh form).
 * GitHub (github.com) is tried first and keeps its exact existing behavior;
 * any other host is treated as GitLab-API-compatible (gitlab.com or a
 * self-hosted instance) — see `GENERIC_GIT_URL_REGEX`'s doc comment.
 */
export function parseRepoUrl(url: string): ParsedRepoUrl {
  // https://github.com/owner/repo(.git)  |  git@github.com:owner/repo.git
  const gh = url.match(GITHUB_URL_REGEX);
  if (gh?.[1] && gh[2]) {
    return { owner: gh[1], name: gh[2], provider: 'github', host: GITHUB_HTTPS_HOST };
  }

  // https://<host>/owner/repo(.git)  |  git@<host>:owner/repo.git
  const generic = url.match(GENERIC_GIT_URL_REGEX);
  const host = generic?.[1] ?? generic?.[2];
  if (host && generic?.[3] && generic[4]) {
    return { owner: generic[3], name: generic[4], provider: 'gitlab', host };
  }

  throw new AppError('invalid_repo_url', `Could not parse owner/repo from '${url}'`, 400);
}

/**
 * Embed a token into an authenticated https clone URL so private clones
 * authenticate non-interactively. SSH URLs are left untouched (they carry
 * their own key-based auth). GitHub uses `x-access-token:<token>@host`;
 * GitLab's PAT-over-HTTPS convention is `oauth2:<token>@host`.
 */
export function withVcsToken(url: string, token: string, provider: RepoProvider): string {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return url;
    if (provider === 'github' && u.hostname !== GITHUB_HTTPS_HOST) return url;
    u.username = provider === 'github' ? GIT_TOKEN_USERNAME : GITLAB_TOKEN_USERNAME;
    u.password = token;
    return u.toString();
  } catch {
    /* non-URL (e.g. git@host:...) — leave as-is */
    return url;
  }
}

/** Map a persisted repo row to the API `Repo` DTO. */
export function toRepoDto(row: typeof t.repos.$inferSelect): Repo {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    owner: row.owner,
    name: row.name,
    full_name: row.fullName,
    default_branch: row.defaultBranch,
    clone_path: row.clonePath,
    last_polled_at: row.lastPolledAt?.toISOString() ?? null,
    created_by: row.createdBy,
    provider: row.provider,
    host: row.host,
    insecure_tls: row.insecureTls,
  };
}
