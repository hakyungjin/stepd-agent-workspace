"use client";
import {
  Check,
  CheckCheck,
  ChevronDown,
  CirclePlay,
  Info,
  Plus,
  ScanSearch,
  Users,
  BookmarkCheck,
} from "lucide-react";
import { useState } from "react";
import type { Scene } from "@/types/stepd";
import { needsIdentityCheck, rangeLabel, spoilerLabels } from "@/lib/utils";

export function SceneFrame({
  scene,
  onPlay,
  className = "",
}: {
  scene: Scene;
  onPlay?: () => void;
  className?: string;
}) {
  return (
    <button
      className={`scene-frame variant-${scene.frameVariant} ${className}`}
      onClick={onPlay}
      aria-label={`${scene.title} 데모 프레임 미리보기`}
    >
      <img
        src={scene.frame}
        alt={`${scene.title} · 실제 영상이 아닌 데모 프레임`}
      />
      <span className="frame-demo">데모 프레임</span>
      <span className="frame-play">
        <CirclePlay size={32} strokeWidth={1.3} />
      </span>
      <span className="frame-duration">{scene.end - scene.start}초</span>
    </button>
  );
}
export function SceneCard({
  scene,
  selected,
  onSelect,
  onPin,
  onPlay,
  onSimilar,
  busy = false,
}: {
  scene: Scene;
  selected: boolean;
  onSelect: () => void;
  onPin: () => void;
  onPlay: () => void;
  onSimilar: () => void;
  busy?: boolean;
}) {
  const [reasons, setReasons] = useState(false);
  return (
    <article className={`scene-card ${selected ? "is-pinned" : ""}`}>
      <div className="scene-card-main">
        <SceneFrame scene={scene} onPlay={onPlay} />
        <div className="scene-card-content">
          <button className="scene-title-button" onClick={onSelect}>
            <span className="scene-source">
              <span>{scene.episode}회</span>
              <time>{rangeLabel(scene.start, scene.end)}</time>
              <span className="tiny-demo">데모</span>
            </span>
            <h3>{scene.title}</h3>
          </button>
          {scene.dialogue[0] ? (
            <blockquote>“{scene.dialogue[0]}”</blockquote>
          ) : (
            <blockquote className="no-dialogue">
              이 장면에는 저장된 대사가 없습니다.
            </blockquote>
          )}
          <p className="scene-summary">
            <Info size={12} />{" "}
            <span
              className={
                needsIdentityCheck(scene.characters[0])
                  ? "character-uncertain"
                  : ""
              }
            >
              요약 · 해석&nbsp; {scene.summary.replace(" 데모 장면.", ".")}
            </span>
          </p>
          <div className="scene-meta">
            <span>
              <Users size={12} />
              {needsIdentityCheck(scene.characters[0])
                ? "인물 확인 필요"
                : scene.characters[0].name}
            </span>
            <span
              className={
                scene.spoiler === "safe" ? "badge-neutral" : "badge-danger"
              }
            >
              스포일러 {spoilerLabels[scene.spoiler]}
            </span>
            <span className="badge-warning">권리 확인 필요</span>
          </div>
        </div>
      </div>
      <div className="scene-card-footer">
        <span className="verified">
          <CheckCheck size={13} /> 대사 fixture 원문 확인
        </span>
        <div className="scene-actions">
          <button onClick={onPlay}>
            <CirclePlay size={14} />
            재생
          </button>
          <button onClick={onSimilar} disabled={busy}>
            <ScanSearch size={14} />
            비슷한 장면
          </button>
          <button
            className={selected ? "pin-action pinned" : "pin-action"}
            onClick={onPin}
          >
            {selected ? <BookmarkCheck size={14} /> : <Plus size={14} />}
            {selected ? "후보 담김" : "후보에 담기"}
          </button>
        </div>
      </div>
      <button
        className="reason-toggle"
        onClick={() => setReasons((v) => !v)}
        aria-expanded={reasons}
      >
        찾은 이유 <span>{scene.tags.slice(0, 2).join(" · ")}</span>
        <ChevronDown size={13} className={reasons ? "rotate" : ""} />
      </button>
      {reasons && (
        <div className="reason-content">
          <p>{scene.reason}</p>
          <span>
            <Check size={12} /> 검색어와 장면 태그 적합도 · 훅 {scene.hookScore}
            /100 (데모 점수) · {scene.tags.join(" / ")}
          </span>
          <span>
            인물:{" "}
            {scene.characters.length
              ? scene.characters
                  .map(
                    (c) =>
                      `${c.name} [${c.id}]${needsIdentityCheck(c) ? " · 인물 확인 필요" : ""}`,
                  )
                  .join(", ")
              : "저장된 인물 정보 없음"}
          </span>
        </div>
      )}
    </article>
  );
}
