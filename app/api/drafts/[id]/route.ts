import { readDraft, saveDraft } from "@/lib/stepd/draft-store";
import { z } from "zod";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const draft = await readDraft(id);
  return draft
    ? Response.json(draft)
    : Response.json({ error: "초안을 찾을 수 없습니다." }, { status: 404 });
}
const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    thumbnailHook: z.string().max(100),
    captions: z
      .array(
        z.object({
          start: z.number().nonnegative(),
          end: z.number().positive(),
          text: z.string().max(300),
        }),
      )
      .length(3),
  })
  .strict();
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const draft = await readDraft(id);
  if (!draft)
    return Response.json(
      { error: "초안을 찾을 수 없습니다." },
      { status: 404 },
    );
  try {
    const updates = patchSchema.parse(await request.json());
    if (
      updates.captions.some(
        (c, index) =>
          c.start !== draft.captions[index].start ||
          c.end !== draft.captions[index].end,
      )
    )
      return Response.json(
        { error: "원본 시간 구간은 변경할 수 없습니다." },
        { status: 400 },
      );
    await saveDraft({ ...draft, ...updates });
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "초안 필드를 확인해 주세요." },
      { status: 400 },
    );
  }
}
