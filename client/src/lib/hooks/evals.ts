/* hooks/evals.ts — React Query hooks for the L06 Eval Pipeline (SPEC-04).
   Every endpoint here is served by server/src/modules/evals/ (a sibling plan
   step — Step 4) plus one agents-module route (restoreVersion, added in
   hooks/agents.ts by Step 5). Built against specs/04-eval-pipeline.md's
   endpoint shapes directly, which are authoritative and fixed regardless of
   those steps' exact landing order (SPEC-04 plan, Step 7).
   No wrapper functions added to api.ts — every path is built inline against
   the generic api.get/post/put/del, per client/INSIGHTS.md (2026-08-17). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { EvalCase, EvalCaseInput, EvalDashboard, EvalRun, EvalRunResult } from "@devdigest/shared";

// ---- Case CRUD (AC 2-7) ----

/** GET /agents/:id/eval-cases → this agent's full case set, workspace-scoped
   (AC 2). */
export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-cases", agentId],
    queryFn: () => api.get<EvalCase[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

/** POST /agents/:id/eval-cases → 201 EvalCase (AC 3). `input` is the full
   EvalCaseInput the contract requires, including owner_kind/owner_id, even
   though the route additionally scopes by `:id` — the contract shape is not
   reshaped client-side. */
export function useCreateEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalCaseInput) => api.post<EvalCase>(`/agents/${agentId}/eval-cases`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["eval-cases", agentId] }),
  });
}

/** PUT /eval-cases/:id → 200 updated EvalCase (AC 4). `agentId` is passed in
   only to know which cached list to invalidate — the route itself resolves
   ownership from the case row. */
export function useUpdateEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: EvalCaseInput }) =>
      api.put<EvalCase>(`/eval-cases/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["eval-cases", agentId] }),
  });
}

/** DELETE /eval-cases/:id → 204; cascades that case's eval_runs (AC 5), which
   can retroactively shift the dashboard trend (spec, Edge cases) — so this
   also invalidates the agent's dashboard, not just the case list. */
export function useDeleteEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/eval-cases/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard", "agent", agentId] });
    },
  });
}

// ---- Turn a finding into a case (AC 8-18) ----

/** POST /findings/:id/eval-case → EvalCase. Owned by evals/routes.ts, not
   reviews/ (spec, "Module ownership") — the `/findings/:id/*` prefix is
   served by two plugins. Idempotent: a repeat click on the same finding
   returns the existing case (AC 14), so a caller should treat any 2xx as
   success without branching on the exact status. */
export function useCreateEvalCaseFromFinding(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (findingId: string) => api.post<EvalCase>(`/findings/${findingId}/eval-case`),
    onSuccess: () => {
      if (agentId) qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
    },
  });
}

// ---- Running (AC 19-34) ----

/** POST /eval-cases/:id/run → runs synchronously, 200 EvalRunResult (AC 32).
   A fresh result can move the agent's dashboard metrics too. */
export function useRunEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.post<EvalRunResult>(`/eval-cases/${caseId}/run`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard", "agent", agentId] });
    },
  });
}

/** Accepted-batch shape for POST /agents/:id/eval-runs (AC 19). No shared
   `@devdigest/shared` contract models this envelope — the spec's own
   "jobs table has no result column" note is why the batch is read back via
   useEvalBatchStatus rather than the 202 body carrying anything more than
   the two ids the client needs to poll. Mirrors
   OnboardingGenerateAccepted's shape locally rather than inventing a new
   cross-package schema for a single hook's response. */
export interface EvalBatchAccepted {
  job_id: string;
  batch_id: string;
}

/** POST /agents/:id/eval-runs → 202 { job_id, batch_id } (AC 19), enqueuing
   the agent's whole case set as one batch. The 400 zero-cases case (AC 33)
   surfaces as a normal mutation error — no job is ever created for it. */
export function useDispatchEvalBatch(agentId: string | null | undefined) {
  return useMutation({
    mutationFn: () => api.post<EvalBatchAccepted>(`/agents/${agentId}/eval-runs`),
  });
}

/** Batch status envelope for GET /agents/:id/eval-runs/:batchId. `result` is
   null while `queued`/`running` (AC 21) and the aggregate EvalRun once
   `done` (AC 22); a `failed` job surfaces `error` instead of an empty
   successful batch (AC 24). Same "no contract for this" reasoning as
   EvalBatchAccepted above. */
export interface EvalBatchStatus {
  status: "queued" | "running" | "done" | "failed";
  batch_id: string;
  result: EvalRun | null;
  error?: string | null;
}

/** GET /agents/:id/eval-runs/:batchId → poll while `queued`/`running`. Same
   caller-controlled poll-flag shape as useOnboardingState/
   useConventionsState — only the caller knows the last observed status, so
   it decides when polling stops. */
export function useEvalBatchStatus(
  agentId: string | null | undefined,
  batchId: string | null | undefined,
  poll = false,
) {
  return useQuery({
    queryKey: ["eval-batch", agentId, batchId],
    queryFn: () => api.get<EvalBatchStatus>(`/agents/${agentId}/eval-runs/${batchId}`),
    enabled: !!agentId && !!batchId,
    refetchInterval: poll ? 2000 : false,
  });
}

// ---- Dashboards (AC 60-67) ----

/** GET /agents/:id/eval-dashboard?since=... → this agent's EvalDashboard
   (AC 60). `since` (AC 62) is an ISO-8601 instant; an unparseable value is
   422'd server-side (AC 63) — the caller is responsible for only sending a
   value it already knows parses (e.g. from a date picker's own ISO output). */
export function useAgentEvalDashboard(agentId: string | null | undefined, since?: string) {
  return useQuery({
    queryKey: ["eval-dashboard", "agent", agentId, since ?? null],
    queryFn: () =>
      api.get<EvalDashboard>(
        `/agents/${agentId}/eval-dashboard${since ? `?since=${encodeURIComponent(since)}` : ""}`,
      ),
    enabled: !!agentId,
  });
}

/** GET /eval-dashboard?since=... → one EvalDashboard per agent in the
   workspace (AC 61) — backs the workspace-wide Eval Dashboard page. */
export function useEvalDashboard(since?: string) {
  return useQuery({
    queryKey: ["eval-dashboard", "workspace", since ?? null],
    queryFn: () =>
      api.get<EvalDashboard[]>(`/eval-dashboard${since ? `?since=${encodeURIComponent(since)}` : ""}`),
  });
}
