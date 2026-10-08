import type { ClipPlan, Scene } from "@/types/stepd";
export function makePlans(scenes: Scene[], duration = 30): ClipPlan[] {
  return scenes.slice(0, 3).map((scene, index) => {
    const length = Math.max(
      20,
      Math.min(40, duration, scene.end - scene.start),
    );
    const opening = 3,
      ending = 5,
      middle = length - opening - ending;
    const type = (
      scene.tags.includes("반전")
        ? "반전형"
        : scene.tags.includes("감정") || scene.tags.includes("위로")
          ? "감정형"
          : scene.programId === "solo"
            ? "정보형"
            : "갈등형"
    ) as ClipPlan["type"];
    return {
      id: `plan-${scene.id}-${length}`,
      number: index + 1,
      sceneId: scene.id,
      programId: scene.programId,
      type,
      duration: length,
      sourceRanges: [
        {
          sceneId: scene.id,
          episode: scene.episode,
          start: scene.start,
          end: scene.start + opening,
          role: "시작",
        },
        {
          sceneId: scene.id,
          episode: scene.episode,
          start: scene.start + opening,
          end: scene.start + opening + middle,
          role: "전개",
        },
        {
          sceneId: scene.id,
          episode: scene.episode,
          start: scene.start + opening + middle,
          end: scene.start + length,
          role: "엔딩",
        },
      ],
      // A STEP D scene can have no stored transcript line. Falling back to the
      // summary keeps the hook labelled as interpretation instead of quoting
      // dialogue that does not exist.
      hook: scene.dialogue[0] ?? scene.summary,
      title: `${scene.title}, 이 한마디의 의미`,
      firstCaption: scene.dialogue[0] ?? scene.summary,
      ending: "반응 컷에서 멈추고 다음 선택을 질문으로 남기기",
      thumbnailHook:
        scene.programId === "busemi"
          ? "이름 하나로 흔들린 순간"
          : scene.programId === "namib"
            ? "다시 시작할 수 있을까?"
            : scene.programId === "solo"
              ? "조건보다 중요한 한 가지"
              : scene.title,
      spoiler: scene.spoiler,
      rights: scene.rights,
      // No stored rank means there is no STEP D original recommendation to claim.
      recommendationSource: scene.originalRank === 1 ? "original" : "reranked",
      originalRank: scene.originalRank,
      reason: scene.reason,
      difficulty: "낮음 · 한 장면 내 3개 구간, 하드 컷과 자막으로 구성",
      performanceEvidence: null,
      demo: scene.demo,
    };
  });
}
