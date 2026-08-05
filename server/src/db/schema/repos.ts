import { pgTable, uuid, text, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces, users } from './core';

export const repos = pgTable(
  'repos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    fullName: text('full_name').notNull(),
    defaultBranch: text('default_branch').notNull().default('main'),
    provider: text('provider', { enum: ['github', 'gitlab'] }).notNull().default('github'),
    /** Git host the repo lives on ('github.com', 'gitlab.com', or a self-hosted GitLab). */
    host: text('host').notNull().default('github.com'),
    /** Skip TLS certificate validation for this repo's host (self-signed/expired certs). */
    insecureTls: boolean('insecure_tls').notNull().default(false),
    clonePath: text('clone_path'),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: now(),
  },
  (t) => ({
    uq: uniqueIndex('repos_ws_fullname_uq').on(t.workspaceId, t.fullName),
    wsIdx: index('repos_ws_idx').on(t.workspaceId),
  }),
);
