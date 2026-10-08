import type { StepDGateway } from "@/lib/stepd/gateway";
import type { Activity, AgentContext, SceneSearchInput } from "@/types/stepd";
import type { LiveEvidence } from "./live-output";
import { isInScope } from "./live-output";

export function observeGateway(
  gateway: StepDGateway,
  context: AgentContext,
  evidence: LiveEvidence,
  emit: (event: Activity) => void,
): StepDGateway {
  const searches = new Map<string, ReturnType<StepDGateway["searchScenes"]>>();
  const run = async <T>(
    tool: string,
    label: string,
    execute: () => Promise<T>,
    cached = false,
  ): Promise<T> => {
    const id = crypto.randomUUID();
    emit({ id, tool, label, status: "running", cached });
    const result = await execute();
    emit({ id, tool, label, status: "complete", cached });
    return result;
  };
  const requireProgram = (programId?: string) => {
    if (programId && programId !== context.programId)
      throw new Error("도구의 프로그램은 현재 범위와 일치해야 합니다.");
  };
  return {
    // Program discovery is a UI concern, not a model tool, so it passes through
    // unobserved and is absent from the agent's activeTools.
    listPrograms: () => gateway.listPrograms(),
    getProgramOverview: async (input) => {
      requireProgram(input.programId);
      return run("get_program_overview", "작품 분석 범위 읽는 중", async () => {
        const overview = await gateway.getProgramOverview({
          programId: context.programId,
        });
        evidence.overview = overview;
        return overview;
      });
    },
    getEpisodeOutline: async (input) => {
      requireProgram(input.programId);
      return run("get_episode_outline", "회차 분석 읽는 중", async () => {
        const outline = await gateway.getEpisodeOutline({
          ...input,
          episodeMax: Math.min(input.episodeMax, context.episodeMax),
          includeSpoilers: context.includeSpoilers,
        });
        evidence.outline = outline;
        return outline;
      });
    },
    searchScenes: async (input) => {
      requireProgram(input.programId);
      const scoped: SceneSearchInput = {
        ...input,
        episodeMax: Math.min(input.episodeMax, context.episodeMax),
        includeSpoilers: context.includeSpoilers,
        limit: Math.min(5, input.limit),
        similarTo: context.similarTo ?? input.similarTo,
      };
      const query = /정체|들킬|의심|신분|비밀/.test(input.query)
        ? "정체 위기"
        : /힘든|좌절|어려운|유진우/.test(input.query)
          ? "좌절"
          : input.query.trim().replace(/\s+/g, " ");
      const key = JSON.stringify({ ...scoped, query });
      const cached = searches.has(key);
      if (!cached)
        searches.set(
          key,
          gateway.searchScenes(scoped).then((result) => {
            const scenes = result.scenes.filter((s) => isInScope(s, context));
            scenes.forEach((s) => evidence.scenes.set(s.id, s));
            return { ...result, scenes };
          }),
        );
      return run(
        "search_scenes",
        context.similarTo ? "비슷한 장면 찾는 중" : "저장된 장면 검색 중",
        () => searches.get(key)!,
        cached,
      );
    },
    listClips: async (input) => {
      requireProgram(input.programId);
      return run("list_clips", "STEP D 원본 추천 읽는 중", async () => {
        const clips = await gateway.listClips({
          ...input,
          programId: context.programId,
          limit: Math.min(input.limit, 5),
        });
        evidence.clips = clips;
        return clips;
      });
    },
    getQueueStatus: () =>
      run("get_queue_status", "운영 상태 읽는 중", () =>
        gateway.getQueueStatus(),
      ),
    getCreditBalance: () =>
      run("get_credit_balance", "크레딧 상태 읽는 중", () =>
        gateway.getCreditBalance(),
      ),
    createClipDraft: async () => {
      throw new Error(
        "초안은 사용자가 선택한 후보를 LangGraph에서 재개해 생성합니다.",
      );
    },
  };
}
