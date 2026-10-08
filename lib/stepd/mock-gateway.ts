import { randomUUID } from "node:crypto";
import { programs, scenes } from "@/fixtures/programs";
import {
  sceneSearchInputSchema,
  type CreateClipDraftInput,
  type EpisodeOutlineInput,
  type ProgramOverview,
  type SceneSearchInput,
  type SceneSearchResult,
} from "@/types/stepd";
import type { StepDGateway } from "./gateway";
import { saveDraft } from "./draft-store";

const cache = new Map<string, { expires: number; result: SceneSearchResult }>();
export class MockStepDGateway implements StepDGateway {
  async listPrograms() {
    return programs;
  }
  async getProgramOverview(input: { programId?: ProgramOverview["id"] }) {
    return programs.find((p) => p.id === input.programId) ?? programs[0];
  }
  async getEpisodeOutline(input: EpisodeOutlineInput) {
    const data = scenes.filter(
      (s) =>
        s.programId === input.programId &&
        s.episode <= input.episodeMax &&
        (input.includeSpoilers || s.spoiler === "safe"),
    );
    return {
      programId: input.programId,
      analyzedRange: `1–${input.episodeMax}회`,
      events: data.map((s) => ({ episode: s.episode, summary: s.summary })),
      reliability: "데모 fixture · 실제 방송 분석이 아닙니다",
      demo: true as const,
    };
  }
  async searchScenes(raw: SceneSearchInput): Promise<SceneSearchResult> {
    const input = sceneSearchInputSchema.parse(raw);
    const normalized = /정체|들킬|의심|신분|비밀/.test(input.query)
      ? "정체"
      : /힘든|좌절|어려운|유진우/.test(input.query)
        ? "좌절"
        : input.query.trim().replace(/\s+/g, " ");
    const key = JSON.stringify({ ...input, query: normalized });
    const previous = cache.get(key);
    if (previous && previous.expires > Date.now())
      return { ...previous.result, cacheHit: true };
    const similar = scenes.find(
      (s) => s.id === input.similarTo && s.programId === input.programId,
    );
    const tokens = normalized.split(" ").filter((t) => t.length > 1);
    const score = (s: (typeof scenes)[number]) =>
      tokens.reduce(
        (sum, t) => sum + (s.keywords.join(" ").includes(t) ? 20 : 0),
        s.hookScore,
      ) +
      (similar
        ? s.tags.filter((t) => similar.tags.includes(t)).length * 15
        : 0);
    const available = scenes
      .filter(
        (s) =>
          s.programId === input.programId &&
          s.episode <= input.episodeMax &&
          (input.includeSpoilers || s.spoiler === "safe") &&
          s.id !== input.similarTo,
      )
      .sort((a, b) => score(b) - score(a));
    const result: SceneSearchResult = {
      scenes: available.slice(0, input.limit),
      total: available.length,
      scope: `1–${input.episodeMax}회 · ${input.includeSpoilers ? "스포일러 포함" : "스포일러 제외"}`,
      cacheHit: false,
      demo: true,
    };
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.now() + 5 * 60_000, result });
    return result;
  }
  async listClips(input: { limit: number; programId?: ProgramOverview["id"] }) {
    return scenes
      .filter((s) => !input.programId || s.programId === input.programId)
      .sort((a, b) => (a.originalRank ?? 0) - (b.originalRank ?? 0))
      .slice(0, Math.min(5, input.limit))
      .map((s) => ({
        id: `clip-${s.id}`,
        sceneId: s.id,
        originalRank: s.originalRank,
        recommendationSource: "original" as const,
        demo: true as const,
      }));
  }
  async createClipDraft({ plan }: CreateClipDraftInput) {
    const scene = scenes.find(
      (s) => s.id === plan.sceneId && s.programId === plan.programId,
    );
    if (
      !scene ||
      plan.sourceRanges.some(
        (r) =>
          r.sceneId !== scene.id ||
          r.episode !== scene.episode ||
          r.start < scene.start ||
          r.end > scene.end ||
          r.end <= r.start,
      ) ||
      plan.sourceRanges.reduce((sum, r) => sum + r.end - r.start, 0) !==
        plan.duration
    )
      throw new Error("원본 장면과 초안 구간이 일치하지 않습니다.");
    const id = `demo-${randomUUID()}`;
    const draft = {
      id,
      programId: plan.programId,
      title: plan.title,
      captions: [
        { start: 0, end: 3, text: plan.firstCaption },
        {
          start: 3,
          end: plan.duration - 5,
          text: "자막 초안 · 데모 대사를 확인하고 편집하세요.",
        },
        {
          start: plan.duration - 5,
          end: plan.duration,
          text: "이 다음, 어떤 선택을 할까요?",
        },
      ],
      thumbnailHook: plan.thumbnailHook,
      sourceRanges: plan.sourceRanges,
      duration: plan.duration,
      editorUrl: `/draft/${id}`,
      createdAt: new Date().toISOString(),
      demo: true as const,
    };
    await saveDraft(draft);
    return draft;
  }
  async getQueueStatus() {
    return {
      status: "not-connected" as const,
      message: "분석 대기열은 아직 연결되지 않았습니다.",
    };
  }
  async getCreditBalance() {
    return {
      balance: null,
      message: "크레딧 데이터는 아직 연결되지 않았습니다.",
    };
  }
}
