import { z } from "zod";
import { randomUUID } from "node:crypto";
import type {
  AgentContext,
  Briefing,
  ClipPlan,
  ClipSummary,
  EpisodeOutline,
  ProgramOverview,
  Scene,
} from "@/types/stepd";
import { briefingSchema } from "@/types/stepd";
import { rankLabel } from "@/lib/utils";
import { makePlans } from "./plans";

// The model may select source IDs and write interpretations. It cannot supply
// original dialogue, timestamps, people, rights, spoiler grades or ranking facts.
export const liveOutputSchema = z.object({
  kind: z.enum([
    "scenes",
    "plans",
    "overview",
    "outline",
    "explanation",
    "unavailable",
  ]),
  title: z.string().min(1).max(100),
  summary: z.string().min(1).max(1000),
  sceneIds: z.array(z.string()).max(5),
  plans: z
    .array(
      z.object({
        sceneId: z.string(),
        type: z.enum(["반전형", "갈등형", "감정형", "정보형"]),
        title: z.string().min(1).max(100),
        firstCaption: z.string().max(300),
        ending: z.string().max(200),
        thumbnailHook: z.string().max(100),
        reason: z.string().max(500),
        recommendationSource: z.enum(["original", "reranked"]),
      }),
    )
    .max(3),
  points: z
    .array(z.object({ label: z.string().max(40), text: z.string().max(500) }))
    .max(8),
});
export type LiveOutput = z.infer<typeof liveOutputSchema>;
export type LiveEvidence = {
  scenes: Map<string, Scene>;
  clips: ClipSummary[];
  overview?: ProgramOverview;
  outline?: EpisodeOutline;
  selectedPlan?: ClipPlan;
};
export function isInScope(scene: Scene, context: AgentContext) {
  return (
    scene.programId === context.programId &&
    scene.episode <= context.episodeMax &&
    (context.includeSpoilers || scene.spoiler === "safe") &&
    scene.id !== context.similarTo
  );
}

export function materializeLiveBriefing(
  output: LiveOutput,
  evidence: LiveEvidence,
  context: AgentContext,
  expectedKind: LiveOutput["kind"],
): Briefing {
  if (output.kind !== expectedKind && output.kind !== "unavailable")
    throw new Error("모델 답변 형식이 현재 요청과 일치하지 않습니다.");
  const scope = `1–${context.episodeMax}회 · ${context.includeSpoilers ? "스포일러 포함" : "스포일러 제외"}`;
  // Every consulted source votes on the demo label. Reading only overview and
  // scenes left outline-only answers labelled as production data.
  const consulted = [
    evidence.overview?.demo,
    evidence.outline?.demo,
    evidence.selectedPlan?.demo,
    ...[...evidence.scenes.values()].map((s) => s.demo),
    ...evidence.clips.map((c) => c.demo),
  ].filter((value) => value !== undefined);
  const base = {
    kind: output.kind,
    title: output.title,
    summary: `모델 해석 · ${output.summary}`,
    programId: context.programId,
    scope,
    demo: consulted.length
      ? consulted.some(Boolean)
      : process.env.STEPD_GATEWAY !== "mcp",
  };
  const selected = (ids: string[]) => {
    if (new Set(ids).size !== ids.length)
      throw new Error("조회한 장면을 중복 선택할 수 없습니다.");
    return ids.map((id) => {
      const scene = evidence.scenes.get(id);
      if (!scene || !isInScope(scene, context))
        throw new Error("조회하지 않은 장면 또는 현재 범위 밖의 장면입니다.");
      return scene;
    });
  };
  if (output.kind === "scenes")
    return briefingSchema.parse({
      ...base,
      scenes: selected(output.sceneIds).slice(0, 5),
    });
  if (output.kind === "plans") {
    const scenes = selected(output.plans.map((p) => p.sceneId));
    if (!scenes.length || scenes.some((s) => s.end - s.start < 20))
      throw new Error("현재 범위에서 20초 이상의 원본 장면을 선택해 주세요.");
    const plans = makePlans(scenes, context.duration).map((plan, index) => {
      const proposal = output.plans[index];
      const original = evidence.clips.find((c) => c.sceneId === plan.sceneId);
      return {
        ...plan,
        id: `${plan.id}-${randomUUID().slice(0, 8)}`,
        type: proposal.type,
        title: proposal.title,
        firstCaption: proposal.firstCaption,
        ending: proposal.ending,
        thumbnailHook: proposal.thumbnailHook,
        reason: proposal.reason,
        recommendationSource:
          proposal.recommendationSource === "original" &&
          original?.originalRank === index + 1
            ? ("original" as const)
            : ("reranked" as const),
        originalRank: original?.originalRank ?? scenes[index].originalRank,
      };
    });
    return briefingSchema.parse({ ...base, scenes, plans });
  }
  if (output.kind === "overview") {
    if (!evidence.overview || evidence.overview.id !== context.programId)
      throw new Error("조회하지 않은 작품 소개입니다.");
    return briefingSchema.parse({
      ...base,
      overview: evidence.overview,
      points: [
        { label: "분석 범위", text: `${scope} · 저장된 분석 기준` },
        {
          label: "신뢰 상태",
          text: evidence.overview.demo
            ? "데모 fixture · 실제 방송 정보가 아닙니다. 요약은 모델 해석입니다."
            : "소개는 모델 해석입니다. 원문 분석 범위에서 확인하세요.",
        },
      ],
    });
  }
  if (output.kind === "outline") {
    if (!evidence.outline || evidence.outline.programId !== context.programId)
      throw new Error("조회하지 않은 회차 분석입니다.");
    return briefingSchema.parse({
      ...base,
      outline: evidence.outline,
      points: [{ label: "신뢰 상태", text: evidence.outline.reliability }],
    });
  }
  if (output.kind === "explanation") {
    // selectedPlan comes from the server's own LangGraph checkpoint, which was
    // built from scenes this server already verified, so it is sufficient
    // evidence on its own. Also requiring a fresh search_scenes hit made
    // explanations fail whenever the model answered without calling a tool.
    const plan = evidence.selectedPlan;
    if (!plan) throw new Error("추천 근거를 설명할 후보를 먼저 선택해 주세요.");
    return briefingSchema.parse({
      ...base,
      points: [
        ...output.points
          .filter((p) => !/성과|스포일러|권리|추천 출처|길이/.test(p.label))
          .slice(0, 4),
        {
          label: "길이·편집 난이도",
          text: `${plan.duration}초 · ${plan.difficulty}`,
        },
        {
          label: "추천 출처",
          text: `${plan.recommendationSource === "original" ? "STEP D 원본 자동 추천" : "현재 요청에 맞춘 AI 재정렬"} · ${rankLabel(plan.originalRank)}${plan.demo ? " (데모)" : ""}`,
        },
        {
          label: "스포일러·권리",
          text: `${plan.spoiler === "safe" ? "안전" : plan.spoiler === "mild" ? "약함" : "강함"} · ${plan.rights === "review" ? "권리 확인 필요" : "권리 확인됨"}`,
        },
        {
          label: "성과 근거",
          text: "성과 근거 없음 · 배포 성과 데이터가 아직 연결되지 않았습니다.",
        },
      ],
    });
  }
  return briefingSchema.parse({ ...base, points: output.points });
}
