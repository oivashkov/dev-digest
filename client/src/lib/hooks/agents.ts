/* hooks/agents.ts — React Query hooks for the A2 Agents tab + Agent Editor. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Agent,
  AgentSkillLink,
  AgentVersion,
  AttachedContextDoc,
  ModelInfo,
  Provider,
  ReviewStrategy,
} from "@devdigest/shared";

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<Agent[]>("/agents"),
  });
}

export function useAgent(id: string | null | undefined) {
  return useQuery({
    queryKey: ["agent", id],
    queryFn: () => api.get<Agent>(`/agents/${id}`),
    enabled: !!id,
  });
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  enabled?: boolean;
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentInput) => api.post<Agent>("/agents", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

export interface UpdateAgentInput {
  id: string;
  patch: Partial<
    Pick<
      Agent,
      | "name"
      | "description"
      | "provider"
      | "model"
      | "system_prompt"
      | "output_schema"
      | "strategy"
      | "ci_fail_on"
      | "repo_intel"
      | "enabled"
    >
  >;
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateAgentInput) => api.put<Agent>(`/agents/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.setQueryData(["agent", data.id], data);
    },
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/agents/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.removeQueries({ queryKey: ["agent", id] });
    },
  });
}

/** Dynamic model list for a provider (editor model picker). */
export function useProviderModels(provider: Provider | null | undefined) {
  return useQuery({
    queryKey: ["provider-models", provider],
    queryFn: () => api.get<ModelInfo[]>(`/providers/${provider}/models`),
    enabled: !!provider,
    staleTime: 5 * 60_000,
  });
}

/** An agent's linked skills, ordered — backs the Agent editor's Skills tab. */
export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

/** Replace the agent's full linked-skill set, in the given order — one call
 *  handles both attach/detach and reorder (server assigns order = index). */
export function useSetAgentSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillIds }: { agentId: string; skillIds: string[] }) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent-skills", agentId] });
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

/** An agent's attached Project Context documents, scoped to `repoId` (Q2) —
 *  backs the Agent editor's Context tab. */
export function useAgentContextDocs(agentId: string | null | undefined, repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-context-docs", agentId, repoId],
    queryFn: () => api.get<AttachedContextDoc[]>(`/agents/${agentId}/context?repo_id=${repoId}`),
    enabled: !!agentId && !!repoId,
  });
}

/** Full-replace the agent's attached context-document set for a repo, in the
 *  given order (drag order, Q3) — one call handles attach/detach/reorder,
 *  same shape as `useSetAgentSkills`. */
export function useSetAgentContextDocs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, repoId, paths }: { agentId: string; repoId: string; paths: string[] }) =>
      api.put<AttachedContextDoc[]>(`/agents/${agentId}/context`, { repo_id: repoId, paths }),
    onSuccess: (_data, { agentId, repoId }) => {
      qc.invalidateQueries({ queryKey: ["agent-context-docs", agentId, repoId] });
    },
  });
}

/** POST /agents/:id/versions/:version/restore → 200 Agent — "Promote prompt
 *  & model vN" (SPEC-04 ACs 54-59). Restores that version's stored
 *  `config_json` onto the agent through `AgentsService.update()`'s existing
 *  patch path, which snapshots a NEW version rather than mutating history
 *  (AC 57) — only `provider`/`model`/`system_prompt`/`output_schema`/
 *  `strategy`/`ci_fail_on`/`repo_intel` are restored; linked skills and
 *  context documents are left as they stand (AC 58). The server route lands
 *  in a sibling plan step (Step 5); this hook's shape is fixed by the spec
 *  regardless of that step's exact landing order. */
export function useRestoreAgentVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, version }: { agentId: string; version: number }) =>
      api.post<Agent>(`/agents/${agentId}/versions/${version}/restore`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.setQueryData(["agent", data.id], data);
    },
  });
}

/** GET /agents/:id/versions/:version → one config snapshot (route already
 *  landed in Step 5 — see `useRestoreAgentVersion`'s doc comment above; only
 *  the hook was missing). Feeds the Compare-runs modal's system-prompt diff:
 *  a persisted `EvalRunRecord.agent_version` number has no prompt TEXT of
 *  its own, this is how the modal turns a version number back into the
 *  actual `config.system_prompt` string for that point in the agent's
 *  history. `enabled: false` when `version` is null — a run recorded before
 *  the `agent_version` column existed has nothing to look up. */
export function useAgentVersion(agentId: string | null | undefined, version: number | null | undefined) {
  return useQuery({
    queryKey: ["agent-version", agentId, version],
    queryFn: () => api.get<AgentVersion>(`/agents/${agentId}/versions/${version}`),
    enabled: !!agentId && version != null,
    staleTime: Infinity, // a past version's snapshot never changes
  });
}
