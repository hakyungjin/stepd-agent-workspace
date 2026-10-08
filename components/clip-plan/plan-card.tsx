"use client";
import {
  ArrowUpRight,
  Bookmark,
  Check,
  FilePlus2,
  MessageSquareText,
} from "lucide-react";
import type { ClipPlan } from "@/types/stepd";
import { rangeLabel, spoilerLabels } from "@/lib/utils";
export function SourceTimeline({
  plan,
}: {
  plan: Pick<ClipPlan, "sourceRanges" | "duration">;
}) {
  return (
    <div className="source-timeline">
      {plan.sourceRanges.map((range, index) => (
        <div
          key={range.role}
          className={`timeline-segment segment-${index}`}
          style={{ flex: range.end - range.start }}
        >
          <span>
            {range.role} <small>{range.end - range.start}초</small>
          </span>
          <time>{rangeLabel(range.start, range.end)}</time>
        </div>
      ))}
    </div>
  );
}
export function PlanCard({
  plan,
  pinned,
  onPin,
  onDraft,
  onExplain,
  busy = false,
}: {
  plan: ClipPlan;
  pinned: boolean;
  onPin: () => void;
  onDraft: () => void;
  onExplain: () => void;
  busy?: boolean;
}) {
  return (
    <article className={`plan-card ${pinned ? "selected-plan" : ""}`}>
      <div className="plan-top">
        <div className="candidate-number">
          {String(plan.number).padStart(2, "0")}
        </div>
        <div>
          <span className="plan-type">{plan.type}</span>
          <span className="source-label">
            {plan.recommendationSource === "original"
              ? "STEP D 원본 자동 추천"
              : "현재 요청에 맞춘 AI 재정렬"}{" "}
            · 데모
          </span>
        </div>
        <span className="plan-duration">
          {plan.duration}
          <small>초</small>
        </span>
        <button
          className={`icon-button ${pinned ? "accent-text" : ""}`}
          onClick={onPin}
          aria-label={
            pinned
              ? `후보 ${plan.number} 고정 해제`
              : `후보 ${plan.number} 작업창에 고정`
          }
        >
          {pinned ? <Check size={17} /> : <Bookmark size={17} />}
        </button>
      </div>
      <h3>{plan.title}</h3>
      <div className="hook-line">
        <MessageSquareText size={14} />
        <span>첫 3초</span>
        <p>“{plan.hook}”</p>
      </div>
      <SourceTimeline plan={plan} />
      <div className="plan-caption">
        <span>첫 자막</span>
        <p>{plan.firstCaption}</p>
      </div>
      <div className="plan-caption">
        <span>엔딩</span>
        <p>{plan.ending}</p>
      </div>
      <div className="plan-bottom">
        <div>
          <span
            className={
              plan.spoiler === "safe" ? "badge-neutral" : "badge-danger"
            }
          >
            스포일러 {spoilerLabels[plan.spoiler]}
          </span>
          <span className="badge-warning">권리 확인 필요</span>
        </div>
        <button
          className="primary-button small"
          onClick={onDraft}
          disabled={busy}
        >
          <FilePlus2 size={15} />이 초안 만들기
        </button>
      </div>
      <button className="plan-explain" onClick={onExplain} disabled={busy}>
        추천 근거 보기 <ArrowUpRight size={13} />
      </button>
    </article>
  );
}
