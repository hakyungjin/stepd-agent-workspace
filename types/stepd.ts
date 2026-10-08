import { z } from "zod";

// STEP D issues opaque program ids (`p_aaaa0003`). The fixture ids
// ("busemi"/"namib"/"solo") are just strings in the same space, so mock and MCP
// gateways share one contract. Program lists come from the gateway, never an enum.
export const programIdSchema = z.string().min(1).max(64);
export const spoilerSchema = z.enum(["safe", "mild", "strong"]);
export const sourceRangeSchema = z.object({
  sceneId: z.string(),
  episode: z.number().int().positive(),
  start: z.number().nonnegative(),
  end: z.number().positive(),
  role: z.enum(["시작", "전개", "엔딩"]),
});
export const sceneSchema = z.object({
  id: z.string(),
  programId: programIdSchema,
  episode: z.number().int(),
  start: z.number(),
  end: z.number(),
  title: z.string(),
  // STEP D scenes carry no still image and may have no transcript line at all;
  // an empty frame renders a placeholder rather than a borrowed demo frame.
  frame: z.string(),
  frameVariant: z.number().int(),
  dialogue: z.array(z.string()).max(2),
  summary: z.string(),
  characters: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      // null when STEP D reports no identification score (cast list misses).
      confidence: z.number().min(0).max(1).nullable(),
    }),
  ),
  tags: z.array(z.string()),
  keywords: z.array(z.string()),
  hookScore: z.number(),
  spoiler: spoilerSchema,
  rights: z.enum(["review", "cleared"]),
  // STEP D has no stored scene recommendation ranking; null means "no original
  // rank to claim", which forces every candidate to read as a reorder.
  originalRank: z.number().nullable(),
  reason: z.string(),
  demo: z.boolean(),
});
export type Scene = z.infer<typeof sceneSchema>;
export const programOverviewSchema = z.object({
  id: programIdSchema,
  name: z.string(),
  shortName: z.string(),
  genre: z.string(),
  themes: z.array(z.string()),
  description: z.string(),
  // Empty for a program STEP D has ingested but not analysed yet.
  analyzedEpisodes: z.array(z.number()),
  characters: z.array(z.string()),
  demo: z.boolean(),
});
export type ProgramOverview = z.infer<typeof programOverviewSchema>;
// Real programs run to 35+ episodes. The 1–5 bound was a fixture artefact and
// would have filtered out every real scene.
export const EPISODE_MAX_LIMIT = 500;
export const sceneSearchInputSchema = z.object({
  programId: programIdSchema,
  query: z.string().max(500),
  episodeMax: z.number().int().min(1).max(EPISODE_MAX_LIMIT).default(5),
  includeSpoilers: z.boolean().default(false),
  limit: z.number().int().min(1).max(5).default(3),
  similarTo: z.string().optional(),
});
export type SceneSearchInput = z.infer<typeof sceneSearchInputSchema>;
export const sceneSearchResultSchema = z.object({
  scenes: z.array(sceneSchema),
  total: z.number(),
  scope: z.string(),
  cacheHit: z.boolean(),
  demo: z.boolean(),
});
export type SceneSearchResult = z.infer<typeof sceneSearchResultSchema>;
export const episodeOutlineInputSchema = z.object({
  programId: programIdSchema,
  episodeMax: z.number().int().min(1).max(EPISODE_MAX_LIMIT),
  includeSpoilers: z.boolean(),
});
export type EpisodeOutlineInput = z.infer<typeof episodeOutlineInputSchema>;
export const episodeOutlineSchema = z.object({
  programId: programIdSchema,
  analyzedRange: z.string(),
  events: z.array(z.object({ episode: z.number(), summary: z.string() })),
  reliability: z.string(),
  demo: z.boolean(),
});
export type EpisodeOutline = z.infer<typeof episodeOutlineSchema>;
export const clipPlanSchema = z.object({
  id: z.string(),
  number: z.number(),
  sceneId: z.string(),
  programId: programIdSchema,
  type: z.enum(["반전형", "갈등형", "감정형", "정보형"]),
  duration: z.number().min(20).max(40),
  sourceRanges: z.array(sourceRangeSchema).length(3),
  hook: z.string(),
  title: z.string(),
  firstCaption: z.string(),
  ending: z.string(),
  thumbnailHook: z.string(),
  spoiler: spoilerSchema,
  rights: z.enum(["review", "cleared"]),
  recommendationSource: z.enum(["original", "reranked"]),
  originalRank: z.number().nullable(),
  reason: z.string(),
  difficulty: z.string(),
  performanceEvidence: z.null(),
  demo: z.boolean(),
});
export type ClipPlan = z.infer<typeof clipPlanSchema>;
// STEP D's list_clips returns finished edits in recency order, not a scene
// recommendation ranking, and does not link a clip back to a source scene.
// "none" keeps recency from being presented as STEP D's own recommendation.
export type ClipSummary = {
  id: string;
  sceneId: string | null;
  originalRank: number | null;
  recommendationSource: "original" | "none";
  demo: boolean;
};
export const createClipDraftInputSchema = z.object({ plan: clipPlanSchema });
export type CreateClipDraftInput = z.infer<typeof createClipDraftInputSchema>;
export const clipDraftSchema = z.object({
  id: z.string(),
  programId: programIdSchema,
  title: z.string(),
  captions: z.array(
    z.object({ start: z.number(), end: z.number(), text: z.string() }),
  ),
  thumbnailHook: z.string(),
  sourceRanges: z.array(sourceRangeSchema),
  duration: z.number(),
  editorUrl: z.string(),
  createdAt: z.string(),
  demo: z.boolean(),
});
export type ClipDraft = z.infer<typeof clipDraftSchema>;
export type PerformanceLink = {
  distributionVideoId: string;
  clipId: string;
  sourceRanges: z.infer<typeof sourceRangeSchema>[];
  characterIds: string[];
  hook: string;
  duration: number;
  channelId: string;
  metrics: {
    views: number | null;
    averageWatchSeconds: number | null;
    completionRate: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    subscriberConversions: number | null;
  };
};
export type PerformanceBriefing = {
  status: "not-connected" | "connected";
  links: PerformanceLink[];
  reactions: {
    positive: string[];
    negative: string[];
    questions: string[];
    characters: string[];
    nextEpisode: string[];
  } | null;
};
export const agentContextSchema = z.object({
  programId: programIdSchema,
  episodeMax: z.number().int().min(1).max(EPISODE_MAX_LIMIT),
  includeSpoilers: z.boolean(),
  selectedSceneIds: z.array(z.string()).max(5).default([]),
  resultSceneIds: z.array(z.string()).max(5).default([]),
  duration: z.number().int().min(20).max(40).default(30),
  similarTo: z.string().optional(),
  // Must cover every intent resolveIntent can return, or the route rejects the
  // request before the agent runs.
  action: z
    .enum([
      "search",
      "plans",
      "draft",
      "overview",
      "outline",
      "performance",
      "explain",
    ])
    .optional(),
  candidateNumber: z.number().int().min(1).max(5).optional(),
  workflowThreadId: z.string().max(100).optional(),
});
export type AgentContext = z.infer<typeof agentContextSchema>;
export type Activity = {
  id: string;
  tool: string;
  label: string;
  status: "running" | "complete";
  cached?: boolean;
};
export const briefingSchema = z.object({
  kind: z.enum([
    "scenes",
    "plans",
    "overview",
    "explanation",
    "draft",
    "unavailable",
    "outline",
  ]),
  title: z.string(),
  summary: z.string(),
  programId: programIdSchema,
  scope: z.string(),
  demo: z.boolean(),
  scenes: z.array(sceneSchema).max(5).optional(),
  plans: z.array(clipPlanSchema).max(5).optional(),
  draft: clipDraftSchema.optional(),
  overview: programOverviewSchema.optional(),
  outline: episodeOutlineSchema.optional(),
  points: z.array(z.object({ label: z.string(), text: z.string() })).optional(),
  workflowThreadId: z.string().optional(),
});
export type Briefing = z.infer<typeof briefingSchema>;
