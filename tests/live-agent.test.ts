import test from "node:test";
import assert from "node:assert/strict";
import { programs, scenes } from "../fixtures/programs";
import {
  liveOutputSchema,
  materializeLiveBriefing,
  type LiveEvidence,
  type LiveOutput,
} from "../lib/agent/live-output";
import { observeGateway } from "../lib/agent/observed-gateway";
import { publicAgentError } from "../lib/agent/errors";
import { MockStepDGateway } from "../lib/stepd/mock-gateway";
import { agentContextSchema, type AgentContext } from "../types/stepd";
import { makePlans } from "../lib/agent/plans";
import { resolveIntent } from "../lib/agent/orchestration";
const context: AgentContext = {
  programId: "busemi",
  episodeMax: 5,
  includeSpoilers: false,
  selectedSceneIds: [],
  resultSceneIds: [],
  duration: 30,
};
const source = scenes.filter(
  (s) => s.programId === "busemi" && s.spoiler === "safe",
);
function evidence(): LiveEvidence {
  return {
    scenes: new Map(source.map((s) => [s.id, s])),
    clips: source.map((s) => ({
      id: `clip-${s.id}`,
      sceneId: s.id,
      originalRank: s.originalRank,
      recommendationSource: "original",
      demo: true,
    })),
    overview: programs[0],
  };
}
function output(kind: LiveOutput["kind"]): LiveOutput {
  return {
    kind,
    title: "모델 해석 제목",
    summary: "모델의 해석입니다.",
    sceneIds: source.map((s) => s.id),
    plans: [],
    points: [],
  };
}
test("live cards retain source dialogue, timestamps and identity, rejecting invented IDs", () => {
  const result = materializeLiveBriefing(
    output("scenes"),
    evidence(),
    context,
    "scenes",
  );
  assert.deepEqual(result.scenes, source);
  assert.throws(
    () =>
      materializeLiveBriefing(
        { ...output("scenes"), sceneIds: ["invented"] },
        evidence(),
        context,
        "scenes",
      ),
    /조회하지 않은/,
  );
});
test("live cards cannot cross program, episode or spoiler scope", () => {
  for (const scene of [
    scenes.find((s) => s.programId === "namib")!,
    scenes.find((s) => s.programId === "busemi" && s.spoiler === "strong")!,
  ]) {
    const data = evidence();
    data.scenes.set(scene.id, scene);
    assert.throws(
      () =>
        materializeLiveBriefing(
          { ...output("scenes"), sceneIds: [scene.id] },
          data,
          context,
          "scenes",
        ),
      /현재 범위/,
    );
  }
  assert.throws(
    () =>
      materializeLiveBriefing(
        output("scenes"),
        evidence(),
        { ...context, episodeMax: 1 },
        "scenes",
      ),
    /현재 범위/,
  );
});
test("AI writes editorial fields while the server derives safe ranges and checks original recommendation rank", () => {
  const proposal = {
    ...output("plans"),
    plans: source.map((s) => ({
      sceneId: s.id,
      type: "감정형" as const,
      title: "생성한 제목",
      firstCaption: "자막 초안",
      ending: "반응 컷",
      thumbnailHook: "썸네일 초안",
      reason: "요청 관련성의 모델 해석",
      recommendationSource: "original" as const,
    })),
  };
  const result = materializeLiveBriefing(
    liveOutputSchema.parse(proposal),
    evidence(),
    context,
    "plans",
  );
  assert.equal(result.plans?.length, 3);
  assert.equal(result.plans?.[0].recommendationSource, "reranked");
  assert.equal(result.plans?.[0].hook, source[0].dialogue[0]);
  for (const plan of result.plans!) {
    const scene = source.find((s) => s.id === plan.sceneId)!;
    assert.equal(
      plan.sourceRanges.reduce((sum, r) => sum + r.end - r.start, 0),
      30,
    );
    assert.ok(
      plan.sourceRanges.every(
        (r) => r.start >= scene.start && r.end <= scene.end,
      ),
    );
    assert.equal(plan.rights, scene.rights);
  }
});
test("explanations derive rights, recommendation source and missing performance evidence on the server", () => {
  const data = evidence();
  data.selectedPlan = makePlans(source)[0];
  const result = materializeLiveBriefing(
    {
      ...output("explanation"),
      points: [
        { label: "성과", text: "조회수 100만" },
        { label: "훅", text: "짧은 질문으로 시작합니다." },
      ],
    },
    data,
    context,
    "explanation",
  );
  assert.ok(
    result.points?.some(
      (p) => p.label === "성과 근거" && p.text.includes("성과 근거 없음"),
    ),
  );
  assert.ok(!result.points?.some((p) => p.text.includes("100만")));
});
test("an explanation needs the checkpointed candidate, not a fresh scene fetch", () => {
  // Gemini cannot be forced to call a tool while a JSON schema is set, so an
  // explanation must survive the model answering without searching.
  const data: LiveEvidence = { scenes: new Map(), clips: [] };
  data.selectedPlan = makePlans(source)[0];
  const result = materializeLiveBriefing(
    {
      ...output("explanation"),
      points: [{ label: "훅", text: "짧은 질문으로 시작합니다." }],
    },
    data,
    context,
    "explanation",
  );
  assert.ok(
    result.points?.some((p) => p.label === "추천 출처"),
    "server-derived points must still be present",
  );
  assert.throws(
    () =>
      materializeLiveBriefing(
        output("explanation"),
        { scenes: new Map(), clips: [] },
        context,
        "explanation",
      ),
    /후보를 먼저 선택/,
  );
});
test("gateway prevents scope widening and reuses paraphrased searches in the model loop", async () => {
  let calls = 0;
  const original = new MockStepDGateway();
  const gateway = {
    ...original,
    listPrograms: original.listPrograms.bind(original),
    getProgramOverview: original.getProgramOverview.bind(original),
    getEpisodeOutline: original.getEpisodeOutline.bind(original),
    searchScenes: async (
      input: Parameters<MockStepDGateway["searchScenes"]>[0],
    ) => {
      calls++;
      return original.searchScenes(input);
    },
    listClips: original.listClips.bind(original),
    createClipDraft: original.createClipDraft.bind(original),
    getQueueStatus: original.getQueueStatus.bind(original),
    getCreditBalance: original.getCreditBalance.bind(original),
  };
  const data = evidence();
  const observed = observeGateway(gateway, context, data, () => {});
  const input = {
    programId: "busemi" as const,
    episodeMax: 5,
    includeSpoilers: true,
    limit: 5,
  };
  const first = await observed.searchScenes({
    ...input,
    query: "정체 들킬 뻔한",
  });
  await observed.searchScenes({ ...input, query: "신분이 의심받는" });
  assert.equal(calls, 1);
  assert.ok(first.scenes.every((s) => s.spoiler === "safe"));
  await assert.rejects(
    observed.getProgramOverview({ programId: "namib" }),
    /현재 범위/,
  );
});
test("every resolvable intent is expressible as a request action", () => {
  const actions = new Set(
    agentContextSchema.shape.action.unwrap().options as string[],
  );
  const intents = [
    ["이번 주 성과 브리핑해줘", "performance"],
    ["왜 2번을 추천했어?", "explain"],
    ["2번 초안 만들어줘", "draft"],
    ["30초 쇼츠 3개 골라줘", "plans"],
    ["이거 어떤 작품이야?", "overview"],
    ["3회까지 무슨 일이 있었어?", "outline"],
    ["정체 들킬 뻔한 장면 찾아줘", "search"],
  ] as const;
  for (const [text, expected] of intents) {
    assert.equal(resolveIntent(text, context), expected);
    // A resolvable intent the context cannot carry is rejected by the route
    // before the agent runs, which is how explicit outline requests 400'd.
    assert.ok(actions.has(expected), `action enum is missing ${expected}`);
  }
});
test("outline-only evidence still reports the demo label", () => {
  const data: LiveEvidence = { scenes: new Map(), clips: [] };
  data.outline = {
    programId: "busemi",
    analyzedRange: "1–3회",
    events: [{ episode: 1, summary: "데모 요약" }],
    reliability: "데모 fixture · 실제 방송 분석이 아닙니다",
    demo: true,
  };
  const result = materializeLiveBriefing(
    output("outline"),
    data,
    context,
    "outline",
  );
  assert.equal(result.demo, true);
  assert.equal(result.outline?.demo, true);
});
test("stored original ranking is read for plans, so it is not labelled reranked by default", async () => {
  const data: LiveEvidence = { scenes: new Map(), clips: [] };
  const observed = observeGateway(
    new MockStepDGateway(),
    context,
    data,
    () => {},
  );
  const results = await observed.searchScenes({
    programId: "busemi",
    query: "정체",
    episodeMax: 5,
    includeSpoilers: false,
    limit: 5,
  });
  // What live-agent.ts now does server-side for every plans request.
  await observed.listClips({ limit: 5 });
  assert.ok(data.clips.length > 0);
  const ranked = [...results.scenes].sort(
    (a, b) => (a.originalRank ?? 0) - (b.originalRank ?? 0),
  );
  const result = materializeLiveBriefing(
    liveOutputSchema.parse({
      ...output("plans"),
      plans: ranked.slice(0, 3).map((s) => ({
        sceneId: s.id,
        type: "갈등형" as const,
        title: "생성한 제목",
        firstCaption: "자막 초안",
        ending: "반응 컷",
        thumbnailHook: "썸네일 초안",
        reason: "모델 해석",
        recommendationSource: "original" as const,
      })),
    }),
    data,
    context,
    "plans",
  );
  assert.deepEqual(
    result.plans?.map((p) => p.recommendationSource),
    ["original", "original", "original"],
  );
  // A request-specific reorder must not inherit the original label.
  const reordered = materializeLiveBriefing(
    liveOutputSchema.parse({
      ...output("plans"),
      plans: [ranked[2], ranked[0], ranked[1]].map((s) => ({
        sceneId: s.id,
        type: "갈등형" as const,
        title: "생성한 제목",
        firstCaption: "자막 초안",
        ending: "반응 컷",
        thumbnailHook: "썸네일 초안",
        reason: "모델 해석",
        recommendationSource: "original" as const,
      })),
    }),
    data,
    context,
    "plans",
  );
  assert.equal(reordered.plans?.[0].recommendationSource, "reranked");
});
test("provider failures expose status guidance without exception secrets", () => {
  const error = {
    statusCode: 402,
    message: "PRIVATE_KEY=not-to-be-disclosed",
    requestHeaders: { "x-goog-api-key": "secret" },
  };
  assert.match(publicAgentError(error), /HTTP 402/);
  assert.ok(!publicAgentError(error).includes("secret"));
  assert.match(
    publicAgentError({ lastError: { statusCode: 429 } }),
    /사용 한도/,
  );
});
