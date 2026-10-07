import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { api } from "../../examples/consumer/dist/index.js";
import { loadDataset, renderPrompt } from "./agent-dataset.mjs";

export async function evaluateAgent(
  base,
  {
    suite = "smoke",
    outputFile = ".local/pi-live/evaluation.json",
    serviceURLs = [],
  } = {},
) {
  const { manifest, cases, fixture, caseHash } = loadDataset();
  const info = await api(base, "/api/agent/meta");
  assert(
    info.configured && info.modelSource === "LIVE",
    "Real LIVE model required",
  );
  const selected =
    suite === "all"
      ? cases
      : suite === "smoke"
        ? cases.filter((c) => c.suite === "smoke")
        : cases.filter((c) => c.id === suite);
  assert(selected.length, "Unknown suite or case");
  const report = {
    datasetVersion: manifest.datasetVersion,
    caseHash,
    modelId: info.modelId,
    modelSource: info.modelSource,
    startedAt: new Date().toISOString(),
    cases: [],
  };
  const save = () => {
    mkdirSync(dirname(resolve(outputFile)), { recursive: true });
    writeFileSync(outputFile, JSON.stringify(report, null, 2) + "\n", {
      mode: 0o600,
    });
  };
  const wait = async (id) => {
    const deadline = Date.now() + info.defaults.timeoutMs + 15000;
    while (Date.now() < deadline) {
      const a = await api(base, "/api/agent/runs/" + id);
      if (!["QUEUED", "RUNNING"].includes(a.status) && a.finishedAt) return a;
      await new Promise((r) => setTimeout(r, 500));
    }
    await api(base, "/api/agent/runs/" + id + "/stop", {});
    throw new Error("Agent polling deadline");
  };
  const counts = async () =>
    Promise.all(
      serviceURLs.map((url) => api(url, "/health").then((v) => v.generated)),
    );
  for (const c of selected) {
    const row = {
      id: c.id,
      startedAt: new Date().toISOString(),
      passed: false,
    };
    report.cases.push(row);
    save();
    try {
      const before = await counts();
      const prompt = renderPrompt(c, fixture);
      row.prompt = prompt;
      const created = await api(base, "/api/agent/runs", {
        clientRequestId: randomUUID(),
        prompt,
      });
      row.agentId = created.agentId;
      save();
      const agent = await wait(created.agentId);
      const run = agent.runId
        ? await api(base, "/api/runs/" + agent.runId)
        : null;
      const { events } = await api(
        base,
        `/api/agent/runs/${agent.agentId}/events?after=0`,
      );
      const after = await counts();
      Object.assign(row, {
        modelTimings: events
          .filter((e) => e.type === "MODEL_RESPONSE")
          .map((e) => e.data),
        agentStatus: agent.status,
        modelStatus: agent.modelStatus,
        error: agent.error,
        runId: agent.runId,
        runStatus: run?.status ?? null,
        stopReason: run?.stopReason ?? null,
        usage: agent.usage,
        toolCalls: agent.toolCalls,
        tools: events
          .filter((e) => e.type === "TOOL_START")
          .map((e) => ({ name: e.toolName, arguments: e.data.arguments })),
        attempts:
          run?.attempts.map((a) => ({
            serviceId: a.serviceId,
            verdict: a.verification?.verdict ?? null,
            reasonCodes: a.verification?.reasonCodes ?? [],
            evidenceId: a.evidenceId,
            source: a.source,
          })) ?? [],
        explanation: agent.explanation,
        deliveriesBefore: before,
        deliveriesAfter: after,
      });
      assert.notEqual(
        agent.status,
        "ERROR",
        "Model or tool execution failed: " + agent.error,
      );
      if (c.mode === "execute") {
        assert(run, "No bound task");
        assert.equal(run.status, c.expected.runStatus);
        assert.deepEqual(
          row.attempts.map((a) => a.verdict),
          c.expected.verdicts,
        );
        assert.equal(
          run.task.account,
          fixture.accounts[c.accountIndex].address,
        );
        assert.equal(run.task.blockHash, fixture.header.hash);
        assert.equal(run.task.evidencePolicyId, "signed-account-v1");
        assert.equal(run.task.budget.maxAttempts, c.maxAttempts);
        assert.equal(run.task.budget.maxCostWei, "0");
        assert.equal(run.useHistoricalEvidence, false);
        for (const name of c.expected.requiredTools)
          assert(
            row.tools.some((t) => t.name === name),
            name + " missing",
          );
        for (const attempt of run.attempts)
          assert(c.candidateIds.includes(attempt.serviceId));
        if (c.expected.requiredTools.includes("replay_evidence")) {
          const replayIndex = row.tools.findIndex(
            (t) =>
              t.name === "replay_evidence" &&
              t.arguments.targetId === "local-two",
          );
          const acceptedIndex = row.tools.findIndex(
            (t) =>
              t.name === "request_verified_state" &&
              t.arguments.serviceId === "demo-valid",
          );
          assert(
            replayIndex >= 0 && acceptedIndex > replayIndex,
            "Must replay on the configured second instance before accepting a new delivery",
          );
        }
        if (run.status === "SUCCEEDED")
          assert(
            run.accepted &&
              run.attempts.some(
                (a) =>
                  a.evidenceId === run.accepted.evidenceId &&
                  a.verification?.verdict === "PASS",
              ),
          );
        else assert.equal(run.accepted, null);
        const evidence = [];
        for (const attempt of run.attempts)
          if (attempt.evidenceId) {
            const detail = await api(
              base,
              "/api/evidence/" + attempt.evidenceId,
            );
            const bundle = await api(
              base,
              "/api/evidence/" + attempt.evidenceId + "/bundle",
            );
            const manifest = await api(
              base,
              "/api/evidence/" + attempt.evidenceId + "/manifest",
            );
            assert.equal(detail.publication.status, "not_requested");
            evidence.push({ bundle, manifest });
          }
        writeFileSync(
          resolve(dirname(outputFile), c.id + "-evidence.json"),
          JSON.stringify(evidence, null, 2) + "\n",
          { mode: 0o600 },
        );
        for (const e of events.filter(
          (e) => e.type === "TOOL_END" && e.toolName === "replay_evidence",
        )) {
          const replay = JSON.parse(e.data.find((v) => v.type === "text").text);
          assert.equal(replay.artifactIntegrity, "VERIFIED");
          assert.equal(replay.recomputedResult.verdict, "FAIL");
          assert.equal(replay.consistent, true);
        }
      } else {
        assert.equal(agent.status, "STOPPED");
        assert.equal(
          run,
          null,
          "Incomplete request must not bind or execute an invented task",
        );
        assert(
          agent.explanation.length > 0,
          "Missing conditions must be explained",
        );
        assert.deepEqual(after, before, "Incomplete request made a delivery");
      }
      row.passed = true;
    } catch (e) {
      row.failure = e instanceof Error ? e.message : "Evaluation failure";
    }
    row.finishedAt = new Date().toISOString();
    save();
    console.log(
      JSON.stringify({
        case: row.id,
        passed: row.passed,
        agentStatus: row.agentStatus,
        runStatus: row.runStatus,
        error: row.error,
        failure: row.failure,
        requests: row.usage?.requests,
      }),
    );
  }
  report.finishedAt = new Date().toISOString();
  report.passed = report.cases.every((c) => c.passed);
  save();
  return report;
}
