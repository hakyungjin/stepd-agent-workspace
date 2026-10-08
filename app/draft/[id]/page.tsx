import { notFound } from "next/navigation";
import { readDraft } from "@/lib/stepd/draft-store";
import { DraftEditor } from "@/components/clip-plan/draft-editor";
export default async function DraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const draft = await readDraft(id);
  if (!draft) notFound();
  return <DraftEditor draft={draft} />;
}
