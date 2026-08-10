# Examples — backend-onion-architecture

Concrete good/bad pairs for each rule in [SKILL.md](SKILL.md).

## Reference-quality module: `repos`

**Good** — `src/modules/repos/routes.ts`, transport only:

```ts
export default async function reposRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new RepoService(app.container);

  app.post('/repos', { schema: { body: RepoInput } }, async (req, reply) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    const { repo, created } = await service.add(
      workspaceId, userId, req.body.url, req.body.insecure_tls,
    );
    reply.status(created ? 201 : 200);
    return repo;
  });
}
```

`src/modules/repos/service.ts` — business logic, no HTTP, no raw SQL:

```ts
/**
 * F1 — repos service. Business logic for the Repositories feature.
 * No HTTP and no raw SQL live here — persistence goes through RepoRepository,
 * pure transforms through helpers.ts, literals through constants.ts.
 */
export class RepoService {
  constructor(private container: Container) {}
  async add(workspaceId: string, userId: string, url: string, insecureTls?: boolean) {
    const parsed = parseRepoUrl(url); // pure helper, no I/O
    return this.repository.upsert(workspaceId, parsed); // delegates persistence
  }
}
```

`src/modules/reviews/repository.ts` — data access, nothing else:

```ts
/**
 * A2 — review data-access. The ONLY layer touching the DB for the review
 * domain. Owns `reviews`, `findings`, `pr_intent`, ...
 */
export class ReviewRepository {
  constructor(private db: Db) {}
  // drizzle queries only — no business rules, no Fastify types
}
```

## Anti-pattern: business logic and DB calls inside `routes.ts`

**Bad** — `src/modules/polling/routes.ts` (real code, unmodified): the route
handler builds `drizzle-orm` queries, does an upsert, and touches three
tables directly. There is no `service.ts` or `repository.ts` for this
module.

```ts
app.post('/repos/:id/poll', { schema: { params: IdParams } }, async (req) => {
  const { workspaceId } = await getContext(container, req);
  const [repo] = await container.db
    .select().from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, req.params.id)));
  if (!repo) throw new NotFoundError('Repo not found');

  const gh = await container.vcsFor(repo);
  const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name, host: repo.host });
  for (const pr of pulls) {
    await container.db.insert(t.pullRequests).values({ /* ... */ }).onConflictDoUpdate({ /* ... */ });
  }
  await container.db.update(t.repos).set({ lastPolledAt: new Date() }).where(eq(t.repos.id, repo.id));
  return { synced: pulls.length, reviewTriggered: false };
});
```

**Fix direction** (don't add more inline DB calls here — extract first):

```ts
// routes.ts — after the fix
app.post('/repos/:id/poll', { schema: { params: IdParams } }, async (req) => {
  const { workspaceId } = await getContext(container, req);
  return service.pollRepo(workspaceId, req.params.id);
});

// service.ts — new
export class PollingService {
  constructor(private container: Container, private repos: RepoRepository) {}
  async pollRepo(workspaceId: string, repoId: string) {
    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    const gh = await this.container.vcsFor(repo);
    const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name, host: repo.host });
    await this.repos.syncPulls(repo.id, pulls);
    await this.repos.touchLastPolled(repo.id);
    return { synced: pulls.length, reviewTriggered: false };
  }
}

// repository.ts — new: syncPulls()/touchLastPolled() move the drizzle calls here
```

## Adapters: always through the container, never imported directly

**Good** — `src/platform/container.ts` resolves the right VCS client:

```ts
async vcsFor(repo: { provider: 'github' | 'gitlab'; host: string; insecureTls?: boolean }) {
  return repo.provider === 'gitlab' ? this.gitlab(repo.host, repo.insecureTls) : this.github();
}
```

```ts
// service.ts — good
const gh = await this.container.vcsFor(repo);
```

**Bad** — importing an adapter directly, bypassing the container (breaks
test mocking via `src/adapters/mocks.ts` and hardcodes the provider):

```ts
// service.ts — bad
import { GitHubAdapter } from '../../adapters/github/octokit.js';
const gh = new GitHubAdapter(token); // provider hardcoded, container bypassed
```

## Dependency inversion: never import "outward"

**Bad** — a repository reaching back into a service (inverts the
dependency direction; repositories must stay ignorant of business rules):

```ts
// repository.ts — bad
import { RepoService } from './service.js'; // infrastructure importing application layer
```

**Good** — repositories expose data operations; services call them, never
the reverse:

```ts
// service.ts
import { RepoRepository } from './repository.js'; // correct direction
```
