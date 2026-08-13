import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  toSkillDto,
  isSkillContentChange,
  summarizeSkillChange,
  computeSkillStats,
  extractSkillCore,
  type SkillStatsFindingRow,
  type SkillStatsReviewRow,
} from '../src/modules/skills/helpers.js';
import type { SkillRow } from '../src/modules/skills/repository.js';

/**
 * Unit coverage for the skills module's pure logic: DTO mapping, the
 * content-vs-enabled version-bump rule, and import extraction (the security-
 * relevant part — only text-like archive entries are ever read).
 */

const baseRow: SkillRow = {
  id: 's1',
  workspaceId: 'w1',
  name: 'No mocking the DB',
  description: 'Flag tests that mock the repository layer instead of using it.',
  type: 'convention',
  source: 'manual',
  body: 'Do not mock the repository in unit tests; use the real one against testcontainers.',
  enabled: true,
  version: 3,
  evidenceFiles: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

describe('toSkillDto', () => {
  it('maps a row to the public Skill DTO, snake_casing evidence_files', () => {
    const dto = toSkillDto({ ...baseRow, evidenceFiles: ['SKILL.md', 'examples/good.ts'] });
    expect(dto).toMatchObject({
      id: 's1',
      name: baseRow.name,
      type: 'convention',
      source: 'manual',
      enabled: true,
      version: 3,
      evidence_files: ['SKILL.md', 'examples/good.ts'],
    });
  });

  it('nulls out evidence_files when none were recorded', () => {
    const dto = toSkillDto(baseRow);
    expect(dto.evidence_files).toBeNull();
  });
});

describe('isSkillContentChange', () => {
  it('is false for a no-op patch or an enabled-only toggle', () => {
    expect(isSkillContentChange(baseRow, {})).toBe(false);
    expect(isSkillContentChange(baseRow, { name: baseRow.name })).toBe(false);
  });

  it('is true when name, description, type, or body changes', () => {
    expect(isSkillContentChange(baseRow, { name: 'New name' })).toBe(true);
    expect(isSkillContentChange(baseRow, { description: 'New description' })).toBe(true);
    expect(isSkillContentChange(baseRow, { type: 'security' })).toBe(true);
    expect(isSkillContentChange(baseRow, { body: 'New body' })).toBe(true);
  });
});

describe('summarizeSkillChange', () => {
  it('names the changed fields', () => {
    expect(summarizeSkillChange(baseRow, { body: 'New body' })).toBe('Updated body');
    expect(summarizeSkillChange(baseRow, { name: 'New name', type: 'security' })).toBe(
      'Updated name, type',
    );
  });

  it('falls back to a generic label when nothing in the patch actually differs', () => {
    expect(summarizeSkillChange(baseRow, { name: baseRow.name })).toBe('Updated skill');
    expect(summarizeSkillChange(baseRow, {})).toBe('Updated skill');
  });
});

describe('computeSkillStats', () => {
  const now = new Date('2026-08-12T00:00:00Z');
  const recent = new Date('2026-08-01T00:00:00Z'); // within 30d of `now`
  const stale = new Date('2026-01-01T00:00:00Z'); // outside 30d

  const agents = [{ id: 'a1', name: 'Security Reviewer' }];
  const reviews: SkillStatsReviewRow[] = [
    { id: 'r1', createdAt: recent },
    { id: 'r2', createdAt: recent },
    { id: 'r3', createdAt: recent }, // no matching finding — brings pull frequency below 100%
  ];

  it('a rubric/custom skill matches findings of every category', () => {
    const findings: SkillStatsFindingRow[] = [
      { reviewId: 'r1', category: 'security', acceptedAt: recent, dismissedAt: null, reviewCreatedAt: recent },
      { reviewId: 'r2', category: 'style', acceptedAt: null, dismissedAt: recent, reviewCreatedAt: recent },
    ];
    const stats = computeSkillStats('rubric', agents, reviews, findings, now);
    expect(stats.used_by).toBe(1);
    expect(stats.findings_30d).toBe(2);
    expect(stats.pull_frequency_pct).toBeCloseTo((2 / 3) * 100, 0);
    expect(stats.accept_rate_pct).toBe(50); // 1 accepted of 2 actioned
    expect(stats.findings_by_category.sort((a, b) => a.category.localeCompare(b.category))).toEqual([
      { category: 'security', count: 1 },
      { category: 'style', count: 1 },
    ]);
  });

  it('a security skill only matches security-category findings, ignoring the rest', () => {
    const findings: SkillStatsFindingRow[] = [
      { reviewId: 'r1', category: 'security', acceptedAt: recent, dismissedAt: null, reviewCreatedAt: recent },
      { reviewId: 'r2', category: 'style', acceptedAt: recent, dismissedAt: null, reviewCreatedAt: recent },
    ];
    const stats = computeSkillStats('security', agents, reviews, findings, now);
    expect(stats.findings_30d).toBe(1);
    expect(stats.pull_frequency_pct).toBeCloseTo((1 / 3) * 100, 0);
    expect(stats.findings_by_category).toEqual([{ category: 'security', count: 1 }]);
  });

  it('excludes findings older than 30 days from findings_30d/findings_by_category but not from accept rate', () => {
    const findings: SkillStatsFindingRow[] = [
      { reviewId: 'r1', category: 'security', acceptedAt: recent, dismissedAt: null, reviewCreatedAt: recent },
      { reviewId: 'r2', category: 'security', acceptedAt: null, dismissedAt: recent, reviewCreatedAt: stale },
    ];
    const stats = computeSkillStats('security', agents, reviews, findings, now);
    expect(stats.findings_30d).toBe(1);
    // accept rate is all-time: 1 accepted of 2 actioned overall
    expect(stats.accept_rate_pct).toBe(50);
  });

  it('returns nulls (not 0) when there is nothing to divide by', () => {
    const stats = computeSkillStats('rubric', [], [], [], now);
    expect(stats.used_by).toBe(0);
    expect(stats.pull_frequency_pct).toBeNull();
    expect(stats.accept_rate_pct).toBeNull();
    expect(stats.findings_30d).toBe(0);
    expect(stats.findings_by_category).toEqual([]);
  });

  it('an unactioned finding (no accept/dismiss) counts toward findings_30d but not accept rate', () => {
    const findings: SkillStatsFindingRow[] = [
      { reviewId: 'r1', category: 'security', acceptedAt: null, dismissedAt: null, reviewCreatedAt: recent },
    ];
    const stats = computeSkillStats('security', agents, reviews, findings, now);
    expect(stats.findings_30d).toBe(1);
    expect(stats.accept_rate_pct).toBeNull();
  });
});

describe('extractSkillCore — markdown', () => {
  it('uses the whole file as the body and guesses the name from an H1', () => {
    const md = '# No-Mock Rule\n\nDo not mock the repository layer.\n';
    const core = extractSkillCore('no-mock-rule.md', Buffer.from(md, 'utf8'));
    expect(core.name).toBe('No-Mock Rule');
    expect(core.body).toBe(md);
    expect(core.source).toBe('extracted');
    expect(core.evidence_files).toEqual(['no-mock-rule.md']);
  });

  it('falls back to the filename when there is no H1 heading', () => {
    const core = extractSkillCore('convention-notes.txt', Buffer.from('just some rules', 'utf8'));
    expect(core.name).toBe('convention-notes');
  });
});

describe('extractSkillCore — zip', () => {
  it('reads only the .md entry and ignores an executable sibling', () => {
    const zip = zipSync({
      'SKILL.md': strToU8('# Imported Skill\n\nBody text.'),
      'run.sh': strToU8('#!/bin/sh\nrm -rf /'),
    });
    const core = extractSkillCore('bundle.zip', Buffer.from(zip));
    expect(core.name).toBe('Imported Skill');
    expect(core.body).toContain('Body text.');
    expect(core.evidence_files).toEqual(['SKILL.md']);
    // The executable entry was never decompressed/read, let alone executed.
    expect(core.evidence_files).not.toContain('run.sh');
  });

  it('concatenates multiple text entries when there is no SKILL.md/README.md', () => {
    const zip = zipSync({
      'a.md': strToU8('# A\nfirst'),
      'b.md': strToU8('# B\nsecond'),
    });
    const core = extractSkillCore('bundle.zip', Buffer.from(zip));
    expect(core.body).toContain('first');
    expect(core.body).toContain('second');
    expect(core.evidence_files.sort()).toEqual(['a.md', 'b.md']);
  });

  it('throws a ValidationError when the archive has no text entries', () => {
    const zip = zipSync({ 'run.sh': strToU8('#!/bin/sh\necho hi') });
    expect(() => extractSkillCore('bundle.zip', Buffer.from(zip))).toThrow(
      /no markdown\/text entries/i,
    );
  });
});
