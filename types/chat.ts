import type { UIMessage } from "ai";
import type { Activity, Briefing } from "./stepd";
export type AgentMessage = UIMessage<
  never,
  { briefing: Briefing; activity: Activity }
>;
