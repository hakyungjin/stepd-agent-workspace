import nextEnv from "@next/env";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
nextEnv.loadEnvConfig(process.cwd());
try {
  const modelId = process.env.AI_MODEL || "gemini-3.1-flash-lite";
  const google = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
  const result = await generateText({
    model: google(modelId),
    prompt: "Reply with OK only.",
    maxOutputTokens: 16,
    maxRetries: 0,
    timeout: 20_000,
  });
  console.log(
    JSON.stringify({
      ok: true,
      model: modelId,
      output: result.text,
      tokens: result.totalUsage.totalTokens,
    }),
  );
} catch (error) {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
  const sanitized = String(error.message || "")
    .replaceAll(key || "[not-set]", "[REDACTED]")
    .replace(/AQ\.[A-Za-z0-9_-]+/g, "[REDACTED]");
  const result = {
    ok: false,
    status: error.statusCode,
    message: sanitized.slice(0, 350),
  };
  if (error.responseBody) {
    try {
      const body = JSON.parse(error.responseBody);
      result.reason = String(
        body.error?.message ||
          body.detail?.message ||
          body.message ||
          (typeof body.error === "string" ? body.error : ""),
      )
        .replaceAll(key || "[not-set]", "[REDACTED]")
        .slice(0, 350);
    } catch {}
  }
  console.log(JSON.stringify(result));
  process.exitCode = 1;
}
