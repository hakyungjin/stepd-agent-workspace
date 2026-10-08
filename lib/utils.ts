export function timecode(seconds: number) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}
export function rangeLabel(start: number, end: number) {
  return `${timecode(start)}–${timecode(end)}`;
}
export const spoilerLabels = {
  safe: "안전",
  mild: "약함",
  strong: "강함",
} as const;
// A missing person, an unscored identification (STEP D reports no score) and a
// low score all mean the same thing to the operator: confirm the person.
export function needsIdentityCheck(character?: {
  confidence: number | null;
}): boolean {
  return (
    !character || character.confidence === null || character.confidence < 0.8
  );
}
export function rankLabel(rank: number | null): string {
  return rank === null ? "원본 순위 없음" : `원본 ${rank}위`;
}
