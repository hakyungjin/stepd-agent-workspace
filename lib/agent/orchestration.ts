import { randomUUID } from "node:crypto";
import type { Activity, AgentContext, Briefing } from "@/types/stepd";
import type { StepDGateway } from "@/lib/stepd/gateway";
import { rankLabel } from "@/lib/utils";
import { makePlans } from "./plans";
import { prepareDraftSelection, resumeDraftSelection } from "./draft-workflow";

export function resolveProgram(
  text: string,
  fallback: AgentContext["programId"],
): AgentContext["programId"] {
  return /나미브/.test(text)
    ? "namib"
    : /솔로정보회사/.test(text)
      ? "solo"
      : /부세미/.test(text)
        ? "busemi"
        : fallback;
}
export function resolveIntent(text: string, context: AgentContext) {
  if (context.action) return context.action;
  if (
    /성과|댓글|시청자|잘됐|잘된|다음엔|업로드|배포|삭제|문제|크레딧/.test(text)
  )
    return "performance";
  if (/왜.*추천|추천.*이유|근거|중요해/.test(text)) return "explain";
  if (/초안|draft/.test(text)) return "draft";
  if (/쇼츠|숏츠|골라|기획/.test(text)) return "plans";
  if (/어떤 작품|소개|이해/.test(text)) return "overview";
  if (/무슨 일이|회까지|사건|인물 변화/.test(text)) return "outline";
  return "search";
}

// Deterministic fixture router, NOT a second agent/tool loop. AI SDK owns streaming.
export async function runMockRequest(
  text: string,
  rawContext: AgentContext,
  gateway: StepDGateway,
  emit: (activity: Activity) => void,
  signal?: AbortSignal,
): Promise<Briefing> {
  const programId = resolveProgram(text, rawContext.programId);
  const context = { ...rawContext, programId };
  const scope = `1–${context.episodeMax}회 · ${context.includeSpoilers ? "스포일러 포함" : "스포일러 제외"}`;
  const base = { programId, scope, demo: true as const };
  const run = async <T>(
    tool: string,
    label: string,
    call: () => Promise<T>,
  ): Promise<T> => {
    const id = randomUUID();
    emit({ id, tool, label, status: "running" });
    // Short fixture latency makes actual tool progress visible; no retry or agent loop.
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(new Error("요청이 중단되었습니다."));
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("요청이 중단되었습니다."));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, 450);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    const result = await call();
    emit({
      id,
      tool,
      label,
      status: "complete",
      cached:
        typeof result === "object" && result !== null && "cacheHit" in result
          ? Boolean(result.cacheHit)
          : false,
    });
    return result;
  };
  const intent = resolveIntent(text, context);
  if (intent === "performance")
    return {
      ...base,
      kind: "unavailable",
      title: "성과 데이터 연결을 기다리고 있습니다",
      summary:
        "성과 데이터가 아직 연결되지 않았습니다. 조회수·완주율·댓글 반응과 성과 기반 재추천은 데이터 연결 후 사용할 수 있습니다.",
      points: [
        {
          label: "연결 기준",
          text: "배포 영상 ID → STEP D clip ID → 원본 장면·인물·훅·길이 → 채널 성과",
        },
        {
          label: "현재 상태",
          text: "준비 중 · 운영 상태 조회와 배포 캘린더도 같은 데이터 계약으로 확장됩니다.",
        },
      ],
    };
  if (intent === "overview") {
    const overview = await run(
      "get_program_overview",
      "작품 분석 범위 읽는 중",
      () => gateway.getProgramOverview({ programId }),
    );
    return {
      ...base,
      kind: "overview",
      title: `${overview.name}, 먼저 이해하기`,
      summary: overview.description,
      overview,
      points: [
        {
          label: "분석 범위",
          text: `${overview.analyzedEpisodes[0]}–${overview.analyzedEpisodes.at(-1)}회 · 저장된 데모 fixture`,
        },
        {
          label: "신뢰 상태",
          text: "소개와 인물 설정은 데모입니다. 실제 작품 정보로 검증되지 않았습니다.",
        },
      ],
    };
  }
  if (intent === "outline") {
    const episodeNumber = text.match(/([1-5])\s*회/);
    const episodeMax = episodeNumber
      ? Math.min(context.episodeMax, Number(episodeNumber[1]))
      : context.episodeMax;
    const outline = await run("get_episode_outline", "회차 분석 읽는 중", () =>
      gateway.getEpisodeOutline({
        programId,
        episodeMax,
        includeSpoilers: context.includeSpoilers,
      }),
    );
    return {
      ...base,
      kind: "outline",
      title: `${episodeMax}회까지의 사건 흐름`,
      summary:
        "저장된 회차 요약을 읽었습니다. 아래 사건은 실제 방송 정보가 아닌 데모 해석입니다.",
      outline,
    };
  }
  const durationMatch = text.match(/(\d+)\s*초/);
  const duration = Math.min(
    40,
    Math.max(20, durationMatch ? Number(durationMatch[1]) : context.duration),
  );
  const results = await run(
    "search_scenes",
    context.similarTo ? "비슷한 장면 찾는 중" : "저장된 장면 검색 중",
    () =>
      gateway.searchScenes({
        programId,
        query: intent === "search" ? text : "",
        episodeMax: context.episodeMax,
        includeSpoilers: context.includeSpoilers,
        limit: 5,
        similarTo: context.similarTo,
      }),
  );
  if (intent === "search")
    return {
      ...base,
      kind: "scenes",
      title: context.similarTo
        ? "같은 감정, 다른 장면을 찾았습니다"
        : "이 장면부터 살펴보세요",
      summary: `${Math.min(3, results.scenes.length)}개의 데모 장면을 찾았습니다. 대사와 시간은 fixture 원문, 장면 요약과 적합도는 해석입니다.`,
      scenes: results.scenes.slice(0, 3),
    };
  const requestedIds = [
    ...new Set([...context.selectedSceneIds, ...context.resultSceneIds]),
  ];
  const ordered = [
    ...requestedIds
      .map((id) => results.scenes.find((s) => s.id === id))
      .filter((s) => s !== undefined),
    ...results.scenes.filter((s) => !requestedIds.includes(s.id)),
  ];
  await run("list_clips", "원본 추천과 편집 구간 확인 중", () =>
    gateway.listClips({ programId, limit: 5 }),
  );
  const plans = makePlans(ordered, duration);
  if (!plans.length)
    return {
      ...base,
      kind: "unavailable",
      title: "이 범위에는 장면이 없습니다",
      summary: "회차 범위를 넓히거나 스포일러 필터를 변경해 주세요.",
    };
  const numberMatch = text.match(/([1-5])\s*번/);
  const candidateNumber =
    context.candidateNumber ?? (numberMatch ? Number(numberMatch[1]) : 1);
  const plan = plans[candidateNumber - 1];
  if ((intent === "explain" || intent === "draft") && !plan)
    return {
      ...base,
      kind: "unavailable",
      title: "해당 후보를 찾을 수 없습니다",
      summary: `현재 범위의 후보는 ${plans.length}개입니다. 후보 번호를 다시 선택해 주세요.`,
    };
  if (intent === "explain")
    return {
      ...base,
      kind: "explanation",
      title: `후보 ${candidateNumber}, 이렇게 추천했습니다`,
      summary: plan.reason,
      points: [
        {
          label: "요청 관련성",
          text: `${plan.type} 구성으로 ${duration}초 안에 훅 → 반응 → 여운을 만듭니다. 선택한 프로그램과 회차 범위에서 가져왔습니다.`,
        },
        {
          label: "훅·감정·갈등",
          text: `“${plan.hook}”로 시작해 관계의 긴장을 빠르게 전달합니다. 이는 편집 가능성에 대한 데모 해석입니다.`,
        },
        {
          label: "길이·편집 난이도",
          text: `${plan.duration}초 · ${plan.difficulty}`,
        },
        {
          label: "추천 출처",
          text: `${plan.recommendationSource === "original" ? "STEP D 원본 자동 추천" : "현재 요청에 맞춘 AI 재정렬"} (데모) · STEP D ${rankLabel(plan.originalRank)}`,
        },
        {
          label: "스포일러·권리",
          text: `${plan.spoiler === "safe" ? "안전" : plan.spoiler === "mild" ? "약함" : "강함"} · 권리 확인 필요`,
        },
        {
          label: "성과 근거",
          text: "성과 근거 없음 · 배포 성과 데이터가 아직 연결되지 않았습니다.",
        },
      ],
    };
  if (intent === "draft") {
    let threadId = context.workflowThreadId;
    if (!threadId) {
      threadId = randomUUID();
      await prepareDraftSelection(gateway, plans, threadId);
    }
    const draft = await run(
      "create_clip_draft",
      "source ranges와 자막 초안 저장 중",
      () => resumeDraftSelection(gateway, threadId!, plan.id),
    );
    return {
      ...base,
      kind: "draft",
      title: "편집을 시작할 초안이 준비됐습니다",
      summary: `${draft.duration}초 · 제목, 첫 자막, 썸네일 문구와 원본 구간을 저장했습니다. 편집기에서 검토하고 수정하세요.`,
      draft,
    };
  }
  const workflowThreadId = randomUUID();
  await prepareDraftSelection(gateway, plans, workflowThreadId);
  return {
    ...base,
    kind: "plans",
    title: `${duration}초 안에 담는 세 가지 이야기`,
    summary: `${plans.length}개의 편집 기획안을 만들었습니다. 원본 추천과 재정렬을 구분했으며, 모든 제목·자막은 데모 초안입니다.`,
    plans,
    scenes: ordered.slice(0, 3),
    workflowThreadId,
  };
}
