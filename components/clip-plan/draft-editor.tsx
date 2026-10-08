"use client";
import { ArrowLeft, FileCheck2, Save, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { ClipDraft } from "@/types/stepd";
import { SourceTimeline } from "./plan-card";
import { rangeLabel } from "@/lib/utils";
export function DraftEditor({ draft }: { draft: ClipDraft }) {
  const [title, setTitle] = useState(draft.title);
  const [thumbnailHook, setThumbnailHook] = useState(draft.thumbnailHook);
  const [captions, setCaptions] = useState(draft.captions);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    setStatus("");
    try {
      const response = await fetch(`/api/drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, thumbnailHook, captions }),
      });
      if (!response.ok)
        throw new Error("제목과 자막을 확인하고 다시 저장해 주세요.");
      setStatus("초안 변경사항을 저장했습니다.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <main className="draft-page">
      <header className="editor-header">
        <a href="/">
          <ArrowLeft size={16} />
          STEP D Agent
        </a>
        <div>
          <FileCheck2 size={15} />
          클립 초안 편집<span className="demo-badge">데모 데이터</span>
        </div>
      </header>
      <div className="editor-content">
        <section>
          <h1 className="editor-title">이야기의 마지막 손질</h1>
          <p className="editor-subtitle">
            {draft.duration}초 · 원본 구간은 유지하고 제목과 자막을 다듬어
            보세요.
          </p>
          <div className="editor-preview">
            <img
              src="/frames/demo-frame.svg"
              alt="실제 영상이 아닌 데모 프레임 placeholder"
            />
            <div className="editor-caption-preview">{captions[0]?.text}</div>
          </div>
          <h2 className="editor-section-title">source ranges · 원본 구간</h2>
          <SourceTimeline plan={draft} />
          <table className="editor-source-table">
            <thead>
              <tr>
                <th>구성</th>
                <th>원본 회차</th>
                <th>시작–종료</th>
                <th>장면 ID</th>
              </tr>
            </thead>
            <tbody>
              {draft.sourceRanges.map((range) => (
                <tr key={range.role}>
                  <td>{range.role}</td>
                  <td>{range.episode}회</td>
                  <td>{rangeLabel(range.start, range.end)}</td>
                  <td>{range.sceneId}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="editor-id">Draft ID: {draft.id}</p>
          <div className="rights-notice">
            <ShieldCheck size={16} />
            <p>
              권리 확인 필요 · 프레임과 대사는 데모입니다. 실제 영상 렌더링과
              공개 배포 기능은 포함하지 않습니다.
            </p>
          </div>
        </section>
        <section className="editor-fields">
          <h2>편집 초안</h2>
          <label>
            제목 초안
            <input
              value={title}
              maxLength={100}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            썸네일 훅 문구
            <input
              value={thumbnailHook}
              maxLength={100}
              onChange={(event) => setThumbnailHook(event.target.value)}
            />
          </label>
          <label>
            자막 초안
            {captions.map((caption, index) => (
              <div key={index} className="caption-row">
                <span>
                  {caption.start}–{caption.end}초
                </span>
                <textarea
                  value={caption.text}
                  maxLength={300}
                  onChange={(event) =>
                    setCaptions((previous) =>
                      previous.map((item, i) =>
                        i === index
                          ? { ...item, text: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </div>
            ))}
          </label>
          <button
            className="primary-button full-width"
            onClick={save}
            disabled={saving || !title.trim()}
          >
            <Save size={15} />
            {saving ? "저장 중" : "초안 저장"}
          </button>
          {status && (
            <p className="editor-status" role="status">
              {status}
            </p>
          )}
          <p className="editor-field-note">
            제목·자막·썸네일 문구는 편집 제안입니다. 원본 대사와 이용 권리를
            확인하고 완성해 주세요.
          </p>
        </section>
      </div>
    </main>
  );
}
