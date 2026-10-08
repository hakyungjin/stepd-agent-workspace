import fs from "node:fs";
import path from "node:path";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
const secrets = [
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENAI_API_KEY",
  "STEPD_AUTH_TOKEN",
]
  .map((name) => process.env[name])
  .filter(Boolean);
const root = path.join(process.cwd(), ".next", "static");
const files = fs
  .readdirSync(root, { recursive: true })
  .filter((file) => /\.(js|json|map)$/.test(file));
const leaked = files.filter((file) => {
  const content = fs.readFileSync(path.join(root, file), "utf8");
  return secrets.some((secret) => content.includes(secret));
});
console.log(
  JSON.stringify({
    ok: leaked.length === 0,
    filesChecked: files.length,
    ...(leaked.length ? { files: leaked } : {}),
  }),
);
if (leaked.length) process.exitCode = 1;
