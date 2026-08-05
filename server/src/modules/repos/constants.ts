/**
 * F1 — repos module constants (extracted from routes.ts; no behaviour change).
 */

/** JobRunner kind for the asynchronous `git clone` job. */
export const CLONE_JOB_KIND = 'clone';

/** Clone depth — shallow clone (latest commit only) keeps imports fast. */
export const CLONE_DEPTH = 1;

/** Secret name (via the Secrets adapter) holding the GitHub PAT for private clones. */
export const GITHUB_TOKEN_SECRET = 'GITHUB_TOKEN';

/** Secret name (via the Secrets adapter) holding the GitLab PAT for private clones. */
export const GITLAB_TOKEN_SECRET = 'GITLAB_TOKEN';

/**
 * Parse `owner`/`repo` from a GitHub URL — supports both
 * `https://github.com/owner/repo(.git)` and `git@github.com:owner/repo.git`.
 */
export const GITHUB_URL_REGEX = /github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?\/?$/;

/**
 * Parse `host`/`owner`/`repo` from ANY git host — supports both
 * `https://<host>/owner/repo(.git)` and `git@<host>:owner/repo.git`. Tried
 * only after `GITHUB_URL_REGEX` fails to match; treated as GitLab (gitlab.com
 * or a self-hosted instance) — the app only knows about two providers today,
 * so any non-GitHub git remote is assumed GitLab-API-compatible.
 */
export const GENERIC_GIT_URL_REGEX =
  /^(?:https?:\/\/([^/]+)\/|git@([^:]+):)([^/]+)\/([^/.]+?)(?:\.git)?\/?$/;

/** Username embedded into an authenticated https github.com clone URL. */
export const GIT_TOKEN_USERNAME = 'x-access-token';

/** Host for which a token is embedded into an https clone URL. */
export const GITHUB_HTTPS_HOST = 'github.com';

/** Username GitLab expects embedded into an authenticated https clone URL. */
export const GITLAB_TOKEN_USERNAME = 'oauth2';
