import "server-only";
import {
  convertToModelMessages,
  Output,
  stepCountIs,
  ToolLoopAgent,
  type UIMessageStreamWriter,
  type TextStreamPart,
} from "ai";
import type { AgentMessage } from "@/types/chat";
import type { Activity, AgentContext, Briefing } from "@/types/stepd";
import type { StepDGateway } from "@/lib/stepd/gateway";
import { getModelProvider } from "./provider";
import { systemPrompt } from "./system-prompt";
import { createTools } from "./tool-registry";
import { resolveIntent, resolveProgram } from "./orchestration";
import {
  getPreparedPlans,
  prepareDraftSelection,
  resumeDraftSelection,
} from "./draft-workflow";
import {
  liveOutputSchema,
  materializeLiveBriefing,
  type LiveEvidence,
  type LiveOutput,
} from "./live-output";
import { observeGateway } from "./observed-gateway";
import { recordLocalTrace } from "./trace";
import { getProviderStatus } from "./errors";

export async function streamLiveAgent(
  messages: AgentMessage[],
  rawContext: AgentContext,
  gateway: StepDGateway,
  writer: UIMessageStreamWriter<AgentMessage>,
  signal: AbortSignal,
) {
  const text =
    messages
      .findLast((m) => m.role === "user")
      ?.parts.filter((p) => p.type === "text")
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("") || "";
  const durationMatch = text.match(/(\d+)\s*초/);
  const context = {
    ...rawContext,
    programId: resolveProgram(text, rawContext.programId),
    duration: Math.min(
      40,
      Math.max(
        20,
        durationMatch ? Number(durationMatch[1]) : rawContext.duration,
      ),
    ),
  };
  const intent = resolveIntent(text, context);
  const scope = `1–${context.episodeMax}회 · ${context.includeSpoilers ? "스포일러 포함" : "스포일러 제외"}`;
  const emitBriefing = (briefing: Briefing) =>
    writer.write({
      type: "data-briefing",
      id: crypto.randomUUID(),
      data: briefing,
    });
  const candidateNumber =
    context.candidateNumber ?? Number(text.match(/([1-5])\s*번/)?.[1] || 1);
  if (intent === "performance") {
    emitBriefing({
      kind: "unavailable",
      title: "성과 데이터 연결을 기다리고 있습니다",
      summary:
        "성과 데이터가 아직 연결되지 않았습니다. 조회수·완주율·댓글과 성과 기반 재추천을 추정하지 않습니다.",
      programId: context.programId,
      scope,
      demo: process.env.STEPD_GATEWAY !== "mcp",
      points: [
        {
          label: "연결 기준",
          text: "배포 영상 ID → clip ID → 원본 장면·인물·훅·길이 → 채널 성과",
        },
      ],
    });
    return;
  }
  const preparedPlans =
    (intent === "draft" || intent === "explain") && context.workflowThreadId
      ? await getPreparedPlans(gateway, context.workflowThreadId)
      : [];
  const selectedPlan = preparedPlans[candidateNumber - 1];
  if (intent === "draft") {
    if (
      !selectedPlan ||
      selectedPlan.programId !== context.programId ||
      selectedPlan.sourceRanges.some((r) => r.episode > context.episodeMax) ||
      (!context.includeSpoilers && selectedPlan.spoiler !== "safe")
    ) {
      emitBriefing({
        kind: "unavailable",
        title: "먼저 쇼츠 후보를 선택해 주세요",
        summary:
          "현재 범위에서 쇼츠 기획안을 생성한 뒤 후보를 선택하면 초안을 저장합니다.",
        programId: context.programId,
        scope,
        demo: process.env.STEPD_GATEWAY !== "mcp",
      });
      return;
    }
    const id = crypto.randomUUID();
    writer.write({
      type: "data-activity",
      id,
      data: {
        id,
        tool: "create_clip_draft",
        label: "선택한 후보의 초안 저장 중",
        status: "running",
      },
    });
    const draft = await resumeDraftSelection(
      gateway,
      context.workflowThreadId!,
      selectedPlan.id,
    );
    writer.write({
      type: "data-activity",
      id,
      data: {
        id,
        tool: "create_clip_draft",
        label: "선택한 후보의 초안 저장 중",
        status: "complete",
      },
    });
    emitBriefing({
      kind: "draft",
      title: "편집을 시작할 초안이 준비됐습니다",
      summary: `${draft.duration}초 · 선택한 기획안의 source ranges, 제목, 자막과 썸네일 문구를 저장했습니다.`,
      programId: context.programId,
      scope,
      demo: draft.demo,
      draft,
    });
    return;
  }
  if (intent === "explain" && !selectedPlan) {
    emitBriefing({
      kind: "unavailable",
      title: "설명할 후보를 먼저 골라 주세요",
      summary: "쇼츠 기획안을 생성하면 후보별 추천 이유를 설명할 수 있습니다.",
      programId: context.programId,
      scope,
      demo: process.env.STEPD_GATEWAY !== "mcp",
    });
    return;
  }
  if (
    (process.env.AGENT_DEPLOYMENT || process.env.NODE_ENV) === "production" &&
    !process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  )
    throw new Error("운영 전 관측 도구 연결이 필요합니다.");
  const { forcedToolChoiceWithStructuredOutput, ...provider } =
    getModelProvider();
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const evidence: LiveEvidence = { scenes: new Map(), clips: [], selectedPlan };
  const activities = new Map<string, Activity>();
  const scopedGateway = observeGateway(
    gateway,
    context,
    evidence,
    (activity) => {
      activities.set(activity.id, activity);
      writer.write({ type: "data-activity", id: activity.id, data: activity });
    },
  );
  const expectedKind = (
    {
      search: "scenes",
      plans: "plans",
      overview: "overview",
      outline: "outline",
      explain: "explanation",
    } as const
  )[intent] as LiveOutput["kind"];
  const allTools = [
    "get_program_overview",
    "get_episode_outline",
    "search_scenes",
    "list_clips",
    "get_queue_status",
    "get_credit_balance",
  ] as const;
  const firstTool: (typeof allTools)[number] =
    intent === "overview"
      ? "get_program_overview"
      : intent === "outline"
        ? "get_episode_outline"
        : "search_scenes";
  // Step 0 always reads the intent's source tool. Narrowing activeTools works on
  // every provider; forcing toolChoice is additionally applied only where the
  // provider accepts it alongside the structured-output response schema.
  const firstStep = forcedToolChoiceWithStructuredOutput
    ? { toolChoice: { type: "tool" as const, toolName: firstTool } }
    : { activeTools: [firstTool] };
  const traceBase = {
    requestId,
    provider: process.env.AI_PROVIDER || "google",
    model: process.env.AI_MODEL || "gemini-3.1-flash-lite",
  };
  let usage: { input?: number; output?: number; total?: number } | undefined;
  try {
    const agent = new ToolLoopAgent({
      ...provider,
      instructions: `${systemPrompt}\n현재 범위: ${JSON.stringify(context)}\n최종 응답 kind는 ${expectedKind}이다. 첫 단계에서 반드시 ${firstTool}를 호출해 원문을 조회한 뒤 JSON 스키마를 따른다. 도구를 호출하지 않고 장면 ID나 기획안을 답하면 서버가 거부한다. 관련 없는 sceneIds/plans/points는 빈 배열이다. 장면은 3~5개 이내, 기획안은 가능하면 서로 다른 장면으로 3개를 제시한다. 시작 3초/전개/엔딩 5초의 원본 구간은 서버가 구성한다. 선택한 장면 ID를 sceneIds 또는 plans에 넣는다. 원본 추천 순위는 서버가 list_clips로 확인해 검증한다. 현재 요청에 맞춰 순서를 변경하면 reranked다. 장면·시간·대사·성과를 새로 만들지 않는다. 요약과 편집 제안은 해석이다. 성과 근거는 없다. 설명 요청은 관련성·훅·감정·갈등을 points에 적는다.\n서버에서 확인한 선택 후보: ${JSON.stringify(selectedPlan ?? null)}`,
      tools: createTools(scopedGateway),
      activeTools: [...allTools],
      prepareStep: ({ stepNumber }) =>
        stepNumber === 0
          ? firstStep
          : { toolChoice: "auto", activeTools: [...allTools] },
      output: Output.object({ schema: liveOutputSchema }),
      stopWhen: stepCountIs(6),
      maxRetries: 2,
      maxOutputTokens: 2400,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "stepd-agent-chat",
        recordInputs: false,
        recordOutputs: false,
      },
    });
    // Evidence the server can derive on its own is fetched here rather than
    // left to the model's tool choice. Step 0 narrows activeTools but cannot
    // force a call on Gemini, so a request that needs specific evidence has to
    // load it itself or it fails whenever the model answers without searching.
    //
    // plans: the original STEP D ranking is a stored fact. Without it every
    // candidate collapsed to "reranked" and STEP D's own recommendation could
    // not be told apart from a request-specific reorder.
    if (intent === "plans") await scopedGateway.listClips({ limit: 5 });
    // explain: materializing an explanation requires the selected candidate's
    // source scene, so the server loads the in-scope scenes up front.
    if (intent === "explain" && selectedPlan)
      await scopedGateway.searchScenes({
        programId: context.programId,
        query: "",
        episodeMax: context.episodeMax,
        includeSpoilers: context.includeSpoilers,
        limit: 5,
      });
    // AI SDK owns the loop, structured-output stream, timeout and abort. The UI
    // receives tool progress immediately and source-verified cards on completion.
    const result = await agent.stream({
      messages: await convertToModelMessages(
        messages.filter(
          (m) => m.role !== "system" && m.parts.some((p) => p.type === "text"),
        ),
      ),
      abortSignal: signal,
      timeout: 45_000,
    });
    let streamError: unknown;
    // Provider failures are typed SDK events, not necessarily reader errors.
    // Consume the framework stream through a native sink so the original HTTP
    // status survives structured-output aggregation. There is no SSE parser.
    await result.fullStream.pipeTo(
      new WritableStream<TextStreamPart<ReturnType<typeof createTools>>>({
        write(part) {
          if (part.type === "error") streamError = part.error;
        },
      }),
    );
    if (streamError) throw streamError;
    const output = await result.output;
    const totalUsage = await result.totalUsage;
    usage = {
      input: totalUsage.inputTokens,
      output: totalUsage.outputTokens,
      total: totalUsage.totalTokens,
    };
    const briefing = materializeLiveBriefing(
      output,
      evidence,
      context,
      expectedKind,
    );
    if (briefing.plans) {
      briefing.workflowThreadId = crypto.randomUUID();
      await prepareDraftSelection(
        gateway,
        briefing.plans,
        briefing.workflowThreadId,
      );
    }
    emitBriefing(briefing);
    await recordLocalTrace({
      ...traceBase,
      elapsedMs: Date.now() - startedAt,
      outcome: "complete",
      tokens: usage,
      tools: [...activities.values()].map((a) => ({
        name: a.tool,
        outcome: a.status,
      })),
      resultKind: briefing.kind,
      sceneIds: briefing.scenes?.map((s) => s.id),
    });
  } catch (error) {
    await recordLocalTrace({
      ...traceBase,
      elapsedMs: Date.now() - startedAt,
      outcome: "error",
      statusCode: getProviderStatus(error),
      tokens: usage,
      tools: [...activities.values()].map((a) => ({
        name: a.tool,
        outcome: a.status,
      })),
    });
    throw error;
  }
}
