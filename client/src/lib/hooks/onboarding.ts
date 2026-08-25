/* hooks/onboarding.ts — React Query hooks for the Onboarding Tour.
   Mirrors hooks/conventions.ts's polling shape:
     GET  /repos/:id/onboarding           → OnboardingState
     POST /repos/:id/onboarding/generate  → 202, enqueues generation */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OnboardingGenerateAccepted, OnboardingState } from "@devdigest/shared";
import { api } from "../api";

/** GET /repos/:id/onboarding → cached tour + status.
    While `poll` is true, refetch on an interval so a running generation's
    result becomes visible — the caller stops polling once `status` leaves
    "generating". */
export function useOnboardingState(repoId: string | null | undefined, poll = false) {
  return useQuery({
    queryKey: ["onboarding", repoId],
    queryFn: () => api.get<OnboardingState>(`/repos/${repoId}/onboarding`),
    enabled: !!repoId,
    refetchInterval: poll ? 2000 : false,
  });
}

/** POST /repos/:id/onboarding/generate → enqueue a (re-)generation. */
export function useGenerateOnboarding(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<OnboardingGenerateAccepted>(`/repos/${repoId}/onboarding/generate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onboarding", repoId] }),
  });
}
