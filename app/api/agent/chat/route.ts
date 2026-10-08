import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { z } from "zod";
import { agentContextSchema, briefingSchema } from "@/types/stepd";
import type { AgentMessage } from "@/types/chat";
import { getGateway } from "@/lib/stepd";
import { runMockRequest } from "@/lib/agent/orchestration";
import { streamLiveAgent } from "@/lib/agent/live-agent";
import { publicAgentError } from "@/lib/agent/errors";
export const runtime = "nodejs";
export const maxDuration = 60;
const requestSchema = z.object({
  messages: z
    .array(
      z.object({
        id: z.string(),
        role: z.enum(["user", "assistant", "system"]),
        parts: z
          .array(
            z
              .object({ type: z.string(), text: z.string().optional() })
              .passthrough(),
          )
          .max(40),
      }),
    )
    .min(1)
    .max(80),
  context: agentContextSchema,
});
export async function POST(request: Request) {
  let input;
  try {
    if (Number(request.headers.get("content-length")) > 250_000)
      return Response.json({ error: "요청이 너무 큽니다." }, { status: 413 });
    input = requestSchema.parse(await request.json());
  } catch {
    return Response.json(
      { error: "입력과 프로그램 범위를 확인해 주세요." },
      { status: 400 },
    );
  }
  const last = input.messages.findLast((m) => m.role === "user");
  const text =
    last?.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text || "")
      .join("") || "";
  if (!text.trim() || text.length > 2000)
    return Response.json(
      { error: "요청은 1~2,000자로 입력해 주세요." },
      { status: 400 },
    );
  const gateway = getGateway();
  const stream = createUIMessageStream<AgentMessage>({
    execute: async ({ writer }) => {
      if (process.env.AGENT_MODE === "live") {
        await streamLiveAgent(
          input.messages as AgentMessage[],
          input.context,
          gateway,
          writer,
          request.signal,
        );
        return;
      }
      const briefing = await runMockRequest(
        text,
        input.context,
        gateway,
        (activity) =>
          writer.write({
            type: "data-activity",
            id: activity.id,
            data: activity,
          }),
        request.signal,
      );
      writer.write({
        type: "data-briefing",
        id: crypto.randomUUID(),
        data: briefingSchema.parse(briefing),
      });
    },
    onError: publicAgentError,
  });
  return createUIMessageStreamResponse({ stream });
}
