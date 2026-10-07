import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { api } from "../../examples/consumer/dist/index.js";
const base = process.argv[2] ?? "http://127.0.0.1:3001";
const info = await api(base, "/api/agent/meta");
assert(info.configured, "PI model is not configured");
assert.equal(
  info.modelSource,
  "LIVE",
  "This command requires a real model, not TEST_TRANSPORT",
);
const meta = await api(base, "/api/meta"),
  context = meta.contexts[0],
  account = meta.capabilities[0].accounts[0];
const wait = async (path, ready) => {
  for (let i = 0; i < 600; i++) {
    const result = await api(base, path);
    if (ready(result)) return result;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error("Verification deadline");
};
const outputs = [];
for (const scenario of ["fallback", "all-fail"]) {
  const candidateIds =
    scenario === "fallback"
      ? ["demo-wrong-block", "demo-wrong-value", "demo-valid"]
      : ["demo-wrong-block", "demo-wrong-value"];
  const prompt = `请核验以太坊账户 ${account} 在固定检查点 ${context.trustedBlock.blockHash} 的 balance、nonce、codeHash、storageRoot。关闭历史反证。仅可使用候选 ${candidateIds.join("、")}，请按这个顺序一次调用一个服务，收到失败后再决定下一个。签名和证明要求不可降低，全部失败就明确停止。`;
  const { draftId } = await api(base, "/api/agent/drafts", {
    clientRequestId: randomUUID(),
    prompt,
  });
  let draft = await wait(
    "/api/agent/drafts/" + draftId,
    (d) => d.status !== "GENERATING",
  );
  assert.equal(
    draft.status,
    "READY",
    JSON.stringify({ status: draft.status, error: draft.error }),
  );
  // Explicit test operator confirms these exact conditions, independent of the model proposal.
  draft = await api(base, `/api/agent/drafts/${draftId}/revise`, {
    version: draft.version,
    conditions: {
      contextId: context.contextId,
      account,
      blockHash: context.trustedBlock.blockHash,
      fields: ["balance", "nonce", "codeHash", "storageRoot"],
      candidateIds,
      useHistoricalEvidence: false,
      budget: info.defaults,
    },
  });
  const { agentId, runId } = await api(
    base,
    `/api/agent/drafts/${draftId}/confirm`,
    { version: draft.version },
  );
  const agent = await wait(
    "/api/agent/runs/" + agentId,
    (a) => !["QUEUED", "RUNNING"].includes(a.status) && a.finishedAt,
  );
  const run = await api(base, "/api/runs/" + runId);
  const { events } = await api(
    base,
    `/api/agent/runs/${agentId}/events?after=0`,
  );
  assert.equal(agent.modelSource, "LIVE");
  assert(
    events.some(
      (e) => e.type === "TOOL_START" && e.toolName === "request_verified_state",
    ),
  );
  if (scenario === "fallback") {
    assert.equal(run.status, "SUCCEEDED");
    assert.deepEqual(
      run.attempts.map((a) => a.verification?.verdict),
      ["FAIL", "FAIL", "PASS"],
    );
    assert.equal(agent.status, "COMPLETED");
  } else {
    assert.equal(run.status, "STOPPED");
    assert.equal(run.accepted, null);
    assert.equal(agent.status, "STOPPED");
  }
  outputs.push({
    scenario,
    agentId,
    runId,
    agentStatus: agent.status,
    runStatus: run.status,
    verdicts: run.attempts.map((a) => a.verification?.verdict),
    usage: agent.usage,
    modelId: agent.modelId,
    modelSource: agent.modelSource,
  });
}
mkdirSync(".local/pi-demo", { recursive: true });
writeFileSync(
  ".local/pi-demo/live-verification.json",
  JSON.stringify({ checkedAt: new Date().toISOString(), outputs }, null, 2),
);
console.log(JSON.stringify(outputs, null, 2));
