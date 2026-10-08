import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import type { ToolLoopAgentSettings } from "ai";
const reasoningSchema = z.enum(["minimal", "low", "medium", "high"]);
// Gemini rejects forced function calling (ANY mode) while a JSON response
// schema is set: "Forced function calling (ANY mode) with a response mime type:
// 'application/json' is unsupported". The structured-output contract is what
// keeps cards grounded, so the first step narrows activeTools instead of
// forcing toolChoice. OpenAI accepts both together.
export type ModelProvider = Pick<
  ToolLoopAgentSettings,
  "model" | "providerOptions"
> & { forcedToolChoiceWithStructuredOutput: boolean };
export function getModelProvider(): ModelProvider {
  if ((process.env.AI_PROVIDER || "google") === "google") {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY)
      throw new Error(
        "서버에 GOOGLE_GENERATIVE_AI_API_KEY가 설정되지 않았습니다.",
      );
    const provider = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    });
    return {
      forcedToolChoiceWithStructuredOutput: false,
      model: provider(process.env.AI_MODEL || "gemini-3.1-flash-lite"),
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingLevel: reasoningSchema.parse(
              process.env.AI_REASONING_LEVEL || "low",
            ),
            includeThoughts: false,
          },
        },
      },
    };
  }
  if (process.env.AI_PROVIDER !== "openai")
    throw new Error("AI_PROVIDER 설정을 확인해 주세요.");
  if (!process.env.OPENAI_API_KEY)
    throw new Error("서버에 OPENAI_API_KEY가 설정되지 않았습니다.");
  const provider = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return {
    forcedToolChoiceWithStructuredOutput: true,
    model: provider(process.env.AI_MODEL || "gpt-6-luna"),
    providerOptions: {
      openai: {
        reasoningEffort: reasoningSchema.parse(
          process.env.AI_REASONING_LEVEL || "low",
        ),
      },
    },
  };
}
