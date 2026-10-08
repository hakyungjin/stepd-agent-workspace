// Pins lib/stepd/mcp-text.ts to the real STEP D MCP responses captured in
// fixtures/stepd-mcp/. No network: the point is that a server wording change
// breaks a test instead of silently producing wrong cards.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parseCastAxis,
  parseCastName,
  parseCreditBalance,
  parseEpisodeOutline,
  parseListClips,
  parseOutlineScenes,
  parseProgramList,
  parseProgramOverview,
  parseRights,
  parseSearchScenes,
  splitDialogue,
  splitTopLevel,
  StepDParseError,
} from "../lib/stepd/mcp-text";
import {
  episodeOutlineSchema,
  programOverviewSchema,
  sceneSchema,
  sceneSearchResultSchema,
} from "../types/stepd";

const fixture = (name: string) =>
  readFileSync(
    path.join(process.cwd(), "fixtures", "stepd-mcp", `${name}.txt`),
    "utf8",
  );

test("program list yields opaque ids and never invents a synopsis", () => {
  const programs = parseProgramList(fixture("program-list"));
  for (const program of programs) programOverviewSchema.parse(program);
  assert.equal(programs.length, 5);
  const drama = programs.find((p) => p.name === "가상 드라마 B");
  assert.equal(drama?.id, "p_aaaa0003");
  assert.equal(drama?.genre, "drama");
  assert.equal(drama?.demo, false);
  // List mode carries no synopsis at all; it must not be reported as empty-or-filled.
  assert.match(drama!.description, /작품 목록 항목/);
  assert.deepEqual(drama?.analyzedEpisodes, []);
  // A non-ASCII genre must survive (`예능`, not just `drama`/`variety`).
  assert.equal(programs.find((p) => p.name === "가상 토크쇼 C")?.genre, "예능");
  // A title containing a bracket or comma must not be truncated.
  assert.ok(programs.some((p) => p.name === "[연동 시험] 삭제 예정"));
  assert.ok(
    programs.some((p) => p.name === "가상 예능 A, 그 후 이야기는 계속된다"),
  );
  // Every bit after the em dash is optional — a bare title must still parse.
  assert.equal(programs.find((p) => p.name === "장르 없는 작품 D")?.genre, "");
  // askBlock and the "아직 없는 것" block emit `· …` lines too; only entries with
  // a (program=…) companion line are programs.
  assert.ok(programs.every((p) => /^p_/.test(p.id)));
});

test("program overview counts only finished analysis stages as analysed", () => {
  const overview = programOverviewSchema.parse(
    parseProgramOverview(fixture("program-overview"), "p_aaaa0003"),
  );
  assert.equal(overview.name, "가상 드라마 B");
  assert.equal(overview.genre, "drama");
  // 4회 is analyze(progress) so it is not available; 5회 has no air date and
  // `회차 번호 없음` has no number at all — both must be handled, not dropped.
  assert.deepEqual(overview.analyzedEpisodes, [1, 2, 3, 5, 22, 37]);
  assert.ok(overview.characters.includes("배우이 — 인물이 · 가명이"));
  // A cast row with no 극중 이름 still renders as a bare actor name.
  assert.ok(overview.characters.includes("배우삼"));
  assert.equal(overview.characters.length, 6);
  // No synopsis paragraph → say so rather than inventing one.
  assert.match(overview.description, /저장된 줄거리가 없습니다/);
  assert.equal(overview.demo, false);
});
test("a synopsis, when present, is carried instead of claimed empty", () => {
  const overview = parseProgramOverview(
    [
      "가상 드라마 B · drama · 가상방송사",
      "",
      "가상 줄거리 한 줄입니다.",
      "",
      "등장인물 1명 (배우 — 극중 이름들)",
      "· 배우일 — 인물일",
      "  (cast=cast_bbbb0001)",
    ].join("\n"),
    "p_aaaa0003",
  );
  assert.equal(overview.description, "가상 줄거리 한 줄입니다.");
  // `제목 · 장르 · 방송사` — the broadcaster tail must not leak into the genre.
  assert.equal(overview.name, "가상 드라마 B");
  assert.equal(overview.genre, "drama");
});

test("search scenes keep exact source ranges and claim no ranking", () => {
  const result = sceneSearchResultSchema.parse(
    parseSearchScenes(fixture("search-scenes"), {
      programId: "p_aaaa0003",
      includeSpoilers: false,
    }),
  );
  assert.equal(result.total, 3);
  assert.equal(result.scenes.length, 3);
  assert.equal(result.demo, false);
  const [first] = result.scenes;
  // The segment URL is the only exact range, not the mm:ss display.
  assert.equal(first.start, 78.33);
  assert.equal(first.end, 87.87);
  assert.equal(first.id, "m_dddd0001@78.33-87.87");
  assert.equal(first.episode, 22);
  assert.equal(first.rights, "review");
  assert.equal(first.spoiler, "safe");
  // 훅 1.00 on a 0–1 scale becomes 100 on this contract's 0–100 scale.
  assert.equal(first.hookScore, 100);
  // STEP D stores no scene ranking and no identification score.
  assert.equal(first.originalRank, null);
  assert.ok(first.characters.every((c) => c.confidence === null));
  // Transcript lines are copied verbatim.
  assert.ok(first.dialogue[0].startsWith("낯선 분이기도 하고"));
  assert.equal(first.frame, "");
  for (const scene of result.scenes) sceneSchema.parse(scene);
  const ids = new Set(result.scenes.map((s) => s.id));
  assert.equal(ids.size, 3, "synthesised ids must stay unique per range");
});

test("episode outline reports only the episode it actually read", () => {
  const outline = episodeOutlineSchema.parse(
    parseEpisodeOutline(fixture("episode-outline"), {
      programId: "p_aaaa0003",
      episode: 1,
      range: "10:00-13:00",
    }),
  );
  assert.equal(outline.analyzedRange, "1회 (10:00-13:00)");
  assert.ok(outline.events.length >= 3);
  assert.ok(outline.events.every((e) => e.episode === 1));
  assert.match(outline.events[0].summary, /0:00[–-]5:00/);
  assert.match(outline.reliability, /모델 해석/);
  assert.equal(outline.demo, false);
});

test("outline scene blocks parse without an ordinal prefix", () => {
  const scenes = parseOutlineScenes(fixture("episode-outline"), {
    programId: "p_aaaa0003",
    episode: 1,
    includeSpoilers: false,
  });
  assert.equal(scenes.length, 4);
  for (const scene of scenes) sceneSchema.parse(scene);
  assert.equal(scenes[0].start, 590.97);
  assert.equal(scenes[0].end, 603.15);
  assert.equal(scenes[0].episode, 1);
  // An outline scene can carry a summary but no transcript line and no people.
  const noDialogue = scenes.find((s) => s.start === 622.17);
  assert.deepEqual(noDialogue?.dialogue, []);
  assert.deepEqual(noDialogue?.characters, []);
  assert.ok(noDialogue?.summary.length);
  // The spoiler flag travels in the 권리 line here too — an outline block has no
  // ordinal title line at all, so there is nowhere else it could have been read.
  const spoiler = scenes.find((s) => s.start === 603.15);
  assert.equal(spoiler?.spoiler, "strong");
  assert.equal(spoiler?.rights, "review");
  assert.ok(scenes.filter((s) => s.spoiler === "safe").length === 3);
});

test("the spoiler mark is read from the rights line, not the title line", () => {
  // understand.ts rightsOf() puts `⚠️ 스포일러` inside the 권리 line. Reading it
  // off the title line let every spoiler scene through as safe.
  const result = parseSearchScenes(fixture("edge-cases"), {
    programId: "p_aaaa0003",
    includeSpoilers: true,
  });
  assert.equal(result.scenes.length, 3);
  const [spoiler, bare, cleared] = result.scenes;

  assert.equal(spoiler.spoiler, "strong");
  assert.equal(spoiler.rights, "review");
  // clock() emits h:mm:ss past an hour; the exact range still comes from the URL.
  assert.equal(spoiler.start, 3750);
  assert.equal(spoiler.end, 3790);
  assert.equal(spoiler.episode, 12);
  assert.equal(spoiler.hookScore, 82);
  // A free-text Korean scene type must survive as a tag.
  assert.ok(spoiler.tags.includes("먹방"));
  assert.ok(spoiler.tags.includes("쇼츠감"));
  // castLabel emits `인물이(= 가명이 · 배우 배우이)`, whose inner ` · ` must not
  // split one person into fragments, and the anonymous tail is a count.
  assert.deepEqual(
    spoiler.characters.map((c) => c.name),
    ["인물이", "명단밖일"],
  );
  assert.ok(spoiler.tags.includes("이름 미확인 4명"));

  // No air date, no rights line, no dialogue, and no episode title.
  assert.equal(bare.episode, 3);
  assert.equal(bare.spoiler, "safe");
  // An absent rights line means nothing was flagged, which the server still
  // refuses to call cleared.
  assert.equal(bare.rights, "review");
  assert.deepEqual(bare.dialogue, []);
  assert.equal(bare.hookScore, 0);
  // `일치도 ?` carries no number.
  assert.ok(!/일치도/.test(bare.reason));

  // Only an explicitly cleared line with nothing flagged may read as cleared.
  assert.equal(cleared.rights, "cleared");
  assert.equal(cleared.spoiler, "safe");
  assert.equal(cleared.start, 30);
  assert.equal(cleared.end, 70);
  assert.deepEqual(
    cleared.characters.map((c) => c.name),
    ["배우삼"],
  );
  for (const scene of result.scenes) sceneSchema.parse(scene);
});
test("cast labels and axis counts follow castLabel/splitCast output", () => {
  assert.deepEqual(splitTopLevel("a · b(x · y) · c", "·"), [
    "a",
    "b(x · y)",
    "c",
  ]);
  const axis = parseCastAxis(
    "인물이(= 가명이 · 배우 배우이)·명단밖일(명단 밖) + 이름 미확인 3명",
  );
  assert.deepEqual(axis.named, [
    "인물이(= 가명이 · 배우 배우이)",
    "명단밖일(명단 밖)",
  ]);
  assert.equal(axis.anonymous, 3);
  // Anonymous speakers are counted, never named (splitCast's rule).
  assert.deepEqual(parseCastAxis("이름 미확인 2명"), {
    named: [],
    anonymous: 2,
  });
  assert.deepEqual(parseCastName("인물이(= 가명이 · 배우 배우이)"), {
    name: "인물이",
    registered: true,
  });
  assert.deepEqual(parseCastName("명단밖일(명단 밖)"), {
    name: "명단밖일",
    registered: false,
  });
  assert.deepEqual(parseCastName("배우이(배우 · 극중 인물이)"), {
    name: "배우이",
    registered: true,
  });
});
test("rights flags map conservatively", () => {
  assert.deepEqual(parseRights("⚠️ 스포일러 · 출연자 권리 확인필요", "1. x"), {
    rights: "review",
    spoiler: "strong",
  });
  assert.deepEqual(parseRights("", "1. x"), {
    rights: "review",
    spoiler: "safe",
  });
  assert.deepEqual(parseRights("출연자 권리 확인됨 · 음원 확인됨", "1. x"), {
    rights: "cleared",
    spoiler: "safe",
  });
  // A cleared cast line alongside an unresolved music flag is not cleared.
  assert.deepEqual(parseRights("출연자 권리 확인됨 · 음원 확인필요", "1. x"), {
    rights: "review",
    spoiler: "safe",
  });
  assert.deepEqual(parseRights("PPL 가능성 — 검수 필요", "1. x"), {
    rights: "review",
    spoiler: "safe",
  });
});

test("finished clips carry no source scene and no recommendation rank", () => {
  const clips = parseListClips(fixture("list-clips"));
  assert.equal(clips.length, 5);
  assert.equal(clips[0].id, "c_ffff0001");
  // Recency order must never be presented as STEP D's own recommendation.
  assert.ok(clips.every((c) => c.recommendationSource === "none"));
  assert.ok(clips.every((c) => c.originalRank === null));
  assert.ok(clips.every((c) => c.sceneId === null));
  assert.ok(clips.every((c) => c.demo === false));
});

test("credit balance reads a real number, which the old null contract rejected", () => {
  const credit = parseCreditBalance("크레딧 잔액: 1,234 · 이번 달 사용 56");
  assert.equal(credit.balance, 1234);
  assert.match(credit.message, /1,234/);
});

test("speaker-tagged transcripts split into at most two turns, losing nothing", () => {
  assert.deepEqual(splitDialogue("1: 안녕하세요. 2: 네, 반갑습니다."), [
    "안녕하세요.",
    "네, 반갑습니다.",
  ]);
  const many = splitDialogue("4: 하나. 2: 둘. 2: 셋. 3: 넷.");
  assert.equal(many.length, 2);
  assert.equal(many[0], "하나.");
  // Later turns are joined rather than dropped.
  assert.ok(many[1].includes("둘.") && many[1].includes("넷."));
  assert.deepEqual(splitDialogue("화자 표기가 없는 한 줄"), [
    "화자 표기가 없는 한 줄",
  ]);
  assert.deepEqual(splitDialogue("   "), []);
});

test("unparseable text fails loudly instead of yielding empty cards", () => {
  assert.throws(() => parseProgramList("예상 못한 응답"), StepDParseError);
  assert.throws(
    () => parseCreditBalance("크레딧 정보를 읽을 수 없습니다"),
    StepDParseError,
  );
  assert.throws(
    () =>
      parseEpisodeOutline("머리글만 있는 응답", {
        programId: "p_aaaa0003",
        episode: 1,
      }),
    StepDParseError,
  );
});
