import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { clipDraftSchema, type ClipDraft } from "@/types/stepd";
const directory = path.join(process.cwd(), ".local-data", "drafts");
export async function saveDraft(draft: ClipDraft) {
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `${draft.id}.json`),
    JSON.stringify(clipDraftSchema.parse(draft)),
    "utf8",
  );
}
export async function readDraft(id: string): Promise<ClipDraft | null> {
  if (!/^demo-[a-f0-9-]{36}$/.test(id)) return null;
  try {
    return clipDraftSchema.parse(
      JSON.parse(await readFile(path.join(directory, `${id}.json`), "utf8")),
    );
  } catch {
    return null;
  }
}
