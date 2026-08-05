import { describe, it, expect, vi } from 'vitest';

/**
 * Hermetic coverage for SimpleGitClient's TLS-bypass wiring: every
 * `simpleGit(...)` call for a repo with `insecureTls: true` must be prefixed
 * with `-c http.sslVerify=false` (via simple-git's per-instance `config`
 * option), and NOT prefixed at all for a normal repo — this is the git-side
 * half of the self-signed/expired-cert fix; the GitLab-client half is
 * covered by `gitbeaker.ts`'s own construction (see `container-gitlab-tls.test.ts`).
 */

const simpleGitCalls: { baseDir: string; options: unknown }[] = [];

vi.mock('simple-git', () => ({
  simpleGit: (baseDir: string, options?: unknown) => {
    simpleGitCalls.push({ baseDir, options });
    return {
      diff: async () => 'diff --git a/x b/x\n',
      currentHead: async () => 'abc123',
      revparse: async () => 'abc123\n',
    };
  },
}));

const { SimpleGitClient } = await import('../src/adapters/git/simple-git.js');

describe('SimpleGitClient TLS bypass', () => {
  it('prefixes -c http.sslVerify=false when the repo has insecureTls: true', async () => {
    simpleGitCalls.length = 0;
    const git = new SimpleGitClient('/tmp/clones');
    await git.diff({ owner: 'acme', name: 'internal', insecureTls: true }, 'main', 'abc123');
    expect(simpleGitCalls).toHaveLength(1);
    expect(simpleGitCalls[0]!.options).toEqual({ config: ['http.sslVerify=false'] });
  });

  it('does not touch git config for a normal repo (insecureTls undefined/false)', async () => {
    simpleGitCalls.length = 0;
    const git = new SimpleGitClient('/tmp/clones');
    await git.diff({ owner: 'acme', name: 'public' }, 'main', 'abc123');
    expect(simpleGitCalls).toHaveLength(1);
    expect(simpleGitCalls[0]!.options).toEqual({ config: [] });

    simpleGitCalls.length = 0;
    await git.diff({ owner: 'acme', name: 'public', insecureTls: false }, 'main', 'abc123');
    expect(simpleGitCalls[0]!.options).toEqual({ config: [] });
  });
});
