import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { api, consume } from "../../examples/consumer/dist/index.js";
const first = process.argv[2] ?? "http://127.0.0.1:3001",
  second = process.argv[3] ?? "http://127.0.0.1:3002";
const meta = await api(first, "/api/meta");
const context = meta.contexts[0];
const cap = meta.capabilities[0];
const now = Math.floor(Date.now() / 1000);
const input = {
  contextId: context.contextId,
  useHistoricalEvidence: false,
  task: {
    schemaVersion: "1.0.0",
    requestId: randomUUID(),
    dataChainId: "1",
    account: cap.accounts[0],
    blockHash: context.trustedBlock.blockHash,
    fields: ["balance", "nonce", "codeHash", "storageRoot"],
    evidencePolicyId: context.policy.id,
    validity: { notBefore: String(now - 5), expiresAt: String(now + 300) },
    budget: { maxAttempts: 3, timeoutMs: 15000, maxCostWei: "0" },
  },
};
// Restrict the first path so recent local timing statistics cannot skip the intended fault demonstrations.
const wrongBlock = await consume(first, {
  ...input,
  candidateIds: ["demo-wrong-block"],
});
const wrongValue = await consume(first, {
  ...input,
  task: { ...input.task, requestId: randomUUID() },
  candidateIds: ["demo-wrong-value"],
});
assert.equal(wrongBlock.attempts[0].verification.verdict, "FAIL");
assert(
  wrongBlock.attempts[0].verification.reasonCodes.includes("BLOCK_MISMATCH"),
);
assert.equal(wrongValue.attempts[0].verification.verdict, "FAIL");
assert(
  wrongValue.attempts[0].verification.reasonCodes.includes("FIELD_MISMATCH"),
);
const fallback = await consume(first, {
  ...input,
  task: { ...input.task, requestId: randomUUID() },
});
assert.equal(fallback.status, "SUCCEEDED");
assert.equal(fallback.accepted.serviceId, "demo-valid");
assert(fallback.attempts.some((a) => a.verification?.verdict === "FAIL"));
const failure = await consume(first, {
  ...input,
  task: { ...input.task, requestId: randomUUID() },
  candidateIds: ["demo-wrong-block", "demo-wrong-value"],
});
assert.equal(failure.status, "STOPPED");
assert.equal(failure.accepted, null);
const offInput = {
  ...input,
  candidateIds: ["demo-wrong-block", "demo-valid"],
  task: { ...input.task, requestId: randomUUID() },
  useHistoricalEvidence: false,
};
const off = await api(second, "/api/selection", offInput);
for (const attempt of [wrongBlock.attempts[0], wrongValue.attempts[0]]) {
  const id = attempt.evidenceId;
  const bundle = await api(first, `/api/evidence/${id}/bundle`),
    manifest = await api(first, `/api/evidence/${id}/manifest`);
  const imported = await api(second, "/api/evidence/import", {
    bundle,
    manifest,
    contextId: context.contextId,
  });
  assert.equal(imported.result.artifactIntegrity, "VERIFIED");
  assert.equal(imported.result.recomputedResult.verdict, "FAIL");
  assert.equal(imported.reportConsistent ?? imported.consistent, true);
  const { replayId } = await api(second, "/api/replays", {
    evidenceId: id,
    contextId: context.contextId,
  });
  let replay;
  for (let i = 0; i < 200; i++) {
    replay = await api(second, `/api/replays/${replayId}`);
    if (["COMPLETED", "ERROR"].includes(replay.status)) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(replay.status, "COMPLETED");
  assert.equal(replay.reportConsistent, true);
  assert.equal(replay.result.recomputedResult.verdict, "FAIL");
}
const on = await api(second, "/api/selection", {
  ...offInput,
  useHistoricalEvidence: true,
});
const reasonsOff = off.candidates.filter(
  (c) => c.applicableEvidenceIds.length,
).length;
const reasonsOn = on.candidates.filter(
  (c) => c.applicableEvidenceIds.length,
).length;
assert.equal(reasonsOff, 0);
assert.equal(reasonsOn, 1);
assert.equal(on.candidates[0].serviceId, "demo-valid");
const secondRun = await consume(second, {
  ...offInput,
  useHistoricalEvidence: true,
});
assert.equal(secondRun.status, "SUCCEEDED");
assert.equal(secondRun.attempts[0].verification.verdict, "PASS");
const summary = {
  checkedAt: new Date().toISOString(),
  first,
  second,
  fallback: fallback.attempts.map((a) => ({
    serviceId: a.serviceId,
    verdict: a.verification?.verdict,
    reasons: a.verification?.reasonCodes,
  })),
  allFail: failure.stopReason,
  historyOff: off.candidates.map((c) => c.serviceId),
  historyOn: on.candidates.map((c) => c.serviceId),
  secondRunId: secondRun.runId,
  secondCurrentVerdict: secondRun.attempts[0].verification.verdict,
  publication: (
    await api(second, `/api/evidence/${secondRun.accepted.evidenceId}`)
  ).publication,
};
mkdirSync(".local/b-demo", { recursive: true });
writeFileSync(
  ".local/b-demo/verification.json",
  JSON.stringify(summary, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
