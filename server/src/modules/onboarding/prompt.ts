import { z } from 'zod';
import { wrapUntrusted, INJECTION_GUARD } from '../../platform/prompt.js';
import { renderPrompt } from '../../platform/prompts.js';
import type { ChatMessage } from '@devdigest/shared';
import { ONBOARDING_SECTIONS } from './constants.js';

/**
 * Prompt + structured-output schema for onboarding-tour generation.
 *
 * The generation schema is deliberately PERMISSIVE (`kind: z.string()`,
 * uncapped `links`) — the shared `Onboarding` contract's narrowed `kind`
 * enum and `MAX_LINKS_PER_SECTION` cap are PERSISTENCE gates, applied in
 * `helpers.ts#normalizeTour` after the LLM call, not at the structured-
 * output boundary. A strict schema here would fail the WHOLE parse (all
 * five sections) on a single hallucinated `kind`, which contradicts the
 * per-section discard/truncate ACs in SPEC-02.
 */

export const OnboardingLinkGenSchema = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLinkGen = z.infer<typeof OnboardingLinkGenSchema>;

export const OnboardingSectionGenSchema = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  diagram: z.string().nullish(),
  links: z.array(OnboardingLinkGenSchema),
});
export type OnboardingSectionGen = z.infer<typeof OnboardingSectionGenSchema>;

export const OnboardingGenerationSchema = z.object({
  sections: z.array(OnboardingSectionGenSchema),
});
export type OnboardingGenerationResult = z.infer<typeof OnboardingGenerationSchema>;

export interface ManifestFact {
  path: string;
  content: string;
}

export interface OnboardingFacts {
  criticalPaths: string[][];
  topFiles: string[];
  repoMap: string;
  manifests: ManifestFact[];
}

export async function buildOnboardingPrompt(
  repoFullName: string,
  facts: OnboardingFacts,
  language: string,
): Promise<ChatMessage[]> {
  const sectionsText = ONBOARDING_SECTIONS.map(
    (s, i) => `${i + 1}. ${s.kind} — ${s.title}`,
  ).join('\n');
  const systemBase = await renderPrompt('onboarding.system.md', { sections: sectionsText, language });
  // Q9: one shared guard, not a second inline copy — appended at assembly
  // time, same mechanism reviewer-core uses for every review prompt.
  const system = `${systemBase}\n\n${INJECTION_GUARD}`;

  const factBlocks = [
    wrapUntrusted('critical-paths', JSON.stringify(facts.criticalPaths)),
    wrapUntrusted('ranked-files', JSON.stringify(facts.topFiles)),
    wrapUntrusted('repo-map', facts.repoMap),
    ...facts.manifests.map((m) => wrapUntrusted(`manifest:${m.path}`, m.content)),
  ].join('\n\n');

  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `Repository: ${repoFullName}\n\n${factBlocks}`,
    },
  ];
}
