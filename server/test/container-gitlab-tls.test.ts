import { describe, it, expect } from 'vitest';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MockSecretsProvider } from '../src/adapters/mocks.js';
import type { Db } from '../src/db/client.js';

/**
 * Hermetic coverage for Container.gitlab()'s cache key: two repos on the same
 * host must NOT silently share a client if they disagree on insecureTls, and
 * the same (host, insecureTls) pair must reuse one client rather than
 * reconstructing (and re-dialing) a new one on every call.
 */
describe('Container.gitlab() cache key includes insecureTls', () => {
  const config = loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
  const secrets = new MockSecretsProvider({ GITLAB_TOKEN: 'test-token' });

  it('the same host+insecureTls pair returns the cached instance', async () => {
    const container = new Container(config, {} as Db, { secrets });
    const a = await container.gitlab('gitlab.example.com', false);
    const b = await container.gitlab('gitlab.example.com', false);
    expect(a).toBe(b);
  });

  it('the same host with a different insecureTls resolves to a different instance', async () => {
    const container = new Container(config, {} as Db, { secrets });
    const secure = await container.gitlab('gitlab.example.com', false);
    const insecure = await container.gitlab('gitlab.example.com', true);
    expect(secure).not.toBe(insecure);
  });

  it('vcsFor() threads repo.insecureTls into gitlab() for a gitlab-provider repo', async () => {
    const container = new Container(config, {} as Db, { secrets });
    const direct = await container.gitlab('gitlab.example.com', true);
    const viaVcsFor = await container.vcsFor({
      provider: 'gitlab',
      host: 'gitlab.example.com',
      insecureTls: true,
    });
    expect(viaVcsFor).toBe(direct);
  });
});
