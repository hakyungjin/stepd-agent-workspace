import test from "node:test";
import assert from "node:assert/strict";
import { MockStepDGateway } from "../lib/stepd/mock-gateway";
import { makePlans } from "../lib/agent/plans";
import {
  prepareDraftSelection,
  resumeDraftSelection,
} from "../lib/agent/draft-workflow";
import { readDraft } from "../lib/stepd/draft-store";
const gateway = new MockStepDGateway();
test("program, episode and spoiler filters constrain source evidence", async () => {
  const result = await gateway.searchScenes({
    programId: "namib",
    query: "유진우 힘든",
    episodeMax: 2,
    includeSpoilers: false,
    limit: 5,
  });
  assert.equal(result.scenes.length, 2);
  assert.ok(
    result.scenes.every(
      (s) =>
        s.programId === "namib" &&
        s.episode <= 2 &&
        s.spoiler === "safe" &&
        s.demo,
    ),
  );
});
test("same identity-search intent reuses cached evidence", async () => {
  const input = {
    programId: "busemi" as const,
    episodeMax: 5,
    includeSpoilers: false,
    limit: 3,
  };
  await gateway.searchScenes({ ...input, query: "정체 들킬 뻔한 장면" });
  const second = await gateway.searchScenes({
    ...input,
    query: "신분이 의심받는 순간",
  });
  assert.equal(second.cacheHit, true);
});
test("every plan sums to requested duration and stays inside its source scene", async () => {
  const result = await gateway.searchScenes({
    programId: "solo",
    query: "",
    episodeMax: 5,
    includeSpoilers: true,
    limit: 5,
  });
  for (const duration of [20, 30, 40]) {
    const plans = makePlans(result.scenes, duration);
    assert.equal(plans.length, 3);
    for (const plan of plans) {
      const scene = result.scenes.find((s) => s.id === plan.sceneId)!;
      assert.equal(
        plan.sourceRanges.reduce((sum, r) => sum + r.end - r.start, 0),
        duration,
      );
      assert.ok(
        plan.sourceRanges.every(
          (r) =>
            r.start >= scene.start && r.end <= scene.end && r.end > r.start,
        ),
      );
    }
  }
});
test("out-of-source range cannot be saved as a draft", async () => {
  const result = await gateway.searchScenes({
    programId: "busemi",
    query: "",
    episodeMax: 5,
    includeSpoilers: false,
    limit: 3,
  });
  const plan = makePlans(result.scenes)[0];
  plan.sourceRanges[0].start = 0;
  await assert.rejects(gateway.createClipDraft({ plan }), /구간이 일치/);
});
test("LangGraph waits for selection, resumes and saves a reopenable draft", async () => {
  const result = await gateway.searchScenes({
    programId: "namib",
    query: "",
    episodeMax: 5,
    includeSpoilers: false,
    limit: 3,
  });
  const plans = makePlans(result.scenes);
  const thread = crypto.randomUUID();
  await prepareDraftSelection(gateway, plans, thread);
  const draft = await resumeDraftSelection(gateway, thread, plans[1].id);
  assert.equal(draft.sourceRanges[0].sceneId, plans[1].sceneId);
  assert.equal(draft.duration, 30);
  assert.equal((await readDraft(draft.id))?.id, draft.id);
  const again = await resumeDraftSelection(gateway, thread, plans[1].id);
  assert.equal(again.id, draft.id);
  const another = await resumeDraftSelection(gateway, thread, plans[0].id);
  assert.notEqual(another.id, draft.id);
  assert.equal(another.sourceRanges[0].sceneId, plans[0].sceneId);
  const anotherAgain = await resumeDraftSelection(gateway, thread, plans[0].id);
  assert.equal(anotherAgain.id, another.id);
});
test("unknown candidates cannot resume a workflow", async () => {
  const result = await gateway.searchScenes({
    programId: "solo",
    query: "",
    episodeMax: 5,
    includeSpoilers: false,
    limit: 3,
  });
  const thread = crypto.randomUUID();
  await prepareDraftSelection(gateway, makePlans(result.scenes), thread);
  await assert.rejects(
    resumeDraftSelection(gateway, thread, "unknown-plan"),
    /다시 선택/,
  );
});
test("draft path does not accept traversal", async () => {
  assert.equal(await readDraft("../package"), null);
});
