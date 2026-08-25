import type { Onboarding, OnboardingSection, OnboardingSectionKind } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { MAX_LINKS_PER_SECTION, ONBOARDING_SECTIONS } from './constants.js';
import type { OnboardingGenerationResult } from './prompt.js';

const VALID_KINDS = new Set<string>(ONBOARDING_SECTIONS.map((s) => s.kind));
const SECTION_ORDER = ONBOARDING_SECTIONS.map((s) => s.kind);

/**
 * Normalize a permissive LLM generation result into the strict, persistable
 * shape: per-section salvage per SPEC-02's structural ACs.
 *
 *  - a section whose `kind` is outside the five-value enum is DISCARDED, not
 *    the whole tour;
 *  - a repeated `kind` keeps only the first occurrence;
 *  - `links` are capped to `MAX_LINKS_PER_SECTION` and filtered to
 *    `allowedPaths` (the server-derived indexed-file ∪ manifest-fed set —
 *    never trust a model-supplied path);
 *  - `diagram` is nulled on every section except `architecture`;
 *  - surviving sections are re-ordered to `ONBOARDING_SECTIONS`' canonical
 *    order, regardless of the order the model returned them in.
 *
 * Pure — no I/O — so it is unit-testable without a DB or an LLM.
 */
export function normalizeTour(raw: OnboardingGenerationResult, allowedPaths: Set<string>): Onboarding {
  const byKind = new Map<string, OnboardingSection>();
  for (const s of raw.sections) {
    if (!VALID_KINDS.has(s.kind)) continue; // discard hallucinated kind
    if (byKind.has(s.kind)) continue; // dedupe — first occurrence wins
    const links = s.links.filter((l) => allowedPaths.has(l.path)).slice(0, MAX_LINKS_PER_SECTION);
    byKind.set(s.kind, {
      kind: s.kind as OnboardingSectionKind,
      title: s.title,
      body: s.body,
      diagram: s.kind === 'architecture' ? (s.diagram ?? null) : null,
      links,
    });
  }
  const sections = SECTION_ORDER.map((kind) => byKind.get(kind)).filter(
    (s): s is OnboardingSection => s !== undefined,
  );
  return { sections };
}

/**
 * Resolve the prompt's `{{language}}` value. A one-function seam (SPEC-02
 * §9 Recommendation 3): this codebase has no workspace locale setting yet
 * (`client/src/i18n/request.ts` hardcodes `en`), so this always returns
 * 'English' today — the day a locale setting lands, this is the one place
 * to change, with no prompt-assembly rework.
 */
export async function resolveLanguage(_container: Container, _workspaceId: string): Promise<string> {
  return 'English';
}
