import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Project Context data-access. Owns no table of its own — discovery is a
 * live walk of the repo's clone (SPEC-01: "no relevance ranking, no
 * embeddings"; there is nothing here worth caching that `walkClone` +
 * `Tokenizer.count` don't already produce fresh each call). The only DB read
 * is the repo's clone path, mirroring `ConventionsRepository.getRepo`.
 */

export interface RepoBasics {
  id: string;
  clonePath: string | null;
}

export class ContextRepository {
  constructor(private db: Db) {}

  async getRepo(workspaceId: string, repoId: string): Promise<RepoBasics | undefined> {
    const [row] = await this.db
      .select({ id: t.repos.id, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }
}
