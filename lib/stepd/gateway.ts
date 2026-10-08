import type {
  ClipDraft,
  ClipSummary,
  CreateClipDraftInput,
  EpisodeOutline,
  EpisodeOutlineInput,
  ProgramOverview,
  SceneSearchInput,
  SceneSearchResult,
} from "@/types/stepd";
export interface StepDGateway {
  // STEP D returns the workspace program list when no program is given. The app
  // needs it to populate the picker, since program ids are not a fixed enum.
  listPrograms(): Promise<ProgramOverview[]>;
  getProgramOverview(input: {
    programId?: ProgramOverview["id"];
  }): Promise<ProgramOverview>;
  getEpisodeOutline(input: EpisodeOutlineInput): Promise<EpisodeOutline>;
  searchScenes(input: SceneSearchInput): Promise<SceneSearchResult>;
  listClips(input: {
    limit: number;
    programId?: ProgramOverview["id"];
  }): Promise<ClipSummary[]>;
  createClipDraft(input: CreateClipDraftInput): Promise<ClipDraft>;
  getQueueStatus(): Promise<{
    status: "not-connected" | "connected";
    message: string;
  }>;
  // Connected STEP D reports a real balance; null stays "not connected".
  getCreditBalance(): Promise<{ balance: number | null; message: string }>;
}
