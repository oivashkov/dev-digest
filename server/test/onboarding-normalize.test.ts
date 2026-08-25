import { describe, it, expect } from 'vitest';
import { normalizeTour } from '../src/modules/onboarding/helpers.js';
import type { OnboardingGenerationResult } from '../src/modules/onboarding/prompt.js';

function section(overrides: Partial<OnboardingGenerationResult['sections'][number]> = {}) {
  return {
    kind: 'architecture',
    title: 'T',
    body: 'b',
    links: [],
    ...overrides,
  };
}

describe('normalizeTour', () => {
  it('discards a section whose kind is outside the five-value enum, keeping the rest', () => {
    const raw: OnboardingGenerationResult = {
      sections: [
        section({ kind: 'architecture', title: 'Architecture' }),
        section({ kind: 'routes_and_apis', title: 'Bogus' }),
        section({ kind: 'critical_paths', title: 'Critical paths' }),
      ],
    };
    const tour = normalizeTour(raw, new Set());
    expect(tour.sections.map((s) => s.kind)).toEqual(['architecture', 'critical_paths']);
  });

  it('persists fewer than five sections as-is when the model returns fewer', () => {
    const raw: OnboardingGenerationResult = {
      sections: [
        section({ kind: 'architecture' }),
        section({ kind: 'local_setup' }),
        section({ kind: 'reading_path' }),
        section({ kind: 'first_tasks' }),
      ],
    };
    const tour = normalizeTour(raw, new Set());
    expect(tour.sections).toHaveLength(4);
  });

  it('re-orders sections to the canonical order regardless of model output order', () => {
    const raw: OnboardingGenerationResult = {
      sections: [section({ kind: 'first_tasks' }), section({ kind: 'architecture' })],
    };
    const tour = normalizeTour(raw, new Set());
    expect(tour.sections.map((s) => s.kind)).toEqual(['architecture', 'first_tasks']);
  });

  it('truncates links to at most 4 per section', () => {
    const raw: OnboardingGenerationResult = {
      sections: [
        section({
          kind: 'local_setup',
          links: [
            { label: 'a', path: 'a.ts' },
            { label: 'b', path: 'b.ts' },
            { label: 'c', path: 'c.ts' },
            { label: 'd', path: 'd.ts' },
            { label: 'e', path: 'e.ts' },
            { label: 'f', path: 'f.ts' },
          ],
        }),
      ],
    };
    const allowed = new Set(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts']);
    const tour = normalizeTour(raw, allowed);
    expect(tour.sections[0]!.links).toHaveLength(4);
  });

  it('drops a link whose path is absent from the allowed (indexed ∪ manifest) set', () => {
    const raw: OnboardingGenerationResult = {
      sections: [
        section({
          kind: 'reading_path',
          links: [
            { label: 'real', path: 'src/index.ts' },
            { label: 'invented', path: 'src/does-not-exist.ts' },
          ],
        }),
      ],
    };
    const tour = normalizeTour(raw, new Set(['src/index.ts']));
    expect(tour.sections[0]!.links).toEqual([{ label: 'real', path: 'src/index.ts' }]);
  });

  it('nulls diagram on every section except architecture', () => {
    const raw: OnboardingGenerationResult = {
      sections: [
        section({ kind: 'architecture', diagram: 'flowchart LR\nA-->B' }),
        section({ kind: 'critical_paths', diagram: 'flowchart LR\nX-->Y' }),
      ],
    };
    const tour = normalizeTour(raw, new Set());
    expect(tour.sections.find((s) => s.kind === 'architecture')!.diagram).toBe('flowchart LR\nA-->B');
    expect(tour.sections.find((s) => s.kind === 'critical_paths')!.diagram).toBeNull();
  });

  it('keeps only the first occurrence of a repeated kind', () => {
    const raw: OnboardingGenerationResult = {
      sections: [
        section({ kind: 'architecture', title: 'First' }),
        section({ kind: 'architecture', title: 'Second' }),
      ],
    };
    const tour = normalizeTour(raw, new Set());
    expect(tour.sections).toHaveLength(1);
    expect(tour.sections[0]!.title).toBe('First');
  });
});
