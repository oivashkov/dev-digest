import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContextDiscovery, SpecFile } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { walkClone } from '../repo-intel/pipeline/walk.js';
import { ContextRepository } from './repository.js';
import { classifyContextDocType, isRealpathWithinClone, isSafeContextDocPath } from './helpers.js';

/**
 * Project Context service (SPEC-01). Discovery is a live walk of the repo's
 * clone — no relevance ranking, no embeddings, no LLM call, nothing cached
 * (`ContextRepository`'s doc comment). `GET /repos/:id/context` and
 * `POST /repos/:id/context/reindex` share this one method: "reindex" means
 * "walk again right now", exactly the same as any other read (Q5).
 *
 * Every failure degrades — a missing clone or an unreadable file never
 * throws, matching the `run-executor.ts` enrichment contract this feature's
 * run-time half (Step 5) also follows.
 */
export class ContextService {
  private repo: ContextRepository;

  constructor(private container: Container) {
    this.repo = new ContextRepository(container.db);
  }

  /** Discovery envelope for the Project Context page + reindex action.
   *  Returns `undefined` when the repo isn't in this workspace (route → 404). */
  async discover(workspaceId: string, repoId: string): Promise<ContextDiscovery | undefined> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) return undefined;

    const nowIso = new Date().toISOString();
    if (!repo.clonePath) {
      // No local clone yet — empty list + degraded, never an error response.
      return { documents: [], degraded: true, tokens_total: 0, last_scan_at: nowIso };
    }
    const clonePath = repo.clonePath;

    const walk = await walkClone(clonePath, {
      match: (relPath) => isSafeContextDocPath(clonePath, relPath),
    });

    const documents: SpecFile[] = [];
    let tokensTotal = 0;
    for (const relPath of walk.files) {
      const doc = await this.readDocMeta(clonePath, relPath);
      if (!doc) continue; // unreadable (permissions, non-UTF8, deleted mid-walk) — skip
      documents.push(doc);
      tokensTotal += doc.tokens;
    }

    return { documents, degraded: false, tokens_total: tokensTotal, last_scan_at: nowIso };
  }

  /** One document's current text for the preview pane. Returns `undefined`
   *  when the repo isn't in this workspace, the path fails the guard, or the
   *  file can't be read (route → 404 either way — no distinction leaked). */
  async getDocument(
    workspaceId: string,
    repoId: string,
    path: string,
  ): Promise<SpecFile | undefined> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo?.clonePath) return undefined;
    // Re-guard immediately before every read — a path is untrusted on the way
    // in AND on the way back out (SPEC-01 "Untrusted inputs"; the Zod
    // `SpecPath` refine at the route boundary already ran, this is the
    // second, independent check).
    if (!isSafeContextDocPath(repo.clonePath, path)) return undefined;
    return this.readDocMeta(repo.clonePath, path, { withContent: true });
  }

  private async readDocMeta(
    clonePath: string,
    relPath: string,
    opts: { withContent?: boolean } = {},
  ): Promise<SpecFile | undefined> {
    const full = join(clonePath, relPath);
    try {
      // Second, stronger guard right before the read — catches a symlink
      // whose final component escapes the clone, which the lexical
      // `isWithinClone` check (already run by the caller) cannot see.
      if (!(await isRealpathWithinClone(clonePath, full))) return undefined;
      const [st, content] = await Promise.all([stat(full), readFile(full, 'utf8')]);
      const tokens = this.container.tokenizer.count(content);
      return {
        path: relPath,
        type: classifyContextDocType(relPath),
        tokens,
        size: st.size,
        updated_at: st.mtime.toISOString(),
        ...(opts.withContent ? { content } : {}),
      };
    } catch {
      return undefined;
    }
  }
}
