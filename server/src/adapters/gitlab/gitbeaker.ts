import { Gitlab } from '@gitbeaker/rest';
import type { CommitAction, DiffRefsSchema } from '@gitbeaker/rest';
import { Agent } from 'undici';
import type {
  GitLabClient,
  RepoRef,
  PrMeta,
  PrDetail,
  PrStatus,
  GitHubReviewPayload,
  CreateReviewCommentInput,
  PrReviewComment,
  OpenPrPayload,
  CommitFilesPayload,
  IssueMeta,
} from '@devdigest/shared';
import { withRetry, withTimeout } from '../../platform/resilience.js';

const TIMEOUT = 30_000;

function mapStatus(state: string): PrStatus {
  if (state === 'merged') return 'merged';
  if (state === 'closed' || state === 'locked') return 'closed';
  return 'open';
}

function projectId(repo: RepoRef): string {
  return `${repo.owner}/${repo.name}`;
}

/** Count +/- lines in a unified diff — GitLab's MR-changes payload has no
 *  per-file additions/deletions counter the way GitHub's does. */
function countDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions++;
    else if (line.startsWith('-')) deletions++;
  }
  return { additions, deletions };
}

/**
 * GitLabClient over @gitbeaker/rest — thin, mirrors OctokitGitHubClient's
 * structure method-by-method. PAT auth; `host` is gitlab.com or a self-hosted
 * instance (threaded from `RepoRef.host` by the caller / DI container).
 *
 * GitLab has no first-class "review" object like GitHub's create-review API,
 * and its comment model is thread/discussion-based rather than flat
 * comment-id + reply-to-id. `postReview`/`*ReviewComment*` map onto MR notes
 * and discussions as closely as the shared DTOs allow — see
 * docs/plans/gitlab-connector.md Open Question #2 for the known gap.
 */
export class GitbeakerGitLabClient implements GitLabClient {
  // `<false>` pins the camelize generic — without it TS can't infer the param
  // from the options shape and every response type widens to `T | Camelize<T>`.
  private api: InstanceType<typeof Gitlab<false>>;
  private host: string;

  constructor(token: string, host: string, insecureTls = false) {
    this.host = host.startsWith('http') ? host.replace(/\/+$/, '') : `https://${host}`;
    this.api = new Gitlab<false>({
      token,
      host: this.host,
      // Self-signed/expired certs on internal GitLab instances. Scoped to
      // THIS client's undici dispatcher only — never toggles Node's global
      // TLS verification, which would also weaken the LLM provider calls.
      // gitbeaker types `agent` as Node's `http.Agent` for lack of an undici
      // type dependency, but at runtime it's forwarded verbatim as fetch's
      // `dispatcher` option (@gitbeaker/rest/dist/index.mjs) — an undici
      // Agent is exactly what belongs there; the cast bridges the typing gap.
      ...(insecureTls
        ? {
            agent: new Agent({
              connect: { rejectUnauthorized: false },
            }) as unknown as import('http').Agent,
          }
        : {}),
    });
  }

  private mrWebUrl(pid: string, n: number): string {
    return `${this.host}/${pid}/-/merge_requests/${n}`;
  }

  async listPullRequests(repo: RepoRef): Promise<PrMeta[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const mrs = await this.api.MergeRequests.all({
            projectId: projectId(repo),
            orderBy: 'updated_at',
            sort: 'desc',
            perPage: 50,
          });
          return mrs.map((mr) => ({
            number: mr.iid,
            title: mr.title,
            author: mr.author?.username ?? 'unknown',
            branch: mr.source_branch,
            base: mr.target_branch,
            head_sha: mr.sha,
            additions: 0,
            deletions: 0,
            files_count: 0, // not on the list payload; populated by getPullRequest
            status: mapStatus(mr.state),
            opened_at: mr.created_at,
            updated_at: mr.updated_at,
          }));
        })(),
        TIMEOUT,
      ),
    );
  }

  async getPullRequest(repo: RepoRef, n: number): Promise<PrDetail> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const pid = projectId(repo);
          const mr = await this.api.MergeRequests.show(pid, n);
          const changes = await this.api.MergeRequests.showChanges(pid, n);
          const commits = await this.api.MergeRequests.allCommits(pid, n);
          const linkedIssue = await this.resolveLinkedIssue(repo, mr.description ?? '');

          let additions = 0;
          let deletions = 0;
          const files = changes.changes.map((c) => {
            const counts = countDiffLines(c.diff);
            additions += counts.additions;
            deletions += counts.deletions;
            return {
              path: c.new_path,
              additions: counts.additions,
              deletions: counts.deletions,
              patch: c.diff,
            };
          });

          return {
            number: mr.iid,
            title: mr.title,
            author: mr.author?.username ?? 'unknown',
            branch: mr.source_branch,
            base: mr.target_branch,
            head_sha: mr.sha,
            additions,
            deletions,
            files_count: files.length,
            status: mapStatus(mr.state),
            opened_at: mr.created_at,
            updated_at: mr.updated_at,
            body: mr.description,
            files,
            commits: commits.map((c) => ({
              sha: c.id,
              message: c.message,
              author: c.author_name ?? 'unknown',
              committed_at: c.committed_date ?? c.authored_date ?? null,
            })),
            linked_issue: linkedIssue,
          };
        })(),
        TIMEOUT,
      ),
    );
  }

  /** linked issue via regex on the MR description (#123 / closes #123). */
  private async resolveLinkedIssue(repo: RepoRef, body: string): Promise<IssueMeta | undefined> {
    const m = body.match(/(?:closes|fixes|resolves)?\s*#(\d+)/i);
    if (!m?.[1]) return undefined;
    try {
      return await this.getIssue(repo, Number(m[1]));
    } catch {
      return undefined;
    }
  }

  /** Shape a GitLab discussion note (with an optional diff `position`) into our DTO. */
  private mapNoteToComment(
    firstNoteId: number,
    note: {
      id: number;
      body: string;
      author?: { username?: string } | null;
      created_at: string;
      position?: {
        new_path?: string;
        old_path?: string;
        new_line?: number | string;
        old_line?: number | string;
      } | null;
    },
    pid: string,
    n: number,
  ): PrReviewComment {
    const pos = note.position;
    const newLine = pos?.new_line != null ? Number(pos.new_line) : null;
    const oldLine = pos?.old_line != null ? Number(pos.old_line) : null;
    return {
      id: note.id,
      path: pos?.new_path ?? pos?.old_path ?? '',
      line: newLine,
      original_line: oldLine,
      side: newLine != null ? 'RIGHT' : 'LEFT',
      body: note.body,
      user: note.author?.username ?? 'unknown',
      created_at: note.created_at,
      html_url: `${this.mrWebUrl(pid, n)}#note_${note.id}`,
      in_reply_to_id: note.id === firstNoteId ? null : firstNoteId,
      // GitLab drops `position` when the note can no longer be anchored to the diff.
      is_outdated: pos == null,
    };
  }

  private buildPosition(
    refs: DiffRefsSchema,
    path: string,
    line: number,
    side: 'LEFT' | 'RIGHT' | undefined,
  ) {
    return {
      baseSha: refs.base_sha,
      startSha: refs.start_sha,
      headSha: refs.head_sha,
      positionType: 'text' as const,
      newPath: path,
      oldPath: path,
      ...(side === 'LEFT' ? { oldLine: line } : { newLine: line }),
    };
  }

  async postReview(
    repo: RepoRef,
    n: number,
    review: GitHubReviewPayload,
  ): Promise<{ id: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const pid = projectId(repo);
          // GitLab has no "pending review with an event type" object — map the
          // verdict onto a top-level MR note, plus one diff discussion per
          // inline comment.
          const prefix =
            review.event === 'REQUEST_CHANGES'
              ? '🔴 Changes requested\n\n'
              : review.event === 'APPROVE'
                ? '✅ Approved\n\n'
                : '';
          const note = await this.api.MergeRequestNotes.create(pid, n, `${prefix}${review.body}`);
          if (review.comments?.length) {
            const mr = await this.api.MergeRequests.show(pid, n);
            const refs = mr.diff_refs;
            for (const c of review.comments) {
              await this.api.MergeRequestDiscussions.create(pid, n, c.body, {
                position: this.buildPosition(refs, c.path, c.line, undefined) as never,
              });
            }
          }
          return { id: String(note.id) };
        })(),
        TIMEOUT,
      ),
    );
  }

  async listReviewComments(repo: RepoRef, n: number): Promise<PrReviewComment[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const pid = projectId(repo);
          const discussions = await this.api.MergeRequestDiscussions.all(pid, n);
          const comments: PrReviewComment[] = [];
          for (const d of discussions) {
            const notes = (d.notes ?? []).filter(
              (note): note is typeof note & { position: NonNullable<typeof note.position> } =>
                'position' in note && note.position != null,
            );
            if (notes.length === 0) continue;
            const firstId = notes[0]!.id;
            for (const note of notes) {
              comments.push(this.mapNoteToComment(firstId, note as never, pid, n));
            }
          }
          return comments;
        })(),
        TIMEOUT,
      ),
    );
  }

  async createReviewComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const pid = projectId(repo);
          if (input.inReplyTo != null) {
            // GitHub replies are keyed by comment id; GitLab replies are keyed
            // by discussion id — resolve the thread that contains the note.
            const discussions = await this.api.MergeRequestDiscussions.all(pid, n);
            const thread = discussions.find((d) =>
              (d.notes ?? []).some((note) => note.id === input.inReplyTo),
            );
            if (!thread) {
              throw new Error(`No GitLab discussion found for note ${input.inReplyTo}`);
            }
            const note = await this.api.MergeRequestDiscussions.addNote(
              pid,
              n,
              thread.id,
              input.body,
            );
            const firstId = thread.notes?.[0]?.id ?? note.id;
            return this.mapNoteToComment(firstId, note as never, pid, n);
          }
          const mr = await this.api.MergeRequests.show(pid, n);
          const discussion = await this.api.MergeRequestDiscussions.create(pid, n, input.body, {
            position: this.buildPosition(mr.diff_refs, input.path, input.line, input.side) as never,
          });
          const note = discussion.notes?.[0];
          if (!note) throw new Error('GitLab did not return a note for the new discussion');
          return this.mapNoteToComment(note.id, note as never, pid, n);
        })(),
        TIMEOUT,
      ),
    );
  }

  async openPullRequest(repo: RepoRef, payload: OpenPrPayload): Promise<{ url: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const mr = await this.api.MergeRequests.create(
            projectId(repo),
            payload.head,
            payload.base,
            payload.title,
            { description: payload.body },
          );
          return { url: mr.web_url };
        })(),
        TIMEOUT,
      ),
    );
  }

  async commitFiles(repo: RepoRef, payload: CommitFilesPayload): Promise<{ branch: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const pid = projectId(repo);
          const actions: CommitAction[] = [];
          for (const f of payload.files) {
            let exists = true;
            try {
              await this.api.RepositoryFiles.show(pid, f.path, payload.branch);
            } catch {
              exists = false;
            }
            actions.push({
              action: exists ? 'update' : 'create',
              filePath: f.path,
              content: f.contents,
            });
          }
          // `startBranch` is only consulted by GitLab when `payload.branch`
          // doesn't exist yet; it's a no-op (branch already exists) otherwise.
          await this.api.Commits.create(pid, payload.branch, payload.message, actions, {
            startBranch: payload.base,
          });
          return { branch: payload.branch };
        })(),
        TIMEOUT,
      ),
    );
  }

  async findOpenPr(repo: RepoRef, branch: string): Promise<{ url: string } | null> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const mrs = await this.api.MergeRequests.all({
            projectId: projectId(repo),
            state: 'opened',
            sourceBranch: branch,
            perPage: 1,
          });
          const mr = mrs[0];
          return mr ? { url: mr.web_url } : null;
        })(),
        TIMEOUT,
      ),
    );
  }

  async getIssue(repo: RepoRef, n: number): Promise<IssueMeta> {
    const issue = await withRetry(() =>
      withTimeout(this.api.Issues.show(n, { projectId: projectId(repo) }), TIMEOUT),
    );
    return {
      number: issue.iid,
      title: issue.title,
      body: issue.description,
      state: issue.state,
    };
  }

  async currentLogin(): Promise<string> {
    const user = await withRetry(() => withTimeout(this.api.Users.showCurrentUser(), TIMEOUT));
    return user.username;
  }
}
