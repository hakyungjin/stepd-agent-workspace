// STEP D MCP tools answer in prose aimed at a reading model. Their `ok()` helper
// returns only `content:[{type:"text"}]` — there is no structuredContent — so the
// text is the whole contract.
//
// Written against the generator source, not against samples:
//   packages/mcp/src/tools/scene-format.ts   sceneBlock / castLabel / rightsLine / clock
//   packages/mcp/src/tools/understand.ts     get_program_overview / get_episode_outline / rightsOf
//   packages/mcp/src/tools/clip-format.ts    clipBlock
//   packages/mcp/src/tools/ask.ts            askBlock (trailing `· …` question lines)
// Pinned by tests/mcp-contract.test.ts.
//
// Rules this file follows:
// - Facts (timecodes, transcript lines, rights, episode numbers) are copied, never derived.
// - Interpretations (summaries) are copied as-is and left labelled by the caller.
// - Anything STEP D does not report becomes null/empty, never a plausible number.
import type {
  ClipSummary,
  EpisodeOutline,
  ProgramOverview,
  Scene,
  SceneSearchResult,
} from "@/types/stepd";

export class StepDParseError extends Error {
  constructor(what: string) {
    super(`STEP D 응답을 해석하지 못했습니다: ${what}`);
    this.name = "StepDParseError";
  }
}

const flat = (value: string) => value.replace(/\s+/g, " ").trim();

/**
 * `clock()` emits `m:ss` and `h:mm:ss` past an hour, so a fixed `\d+:\d+` pattern
 * mis-reads long episodes. Kept for the meta line only; exact ranges come from the
 * segment URL.
 */
const TIME = String.raw`\d+:\d{2}(?::\d{2})?`;
const RANGE = new RegExp(`^\\s*(${TIME})[–-](${TIME})`);

/**
 * Splits a `·`-joined list without cutting inside parentheses. `castLabel` emits
 * `인물이(= 가명이 · 배우 배우이)`, which contains the same separator, so a plain
 * split shreds one person into fragments.
 */
export function splitTopLevel(line: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buffer = "";
  for (const char of line) {
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth = Math.max(0, depth - 1);
    if (char === separator && depth === 0) {
      parts.push(buffer);
      buffer = "";
      continue;
    }
    buffer += char;
  }
  parts.push(buffer);
  return parts.map(flat).filter(Boolean);
}

/**
 * `axis()`/`line()` render `이름A·이름B + 이름 미확인 2명`. The anonymous tail is a
 * count of unnamed speakers, never a person, so it must not become a name
 * (`splitCast` deliberately counts rather than naming them).
 */
export function parseCastAxis(value: string | undefined): {
  named: string[];
  anonymous: number;
} {
  if (!value) return { named: [], anonymous: 0 };
  let anonymous = 0;
  const named: string[] = [];
  for (const chunk of splitTopLevel(value, "+")) {
    const anon = chunk.match(/^이름 미확인\s*(\d+)명$/);
    if (anon) {
      anonymous += Number(anon[1]);
      continue;
    }
    for (const name of splitTopLevel(chunk, "·")) named.push(name);
  }
  return { named, anonymous };
}

/** `인물이(= 가명이 · 배우 배우이)` / `명단밖일(명단 밖)` / `배우이(배우)` → plain name + registration. */
export function parseCastName(label: string): {
  name: string;
  registered: boolean;
} {
  const outside = /\(명단 밖\)\s*$/.test(label);
  return {
    name:
      flat(label.replace(/\s*\((?:=|배우|명단 밖)[^)]*\)\s*$/, "")) || label,
    registered: !outside,
  };
}

/** `· 가상 드라마 B — drama · 회차 0 · 들어온 회차 35 · 편집본 0` + `(program=p_…)` */
export function parseProgramList(text: string): ProgramOverview[] {
  const programs: ProgramOverview[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    // askBlock and the "아직 없는 것" block also emit `· …` lines; requiring the
    // `(program=…)` companion line is what tells a program entry from those.
    const id = lines[index + 1]?.match(/\(program=([A-Za-z0-9_-]+)\)/)?.[1];
    if (!id) continue;
    const head = lines[index].match(/^·\s+(.+?)(?:\s+—\s+(.*))?$/);
    if (!head) continue;
    // Every bit after the em dash is optional — a program with no genre, no
    // episode count and no clips renders as a bare title.
    const bits = head[2] ? splitTopLevel(head[2], "·") : [];
    const genre = bits.find((bit) => !/^(회차|들어온 회차|편집본)\s/.test(bit));
    const ingested = bits
      .find((bit) => bit.startsWith("들어온 회차"))
      ?.match(/(\d+)/)?.[1];
    programs.push({
      id,
      name: flat(head[1]),
      shortName: flat(head[1]),
      genre: genre ?? "",
      themes: [],
      // The list mode carries no synopsis at all. Saying so beats inventing one.
      description: `STEP D 작품 목록 항목${ingested ? ` · 들어온 회차 ${ingested}개` : ""}. 줄거리는 작품을 지정해 조회합니다.`,
      analyzedEpisodes: [],
      characters: [],
      demo: false,
    });
  }
  if (!programs.length) throw new StepDParseError("프로그램 목록");
  return programs;
}

/**
 * Program detail. Head is `제목 · 장르 · 방송사` with both tails optional, an
 * optional synopsis paragraph, then cast and episode blocks.
 */
export function parseProgramOverview(
  text: string,
  programId: string,
): ProgramOverview {
  const lines = text.split("\n");
  const head = lines.find((line) => line.trim().length > 0);
  if (!head) throw new StepDParseError("작품 소개 머리글");
  const headBits = splitTopLevel(head, "·");
  // `get_program_overview` answers "그 프로그램을 찾지 못했습니다." as a normal
  // result, which would otherwise parse into a program literally named that.
  if (/찾지 못했습니다/.test(head))
    throw new StepDParseError("작품 소개 머리글");

  // `understand.ts` pushes the synopsis right after the head line and before any
  // structural block. Scanning the whole response instead picked up an indented
  // `(cast=…)` id line as the synopsis, so the search stops at the first block.
  let synopsis: string | undefined;
  for (const line of lines.slice(lines.indexOf(head) + 1)) {
    if (
      /^(【|등장인물|회차\s|아직 없는 것|—|ⓘ)/.test(line) ||
      line.startsWith("·")
    )
      break;
    // Id lines (`  (cast=…)`) are indented and parenthesised, never prose.
    if (!line.trim() || /^\s/.test(line) || line.trim().startsWith("("))
      continue;
    synopsis = line;
    break;
  }

  const characters: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (!/\(cast=[A-Za-z0-9_-]+\)/.test(lines[index + 1] ?? "")) continue;
    const entry = lines[index].match(/^·\s+(.+?)\s*$/);
    if (entry) characters.push(flat(entry[1]));
  }

  // `· 1회 · 2026-09-21 · recommend(done) · 파일 5개` — broadDate, stage and
  // stageStatus are each optional, and an episode may have no number at all.
  const episodes: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (!/\(episode=[A-Za-z0-9_-]+\)/.test(lines[index + 1] ?? "")) continue;
    const bits = splitTopLevel(lines[index].replace(/^·\s*/, ""), "·");
    const number = bits[0]?.match(/^(\d+)회$/)?.[1];
    if (!number) continue;
    // Only a finished analysis stage can be searched or outlined. A stage still
    // running must not be offered as available.
    if (bits.some((bit) => /\(done\)\s*$/.test(bit)))
      episodes.push(Number(number));
  }

  const registered = text.match(/회차\s+(\d+)개/)?.[1];
  return {
    id: programId,
    name: flat(headBits[0] ?? head),
    shortName: flat(headBits[0] ?? head),
    genre: headBits[1] ?? "",
    themes: [],
    description: synopsis
      ? flat(synopsis)
      : `STEP D에 저장된 줄거리가 없습니다. 등록 회차 ${registered ?? episodes.length}개 중 분석 완료 ${episodes.length}개.`,
    analyzedEpisodes: [...new Set(episodes)].sort((a, b) => a - b),
    characters,
    demo: false,
  };
}

type RawScene = {
  mediaId: string;
  start: number;
  end: number;
  episode: number | null;
  episodeLabel: string;
  sceneType: string;
  hook: number | null;
  match: number | null;
  shortsWorthy: boolean;
  onScreen: { named: string[]; anonymous: number };
  speakers: { named: string[]; anonymous: number };
  rightsLine: string;
  summary: string;
  dialogue: string[];
};

/** `영상 …/media/m_dddd0001/segment?start=78.33&end=87.87` — `toFixed(2)`, the only exact range. */
function parseSegmentUrl(block: string) {
  const match = block.match(
    /\/media\/([A-Za-z0-9_-]+)\/segment\?start=([\d.]+)&end=([\d.]+)/,
  );
  if (!match) return null;
  return { mediaId: match[1], start: Number(match[2]), end: Number(match[3]) };
}

/** Field lookups are anchored to a line so a label cannot match mid-sentence. */
const field = (block: string, name: string) =>
  block.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, "m"))?.[1]?.trim();

function parseSceneBlock(
  block: string,
  fallbackEpisode: number | null,
): RawScene | null {
  const segment = parseSegmentUrl(block);
  if (!segment) return null;

  // Meta line: `0:05–0:20 (15초) · 먹방 · 훅 0.82 · 쇼츠감`. Tokens are optional and
  // the scene type is free text (Korean), so each ` · ` token is classified
  // rather than captured positionally.
  const metaLine =
    block.split("\n").find((line) => RANGE.test(line.trim())) ?? "";
  const afterRange = metaLine
    .trim()
    .replace(RANGE, "")
    .replace(/^\s*\(\d+초\)/, "");
  let hook: number | null = null;
  let shortsWorthy = false;
  let sceneType = "";
  for (const token of splitTopLevel(afterRange, "·")) {
    const asHook = token.match(/^훅\s+([\d.]+)$/);
    if (asHook) hook = Number(asHook[1]);
    else if (token === "쇼츠감") shortsWorthy = true;
    else if (!sceneType) sceneType = token;
  }

  // `episodeLabel` renders `제목 (22회 · 2026-09-21)`; both the episode number and
  // the air date are optional, and a missing title becomes "회차 이름 없음".
  const labelLine = block.match(/^\s*(?:\d+\.\s+)(.+)$/m)?.[1]?.trim() ?? "";
  const episodeNumber = labelLine.match(/\((?:.*?·\s*)?(\d+)회(?:\s|·|\))/)
    ? Number(labelLine.match(/\(\s*(\d+)회/)?.[1] ?? NaN)
    : NaN;

  const dialogue = block.match(/^\s*대사\(사실\):\s*"([\s\S]*?)"\s*$/m)?.[1];
  return {
    ...segment,
    episode: Number.isFinite(episodeNumber) ? episodeNumber : fallbackEpisode,
    episodeLabel: labelLine.replace(/\s*\([^)]*\)\s*$/, "") || labelLine,
    sceneType,
    hook,
    match: block.match(/^\s*일치도\s+([\d.]+)/m)
      ? Number(block.match(/^\s*일치도\s+([\d.]+)/m)![1])
      : null,
    shortsWorthy,
    onScreen: parseCastAxis(field(block, "화면 인물")),
    speakers: parseCastAxis(field(block, "말한 사람")),
    rightsLine: field(block, "권리") ?? "",
    summary: flat(field(block, "요약\\(해석\\)") ?? ""),
    dialogue: dialogue ? splitDialogue(dialogue) : [],
  };
}

/** `"4: 낯선 분이기도…  2: 어머, 어 2: 머."` → at most two speaker turns, verbatim. */
export function splitDialogue(raw: string): string[] {
  const marks: { index: number; length: number }[] = [];
  const pattern = /(^|\s)(\d+):\s*/g;
  let found: RegExpExecArray | null;
  while ((found = pattern.exec(raw)) !== null)
    marks.push({ index: found.index, length: found[0].length });
  if (!marks.length) {
    const single = flat(raw);
    return single ? [single] : [];
  }
  const turns: string[] = [];
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].index + marks[i].length;
    const to = i + 1 < marks.length ? marks[i + 1].index : raw.length;
    const turn = flat(raw.slice(from, to));
    if (turn) turns.push(turn);
  }
  // The transcript splits one utterance across repeated speaker tags, so later
  // turns are joined rather than dropped.
  if (turns.length <= 2) return turns;
  return [turns[0], turns.slice(1).join(" ")];
}

/**
 * Rights and spoiler both live in the `권리:` line, which `rightsOf` builds from
 * raw server flags: `⚠️ 스포일러 · 출연자 권리 확인필요 · ⚠️ 음원 미클리어`.
 * Reading the spoiler mark off the title line instead let every spoiler scene
 * through as safe.
 */
export function parseRights(rightsLine: string, titleLine: string) {
  const spoiler =
    /스포일러/.test(rightsLine) || /^\s*\d+\.\s*⚠️/.test(titleLine);
  const flagged = /확인필요|미클리어|검수 필요|스포일러/.test(rightsLine);
  const cleared = /확인됨|클리어됨/.test(rightsLine);
  return {
    // An absent line means nothing was flagged, which the server still refuses
    // to call cleared ("'확인됨' 이라고 말하지 않는다 — 판정이 아니다").
    rights: (!flagged && cleared ? "cleared" : "review") as
      "cleared" | "review",
    spoiler: (spoiler ? "strong" : "safe") as "strong" | "safe",
  };
}

function toScene(
  raw: RawScene,
  block: string,
  programId: string,
  index: number,
  spoilersRequested: boolean,
): Scene {
  const axes = [raw.onScreen, raw.speakers];
  const named = axes.flatMap((axis) => axis.named);
  const anonymous = axes.reduce((sum, axis) => sum + axis.anonymous, 0);
  const { rights, spoiler } = parseRights(raw.rightsLine, block);
  return {
    // Synthesised from the media id and the exact segment range: STEP D exposes
    // no scene id (segmentId exists server-side but is never printed), and this
    // still proves which stored source a card came from.
    id: `${raw.mediaId}@${raw.start}-${raw.end}`,
    programId,
    episode: raw.episode ?? 0,
    start: raw.start,
    end: raw.end,
    // Interpretation-derived heading; the factual labels stay in tags.
    title: raw.summary
      ? flat(raw.summary.split(/[.,]/)[0]).slice(0, 60)
      : raw.episodeLabel || `${raw.mediaId} ${raw.start}s`,
    frame: "",
    frameVariant: index % 5,
    dialogue: raw.dialogue,
    summary: raw.summary,
    characters: named.map((label, position) => {
      const parsed = parseCastName(label);
      return {
        id: `${raw.mediaId}-cast-${position}`,
        name: parsed.name,
        // STEP D reports no identification score. A name outside the cast list
        // is explicitly unverified; a registered name is still unscored.
        confidence: null,
      };
    }),
    tags: [
      raw.sceneType,
      ...(raw.shortsWorthy ? ["쇼츠감"] : []),
      ...(anonymous ? [`이름 미확인 ${anonymous}명`] : []),
      ...(raw.rightsLine ? splitTopLevel(raw.rightsLine, "·") : []),
    ].filter(Boolean),
    keywords: named.map((label) => parseCastName(label).name),
    // STEP D scores the hook 0–1; this contract is 0–100. The hook is how
    // watchable the scene is, NOT how well it matches the query.
    hookScore: raw.hook === null ? 0 : Math.round(raw.hook * 100),
    spoiler,
    rights,
    // No stored scene recommendation ranking exists on STEP D.
    originalRank: null,
    reason: [
      raw.match === null ? null : `검색 일치도 ${raw.match}`,
      raw.hook === null
        ? null
        : `훅 ${raw.hook} (볼 만함 · 질의 일치도와 다른 축)`,
      raw.shortsWorthy ? "STEP D가 쇼츠감으로 표시" : null,
      anonymous ? `이름 미확인 ${anonymous}명` : null,
      spoilersRequested ? "스포일러 포함 검색" : "스포일러 제외 검색",
    ]
      .filter(Boolean)
      .join(" · "),
    demo: false,
  };
}

/** Search hits start at a left-margin ordinal (`1. `). */
function sceneBlocks(text: string): string[] {
  return text.split(/\n(?=\d+\.\s)/).slice(1);
}

export function parseSearchScenes(
  text: string,
  input: { programId: string; includeSpoilers: boolean },
): SceneSearchResult {
  const total = Number(text.match(/—\s*(\d+)건 중/)?.[1] ?? 0);
  const scenes = sceneBlocks(text)
    .map((block) => {
      const raw = parseSceneBlock(block, null);
      return raw ? { raw, block } : null;
    })
    .filter(
      (entry): entry is { raw: RawScene; block: string } => entry !== null,
    )
    .map(({ raw, block }, index) =>
      toScene(raw, block, input.programId, index, input.includeSpoilers),
    );
  return {
    scenes,
    total: total || scenes.length,
    scope: `STEP D 검색 · ${input.includeSpoilers ? "스포일러 포함" : "스포일러 제외"}`,
    cacheHit: false,
    demo: false,
  };
}

/** Outline scene blocks carry no ordinal prefix and no episode label. */
export function parseOutlineScenes(
  text: string,
  input: { programId: string; episode: number; includeSpoilers: boolean },
): Scene[] {
  return text
    .split(new RegExp(`\\n(?=${TIME}[–-]${TIME}(?:\\s*·|\\s*$))`))
    .slice(1)
    .map((block) => {
      const raw = parseSceneBlock(block, input.episode);
      return raw ? { raw, block } : null;
    })
    .filter(
      (entry): entry is { raw: RawScene; block: string } => entry !== null,
    )
    .map(({ raw, block }, index) =>
      toScene(raw, block, input.programId, index, input.includeSpoilers),
    );
}

/**
 * `【사건 흐름 N구간】` segments: `· 0:00–5:00 제목 · 긴장/냉담` then indented
 * summary / key moments / 인물 / 장소 lines. Title, tone and every indented line
 * are independently optional.
 */
export function parseEpisodeOutline(
  text: string,
  input: { programId: string; episode: number; range?: string },
): EpisodeOutline {
  const section = text.split("【사건 흐름")[1]?.split("【")[0] ?? "";
  const events: { episode: number; summary: string }[] = [];
  const lines = section.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const head = lines[index].match(
      new RegExp(`^·\\s+(${TIME}[–-]${TIME})\\s*(.*)$`),
    );
    if (!head) continue;
    const detail: string[] = [];
    for (let next = index + 1; next < lines.length; next++) {
      if (!/^\s{3,}\S/.test(lines[next])) break;
      detail.push(flat(lines[next]));
    }
    events.push({
      episode: input.episode,
      summary: [`${head[1]}${head[2] ? ` ${flat(head[2])}` : ""}`, ...detail]
        .filter(Boolean)
        .join(" — "),
    });
  }
  // A real episode can have narrative recorded but no segments, and the tool
  // says so ("이 회차에는 사건 흐름 기록이 없습니다"). Failing loudly beats an
  // empty outline card that reads as "nothing happened".
  if (!events.length) throw new StepDParseError("회차 사건 흐름");
  return {
    programId: input.programId,
    analyzedRange: `${input.episode}회${input.range ? ` (${input.range})` : ""}`,
    events,
    reliability:
      "STEP D 저장 분석 · 구간 시각은 원문, 서사 요약은 모델 해석입니다. 요약과 대사가 어긋나면 대사 원문이 사실입니다.",
    demo: false,
  };
}

/** `1. <title>` / `<program> N회 · 46초 · …` / `편집 …/editor/c_…` / `(clip=c_…)` */
export function parseListClips(text: string): ClipSummary[] {
  return text
    .split(/\n(?=\d+\.\s)/)
    .slice(1)
    .map((block) => block.match(/\(clip=([A-Za-z0-9_-]+)\)/)?.[1])
    .filter((id): id is string => Boolean(id))
    .map((id) => ({
      id,
      // STEP D does not link a finished clip back to a source scene, and the
      // list is recency-ordered, not a recommendation ranking.
      sceneId: null,
      originalRank: null,
      recommendationSource: "none" as const,
      demo: false,
    }));
}

/** `크레딧 잔액: 1,234 · 이번 달 사용 56` — balance may be `알 수 없음`. */
export function parseCreditBalance(text: string): {
  balance: number | null;
  message: string;
} {
  const line = text.match(/크레딧 잔액:\s*([^\n·]+)/)?.[1]?.trim();
  if (!line) throw new StepDParseError("크레딧 잔액");
  const used = text.match(/이번 달 사용\s*([\d,]+)/)?.[1];
  const numeric = /^[\d,]+$/.test(line) ? Number(line.replace(/,/g, "")) : null;
  return {
    balance: numeric,
    message: `STEP D 크레딧 잔액 ${line}${used ? ` · 이번 달 사용 ${used}` : ""}`,
  };
}
