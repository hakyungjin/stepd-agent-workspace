"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowUp,
  ArrowUpRight,
  AudioLines,
  BookOpen,
  Bookmark,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clapperboard,
  Clock3,
  FileCheck2,
  FilePlus2,
  Film,
  Layers3,
  LoaderCircle,
  Menu,
  PanelRightClose,
  Plus,
  ScanSearch,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Video,
  X,
  BarChart3,
  Command,
  MessageSquareText,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { programs as initialPrograms } from "@/fixtures/programs";
import type { AgentMessage } from "@/types/chat";
import type {
  Activity,
  AgentContext,
  Briefing,
  ClipDraft,
  ClipPlan,
  ProgramOverview,
  Scene,
} from "@/types/stepd";
import {
  BriefingBlock,
  type BriefingActions,
} from "@/components/chat/briefing-block";
import { SceneFrame } from "@/components/scene/scene-card";
import { SourceTimeline } from "@/components/clip-plan/plan-card";
import { rangeLabel, rankLabel, spoilerLabels, timecode } from "@/lib/utils";

type Board = {
  scenes: Scene[];
  pinnedIds: string[];
  plans: ClipPlan[];
  drafts: ClipDraft[];
  selectedSceneId?: string;
  selectedPlanId?: string;
  selectedPlanBriefing?: Briefing;
};
type SavedTask = {
  id: string;
  title: string;
  updatedAt: string;
  messages: AgentMessage[];
  board: Board;
  programId: AgentContext["programId"];
  episodeMax: number;
  includeSpoilers: boolean;
  latestPlans?: Briefing;
};
const emptyBoard = (): Board => ({
  scenes: [],
  pinnedIds: [],
  plans: [],
  drafts: [],
});
const quickStarts = [
  {
    name: "작품 이해",
    subtitle: "이야기와 인물부터",
    icon: BookOpen,
    prompt: "이 작품 어떤 작품이야?",
  },
  {
    name: "장면 찾기",
    subtitle: "대사와 시간으로 탐색",
    icon: ScanSearch,
    prompt: "정체 들킬 뻔한 장면 찾아줘",
  },
  {
    name: "쇼츠 기획",
    subtitle: "짧고 강한 이야기",
    icon: Clapperboard,
    prompt: "30초 쇼츠 3개 추천해줘",
  },
  {
    name: "성과 브리핑",
    subtitle: "데이터 연결 준비 중",
    icon: BarChart3,
    prompt: "이번 주 채널 성과 브리핑해줘",
  },
];

export function AgentWorkspace() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 5 * 60_000, retry: 1 } },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <Workspace />
    </QueryClientProvider>
  );
}
function Workspace() {
  const { data } = useQuery<{
    programs: ProgramOverview[];
    agent?: { mode: "live" | "mock"; provider: string; model: string };
  }>({
    queryKey: ["programs"],
    queryFn: async () => {
      const response = await fetch("/api/programs");
      if (!response.ok) throw new Error("작품 목록을 읽지 못했습니다.");
      return response.json();
    },
    initialData: { programs: initialPrograms },
    initialDataUpdatedAt: 0,
  });
  // Connected STEP D issues opaque program ids, so a hardcoded default would
  // not exist in the list. An empty id resolves to the first program returned.
  const [programId, setProgramId] = useState<AgentContext["programId"]>("");
  const [episodeMax, setEpisodeMax] = useState(5);
  const [includeSpoilers, setIncludeSpoilers] = useState(false);
  const [input, setInput] = useState("");
  const [board, setBoard] = useState<Board>(emptyBoard);
  const [latestPlans, setLatestPlans] = useState<Briefing>();
  const [tab, setTab] = useState<"scenes" | "drafts" | "evidence">("scenes");
  const [navOpen, setNavOpen] = useState(false);
  const [mobileBoardOpen, setMobileBoardOpen] = useState(false);
  const [tasks, setTasks] = useState<SavedTask[]>([]);
  const [taskId, setTaskId] = useState("");
  const [notice, setNotice] = useState("");
  const [player, setPlayer] = useState<Scene | null>(null);
  const [previewTime, setPreviewTime] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/agent/chat" }),
    [],
  );
  const {
    messages,
    sendMessage,
    setMessages,
    status,
    error,
    stop,
    clearError,
  } = useChat<AgentMessage>({
    transport,
    onData: (part) => {
      if (part.type !== "data-briefing") return;
      const b = part.data;
      setProgramId(b.programId);
      if (b.plans) {
        setLatestPlans(b);
        setTab("drafts");
      }
      if (b.scenes && !b.plans) setTab("scenes");
      if (b.draft) setTab("drafts");
      setBoard((previous) => {
        const mergedScenes = [...previous.scenes];
        b.scenes?.forEach((s) => {
          if (!mergedScenes.some((existing) => existing.id === s.id))
            mergedScenes.push(s);
        });
        const mergedPlans = [...previous.plans];
        b.plans?.forEach((p) => {
          const i = mergedPlans.findIndex((existing) => existing.id === p.id);
          if (i < 0) mergedPlans.push(p);
          else mergedPlans[i] = p;
        });
        return {
          ...previous,
          scenes: mergedScenes,
          plans: mergedPlans,
          drafts: b.draft
            ? [...previous.drafts.filter((d) => d.id !== b.draft!.id), b.draft]
            : previous.drafts,
          ...(b.plans && !previous.selectedPlanId
            ? { selectedPlanId: b.plans[0]?.id, selectedPlanBriefing: b }
            : {}),
        };
      });
    },
  });
  const busy = status === "submitted" || status === "streaming";
  const program =
    data.programs.find((p) => p.id === programId) ?? data.programs[0];
  // The resolved id is what the server must receive; `programId` may still be
  // the empty initial value before the program list arrives.
  const activeProgramId = program.id;
  const sceneCount = board.pinnedIds.length;
  const selectedScene =
    board.scenes.find((s) => s.id === board.selectedSceneId) ??
    board.scenes.find((s) => board.pinnedIds.includes(s.id));
  const selectedPlan = board.plans.find((p) => p.id === board.selectedPlanId);
  const selectedPlanScene = board.scenes.find(
    (s) => s.id === selectedPlan?.sceneId,
  );
  const scopedPinnedIds = board.pinnedIds.filter((id) =>
    board.scenes.some(
      (s) =>
        s.id === id &&
        s.programId === activeProgramId &&
        s.episode <= episodeMax &&
        (includeSpoilers || s.spoiler === "safe"),
    ),
  );
  useEffect(() => {
    setTaskId(crypto.randomUUID());
    try {
      const saved = JSON.parse(localStorage.getItem("stepd-tasks-v1") || "[]");
      if (Array.isArray(saved))
        setTasks(
          saved
            .filter((t) => t.id && t.board && Array.isArray(t.messages))
            .slice(0, 6),
        );
    } catch {
      /* storage optional */
    }
  }, []);
  const lastScrolledBriefing = useRef("");
  useEffect(() => {
    const last = messages.at(-1);
    if (!last) return;
    const briefing = last.parts.find((part) => part.type === "data-briefing");
    if (briefing && lastScrolledBriefing.current !== last.id) {
      lastScrolledBriefing.current = last.id;
      Array.from(viewportRef.current?.querySelectorAll(".agent-response") ?? [])
        .at(-1)
        ?.scrollIntoView({ behavior: "auto", block: "start" });
    } else if (last.role === "user")
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);
  useEffect(() => {
    if (!taskId || !messages.length || busy) return;
    const timer = setTimeout(() => {
      const result = [...messages]
        .reverse()
        .flatMap((m) => m.parts)
        .find((p) => p.type === "data-briefing");
      const suffix =
        result?.type === "data-briefing"
          ? result.data.kind === "plans"
            ? `쇼츠 ${result.data.plans?.length}개`
            : result.data.kind === "draft"
              ? "클립 초안"
              : result.data.kind === "scenes"
                ? "장면 탐색"
                : result.data.kind === "overview"
                  ? "작품 이해"
                  : "브리핑"
          : "새 작업";
      const title = `${program.shortName} ${suffix}`;
      const saved: SavedTask = {
        id: taskId,
        title,
        updatedAt: new Date().toISOString(),
        messages,
        board,
        programId,
        episodeMax,
        includeSpoilers,
        latestPlans,
      };
      setTasks((previous) => {
        const next = [saved, ...previous.filter((t) => t.id !== taskId)].slice(
          0,
          6,
        );
        try {
          localStorage.setItem("stepd-tasks-v1", JSON.stringify(next));
        } catch {
          /* private browsing or quota */
        }
        return next;
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [
    messages,
    busy,
    board,
    taskId,
    programId,
    episodeMax,
    includeSpoilers,
    latestPlans,
    program.shortName,
  ]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  function context(overrides: Partial<AgentContext> = {}): AgentContext {
    return {
      programId: activeProgramId,
      episodeMax,
      includeSpoilers,
      selectedSceneIds: scopedPinnedIds,
      resultSceneIds:
        latestPlans?.plans
          ?.filter((p) => p.programId === activeProgramId)
          .map((p) => p.sceneId) ??
        board.scenes
          .filter((s) => s.programId === activeProgramId)
          .slice(-3)
          .map((s) => s.id),
      duration: 30,
      workflowThreadId: latestPlans?.workflowThreadId,
      ...overrides,
    };
  }
  function submit(text: string, overrides: Partial<AgentContext> = {}) {
    if (busy || !text.trim()) return;
    clearError();
    // Name matching works against whatever the gateway listed, so it keeps
    // working for fixture ids and for connected STEP D program names alike.
    const inferredProgram =
      data.programs.find(
        (p) => p.name !== program.name && text.includes(p.shortName),
      )?.id ?? activeProgramId;
    setProgramId(inferredProgram);
    setInput("");
    setNavOpen(false);
    void sendMessage(
      { text },
      {
        body: {
          context: context({ programId: inferredProgram, ...overrides }),
        },
      },
    );
  }
  function newTask() {
    if (busy) stop();
    setMessages([]);
    setBoard(emptyBoard());
    setLatestPlans(undefined);
    setInput("");
    setTaskId(crypto.randomUUID());
    setTab("scenes");
    setNavOpen(false);
    clearError();
    inputRef.current?.focus();
  }
  function openTask(task: SavedTask) {
    if (busy) stop();
    setTaskId(task.id);
    setMessages(task.messages);
    setBoard(task.board);
    setProgramId(task.programId);
    setEpisodeMax(task.episodeMax);
    setIncludeSpoilers(task.includeSpoilers);
    setLatestPlans(task.latestPlans);
    setTab(task.board.plans.length ? "drafts" : "scenes");
    setNavOpen(false);
    clearError();
  }
  function pinScene(scene: Scene) {
    if (!board.pinnedIds.includes(scene.id) && board.pinnedIds.length >= 5) {
      setNotice("장면은 최대 5개까지 담을 수 있습니다.");
      return;
    }
    setBoard((previous) => ({
      ...previous,
      pinnedIds: previous.pinnedIds.includes(scene.id)
        ? previous.pinnedIds.filter((id) => id !== scene.id)
        : [...previous.pinnedIds, scene.id],
      selectedSceneId: scene.id,
    }));
    setTab("scenes");
    setNotice(
      board.pinnedIds.includes(scene.id)
        ? "후보에서 해제했습니다."
        : "쇼츠 후보에 담았습니다.",
    );
  }
  function selectScene(scene: Scene) {
    setBoard((previous) => ({ ...previous, selectedSceneId: scene.id }));
    setTab("scenes");
    if (window.innerWidth < 1440) setMobileBoardOpen(true);
  }
  function pinPlan(plan: ClipPlan, briefing: Briefing) {
    setBoard((previous) => ({
      ...previous,
      selectedPlanId: previous.selectedPlanId === plan.id ? undefined : plan.id,
      selectedPlanBriefing: briefing,
    }));
    setTab("drafts");
  }
  function createDraft(plan: ClipPlan, briefing: Briefing) {
    setBoard((previous) => ({
      ...previous,
      selectedPlanId: plan.id,
      selectedPlanBriefing: briefing,
    }));
    submit(`${plan.number}번 후보로 ${plan.duration}초 초안 만들어줘`, {
      action: "draft",
      candidateNumber: plan.number,
      programId: plan.programId,
      duration: plan.duration,
      selectedSceneIds: [],
      resultSceneIds: briefing.plans?.map((p) => p.sceneId) ?? [plan.sceneId],
      workflowThreadId: briefing.workflowThreadId,
    });
  }
  function explainPlan(plan: ClipPlan, briefing: Briefing) {
    submit(`왜 ${plan.number}번을 추천했어?`, {
      action: "explain",
      candidateNumber: plan.number,
      programId: plan.programId,
      duration: plan.duration,
      selectedSceneIds: [],
      resultSceneIds: briefing.plans?.map((p) => p.sceneId) ?? [plan.sceneId],
    });
  }
  const actions: BriefingActions = {
    busy,
    selectedIds: board.pinnedIds,
    selectedPlanId: board.selectedPlanId,
    onSceneSelect: selectScene,
    onScenePin: pinScene,
    onPlay: (scene) => {
      setPlayer(scene);
      setPreviewTime(scene.start);
    },
    onSimilar: (scene) =>
      submit(`“${scene.title}”와 비슷한 장면 찾아줘`, {
        action: "search",
        programId: scene.programId,
        similarTo: scene.id,
      }),
    onPlanPin: pinPlan,
    onDraft: createDraft,
    onExplain: explainPlan,
    onPrompt: (text) => submit(text),
  };

  const sidebar = (
    <>
      <div className="brand">
        <span className="brand-symbol">
          <AudioLines size={22} />
        </span>
        <div>
          <strong>
            STEP D <span>Agent</span>
          </strong>
          <small>영상 운영 워크스페이스</small>
        </div>
      </div>
      <button className="new-task-button" onClick={newTask}>
        <Plus size={17} />새 작업 시작
      </button>
      <div className="sidebar-section">
        <div className="sidebar-label">빠른 시작</div>
        <div className="quick-start-list">
          {quickStarts.map((item, index) => (
            <button
              key={item.name}
              onClick={() =>
                submit(item.prompt, {
                  action: ["overview", "search", "plans", "performance"][
                    index
                  ] as AgentContext["action"],
                })
              }
              disabled={busy}
              className={index === 1 ? "quick-start active" : "quick-start"}
            >
              <item.icon size={17} />
              <span>
                <strong>{item.name}</strong>
                <small>{item.subtitle}</small>
              </span>
              {index === 3 ? (
                <span className="preparing">준비 중</span>
              ) : (
                <ChevronRight size={13} />
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="sidebar-section context-section">
        <div className="sidebar-label">
          현재 컨텍스트 <SlidersHorizontal size={13} />
        </div>
        <label>
          프로그램
          <select
            aria-label="프로그램"
            value={activeProgramId}
            onChange={(event) => {
              setProgramId(event.target.value as AgentContext["programId"]);
              setLatestPlans(undefined);
            }}
            disabled={busy}
          >
            {data.programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          분석 회차
          <select
            aria-label="분석 회차"
            value={episodeMax}
            onChange={(e) => setEpisodeMax(Number(e.target.value))}
            disabled={busy}
          >
            <option value="5">전체 분석 회차 (1–5회)</option>
            {[1, 2, 3, 4].map((i) => (
              <option key={i} value={i}>
                1–{i}회
              </option>
            ))}
          </select>
        </label>
        <div className="spoiler-setting">
          <span>
            <ShieldCheck size={14} />
            스포일러 제외
          </span>
          <button
            className={`switch ${!includeSpoilers ? "on" : ""}`}
            role="switch"
            aria-checked={!includeSpoilers}
            aria-label="스포일러 제외"
            onClick={() => setIncludeSpoilers((value) => !value)}
            disabled={busy}
          >
            <span />
          </button>
        </div>
      </div>
      <div className="sidebar-section recent-section">
        <div className="sidebar-label">
          최근 작업 <span>{tasks.length}</span>
        </div>
        {tasks.length ? (
          tasks.map((task) => (
            <button
              key={task.id}
              className={`recent-task ${task.id === taskId ? "current-task" : ""}`}
              onClick={() => openTask(task)}
            >
              <MessageSquareText size={14} />
              <span>{task.title}</span>
            </button>
          ))
        ) : (
          <div className="recent-empty">
            <Clock3 size={15} />
            <p>시작한 작업이 이곳에 쌓입니다.</p>
          </div>
        )}
      </div>
      <div className="sidebar-bottom">
        <div className="demo-connection">
          <span className="connection-dot" />
          <div>
            <strong>데모 워크스페이스</strong>
            <small>fixture 데이터 사용 중</small>
          </div>
          <CircleHelp size={16} />
        </div>
        <button className="profile-button" onClick={() => setHelpOpen(true)}>
          <span className="profile-avatar">D</span>
          <span>
            영상 운영팀<small>개발용 워크스페이스</small>
          </span>
          <ChevronDown size={14} />
        </button>
      </div>
    </>
  );
  const workboard = (
    <>
      <div className="board-header">
        <span>
          <Layers3 size={17} />
          <strong>작업 보드</strong>
          <span className="board-count">
            {board.pinnedIds.length + board.plans.length}
          </span>
        </span>
        <button
          className="icon-button board-close"
          onClick={() => setMobileBoardOpen(false)}
          aria-label="작업 보드 닫기"
        >
          <PanelRightClose size={17} />
        </button>
      </div>
      <div className="board-tabs" role="tablist" aria-label="작업 보드 보기">
        {(
          [
            { id: "scenes", name: "선택한 장면", count: sceneCount },
            { id: "drafts", name: "쇼츠 초안", count: board.plans.length },
            { id: "evidence", name: "근거", count: 0 },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.name}
            {t.count > 0 && <span>{t.count}</span>}
          </button>
        ))}
      </div>
      <div className="board-body" role="tabpanel">
        {tab === "scenes" && (
          <>
            {!selectedScene && !sceneCount ? (
              <div className="board-empty">
                <div className="empty-frame-grid">
                  <div>
                    <Film size={22} />
                    <span>00:00</span>
                  </div>
                  <div>
                    <Film size={22} />
                    <span>00:00</span>
                  </div>
                  <div>
                    <Film size={22} />
                    <span>00:00</span>
                  </div>
                </div>
                <h3>좋은 장면이, 좋은 시작이 됩니다</h3>
                <p>
                  장면 또는 쇼츠 후보를 선택하면
                  <br />
                  이곳에 작업 초안이 쌓입니다.
                </p>
                <div className="empty-board-rule" />
                <div className="workflow-step">
                  <span>1</span>
                  <div>
                    <strong>장면 찾기</strong>
                    <p>시간과 대사로 근거를 확인하세요</p>
                  </div>
                  <ScanSearch size={17} />
                </div>
                <div className="workflow-step">
                  <span>2</span>
                  <div>
                    <strong>쇼츠 기획하기</strong>
                    <p>훅부터 엔딩까지 한 번에 구성하세요</p>
                  </div>
                  <Clapperboard size={17} />
                </div>
                <div className="workflow-step">
                  <span>3</span>
                  <div>
                    <strong>편집 초안 만들기</strong>
                    <p>선택한 후보를 편집기로 이어 가세요</p>
                  </div>
                  <FilePlus2 size={17} />
                </div>
              </div>
            ) : (
              <>
                {selectedScene && (
                  <div className="board-scene-preview">
                    <div className="section-heading">
                      <span>장면 미리보기</span>
                      <span className="tiny-demo">데모</span>
                    </div>
                    <SceneFrame
                      scene={selectedScene}
                      onPlay={() => {
                        setPlayer(selectedScene);
                        setPreviewTime(selectedScene.start);
                      }}
                    />
                    <div className="board-source">
                      <span>{selectedScene.episode}회</span>
                      <time>
                        {rangeLabel(selectedScene.start, selectedScene.end)}
                      </time>
                    </div>
                    <h3>{selectedScene.title}</h3>
                    <p className="board-dialogue">
                      {selectedScene.dialogue.length
                        ? `“${selectedScene.dialogue[1] ?? selectedScene.dialogue[0]}”`
                        : "저장된 대사가 없는 장면입니다."}
                    </p>
                    <div className="scene-id-label">
                      원본 연결 <code>{selectedScene.id}</code>
                    </div>
                    <button
                      className="outline-button full-width"
                      onClick={() => pinScene(selectedScene)}
                    >
                      {board.pinnedIds.includes(selectedScene.id) ? (
                        <Check size={15} />
                      ) : (
                        <Plus size={15} />
                      )}
                      {board.pinnedIds.includes(selectedScene.id)
                        ? "후보에서 해제"
                        : "쇼츠 후보에 담기"}
                    </button>
                  </div>
                )}
                {sceneCount > 0 && (
                  <div className="pinned-scenes">
                    <div className="section-heading">
                      <span>담은 장면</span>
                      <span>{sceneCount}/5</span>
                    </div>
                    <div className="pinned-grid">
                      {board.scenes
                        .filter((s) => board.pinnedIds.includes(s.id))
                        .map((s) => (
                          <button
                            key={s.id}
                            onClick={() => selectScene(s)}
                            className={
                              selectedScene?.id === s.id ? "selected" : ""
                            }
                          >
                            <img src={s.frame} alt="데모 프레임" />
                            <time>
                              {s.episode}회 · {timecode(s.start)}
                            </time>
                            <span>{s.title}</span>
                          </button>
                        ))}
                    </div>
                    <button
                      className="primary-button full-width"
                      onClick={() =>
                        submit("담은 장면으로 30초 쇼츠 3개 골라줘", {
                          action: "plans",
                        })
                      }
                      disabled={busy}
                    >
                      <Sparkles size={15} />
                      쇼츠 기획안 만들기
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
        {tab === "drafts" && (
          <>
            {selectedPlan ? (
              <div className="board-plan">
                <div className="section-heading">
                  <span>고정한 후보 {selectedPlan.number}</span>
                  <button
                    onClick={() =>
                      pinPlan(selectedPlan, board.selectedPlanBriefing!)
                    }
                  >
                    <Bookmark size={13} />
                    고정 해제
                  </button>
                </div>
                {selectedPlanScene && (
                  <SceneFrame
                    scene={selectedPlanScene}
                    onPlay={() => {
                      setPlayer(selectedPlanScene);
                      setPreviewTime(selectedPlanScene.start);
                    }}
                  />
                )}
                <div className="board-plan-type">
                  <span>{selectedPlan.type}</span>
                  <strong>{selectedPlan.duration}초</strong>
                </div>
                <h3>{selectedPlan.title}</h3>
                <div className="timeline-heading">
                  <span>클립 타임라인</span>
                  <span>원본 {selectedPlan.sourceRanges[0].episode}회</span>
                </div>
                <SourceTimeline plan={selectedPlan} />
                <div className="thumbnail-hook">
                  <span>썸네일 훅 문구 초안</span>
                  <strong>{selectedPlan.thumbnailHook}</strong>
                </div>
                <div className="board-status-line">
                  <span className="badge-neutral">
                    스포일러 {spoilerLabels[selectedPlan.spoiler]}
                  </span>
                  <span className="badge-warning">권리 확인 필요</span>
                </div>
                <button
                  className="primary-button full-width"
                  onClick={() =>
                    createDraft(selectedPlan, board.selectedPlanBriefing!)
                  }
                  disabled={busy}
                >
                  <FilePlus2 size={15} />이 초안 만들기
                </button>
              </div>
            ) : (
              <div className="simple-empty">
                <Clapperboard size={30} />
                <h3>다음 쇼츠를 기획해 보세요</h3>
                <p>
                  시작, 전개, 엔딩이 있는
                  <br />
                  20–40초 기획안이 만들어집니다.
                </p>
                <button
                  className="outline-button"
                  onClick={() => submit("30초 쇼츠 3개 추천해줘")}
                  disabled={busy}
                >
                  쇼츠 기획 시작
                </button>
              </div>
            )}
            {board.plans.length > 0 && (
              <div className="board-candidate-list">
                <div className="section-heading">
                  <span>기획한 후보</span>
                  <span>{board.plans.length}개</span>
                </div>
                {board.plans.map((p) => (
                  <button
                    key={p.id}
                    className={p.id === selectedPlan?.id ? "selected" : ""}
                    onClick={() => {
                      const briefing = messages
                        .flatMap((m) => m.parts)
                        .find(
                          (part) =>
                            part.type === "data-briefing" &&
                            part.data.plans?.some((plan) => plan.id === p.id),
                        );
                      pinPlan(
                        p,
                        briefing?.type === "data-briefing"
                          ? briefing.data
                          : latestPlans!,
                      );
                    }}
                  >
                    <span>{p.number}</span>
                    <div>
                      <strong>{p.title}</strong>
                      <small>
                        {p.type} · {p.duration}초
                      </small>
                    </div>
                    <ChevronRight size={13} />
                  </button>
                ))}
              </div>
            )}
            {board.drafts.length > 0 && (
              <div className="saved-drafts">
                <div className="section-heading">
                  <span>저장한 초안</span>
                  <span>{board.drafts.length}개</span>
                </div>
                {board.drafts.map((d) => (
                  <a key={d.id} href={d.editorUrl}>
                    <FileCheck2 size={18} />
                    <div>
                      <strong>{d.title}</strong>
                      <small>{d.duration}초 · 데모 초안</small>
                    </div>
                    <ArrowUpRight size={15} />
                  </a>
                ))}
              </div>
            )}
          </>
        )}
        {tab === "evidence" && (
          <div className="board-evidence">
            <ShieldCheck size={25} />
            <h3>추천을 확인하는 기준</h3>
            <dl>
              <div>
                <dt>
                  <CheckCheck size={14} />
                  원문 데이터
                </dt>
                <dd>
                  시간, 대사, 인물 ID는 저장된 fixture를 기준으로 표시합니다.
                  실제 방송 정보는 아닙니다.
                </dd>
              </div>
              <div>
                <dt>
                  <Sparkles size={14} />
                  요약과 기획
                </dt>
                <dd>장면 요약, 제목, 자막, 편집 구성은 해석과 초안입니다.</dd>
              </div>
              <div>
                <dt>
                  <Layers3 size={14} />
                  추천의 출처
                </dt>
                <dd>
                  {selectedPlan
                    ? `${selectedPlan.recommendationSource === "original" ? "STEP D 원본 자동 추천" : "현재 요청에 맞춘 AI 재정렬"} · ${rankLabel(selectedPlan.originalRank)}${selectedPlan.demo ? " (데모)" : ""}`
                    : "STEP D 원본 자동 추천과 현재 요청에 맞춘 AI 재정렬을 구분합니다."}
                </dd>
              </div>
              <div>
                <dt>
                  <BarChart3 size={14} />
                  성과 근거
                </dt>
                <dd>성과 근거 없음. 성과 데이터가 아직 연결되지 않았습니다.</dd>
              </div>
            </dl>
            {selectedPlan && (
              <button
                className="outline-button full-width"
                onClick={() =>
                  explainPlan(selectedPlan, board.selectedPlanBriefing!)
                }
                disabled={busy}
              >
                이 후보를 추천한 이유
              </button>
            )}
            <div className="rights-notice">
              <ShieldCheck size={16} />
              <p>
                모든 데모 장면은 권리 확인 필요 상태입니다. 실제 제작 전에 원본
                데이터와 이용 권리를 확인하세요.
              </p>
            </div>
          </div>
        )}
      </div>
      <div className="board-footer">
        <ShieldCheck size={13} />
        <span>초안까지만, 안심하고 탐색하세요</span>
        <span className="tiny-demo">데모</span>
      </div>
    </>
  );

  return (
    <div className="app-shell" data-ready={Boolean(taskId)}>
      <aside className="desktop-sidebar">{sidebar}</aside>
      <main className="main-workspace">
        <header className="context-header">
          <div>
            <button
              className="icon-button mobile-nav-button"
              onClick={() => setNavOpen(true)}
              aria-label="탐색 메뉴 열기"
            >
              <Menu size={19} />
            </button>
            <span className="context-program-icon">
              <Film size={15} />
            </span>
            <strong>{program.name}</strong>
            <ChevronRight size={12} />
            <span className="header-episode">1–{episodeMax}회</span>
            <span className="context-divider" />
            <span className="header-spoiler">
              <ShieldCheck size={13} />
              {includeSpoilers ? "스포일러 포함" : "스포일러 제외"}
            </span>
          </div>
          <div className="header-right">
            <span className="demo-badge" title={data.agent?.model}>
              <span className="runtime-label">
                {data.agent?.mode === "live"
                  ? data.agent.model === "gemini-3.1-flash-lite"
                    ? "Gemini 3.1 Flash-Lite"
                    : data.agent.model
                  : "데모 모드"}
              </span>
              <span className="runtime-label-short">
                {data.agent?.mode === "live"
                  ? data.agent.provider === "google"
                    ? "Gemini 3.1"
                    : "AI 모델"
                  : "데모 모드"}
              </span>
            </span>
            <button
              className="icon-button mobile-board-button"
              onClick={() => setMobileBoardOpen(true)}
              aria-label="작업 보드 열기"
            >
              <Layers3 size={18} />
              {sceneCount > 0 && <b>{sceneCount}</b>}
            </button>
          </div>
        </header>
        <div className="chat-viewport" ref={viewportRef}>
          {!messages.length ? (
            <div className="welcome">
              <div className="welcome-topline">
                <span className="workspace-status">
                  <span />
                  준비된 데이터에서, 새로운 이야기로
                </span>
                <span className="welcome-version">Workspace / 01</span>
              </div>
              <div className="welcome-mark">
                <AudioLines size={31} strokeWidth={1.5} />
                <span className="mark-corner" />
              </div>
              <h1>
                어떤 영상을
                <br />
                만들고 싶으세요?
              </h1>
              <p className="welcome-description">
                작품 이해부터 장면 검색, 쇼츠 기획까지
                <br />
                STEP D 데이터를 바탕으로 도와드립니다.
              </p>
              <div className="welcome-prompts">
                <button
                  onClick={() =>
                    submit("부세미에서 정체 들킬 뻔한 장면 찾아줘")
                  }
                >
                  <ScanSearch size={18} />
                  <span>
                    <strong>이야기가 움직이는 순간</strong>
                    <small>부세미에서 정체 들킬 뻔한 장면 찾아줘</small>
                  </span>
                  <ArrowUpRight size={17} />
                </button>
                <button onClick={() => submit("나미브 30초 쇼츠 3개 추천해줘")}>
                  <Clapperboard size={18} />
                  <span>
                    <strong>30초로 만드는 다음 쇼츠</strong>
                    <small>나미브 30초 쇼츠 3개 추천해줘</small>
                  </span>
                  <ArrowUpRight size={17} />
                </button>
                <button onClick={() => submit("이번 주 채널 성과 브리핑해줘")}>
                  <BarChart3 size={18} />
                  <span>
                    <strong>숫자 뒤에 있는 이야기</strong>
                    <small>이번 주 채널 성과 브리핑해줘</small>
                  </span>
                  <span className="preparing">준비 중</span>
                </button>
              </div>
              <div className="welcome-trust">
                <CheckCheck size={14} />
                <span>저장된 분석에서 검색</span>
                <span className="trust-separator" />
                <ShieldCheck size={14} />
                <span>원문 근거와 함께 제안</span>
              </div>
            </div>
          ) : (
            <div className="conversation">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={
                    message.role === "user" ? "user-request" : "agent-response"
                  }
                >
                  {message.role === "user" ? (
                    <>
                      <span className="user-request-icon">
                        <Command size={12} />
                      </span>
                      <p>
                        {message.parts
                          .filter((p) => p.type === "text")
                          .map((p) => (p.type === "text" ? p.text : ""))
                          .join("")}
                      </p>
                    </>
                  ) : (
                    <>
                      {message.parts.some(
                        (p) => p.type === "data-activity",
                      ) && (
                        <ToolActivity
                          activities={message.parts
                            .filter((p) => p.type === "data-activity")
                            .map((p) =>
                              p.type === "data-activity" ? p.data : null,
                            )
                            .filter((a) => a !== null)}
                        />
                      )}
                      {message.parts.map((part, index) =>
                        part.type === "data-briefing" ? (
                          <BriefingBlock
                            key={index}
                            briefing={part.data}
                            actions={actions}
                          />
                        ) : part.type === "text" ? (
                          <p className="live-agent-text" key={index}>
                            {part.text}
                          </p>
                        ) : null,
                      )}
                    </>
                  )}
                </div>
              ))}
              {busy &&
                !messages
                  .at(-1)
                  ?.parts.some((p) => p.type === "data-briefing") && (
                  <div className="result-skeleton" aria-label="결과 준비 중">
                    <div />
                    <div />
                    <div />
                  </div>
                )}
              {error && (
                <div className="request-error" role="alert">
                  <strong>작업을 완료하지 못했습니다.</strong>
                  <p>{error.message}</p>
                  <button
                    className="outline-button"
                    onClick={() => {
                      clearError();
                      const last = messages.findLast((m) => m.role === "user");
                      const text = last?.parts.find((p) => p.type === "text");
                      if (text?.type === "text") submit(text.text);
                    }}
                  >
                    다시 시도
                  </button>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
        <div className="composer-area">
          <div className="composer-context">
            <Film size={12} />
            <span>{program.shortName}</span>
            <span>1–{episodeMax}회</span>
            <span>
              <ShieldCheck size={11} />
              {includeSpoilers ? "스포일러 포함" : "스포일러 제외"}
            </span>
            {scopedPinnedIds.length > 0 && (
              <button
                onClick={() => {
                  setTab("scenes");
                  setMobileBoardOpen(true);
                }}
              >
                <Bookmark size={11} />
                {scopedPinnedIds.length}개 장면 담김
              </button>
            )}
          </div>
          <form
            className={`composer ${busy ? "composer-busy" : ""}`}
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  submit(input);
                }
              }}
              placeholder="장면을 찾거나, 만들고 싶은 쇼츠를 말해 주세요"
              aria-label="에이전트에게 요청 입력"
              rows={2}
              maxLength={2000}
            />
            <div className="composer-bottom">
              <span>
                <Sparkles size={13} />
                STEP D Agent
                <span className="composer-tool-label">영상 운영 에이전트</span>
              </span>
              <div>
                <span className="input-hint">Enter로 요청</span>
                {busy ? (
                  <button
                    type="button"
                    className="send-button stop-button"
                    onClick={stop}
                    aria-label="응답 중단"
                  >
                    <span />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="send-button"
                    disabled={!input.trim()}
                    aria-label="요청 보내기"
                  >
                    <ArrowUp size={18} />
                  </button>
                )}
              </div>
            </div>
          </form>
          <div className="composer-disclaimer">
            <span>
              모든 샘플은 데모 데이터입니다. 실제 대사·성과가 아닙니다.
            </span>
            <button onClick={() => setHelpOpen(true)}>
              데이터 안내
              <CircleHelp size={11} />
            </button>
          </div>
        </div>
        <div className="mobile-bottom-nav">
          <button
            className={!mobileBoardOpen ? "active" : ""}
            onClick={() => setMobileBoardOpen(false)}
          >
            <MessageSquareText size={17} />
            대화
          </button>
          <button onClick={() => setMobileBoardOpen(true)}>
            <Layers3 size={17} />
            작업 보드{sceneCount > 0 && <span>{sceneCount}</span>}
          </button>
        </div>
      </main>
      <aside className="desktop-workboard">{workboard}</aside>
      <Dialog.Root open={navOpen} onOpenChange={setNavOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="navigation-drawer">
            <Dialog.Title className="sr-only">워크스페이스 탐색</Dialog.Title>
            <Dialog.Description className="sr-only">
              새 작업, 프로그램 필터와 최근 작업
            </Dialog.Description>
            <Dialog.Close
              className="drawer-close icon-button"
              aria-label="탐색 메뉴 닫기"
            >
              <X size={18} />
            </Dialog.Close>
            {sidebar}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={mobileBoardOpen} onOpenChange={setMobileBoardOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay board-overlay" />
          <Dialog.Content className="workboard-sheet">
            <Dialog.Title className="sr-only">작업 보드</Dialog.Title>
            <Dialog.Description className="sr-only">
              선택한 장면, 쇼츠 초안과 추천 근거
            </Dialog.Description>
            {workboard}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={!!player}
        onOpenChange={(open) => {
          if (!open) setPlayer(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="player-dialog">
            <div className="dialog-heading">
              <Dialog.Title>{player?.title}</Dialog.Title>
              <Dialog.Close className="icon-button" aria-label="미리보기 닫기">
                <X size={19} />
              </Dialog.Close>
            </div>
            <Dialog.Description className="player-description">
              데모 프레임 미리보기 · 원본 영상은 아직 연결되지 않았습니다.
            </Dialog.Description>
            {player && (
              <>
                <div className="player-image">
                  <img
                    src={player.frame}
                    alt="실제 방송 영상이 아닌 데모 프레임"
                  />
                  <div>
                    <Video size={26} />
                    <span>원본 영상 연결 대기</span>
                  </div>
                </div>
                <div className="player-controls">
                  <time>{timecode(previewTime)}</time>
                  <input
                    type="range"
                    min={player.start}
                    max={player.end}
                    value={previewTime}
                    onChange={(e) => setPreviewTime(Number(e.target.value))}
                    aria-label="데모 소스 위치"
                  />
                  <time>{timecode(player.end)}</time>
                </div>
                <blockquote>
                  {player.dialogue[0]
                    ? `“${player.dialogue[0]}”`
                    : "저장된 대사가 없는 장면입니다."}
                </blockquote>
                <div className="player-bottom">
                  <span>
                    {player.episode}회 · {rangeLabel(player.start, player.end)}{" "}
                    · 데모
                  </span>
                  <button
                    className="primary-button small"
                    onClick={() => {
                      pinScene(player);
                      setPlayer(null);
                    }}
                  >
                    <Plus size={14} />
                    후보에 담기
                  </button>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={helpOpen} onOpenChange={setHelpOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="help-dialog">
            <div className="dialog-heading">
              <Dialog.Title>데모 데이터 안내</Dialog.Title>
              <Dialog.Close className="icon-button" aria-label="안내 닫기">
                <X size={18} />
              </Dialog.Close>
            </div>
            <Dialog.Description>
              이 워크스페이스는 STEP D 연결 전 기능을 검증하는 독립
              프로토타입입니다.
            </Dialog.Description>
            <p>
              작품명 외의 인물 설정, 회차, 장면, 대사, 시간과 추천 점수는 만든
              예시이며 실제 방송 정보로 확인되지 않았습니다. 프레임은 로컬
              placeholder입니다.
            </p>
            <p>
              요약과 편집 제안은 해석이며, 성과·댓글·권리 데이터는 연결 대기
              상태입니다. 검색과 초안 생성은 서버에서 실행됩니다.
            </p>
            <p>
              최근 작업은 이 브라우저에, 초안은 개발 서버의 로컬 저장소에
              보관됩니다. 서버 재시작 후에는 쇼츠 기획안을 다시 생성해 초안을
              이어갈 수 있습니다.
            </p>
            <Dialog.Close className="primary-button full-width">
              확인했습니다
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {notice && (
        <div className="toast" role="status">
          <Check size={15} />
          {notice}
        </div>
      )}
    </div>
  );
}
function ToolActivity({ activities }: { activities: Activity[] }) {
  const [expanded, setExpanded] = useState(false);
  const running = activities.find((a) => a.status === "running");
  return (
    <div className="tool-activity">
      <button onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        {running ? (
          <LoaderCircle className="spin" size={13} />
        ) : (
          <Check size={13} />
        )}
        <span>
          {running ? running.label : `${activities.length}개 도구 실행 완료`}
        </span>
        {activities.some((a) => a.cached) && <small>캐시 사용</small>}
        <ChevronDown size={12} />
      </button>
      {expanded && (
        <div>
          {activities.map((a) => (
            <p key={a.id}>
              {a.status === "running" ? (
                <LoaderCircle size={12} className="spin" />
              ) : (
                <Check size={12} />
              )}
              <span>{a.label.replace(" 중", "")}</span>
              <code>{a.tool}</code>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
