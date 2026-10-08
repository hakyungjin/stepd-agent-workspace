import { tool } from "ai";
import { z } from "zod";
import {
  createClipDraftInputSchema,
  episodeOutlineInputSchema,
  programIdSchema,
  sceneSearchInputSchema,
} from "@/types/stepd";
import type { StepDGateway } from "@/lib/stepd/gateway";

export function createTools(gateway: StepDGateway) {
  return {
    get_program_overview: tool({
      description:
        "작품 소개 또는 프로그램 범위를 좁힐 때 사용. 대사/성과 질문만에는 사용하지 않음. 분석 회차와 저장 메타데이터는 사실, 소개는 해석/데모 여부 포함. 한 작품만 반환.",
      inputSchema: z.object({ programId: programIdSchema.optional() }),
      execute: (input) => gateway.getProgramOverview(input),
    }),
    get_episode_outline: tool({
      description:
        "회차 사건/인물 맥락을 읽을 때 사용. 원본 재분석이나 성과 조회에 사용하지 않음. 요약은 해석, 회차 범위는 저장 사실. 최대 5회, 스포일러 필터 준수.",
      inputSchema: episodeOutlineInputSchema,
      execute: (input) => gateway.getEpisodeOutline(input),
    }),
    search_scenes: tool({
      description:
        "프로그램/회차를 좁힌 뒤 장면/비슷한 장면 찾기에 사용. 동일 의도 재호출, 새 영상 분석, 성과 추정에는 사용하지 않음. 대사/시간/인물은 저장 원문, 요약/적합도는 해석. 비용 가능: 3~5개 이내, 캐시 우선.",
      inputSchema: sceneSearchInputSchema,
      execute: (input) => gateway.searchScenes(input),
    }),
    list_clips: tool({
      description:
        "저장된 STEP D 원본 추천 순위를 확인할 때 사용. AI 재정렬을 원본이라고 표현하거나 공개 배포에는 사용하지 않음. 저장 순위는 사실, 추천은 해석. 최대 5개.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(5),
        programId: programIdSchema.optional(),
      }),
      execute: (input) => gateway.listClips(input),
    }),
    get_queue_status: tool({
      description:
        "분석 대기열 상태 질문에만 사용. 장면 검색이나 재분석에 사용하지 않음. 연결된 운영 상태만 사실; 연결 없으면 미연결. 요약 상태만 반환.",
      inputSchema: z.object({}),
      execute: () => gateway.getQueueStatus(),
    }),
    get_credit_balance: tool({
      description:
        "현재 크레딧 조회 요청에만 사용. 충전/결제/비용 추정에 사용하지 않음. 연결된 잔액만 사실; 없으면 null. 잔액 하나만 반환.",
      inputSchema: z.object({}),
      execute: () => gateway.getCreditBalance(),
    }),
    create_clip_draft: tool({
      description:
        "사용자가 후보를 선택하고 초안 생성을 요청했을 때만 사용. 공개 배포/영구 편집/삭제에는 사용하지 않음. source ranges는 원본 사실, 제목/자막은 초안 해석. 단일 20~40초 초안만 생성.",
      inputSchema: createClipDraftInputSchema,
      execute: (input) => gateway.createClipDraft(input),
    }),
  };
}
