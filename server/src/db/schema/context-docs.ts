import { pgTable, uuid, text, integer, primaryKey, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { agents } from './agents';
import { skills } from './skills';
import { repos } from './repos';

/**
 * Project Context attachments — `(owner_id, repo_id, path)` triples binding a
 * document discovered under a repo's clone to an agent or a skill (SPEC-01,
 * Q2). Deliberately NOT in `./context.ts` — that file holds `code_chunks`
 * (the embedding-era table, `embedding vector(1536)`), which this feature
 * explicitly does not touch (SPEC-01 Q5); keeping the two apart avoids
 * implying a relationship that doesn't exist.
 *
 * The composite PRIMARY KEY (owner id + repo id + path) gives the
 * full-replace attach flow (`setContextDocs`) an exact `onConflictDoUpdate`
 * target — a bare `db.transaction()` around delete-then-insert is NOT
 * sufficient for two concurrent attach requests on a brand-new agent (no
 * existing rows to lock on the DELETE); see `server/INSIGHTS.md`,
 * 2026-08-12, reproduced against `agent_skills`.
 *
 * `path` is `TEXT` with a length `CHECK`, not `VARCHAR(n)` (project
 * convention). `order` is meaningful for `agent_context_docs` (drag order,
 * Q3) but only a stable tiebreaker for `skill_context_docs` — the Skill
 * editor has no reorder control (Q13); its rows are always presented sorted
 * by normalized path regardless of the stored value.
 */

const MAX_PATH_CHARS = 1024;

export const agentContextDocs = pgTable(
  'agent_context_docs',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.repoId, t.path] }),
    repoIdx: index('agent_context_docs_repo_idx').on(t.repoId),
    agentRepoIdx: index('agent_context_docs_agent_repo_idx').on(t.agentId, t.repoId),
    pathLen: check(
      'agent_context_docs_path_len',
      sql`length(${t.path}) <= ${sql.raw(String(MAX_PATH_CHARS))}`,
    ),
  }),
);

export const skillContextDocs = pgTable(
  'skill_context_docs',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    // No reorder UI (Q13) — kept only as a stable tiebreaker; callers should
    // not rely on this for display order (sort by normalized path instead).
    order: integer('order').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.skillId, t.repoId, t.path] }),
    repoIdx: index('skill_context_docs_repo_idx').on(t.repoId),
    skillRepoIdx: index('skill_context_docs_skill_repo_idx').on(t.skillId, t.repoId),
    pathLen: check(
      'skill_context_docs_path_len',
      sql`length(${t.path}) <= ${sql.raw(String(MAX_PATH_CHARS))}`,
    ),
  }),
);
