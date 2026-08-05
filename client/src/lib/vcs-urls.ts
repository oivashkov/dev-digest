/* vcs-urls.ts — build github.com / gitlab.com deep-links from data we already
   hold. PR/MR detail has repo full_name (owner/repo), PR/MR number, head sha,
   and finding file/line — enough to open the PR/MR or a file blob at a line
   range in a new tab. GitLab's URL shape differs from GitHub's, not just the
   host (a `/-/` segment before `blob`, and a single-`L` line-range fragment)
   — see docs/plans/gitlab-connector.md Open Question for self-hosted hosts. */

import type { RepoProvider } from "./types";

function hostFor(provider: RepoProvider, host: string): string {
  return `https://${host || (provider === "gitlab" ? "gitlab.com" : "github.com")}`;
}

/** Encode a repo-relative path for a URL while keeping "/" separators. */
function encPath(file: string): string {
  return file
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

/** GitHub: .../pull/{n} · GitLab: .../-/merge_requests/{n} */
export function vcsPrUrl(
  repoFullName: string,
  number: number,
  provider: RepoProvider,
  host: string,
): string {
  const base = hostFor(provider, host);
  return provider === "gitlab"
    ? `${base}/${repoFullName}/-/merge_requests/${number}`
    : `${base}/${repoFullName}/pull/${number}`;
}

/**
 * GitHub: .../blob/{sha}/{file}#L{start}[-L{end}]
 * GitLab:  .../-/blob/{sha}/{file}#L{start}[-{end}]
 * `sha` pins the link to the PR/MR's head so line numbers stay accurate.
 */
export function vcsBlobUrl(
  repoFullName: string,
  sha: string,
  file: string,
  provider: RepoProvider,
  host: string,
  startLine?: number,
  endLine?: number,
): string {
  const base = hostFor(provider, host);
  const path = encPath(file);
  let url =
    provider === "gitlab"
      ? `${base}/${repoFullName}/-/blob/${sha}/${path}`
      : `${base}/${repoFullName}/blob/${sha}/${path}`;
  if (startLine != null) {
    url += `#L${startLine}`;
    if (endLine != null && endLine !== startLine) {
      url += provider === "gitlab" ? `-${endLine}` : `-L${endLine}`;
    }
  }
  return url;
}
