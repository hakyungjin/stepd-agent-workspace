"use client";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  FileCheck2,
  Layers3,
  Sparkles,
} from "lucide-react";
import type { Briefing, ClipPlan, Scene } from "@/types/stepd";
import { SceneCard } from "@/components/scene/scene-card";
import { PlanCard } from "@/components/clip-plan/plan-card";
import { SourceTimeline } from "@/components/clip-plan/plan-card";
export type BriefingActions = {
  busy: boolean;
  selectedIds: string[];
  selectedPlanId?: string;
  onSceneSelect: (scene: Scene) => void;
  onScenePin: (scene: Scene) => void;
  onPlay: (scene: Scene) => void;
  onSimilar: (scene: Scene) => void;
  onPlanPin: (plan: ClipPlan, briefing: Briefing) => void;
  onDraft: (plan: ClipPlan, briefing: Briefing) => void;
  onExplain: (plan: ClipPlan, briefing: Briefing) => void;
  onPrompt: (text: string) => void;
};
export function BriefingBlock({
  briefing: b,
  actions: a,
}: {
  briefing: Briefing;
  actions: BriefingActions;
}) {
  return (
    <section className="briefing-block">
      <div className="agent-byline">
        <span className="agent-avatar">
          <Sparkles size={13} />
        </span>
        <strong>STEP D Agent</strong>
        <span>데모 데이터</span>
      </div>
      <h2>{b.title}</h2>
      <p className="briefing-summary">{b.summary}</p>
      <div className="briefing-scope">
        <Layers3 size={12} />
        {b.scope}
        <span>저장된 분석 기준</span>
      </div>
      {b.kind === "scenes" && (
        <>
          <div className="result-section-label">
            <span>검색한 장면</span>
            <span>{b.scenes?.length}개 결과</span>
          </div>
          <div className="scene-results">
            {b.scenes?.map((s) => (
              <SceneCard
                key={s.id}
                scene={s}
                selected={a.selectedIds.includes(s.id)}
                busy={a.busy}
                onSelect={() => a.onSceneSelect(s)}
                onPin={() => a.onScenePin(s)}
                onPlay={() => a.onPlay(s)}
                onSimilar={() => a.onSimilar(s)}
              />
            ))}
          </div>
          {b.scenes?.length ? (
            <button
              className="next-action"
              disabled={a.busy}
              onClick={() => a.onPrompt("30초 쇼츠 3개 골라줘")}
            >
              <Sparkles size={15} />이 장면으로 쇼츠 기획하기
              <ArrowUpRight size={15} />
            </button>
          ) : (
            <p className="inline-notice">
              이 회차 범위에는 결과가 없습니다. 필터를 넓혀 주세요.
            </p>
          )}
        </>
      )}
      {b.kind === "plans" && (
        <div className="plan-results">
          {b.plans?.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              pinned={a.selectedPlanId === p.id}
              busy={a.busy}
              onPin={() => a.onPlanPin(p, b)}
              onDraft={() => a.onDraft(p, b)}
              onExplain={() => a.onExplain(p, b)}
            />
          ))}
        </div>
      )}
      {b.kind === "overview" && b.overview && (
        <div className="overview-card">
          <BookOpen size={24} />
          <div>
            <span className="overline">작품 이해 · 데모</span>
            <h3>{b.overview.name}</h3>
            <p>{b.overview.genre}</p>
            <div className="theme-tags">
              {b.overview.themes.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
            <p className="overview-characters">
              등장인물 설정: {b.overview.characters.join(", ")}
            </p>
          </div>
        </div>
      )}
      {b.outline && (
        <div className="outline-list">
          {b.outline.events.map((event) => (
            <div key={event.episode}>
              <span>{event.episode}회</span>
              <p>{event.summary}</p>
            </div>
          ))}
        </div>
      )}
      {b.points && (
        <dl className="evidence-points">
          {b.points.map((p) => (
            <div key={p.label}>
              <dt>{p.label}</dt>
              <dd>{p.text}</dd>
            </div>
          ))}
        </dl>
      )}
      {b.kind === "overview" && (
        <button
          className="next-action"
          disabled={a.busy}
          onClick={() =>
            a.onPrompt(
              b.programId === "namib"
                ? "유진우 힘든 장면만 찾아줘"
                : "중요한 장면 3개 찾아줘",
            )
          }
        >
          <Sparkles size={15} />이 작품의 장면 찾아보기
          <ArrowUpRight size={15} />
        </button>
      )}
      {b.draft && (
        <div className="draft-result">
          <span className="draft-success">
            <FileCheck2 size={18} />
            <Check size={12} />
          </span>
          <div>
            <span className="overline">클립 초안 생성됨 · 데모</span>
            <h3>{b.draft.title}</h3>
            <code>{b.draft.id}</code>
          </div>
          <SourceTimeline plan={b.draft} />
          <a className="primary-button" href={b.draft.editorUrl}>
            <FileCheck2 size={15} />
            편집기에서 열기
          </a>
          <p className="draft-footnote">
            초안만 저장되었습니다. 권리 확인은 편집 전 필요합니다.
          </p>
        </div>
      )}
    </section>
  );
}
