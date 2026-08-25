/* hooks/skills.ts — React Query hooks for the Skills Lab list/editor + import. */
"use client";

import { useQueries, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AttachedContextDoc,
  Skill,
  SkillStats,
  SkillSummary,
  SkillType,
  SkillVersion,
} from "@devdigest/shared";

/** Each row includes its usage summary (used_by/pull_frequency_pct/accept_rate_pct)
 *  — see SkillSummary's doc comment in @devdigest/shared. */
export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<SkillSummary[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  source?: Skill["source"];
  body: string;
  enabled?: boolean;
  evidence_files?: string[];
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">>;
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.removeQueries({ queryKey: ["skill", id] });
    },
  });
}

/** Body-snapshot history for the Versions tab, newest first. */
export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id, "versions"],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

export function useRestoreSkillVersion(id: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (version: number) => api.post<Skill>(`/skills/${id}/versions/${version}/restore`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["skill", id, "versions"] });
      qc.setQueryData(["skill", id], data);
    },
  });
}

/** Usage stats for the Stats tab — see SkillStats' doc comment in
 *  @devdigest/shared for the category-matching approximation it relies on. */
export function useSkillStats(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id, "stats"],
    queryFn: () => api.get<SkillStats>(`/skills/${id}/stats`),
    enabled: !!id,
  });
}

/** A skill's attached Project Context documents, scoped to `repoId` (Q2) —
 *  backs the Skill editor's Context section. Unordered (Q13) — the server
 *  already sorts by normalized path. */
export function useSkillContextDocs(skillId: string | null | undefined, repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-context-docs", skillId, repoId],
    queryFn: () => api.get<AttachedContextDoc[]>(`/skills/${skillId}/context?repo_id=${repoId}`),
    enabled: !!skillId && !!repoId,
  });
}

/**
 * Attached context documents for MULTIPLE skills at once, scoped to `repoId`
 * — the Agent editor's Context tab needs this to show skill-inherited
 * documents as read-only ticked rows (Q3). Returns a `Map<skillId,
 * AttachedContextDoc[]>`; a skill whose query hasn't resolved yet (or
 * `skillIds`/`repoId` empty) is simply absent from the map rather than
 * blocking the whole tab on the slowest skill.
 */
export function useSkillsContextDocs(skillIds: string[], repoId: string | null | undefined) {
  const queries = useQueries({
    queries: skillIds.map((skillId) => ({
      queryKey: ["skill-context-docs", skillId, repoId],
      queryFn: () => api.get<AttachedContextDoc[]>(`/skills/${skillId}/context?repo_id=${repoId}`),
      enabled: !!skillId && !!repoId,
    })),
  });
  const byId = new Map<string, AttachedContextDoc[]>();
  skillIds.forEach((skillId, i) => {
    const data = queries[i]?.data;
    if (data) byId.set(skillId, data);
  });
  return byId;
}

/** Full-replace the skill's attached context-document set for a repo. */
export function useSetSkillContextDocs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, repoId, paths }: { skillId: string; repoId: string; paths: string[] }) =>
      api.put<AttachedContextDoc[]>(`/skills/${skillId}/context`, { repo_id: repoId, paths }),
    onSuccess: (_data, { skillId, repoId }) => {
      qc.invalidateQueries({ queryKey: ["skill-context-docs", skillId, repoId] });
    },
  });
}

export interface ImportSkillPreview {
  name: string;
  description: string;
  type: SkillType;
  source: Skill["source"];
  body: string;
  evidence_files: string[];
}

/** Parses an uploaded markdown/zip file server-side. Never persists anything —
 *  the caller shows this preview and only then calls `useCreateSkill`. */
export function useImportSkillPreview() {
  return useMutation({
    mutationFn: (input: { filename: string; content_base64: string }) =>
      api.post<ImportSkillPreview>("/skills/import/preview", input),
  });
}
