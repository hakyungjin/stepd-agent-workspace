import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
type Trace = {
  requestId: string;
  provider: string;
  model: string;
  elapsedMs: number;
  outcome: "complete" | "error";
  statusCode?: number;
  tokens?: { input?: number; output?: number; total?: number };
  tools: { name: string; outcome: "complete" | "running" }[];
  resultKind?: string;
  sceneIds?: string[];
};
export async function recordLocalTrace(trace: Trace) {
  const directory = path.join(process.cwd(), ".local-data");
  try {
    await mkdir(directory, { recursive: true });
    await appendFile(
      path.join(directory, "agent-traces.jsonl"),
      JSON.stringify({
        ...trace,
        createdAt: new Date().toISOString(),
        cost: null,
      }) + "\n",
      "utf8",
    );
  } catch {
    /* local diagnostics must not alter the answer */
  }
}
