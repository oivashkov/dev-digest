/* hooks/conventions.ts — React Query hooks for the Conventions Lab.
   Mirrors hooks/repo-intel.ts's polling shape:
     GET   /repos/:id/conventions          → ConventionsState
     POST  /repos/:id/conventions/extract  → 202, enqueues extraction
     PATCH /conventions/:id                → accept/reject/edit one candidate */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConventionCandidate, ConventionsState, UpdateConventionCandidate } from "@devdigest/shared";
import { api } from "../api";

/** GET /repos/:id/conventions → candidates + scan status.
    While `poll` is true, refetch on an interval so a running extraction's
    result becomes visible — the caller stops polling once `scan_status`
    leaves "scanning". */
export function useConventionsState(repoId: string | null | undefined, poll = false) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionsState>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
    refetchInterval: poll ? 2000 : false,
  });
}

/** POST /repos/:id/conventions/extract → enqueue a (re-)scan. */
export function useTriggerConventionsExtraction(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ status: string }>(`/repos/${repoId}/conventions/extract`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

/** PATCH /conventions/:id → accept / reject / inline-edit a candidate. */
export function useUpdateConvention(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateConventionCandidate }) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}
