import {
  Annotation,
  Command,
  END,
  interrupt,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import type { ClipDraft, ClipPlan } from "@/types/stepd";
import type { StepDGateway } from "@/lib/stepd/gateway";
const State = Annotation.Root({
  plans: Annotation<ClipPlan[]>(),
  draft: Annotation<ClipDraft | undefined>(),
  selectedPlanId: Annotation<string | undefined>(),
});
const checkpointer = new MemorySaver();
export async function getPreparedPlans(
  gateway: StepDGateway,
  threadId: string,
): Promise<ClipPlan[]> {
  const state = await draftWorkflow(gateway).getState({
    configurable: { thread_id: threadId },
  });
  if (!state.values.plans?.length)
    throw new Error(
      "작업 세션이 만료되었습니다. 쇼츠 기획안을 다시 생성해 주세요.",
    );
  return state.values.plans as ClipPlan[];
}
export function draftWorkflow(gateway: StepDGateway) {
  return new StateGraph(State)
    .addNode("select_candidate", async (state) => {
      const selection = interrupt({
        message: "후보를 선택하면 초안을 생성합니다.",
        candidates: state.plans.map((p) => ({ id: p.id, title: p.title })),
      }) as { planId: string };
      const plan = state.plans.find((p) => p.id === selection.planId);
      if (!plan) throw new Error("이 작업의 후보를 다시 선택해 주세요.");
      return {
        draft: await gateway.createClipDraft({ plan }),
        selectedPlanId: plan.id,
      };
    })
    .addEdge(START, "select_candidate")
    .addEdge("select_candidate", END)
    .compile({ checkpointer });
}
export async function prepareDraftSelection(
  gateway: StepDGateway,
  plans: ClipPlan[],
  threadId: string,
) {
  await draftWorkflow(gateway).invoke(
    { plans },
    { configurable: { thread_id: threadId } },
  );
}
export async function resumeDraftSelection(
  gateway: StepDGateway,
  threadId: string,
  planId: string,
) {
  const workflow = draftWorkflow(gateway);
  const state = await workflow.getState({
    configurable: { thread_id: threadId },
  });
  if (!state.values.plans?.length)
    throw new Error(
      "작업 세션이 만료되었습니다. 쇼츠 기획안을 다시 생성해 주세요.",
    );
  if (!state.values.plans.some((plan: ClipPlan) => plan.id === planId))
    throw new Error("이 작업의 후보를 다시 선택해 주세요.");
  if (state.values.draft && state.values.selectedPlanId === planId)
    return state.values.draft as ClipDraft;
  // A completed checkpoint belongs to its selected candidate. A different
  // choice resumes its own framework checkpoint, preserving earlier drafts.
  const selectionThreadId = state.values.draft
    ? `${threadId}:${planId}`
    : threadId;
  if (selectionThreadId !== threadId) {
    const selectionState = await workflow.getState({
      configurable: { thread_id: selectionThreadId },
    });
    if (selectionState.values.draft)
      return selectionState.values.draft as ClipDraft;
    if (!selectionState.values.plans?.length)
      await prepareDraftSelection(
        gateway,
        state.values.plans as ClipPlan[],
        selectionThreadId,
      );
  }
  const result = await workflow.invoke(new Command({ resume: { planId } }), {
    configurable: { thread_id: selectionThreadId },
  });
  if (!result.draft) throw new Error("초안을 생성하지 못했습니다.");
  return result.draft;
}
