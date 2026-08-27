/**
 * Demo fixture for the SPEC-04 eval-pipeline walkthrough (lab06 checklist:
 * screenshot of two compared runs + end-to-end screencast).
 *
 * Not wired into any build or import graph — zero blast radius on real code.
 * It exists only to give a review agent one concrete, low-severity finding
 * to flag, so the "finding -> eval case -> run -> prompt change -> re-run ->
 * compare" flow has something real to click through instead of a seeded
 * fixture. The issue below is intentional and left unfixed on purpose.
 *
 * Safe to delete (along with this whole `scripts/demo/` dir and the PR/
 * branch it ships on) once the walkthrough has been recorded.
 */

interface UserRecord {
  id: string;
  name: string;
}

interface UserStore {
  getUser(id: string): Promise<UserRecord>;
}

/**
 * Intentional N+1: fetches each user one at a time inside the loop instead
 * of a single batched lookup (e.g. `db.getUsers(userIds)`). Mirrors the
 * class of issue this repo's seed fixture already demonstrates
 * (`server/src/db/seed.ts`, "N+1 query" finding on `src/api/users.ts`).
 */
export async function loadUserNames(userIds: string[], store: UserStore): Promise<string[]> {
  const names: string[] = [];
  for (const id of userIds) {
    // eslint-disable-next-line no-await-in-loop -- deliberate demo N+1, see file header
    const user = await store.getUser(id);
    names.push(user.name);
  }
  return names;
}
