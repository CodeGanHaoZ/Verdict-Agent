import { randomUUID } from "node:crypto";
import { api, consume } from "./index.js";
const base = process.argv[2] ?? "http://127.0.0.1:3001";
const scenario = process.argv[3] ?? "fallback";
if (!["success", "fallback", "all-fail"].includes(scenario))
  throw new Error("Scenario: success | fallback | all-fail");
const meta = await api(base, "/api/meta");
const context = meta.contexts[0];
const cap = meta.capabilities[0];
const now = Math.floor(Date.now() / 1000);
const run = await consume(base, {
  contextId: context.contextId,
  useHistoricalEvidence: false,
  candidateIds:
    scenario === "success"
      ? ["demo-valid"]
      : scenario === "all-fail"
        ? ["demo-wrong-block", "demo-wrong-value"]
        : undefined,
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
});
console.log(JSON.stringify(run, null, 2));
if (
  scenario === "all-fail"
    ? run.status !== "STOPPED" || run.accepted !== null
    : run.status !== "SUCCEEDED"
)
  process.exitCode = 1;
