import "server-only";
import { createMCPClient } from "@ai-sdk/mcp";
import {
  episodeOutlineSchema,
  programOverviewSchema,
  sceneSearchResultSchema,
  type ClipSummary,
  type CreateClipDraftInput,
  type EpisodeOutlineInput,
  type ProgramOverview,
  type SceneSearchInput,
  type SceneSearchResult,
} from "@/types/stepd";
import type { StepDGateway } from "./gateway";
import {
  parseCreditBalance,
  parseEpisodeOutline,
  parseListClips,
  parseOutlineScenes,
  parseProgramList,
  parseProgramOverview,
  parseSearchScenes,
} from "./mcp-text";

// @ai-sdk/mcp owns the transport/protocol. Only read tools are reachable: the
// server also exposes edit_captions, rerender_clip, set_shorts_title and
// set_channel_metadata, which mutate real channels and are deliberately absent.
//
// Verified against the live server on 2026-10-07. Its tool inputs do NOT match
// this repo's gateway arguments, so each method translates:
//   get_program_overview { program }            — no programId, no enum
//   get_episode_outline  { episode, range, detail } — one episode id, not a range
//   search_scenes        { query, program, limit, spoilers, images }
//   list_clips           { limit }              — no program filter
// Responses are prose, not JSON, and carry no structuredContent (see mcp-text.ts).
export class McpStepDGateway implements StepDGateway {
  private async call(
    name: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    const url = process.env.STEPD_MCP_URL;
    if (!url)
      throw new Error(
        "STEP D MCP 서버 주소(STEPD_MCP_URL)가 필요합니다. 로컬은 http://127.0.0.1:7801/mcp 입니다.",
      );
    // Two postures, per packages/mcp/README.md. Local (STEPD_REQUIRE_SESSION off)
    // needs no credential — the dev server has auth disabled — so requiring a
    // token here made the local posture unreachable. Remote is account-level
    // OAuth 2.1, where the bearer token is the granted access token.
    const token = process.env.STEPD_AUTH_TOKEN;
    const client = await createMCPClient({
      transport: {
        type: "http",
        url,
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      },
    });
    try {
      const tools = await client.tools();
      const selected = tools[name];
      if (!selected?.execute)
        throw new Error(`STEP D 도구가 없습니다: ${name}`);
      const result = await selected.execute(input, {
        toolCallId: crypto.randomUUID(),
        messages: [],
      });
      const envelope = result as {
        isError?: boolean;
        content?: { type: string; text?: string }[];
      };
      const text =
        envelope.content
          ?.filter((part) => part.type === "text")
          .map((part) => part.text || "")
          .join("\n") || "";
      // STEP D reports permission and upstream failures as tool errors whose
      // text carries the HTTP status; surface it instead of a parse failure.
      if (envelope.isError)
        throw new Error(
          `STEP D 도구 실행에 실패했습니다: ${name}${text ? ` · ${text.slice(0, 200)}` : ""}`,
        );
      if (!text.trim()) throw new Error(`STEP D 응답이 비어 있습니다: ${name}`);
      return text;
    } finally {
      await client.close();
    }
  }

  async listPrograms(): Promise<ProgramOverview[]> {
    const text = await this.call("get_program_overview", {});
    return parseProgramList(text).map((program) =>
      programOverviewSchema.parse(program),
    );
  }

  async getProgramOverview(input: { programId?: ProgramOverview["id"] }) {
    if (!input.programId) {
      const [first] = await this.listPrograms();
      if (!first) throw new Error("STEP D에 조회할 작품이 없습니다.");
      return first;
    }
    const text = await this.call("get_program_overview", {
      program: input.programId,
    });
    return programOverviewSchema.parse(
      parseProgramOverview(text, input.programId),
    );
  }

  // STEP D outlines one episode at a time and has no cumulative range tool, so
  // this reads the highest analysed episode within episodeMax and says so in
  // analyzedRange rather than implying it covered 1..N.
  async getEpisodeOutline(input: EpisodeOutlineInput) {
    const { episode, episodeId } = await this.latestAnalysedEpisode(
      input.programId,
      input.episodeMax,
    );
    const text = await this.call("get_episode_outline", {
      episode: episodeId,
      detail: "brief",
    });
    return episodeOutlineSchema.parse(
      parseEpisodeOutline(text, { programId: input.programId, episode }),
    );
  }

  /**
   * In-scope scenes read from the episode outline, which STEP D presents in
   * time order with no ranking and no score filter — the path its own guidance
   * prefers over search.
   */
  private async scenesFromOutline(
    input: SceneSearchInput,
  ): Promise<SceneSearchResult> {
    const { episode, episodeId } = await this.latestAnalysedEpisode(
      input.programId,
      input.episodeMax,
    );
    const text = await this.call("get_episode_outline", {
      episode: episodeId,
      detail: "full",
    });
    const scenes = parseOutlineScenes(text, {
      programId: input.programId,
      episode,
      includeSpoilers: input.includeSpoilers,
    }).filter((scene) => input.includeSpoilers || scene.spoiler === "safe");
    return sceneSearchResultSchema.parse({
      scenes: scenes.slice(0, Math.min(5, Math.max(1, input.limit))),
      total: scenes.length,
      scope: `STEP D ${episode}회 장면 목록 · ${input.includeSpoilers ? "스포일러 포함" : "스포일러 제외"}`,
      cacheHit: false,
      demo: false,
    });
  }

  /** Highest analysed episode at or below the requested bound, with its id. */
  private async latestAnalysedEpisode(programId: string, episodeMax: number) {
    const overview = await this.getProgramOverview({ programId });
    const episode = [...overview.analyzedEpisodes]
      .filter((number) => number <= episodeMax)
      .sort((a, b) => b - a)[0];
    if (episode === undefined)
      throw new Error(
        `${episodeMax}회 이하로 분석이 끝난 회차가 STEP D에 없습니다.`,
      );
    return {
      episode,
      episodeId: await this.resolveEpisodeId(programId, episode),
    };
  }

  private async resolveEpisodeId(programId: string, episode: number) {
    const text = await this.call("get_program_overview", {
      program: programId,
    });
    const match = text.match(
      new RegExp(
        `^·\\s+${episode}회\\s[^\\n]*\\n\\s*\\(episode=([A-Za-z0-9_-]+)\\)`,
        "m",
      ),
    );
    if (!match) throw new Error(`STEP D에 ${episode}회 회차가 없습니다.`);
    return match[1];
  }

  async searchScenes(input: SceneSearchInput) {
    if (input.similarTo)
      throw new Error(
        "STEP D MCP는 비슷한 장면 검색을 지원하지 않습니다. 검색어로 찾아 주세요.",
      );
    // An empty query means the server wants in-scope evidence, not a search.
    // Sending an invented phrase ("최근 장면") would run a semantic search for
    // words nobody asked for; STEP D also ranks its own search as the weakest
    // evidence (packages/mcp/README.md 근거 우선순위: outline 2–3, search 4).
    if (!input.query.trim()) return this.scenesFromOutline(input);
    const text = await this.call("search_scenes", {
      query: input.query.trim(),
      program: input.programId,
      limit: Math.min(50, Math.max(1, input.limit)),
      spoilers: input.includeSpoilers,
      // Thumbnails arrive as image blocks, not URLs this contract can store.
      images: 0,
    });
    const result = parseSearchScenes(text, {
      programId: input.programId,
      includeSpoilers: input.includeSpoilers,
    });
    // The server has no episode-range filter, so the scope is enforced here.
    return sceneSearchResultSchema.parse({
      ...result,
      scenes: result.scenes.filter(
        (scene) => scene.episode > 0 && scene.episode <= input.episodeMax,
      ),
    });
  }

  async listClips(input: {
    limit: number;
    programId?: ProgramOverview["id"];
  }): Promise<ClipSummary[]> {
    const text = await this.call("list_clips", {
      limit: Math.min(200, Math.max(1, input.limit)),
    });
    return parseListClips(text);
  }

  async createClipDraft(_input: CreateClipDraftInput): Promise<never> {
    // Checked against the live tool list: STEP D exposes no draft-creating tool.
    // Its clip tools (edit_captions, rerender_clip, set_shorts_title) mutate
    // clips that already exist, which this workspace must not do.
    throw new Error(
      "STEP D MCP에 초안 생성 도구(create_clip_draft)가 없습니다. 초안 저장 경로를 먼저 연결해야 합니다.",
    );
  }

  async getQueueStatus() {
    try {
      const text = await this.call("get_queue_status", {});
      return { status: "connected" as const, message: text.slice(0, 300) };
    } catch (error) {
      // The live account is not superadmin, so this reads as not connected
      // rather than as an agent failure.
      const message = error instanceof Error ? error.message : "";
      if (/403|superadmin/i.test(message))
        return {
          status: "not-connected" as const,
          message:
            "대기열 상태는 superadmin 권한이 필요합니다. 이 계정으로는 조회할 수 없습니다.",
        };
      throw error;
    }
  }

  async getCreditBalance() {
    const text = await this.call("get_credit_balance", {});
    return parseCreditBalance(text);
  }
}
