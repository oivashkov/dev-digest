import { describe, it, expect } from 'vitest';
import { parseRepoUrl, withVcsToken } from '../src/modules/repos/helpers.js';

/**
 * Unit coverage for repo-URL parsing/token-embedding across both providers.
 * GitHub cases are regression coverage — behavior must stay unchanged now
 * that a second (GitLab, incl. self-hosted) branch was added.
 */

describe('parseRepoUrl', () => {
  it('parses a github.com https URL', () => {
    expect(parseRepoUrl('https://github.com/acme/payments-api')).toEqual({
      owner: 'acme',
      name: 'payments-api',
      provider: 'github',
      host: 'github.com',
    });
  });

  it('parses a github.com https URL with .git suffix', () => {
    expect(parseRepoUrl('https://github.com/acme/payments-api.git')).toEqual({
      owner: 'acme',
      name: 'payments-api',
      provider: 'github',
      host: 'github.com',
    });
  });

  it('parses a github.com ssh URL', () => {
    expect(parseRepoUrl('git@github.com:acme/payments-api.git')).toEqual({
      owner: 'acme',
      name: 'payments-api',
      provider: 'github',
      host: 'github.com',
    });
  });

  it('parses a gitlab.com https URL as gitlab', () => {
    expect(parseRepoUrl('https://gitlab.com/acme/payments-api')).toEqual({
      owner: 'acme',
      name: 'payments-api',
      provider: 'gitlab',
      host: 'gitlab.com',
    });
  });

  it('parses a gitlab.com ssh URL as gitlab', () => {
    expect(parseRepoUrl('git@gitlab.com:acme/payments-api.git')).toEqual({
      owner: 'acme',
      name: 'payments-api',
      provider: 'gitlab',
      host: 'gitlab.com',
    });
  });

  it('parses a self-hosted GitLab https URL, capturing its host', () => {
    expect(parseRepoUrl('https://gitlab.mycompany.com/team/service')).toEqual({
      owner: 'team',
      name: 'service',
      provider: 'gitlab',
      host: 'gitlab.mycompany.com',
    });
  });

  it('parses a self-hosted GitLab ssh URL, capturing its host', () => {
    expect(parseRepoUrl('git@gitlab.mycompany.com:team/service.git')).toEqual({
      owner: 'team',
      name: 'service',
      provider: 'gitlab',
      host: 'gitlab.mycompany.com',
    });
  });

  it('rejects a URL matching neither host pattern', () => {
    expect(() => parseRepoUrl('not-a-url')).toThrow(/invalid_repo_url|Could not parse/);
  });
});

describe('withVcsToken', () => {
  it('embeds x-access-token for a github.com https URL', () => {
    const url = withVcsToken('https://github.com/acme/payments-api', 'ghp_x', 'github');
    expect(url).toContain('x-access-token:ghp_x@github.com');
  });

  it('embeds oauth2 for a gitlab.com https URL', () => {
    const url = withVcsToken('https://gitlab.com/acme/payments-api', 'glpat_x', 'gitlab');
    expect(url).toContain('oauth2:glpat_x@gitlab.com');
  });

  it('embeds oauth2 for a self-hosted GitLab https URL', () => {
    const url = withVcsToken('https://gitlab.mycompany.com/team/service', 'glpat_x', 'gitlab');
    expect(url).toContain('oauth2:glpat_x@gitlab.mycompany.com');
  });

  it('leaves an ssh URL untouched', () => {
    const url = 'git@gitlab.com:acme/payments-api.git';
    expect(withVcsToken(url, 'glpat_x', 'gitlab')).toBe(url);
  });

  it('leaves a github URL untouched when asked to embed a github token for a non-github host', () => {
    const url = 'https://example.com/acme/payments-api';
    expect(withVcsToken(url, 'ghp_x', 'github')).toBe(url);
  });
});
