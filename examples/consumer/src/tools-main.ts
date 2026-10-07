import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CreateRunSchema, ReplaySnapshotSchema, RunSnapshotSchema } from "@verdict/protocol";
import { AcceptanceStopped, call_tool, guard } from "./index.js";

const first = process.argv[2] ?? "http://127.0.0.1:3001";
const second = process.argv[3] ?? "http://127.0.0.1:3002";
const meta = await call_tool(first, { name: "describe_environment", arguments: {} });
const context = meta.contexts[0];
const now = Math.floor(Date.now() / 1000);
const input = CreateRunSchema.parse({
  contextId: context.contextId,
  useHistoricalEvidence: false,
  candidateIds: ["demo-wrong-block", "demo-wrong-value", "demo-valid"],
  task: {
    schemaVersion: "1.0.0", requestId: randomUUID(), dataChainId: "1",
    account: meta.capabilities[0].accounts[0], blockHash: context.trustedBlock.blockHash,
    fields: ["balance", "nonce", "codeHash", "storageRoot"], evidencePolicyId: context.policy.id,
    validity: { notBefore: String(now - 5), expiresAt: String(now + 300) },
    budget: { maxAttempts: 3, timeoutMs: 15000, maxCostWei: "0" },
  },
});
const selection = await call_tool(first, { name: "find_service", arguments: input });
assert.equal(selection.candidates.length, 3);
const { runId } = await call_tool(first, { name: "verify_before_use", arguments: input });
// Same requestId resumes the existing operation; no second outbound purchase.
const accepted = await guard(first, input);
assert.equal(accepted.serviceId, "demo-valid");
const run = RunSnapshotSchema.parse(await call_tool(first, { name: "get_run", arguments: { runId } }));
const failure = run.attempts.find((a) => a.verification?.verdict === "FAIL");
assert(failure?.evidenceId);
let stopped = false;
try {
  await guard(first, { ...input, candidateIds: ["demo-wrong-value"], task: { ...input.task, requestId: randomUUID() } });
} catch (error) {
  if (!(error instanceof AcceptanceStopped)) throw error;
  assert.equal(error.run.accepted, null);
  stopped = true;
}
assert(stopped);
const downloaded = await call_tool(first, { name: "download_evidence", arguments: { evidenceId: failure.evidenceId } });
const imported = await call_tool(second, { name: "report_outcome", arguments: { ...downloaded, contextId: input.contextId } });
assert.equal(imported.result.recomputedResult.verdict, "FAIL");
const { replayId } = await call_tool(second, { name: "replay_evidence", arguments: { evidenceId: failure.evidenceId, contextId: input.contextId } });
let replay;
for (let i = 0; i < 200; i++) {
  replay = ReplaySnapshotSchema.parse(await call_tool(second, { name: "get_replay", arguments: { replayId } }));
  if (["COMPLETED", "ERROR"].includes(replay.status)) break;
  await new Promise((r) => setTimeout(r, 25));
}
assert.equal(replay?.status, "COMPLETED");
assert.equal(replay?.reportConsistent, true);
assert.equal(replay?.result?.recomputedResult?.verdict, "FAIL");
console.log(JSON.stringify({
  toolDemo: "verified", first, second, runId,
  attempts: run.attempts.map((a) => ({ serviceId: a.serviceId, verdict: a.verification?.verdict })),
  accepted, allFailStopped: stopped, replayId, replayVerdict: replay?.result?.recomputedResult?.verdict,
  source: "FROZEN / FAULT_INJECTION; generated adapter signatures; no LLM or chain publication",
}, null, 2));
