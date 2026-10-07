import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { generatePrivateKey } from "viem/accounts";
import { start_demo, type DemoConfig } from "@verdict/demo-service";
import {
  start_server,
  ServerConfigSchema,
  type ServerConfig,
} from "@verdict/server";
import { api, consume, call_tool, guard, AcceptanceStopped } from "@verdict/consumer";
import { digest } from "@verdict/core";
import { probe_rpc, summarize } from "@verdict/observations";
import {
  canonical_json,
  CreateRunSchema,
  CandidateSchema,
  RunSnapshotSchema,
  ReplaySnapshotSchema,
  ObservationSchema,
  MetricGroupSchema,
  type Candidate,
  type CreateRun,
  type EvidenceBundle,
} from "@verdict/protocol";

const directory = mkdtempSync(resolve(tmpdir(), "verdict-b-"));
const fixture = resolve(
  "fixtures/core/ethereum-mainnet-26134149/snapshot.json",
);
const alternate = resolve("fixtures/core/mainnet-corpus/24000000.json");
const snapshot = JSON.parse(readFileSync(fixture, "utf8"));
const variants: DemoConfig["variant"][] = [
  "wrong-block",
  "wrong-value",
  "valid",
  "missing-proof",
  "rate-limit",
  "timeout",
  "unsupported",
  "bad-signature",
];
const demos: ReturnType<typeof start_demo>[] = [];
let config: ServerConfig,
  first: ReturnType<typeof start_server>,
  second: ReturnType<typeof start_server>,
  base: string,
  other: string;
const demoConfigs: DemoConfig[] = [];
function input(ids?: string[]): CreateRun {
  const now = Math.floor(Date.now() / 1000);
  return CreateRunSchema.parse({
    contextId: "mainnet-demo",
    candidateIds: ids,
    useHistoricalEvidence: false,
    task: {
      schemaVersion: "1.0.0",
      requestId: randomUUID(),
      dataChainId: "1",
      account: snapshot.accounts[0].address,
      blockHash: snapshot.header.hash,
      fields: ["balance", "nonce", "codeHash", "storageRoot"],
      evidencePolicyId: "signed-account-v1",
      validity: { notBefore: String(now - 5), expiresAt: String(now + 300) },
      budget: { maxAttempts: 8, timeoutMs: 5000, maxCostWei: "0" },
    },
  });
}
async function post(path: string, value: unknown, target = base) {
  const response = await fetch(target + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
  return { status: response.status, body: (await response.json()) as any };
}
async function waitRun(id: string, target = base) {
  for (let i = 0; i < 300; i++) {
    const run = await api(target, "/api/runs/" + id);
    if (["SUCCEEDED", "STOPPED", "ERROR"].includes(run.status))
      return RunSnapshotSchema.parse(run);
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Run not completed");
}
async function waitReplay(id: string, target = base) {
  for (let i = 0; i < 300; i++) {
    const replay = await api(target, "/api/replays/" + id);
    if (["COMPLETED", "ERROR"].includes(replay.status))
      return ReplaySnapshotSchema.parse(replay);
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Replay not completed");
}
async function evidence(id: string) {
  return {
    bundle: (await api(base, `/api/evidence/${id}/bundle`)) as EvidenceBundle,
    manifest: await api(base, `/api/evidence/${id}/manifest`),
    contextId: "mainnet-demo",
  };
}

before(async () => {
  const services: ServerConfig["services"] = [],
    bindings = [];
  for (const variant of variants) {
    const serviceId = "demo-" + variant;
    const keyFile = resolve(directory, serviceId + ".key");
    writeFileSync(keyFile, generatePrivateKey(), { mode: 0o600 });
    const demoConfig: DemoConfig = {
      serviceId,
      version: "1",
      host: "127.0.0.1",
      port: 0,
      privateKeyFile: keyFile,
      dataDir: resolve(directory, serviceId),
      fixtureFile: fixture,
      alternateFixtureFile: alternate,
      variant,
      testFaults: true,
      delayMs: variant === "timeout" ? 180 : 0,
    };
    demoConfigs.push(demoConfig);
    const demo = start_demo(demoConfig);
    demos.push(demo);
    const port = await demo.ready;
    services.push({
      serviceId,
      version: "1",
      endpoint: `http://127.0.0.1:${port}/deliver`,
      transport: "signed-http",
      source: variant === "valid" ? "FROZEN" : "FAULT_INJECTION",
      capabilities: demo.capabilities,
      quoteWei: "0",
      timeoutMs: variant === "timeout" ? 50 : 2000,
    });
    bindings.push({
      serviceId,
      serviceVersion: "1",
      identityChainId: "1",
      signer: demo.signer,
      validFrom: "0",
      validUntil: "4102444800",
      authority: "Explicit integration-test operator configuration",
    });
  }
  config = ServerConfigSchema.parse({
    instanceId: "test-one",
    host: "127.0.0.1",
    port: 0,
    dataDir: resolve(directory, "one"),
    publicationAdapter: "test_failure",
    services,
    contexts: [
      {
        schemaVersion: "1.0.0",
        contextId: "mainnet-demo",
        ruleVersion: "eth-account-v1",
        identityChainId: "1",
        policy: {
          id: "signed-account-v1",
          requireSignature: true,
          minimumFinality: "any-pinned",
        },
        trustedBlock: {
          dataChainId: "1",
          blockHash: snapshot.header.hash,
          stateRoot: snapshot.header.stateRoot,
          source: "Operator-selected test checkpoint",
          finality: "historical-checkpoint",
        },
        keyBindings: bindings,
      },
    ],
  });
  first = start_server(config);
  base = `http://127.0.0.1:${await first.ready}`;
  second = start_server({
    ...config,
    instanceId: "test-two",
    dataDir: resolve(directory, "two"),
    publicationAdapter: "not_configured",
  });
  other = `http://127.0.0.1:${await second.ready}`;
});
after(async () => {
  await first?.close();
  await second?.close();
  for (const demo of demos) await demo.close();
});

test("three real HTTP signers: both signed faults rejected, valid response adopted", async () => {
  const run = await consume(
    base,
    input(["demo-wrong-block", "demo-wrong-value", "demo-valid"]),
  );
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.attempts.length, 3);
  assert(run.attempts.every((a) => a.status === "COMPLETED"));
  assert.deepEqual(
    run.attempts.map((a) => a.verification?.verdict),
    ["FAIL", "FAIL", "PASS"],
  );
  assert(run.attempts[0].verification?.reasonCodes.includes("BLOCK_MISMATCH"));
  assert(run.attempts[1].verification?.reasonCodes.includes("FIELD_MISMATCH"));
  assert(
    run.attempts.every((a) => a.verification?.attributionStatus === "VERIFIED"),
  );
  assert.equal(run.accepted?.serviceId, "demo-valid");
  const detail = await api(base, "/api/evidence/" + run.accepted!.evidenceId);
  assert.equal(detail.publication.status, "not_requested");
  const bytes = await (await fetch(base + detail.bundleUrl)).text();
  assert.equal(canonical_json(JSON.parse(bytes)), bytes);
  assert.equal(digest(JSON.parse(bytes)), run.accepted!.evidenceId);
  for (const candidate of run.candidates) CandidateSchema.parse(candidate);
});

test("all-fail stops dependency and never exposes accepted data", async () => {
  const run = await consume(
    base,
    input(["demo-wrong-block", "demo-wrong-value"]),
  );
  assert.equal(run.status, "STOPPED");
  assert.equal(run.stopReason, "NO_ACCEPTABLE_DELIVERY");
  assert.equal(run.accepted, null);
});

test("Agent tools expose generated schemas and fail closed through actual signed fallback", async () => {
  const catalog = await api(base, "/api/tools");
  assert.equal(catalog.tools.length, 8);
  const verify = catalog.tools.find((t: any) => t.name === "verify_before_use");
  assert.equal(verify.inputSchema.additionalProperties, false);
  assert.equal(verify.inputSchema.properties.task.additionalProperties, false);
  assert.deepEqual(await call_tool(base, { name: "describe_environment", arguments: {} }), await api(base, "/api/meta"));
  const request = input(["demo-wrong-block", "demo-wrong-value", "demo-valid"]);
  const selection = await call_tool(base, { name: "find_service", arguments: request });
  assert.equal(selection.candidates.length, 3);
  const created = await call_tool(base, { name: "verify_before_use", arguments: request });
  const accepted = await guard(base, request);
  assert.equal(accepted.serviceId, "demo-valid");
  const run = RunSnapshotSchema.parse(await call_tool(base, { name: "get_run", arguments: { runId: created.runId } }));
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.attempts.map((a) => a.verification?.verdict), ["FAIL", "FAIL", "PASS"]);
  assert.equal(accepted.evidenceId, run.accepted?.evidenceId);
  const again = await call_tool(base, { name: "verify_before_use", arguments: request });
  assert.equal(again.runId, created.runId);
  assert.equal(again.duplicate, true);
  await assert.rejects(guard(base, input(["demo-wrong-value"])), (e: unknown) => {
    assert(e instanceof AcceptanceStopped);
    assert.equal(e.run.accepted, null);
    assert.equal(e.run.status, "STOPPED");
    return true;
  });
});

test("Agent evidence tools reverify in second instance and reject forged reports", async () => {
  const replayServer = start_server({ ...config, instanceId: "tool-import", dataDir: resolve(directory, "tool-import") });
  const target = `http://127.0.0.1:${await replayServer.ready}`;
  try {
  const run = await consume(base, input(["demo-wrong-value"]));
  const evidenceId = run.attempts[0].evidenceId!;
  const downloaded = await call_tool(base, { name: "download_evidence", arguments: { evidenceId } });
  assert.equal(digest(downloaded.bundle), evidenceId);
  const contextId = "mainnet-demo";
  const imported = await call_tool(target, { name: "report_outcome", arguments: { ...downloaded, contextId } });
  assert.equal(imported.result.recomputedResult.verdict, "FAIL");
  const { replayId } = await call_tool(target, { name: "replay_evidence", arguments: { evidenceId, contextId } });
  await waitReplay(replayId, target);
  const replay = ReplaySnapshotSchema.parse(await call_tool(target, { name: "get_replay", arguments: { replayId } }));
  assert.equal(replay.status, "COMPLETED");
  assert.equal(replay.reportConsistent, true);
  assert.equal(replay.result?.recomputedResult?.verdict, "FAIL");
  const forged = structuredClone(downloaded);
  forged.bundle.result.verdict = "PASS";
  forged.manifest.evidenceHash = digest(forged.bundle);
  assert.equal((await post("/api/tools/call", {
    name: "report_outcome", arguments: { ...forged, contextId },
  }, target)).status, 422);
  } finally {
    await replayServer.close();
  }
});

test("Agent calls reject model-supplied trust, targets, verdicts and arbitrary tool names", async () => {
  for (const extra of [ { endpoint: "https://example.invalid" }, { verdict: "PASS" }, { trustedBlock: snapshot.header } ]) {
    assert.equal((await post("/api/tools/call", { name: "verify_before_use", arguments: { ...input(), ...extra } })).status, 400);
  }
  for (const call of [
    { name: "publish", arguments: {} },
    { name: "verify_before_use", arguments: { ...input(), contextId: "untrusted" } },
    { name: "download_evidence", arguments: { evidenceId: "../../private.key" } },
    { name: "get_run", arguments: { runId: "missing" }, verdict: "PASS" },
  ]) assert.equal((await post("/api/tools/call", call)).status, 400);
  assert.equal((await post("/api/tools/call", { name: "get_run", arguments: { runId: "missing" } })).status, 404);
  assert.equal((await fetch(base + "/api/tools/call", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://evil.invalid" },
    body: JSON.stringify({ name: "describe_environment", arguments: {} }),
  })).status, 403);
  assert.equal((await fetch(base + "/api/tools/call", {
    method: "POST", headers: { "content-type": "application/json" },
    body: '{"name":"describe_environment","name":"publish","arguments":{}}',
  })).status, 400);
});

test("missing proof is UNVERIFIABLE and preserves attribution; unsigned/bad signature is not a provider counterexample", async () => {
  const run = await consume(base, input(["demo-missing-proof"]));
  assert.equal(run.accepted, null);
  assert.equal(run.attempts[0].verification?.verdict, "UNVERIFIABLE");
  assert(
    run.attempts[0].verification?.reasonCodes.includes("EVIDENCE_MISSING"),
  );
  assert.equal(run.attempts[0].verification?.attributionStatus, "VERIFIED");
  const bad = await consume(base, input(["demo-bad-signature"]));
  assert.equal(bad.attempts[0].verification?.dataVerdict, "PASS");
  assert.equal(bad.attempts[0].verification?.attributionStatus, "INVALID");
  assert.equal(bad.accepted, null);
});

test("429, timeout and signed unsupported remain separate transport/business observations", async () => {
  for (const [id, status, reason] of [
    ["demo-rate-limit", "RATE_LIMITED", "RATE_LIMITED"],
    ["demo-timeout", "TIMEOUT", "TIMEOUT"],
    ["demo-unsupported", "UNSUPPORTED", null],
  ] as const) {
    const run = await consume(base, input([id]));
    assert.equal(run.accepted, null);
    assert.equal(run.attempts[0].observationStatus, status);
    assert.equal(run.attempts[0].runtimeReason, reason);
    if (status === "UNSUPPORTED")
      assert(run.attempts[0].verification?.reasonCodes.includes("UNSUPPORTED"));
    else assert.equal(run.attempts[0].verification, null);
  }
});

test("attempt and elapsed-time budgets prevent unbounded fallback", async () => {
  const one = input(["demo-wrong-block", "demo-valid"]);
  one.task.budget.maxAttempts = 1;
  const run = await consume(base, one);
  assert.equal(run.stopReason, "BUDGET_EXHAUSTED");
  assert.equal(run.attempts.length, 1);
  assert.equal(run.accepted, null);
  const timed = input(["demo-timeout", "demo-valid"]);
  timed.task.budget.timeoutMs = 15;
  const timeout = await consume(base, timed);
  assert.equal(timeout.stopReason, "BUDGET_EXHAUSTED");
  assert.equal(timeout.accepted, null);
});

test("quoted costs reserved before calls; insufficient/unknown cost never treated as free", async () => {
  const service = first.engine.config.services.find(
    (s) => s.serviceId === "demo-valid",
  )!;
  const old = service.quoteWei;
  try {
    service.quoteWei = "7";
    const request = input(["demo-valid"]);
    request.task.budget.maxCostWei = "6";
    const denied = await consume(base, request);
    assert.equal(denied.stopReason, "BUDGET_EXHAUSTED");
    assert.equal(denied.attempts.length, 0);
    assert.equal(denied.spentWei, "0");
    request.task.requestId = randomUUID();
    request.task.budget.maxCostWei = "7";
    const allowed = await consume(base, request);
    assert.equal(allowed.status, "SUCCEEDED");
    assert.equal(allowed.spentWei, "7");
    service.quoteWei = null;
    const unknown = await consume(base, input(["demo-valid"]));
    assert.equal(unknown.attempts.length, 0);
    assert(
      unknown.candidates[0].rankingReasons.some((r) =>
        r.includes("COST_UNKNOWN"),
      ),
    );
  } finally {
    service.quoteWei = old;
  }
});

test("concurrent identical requests have one task, one signed delivery and one atomic consumption", async () => {
  const request = input(["demo-valid"]);
  const service = first.engine.config.services.find(
    (s) => s.serviceId === "demo-valid",
  )!;
  const health = service.endpoint.replace("/deliver", "/health");
  const before = ((await (await fetch(health)).json()) as any).generated;
  const responses = await Promise.all(
    Array.from({ length: 16 }, () => post("/api/runs", request)),
  );
  assert(responses.every((r) => r.status === 202));
  assert.equal(new Set(responses.map((r) => r.body.runId)).size, 1);
  const run = await waitRun(responses[0].body.runId);
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.attempts.length, 1);
  assert.equal(
    ((await (await fetch(health)).json()) as any).generated - before,
    1,
  );
  assert.equal(
    (
      first.engine.store.db
        .prepare("SELECT count(*) AS n FROM consumed WHERE request_id=?")
        .get(request.task.requestId) as { n: number }
    ).n,
    1,
  );
  const conflict = await post("/api/runs", {
    ...request,
    useHistoricalEvidence: true,
  });
  assert.equal(conflict.status, 409);
  const repeat = await post("/api/runs", request);
  assert.equal(repeat.body.runId, run.runId);
  assert.equal(repeat.body.duplicate, true);
});

test("demo itself shares concurrent delivery and rejects conflicting request reuse", async () => {
  const request = input().task;
  const endpoint = first.engine.config.services.find(
    (s) => s.serviceId === "demo-valid",
  )!.endpoint;
  const send = async (task: unknown) => {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(task),
    });
    return { status: r.status, body: await r.json() };
  };
  const results = await Promise.all(
    Array.from({ length: 8 }, () => send(request)),
  );
  assert(results.every((r) => r.status === 200));
  assert.equal(new Set(results.map((r) => canonical_json(r.body))).size, 1);
  assert.equal((await send({ ...request, fields: ["balance"] })).status, 409);
});

test("strict inputs, unknown context, duplicate candidates, DNS rebinding and CORS are rejected", async () => {
  assert.equal(
    (await post("/api/runs", { ...input(), verdict: "PASS" })).status,
    400,
  );
  assert.equal(
    (await post("/api/runs", { ...input(), contextId: "untrusted" })).status,
    400,
  );
  assert.equal(
    (await post("/api/runs", input(["demo-valid", "demo-valid"]))).status,
    400,
  );
  assert.equal(
    (
      await fetch(base + "/api/meta", {
        headers: { origin: "https://evil.invalid" },
      })
    ).status,
    403,
  );
  assert.equal(
    await new Promise<number | undefined>((resolveStatus, reject) => {
      const req = httpRequest(
        base + "/api/meta",
        { headers: { host: "evil.invalid" } },
        (res) => {
          res.resume();
          resolveStatus(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    }),
    403,
  );
  assert.equal(
    (
      await fetch(base + "/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"task":1,"task":2}',
      })
    ).status,
    400,
  );
  assert.equal((await fetch(base + "/api/runs/missing")).status, 404);
});

test("unknown rule and unsupported schema stop explicitly without fake success", async () => {
  const profile = first.engine.config.contexts[0];
  const old = profile.ruleVersion;
  try {
    profile.ruleVersion = "unknown-rule";
    const run = await consume(base, input(["demo-valid"]));
    assert.equal(run.stopReason, "RULE_UNSUPPORTED");
    assert.equal(run.accepted, null);
    assert.equal(run.attempts.length, 0);
  } finally {
    profile.ruleVersion = old;
  }
  const request = input(["demo-valid"]);
  request.task.schemaVersion = "future";
  const run = await consume(base, request);
  assert.equal(run.stopReason, "SCHEMA_UNSUPPORTED");
});

test("candidate identity cannot be substituted by another valid signer", async () => {
  const wrong = first.engine.config.services.find(
    (s) => s.serviceId === "demo-wrong-value",
  )!;
  const old = wrong.endpoint;
  try {
    wrong.endpoint = first.engine.config.services.find(
      (s) => s.serviceId === "demo-valid",
    )!.endpoint;
    const run = await consume(base, input(["demo-wrong-value"]));
    assert.equal(run.attempts[0].verification?.verdict, "PASS");
    assert.equal(run.attempts[0].runtimeReason, "SERVICE_ID_MISMATCH");
    assert.equal(run.accepted, null);
  } finally {
    wrong.endpoint = old;
  }
});

test("independent instance rechecks imported failures; fixed inputs + history toggle changes ranking; duplicate facts have no extra weight", async () => {
  const request = input(["demo-wrong-block", "demo-valid"]);
  const failed = await consume(base, {
    ...request,
    candidateIds: ["demo-wrong-block"],
  });
  const data = await evidence(failed.attempts[0].evidenceId!);
  assert.equal(second.engine.store.evidenceRows().length, 0);
  const off = await api(other, "/api/selection", request);
  assert.equal(off.candidates[0].serviceId, "demo-wrong-block");
  const imported = await api(other, "/api/evidence/import", data);
  assert.equal(imported.result.recomputedResult.verdict, "FAIL");
  assert.equal(imported.consistent, true);
  assert.notEqual(first.engine.store.dir, second.engine.store.dir);
  const replay = await waitReplay(
    (
      await api(other, "/api/replays", {
        evidenceId: imported.evidenceId,
        contextId: "mainnet-demo",
      })
    ).replayId,
    other,
  );
  assert.equal(replay.reportConsistent, true);
  assert.equal(replay.result?.artifactIntegrity, "VERIFIED");
  assert.equal(replay.result?.recomputedResult?.attributionStatus, "VERIFIED");
  for (let i = 0; i < 3; i++) await api(other, "/api/evidence/import", data);
  const secondFailure = await consume(base, input(["demo-wrong-block"]));
  await api(
    other,
    "/api/evidence/import",
    await evidence(secondFailure.attempts[0].evidenceId!),
  );
  const on = await api(other, "/api/selection", {
    ...request,
    useHistoricalEvidence: true,
  });
  assert.equal(on.candidates[0].serviceId, "demo-valid");
  assert.equal(
    on.candidates.find((c: Candidate) => c.serviceId === "demo-wrong-block")
      .applicableEvidenceIds.length,
    1,
  );
  const run = await consume(other, { ...request, useHistoricalEvidence: true });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.attempts.length, 1);
  assert.equal(run.attempts[0].verification?.verdict, "PASS");
  const different = {
    ...request,
    task: { ...request.task, fields: ["balance"] },
    useHistoricalEvidence: true,
  };
  const irrelevant = await api(other, "/api/selection", different);
  assert(
    irrelevant.candidates.every(
      (c: Candidate) => c.applicableEvidenceIds.length === 0,
    ),
  );
});

test("tampering, rehashed forged PASS, UI_MOCK, unknown rules and self-authorized contexts cannot enter public evidence index", async () => {
  const failed = await consume(base, input(["demo-wrong-value"]));
  const data = await evidence(failed.attempts[0].evidenceId!);
  const mutate = async (
    change: (bundle: EvidenceBundle) => void,
    rehash: boolean,
  ) => {
    const copy = structuredClone(data);
    change(copy.bundle);
    if (rehash) copy.manifest.evidenceHash = digest(copy.bundle);
    return post("/api/evidence/import", copy, other);
  };
  assert.equal(
    (
      await mutate((b) => {
        b.delivery.response!.values.balance = "1";
      }, false)
    ).body.error,
    "ARTIFACT_MISMATCH",
  );
  assert.equal(
    (
      await mutate((b) => {
        b.result.verdict = "PASS";
      }, true)
    ).status,
    422,
  );
  assert.equal(
    (
      await mutate((b) => {
        b.provenance.mode = "UI_MOCK";
      }, true)
    ).body.error,
    "UI_MOCK_REJECTED",
  );
  assert.equal(
    (
      await mutate((b) => {
        b.ruleVersion = "future";
      }, true)
    ).body.error,
    "RULE_UNSUPPORTED",
  );
  assert.equal(
    (
      await mutate((b) => {
        b.baseline!.stateRoot = "0x" + "00".repeat(32);
      }, true)
    ).status,
    422,
  );
  const keys = second.engine.config.contexts[0].keyBindings;
  try {
    second.engine.config.contexts[0].keyBindings = [];
    assert.equal((await post("/api/evidence/import", data, other)).status, 422);
  } finally {
    second.engine.config.contexts[0].keyBindings = keys;
  }
});

test("content-addressed file tampering is found on download, replay and historical selection", async () => {
  const run = await consume(base, input(["demo-wrong-value"]));
  const id = run.attempts[0].evidenceId!;
  const path = resolve(first.engine.store.dir, "evidence", id + ".json");
  const original = readFileSync(path, "utf8");
  try {
    writeFileSync(path, "{}");
    assert.equal(
      (await fetch(base + `/api/evidence/${id}/bundle`)).status,
      422,
    );
    assert.equal(
      (await api(base, `/api/evidence/${id}`)).artifactIntegrity,
      "MISMATCH",
    );
    const replay = await waitReplay(
      (
        await api(base, "/api/replays", {
          evidenceId: id,
          contextId: "mainnet-demo",
        })
      ).replayId,
    );
    assert.equal(replay.status, "ERROR");
    assert.equal(replay.error, "ARTIFACT_MISMATCH");
    const candidates = await first.engine.candidates({
      ...input(["demo-wrong-value"]),
      useHistoricalEvidence: true,
    });
    assert(!candidates[0].applicableEvidenceIds.includes(id));
  } finally {
    writeFileSync(path, original);
  }
});

test("publication failure queue is atomic, explicit test-only, and cannot rewrite verdict", async () => {
  const run = await consume(base, input(["demo-valid"]));
  const id = run.accepted!.evidenceId;
  const before = await api(base, `/api/evidence/${id}/bundle`);
  await Promise.all(
    Array.from({ length: 10 }, () => first.engine.publishForTest(id)),
  );
  const details = await api(base, `/api/evidence/${id}`);
  assert.equal(details.publication.status, "failed");
  assert.equal(details.publication.adapter, "test_failure");
  assert.match(details.publication.error, /no chain transaction/);
  assert.equal(details.publication.attempts, 1);
  await Promise.all(
    Array.from({ length: 10 }, () =>
      first.engine.publishForTest(id, details.publication.attemptId),
    ),
  );
  assert.equal(first.engine.store.evidenceRow(id).publication.attempts, 2);
  await first.engine.publishForTest(id, details.publication.attemptId);
  assert.equal(first.engine.store.evidenceRow(id).publication.attempts, 2);
  assert.equal((await api(base, "/api/runs/" + run.runId)).status, "SUCCEEDED");
  assert.deepEqual(await api(base, `/api/evidence/${id}/bundle`), before);
  await assert.rejects(
    () => second.engine.publishForTest(id),
    /PUBLICATION_NOT_CONFIGURED/,
  );
  assert.equal((await post(`/api/evidence/${id}/publish`, {})).status, 404);
});

test("restart preserves completed idempotency and conservatively stops ambiguous work without repeating a service call", async () => {
  const request = input(["demo-valid"]);
  const run = await consume(base, request);
  const pending = input(["demo-valid"]);
  const pendingRun = {
    ...run,
    runId: randomUUID(),
    task: pending.task,
    status: "RUNNING" as const,
    accepted: null,
    attempts: [],
    finishedAt: null,
  };
  first.engine.store.reserveRun(digest(pending), pendingRun);
  await first.close();
  first = start_server(config);
  base = `http://127.0.0.1:${await first.ready}`;
  assert.equal((await post("/api/runs", request)).body.runId, run.runId);
  const recovered = await api(base, "/api/runs/" + pendingRun.runId);
  assert.equal(recovered.status, "STOPPED");
  assert.equal(recovered.stopReason, "INTERRUPTED");
  assert.equal(recovered.attempts.length, 0);
  assert.equal((await post("/api/runs", pending)).body.runId, pendingRun.runId);
});

test("a repaired service can pass current verification despite relevant historical failure", async () => {
  const index = variants.indexOf("wrong-value");
  await demos[index].close();
  const repaired = start_demo({ ...demoConfigs[index], variant: "valid" });
  demos[index] = repaired;
  const port = await repaired.ready;
  first.engine.config.services.find(
    (s) => s.serviceId === "demo-wrong-value",
  )!.endpoint = `http://127.0.0.1:${port}/deliver`;
  const run = await consume(base, {
    ...input(["demo-wrong-value"]),
    useHistoricalEvidence: true,
  });
  assert(run.candidates[0].applicableEvidenceIds.length > 0);
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.attempts[0].verification?.verdict, "PASS");
});

test("controlled RPC probe distinguishes unsupported method, pruned range, rate limit, timeout and invalid data", async () => {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const mode = body.params[0];
    if (mode === "timeout") {
      await new Promise((r) => setTimeout(r, 100));
      res.end("{}");
      return;
    }
    if (mode === "rate") {
      res.writeHead(429);
      res.end("{}");
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        mode === "unsupported"
          ? {
              jsonrpc: "2.0",
              id: 1,
              error: { code: -32601, message: "method not found" },
            }
          : mode === "pruned"
            ? {
                jsonrpc: "2.0",
                id: 1,
                error: { code: -32000, message: "missing trie node" },
              }
            : mode === "bad"
              ? { jsonrpc: "2.0", id: 1, result: "invalid" }
              : { jsonrpc: "2.0", id: 1, result: "0x1" },
      ),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    for (const [mode, status, capability] of [
      ["ok", "OK", "SUPPORTED"],
      ["unsupported", "UNSUPPORTED", "UNSUPPORTED"],
      ["pruned", "UNSUPPORTED", "UNSUPPORTED"],
      ["rate", "RATE_LIMITED", "UNKNOWN"],
      ["timeout", "TIMEOUT", "UNKNOWN"],
      ["bad", "INVALID_RESPONSE", "UNKNOWN"],
    ] as const) {
      const result = await probe_rpc({
        serviceId: "controlled-test-only",
        endpoint,
        method: "eth_chainId",
        params: [mode],
        timeoutMs: 30,
      });
      assert.equal(result.status, status);
      assert.equal(result.capability, capability);
      if (mode === "timeout")
        assert.equal(summarize([result], [])[0].medianLatencyMs, null);
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("operator-configured RPC origin survives storage and metrics keep regions and networks separate", async () => {
  const rpc = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }));
  });
  await new Promise<void>((r) => rpc.listen(0, "127.0.0.1", r));
  const origin = { observerId: "test-runner", region: "HK", networkProfile: "fixture-direct", provenance: "OPERATOR_CONFIGURED" as const };
  const observer = start_server(ServerConfigSchema.parse({
    ...config, instanceId: "origin-test", dataDir: resolve(directory, "origin-test"), rpcObservationOrigin: origin,
    services: [config.services[2], { ...config.services[0], serviceId: "controlled-rpc", source: "LIVE", transport: "rpc-observation",
      endpoint: `http://127.0.0.1:${(rpc.address() as { port: number }).port}`, timeoutMs: 2000 }],
  }));
  try {
    const target = `http://127.0.0.1:${await observer.ready}`;
    assert.equal((await post("/api/observations", { origin: { ...origin, region: "US" } }, target)).status, 400);
    const result = await post("/api/observations", {}, target);
    assert.equal(result.status, 200);
    assert.equal(result.body.observations.length, 6);
    const stored = await api(target, "/api/observations");
    for (const raw of stored.observations) {
      const row = ObservationSchema.parse(raw);
      assert.deepEqual(row.origin, origin);
      assert.equal(row.correctness, "NOT_CHECKED");
    }
    const row = ObservationSchema.parse(stored.observations.find((r: any) => r.method === "eth_chainId"));
    assert.equal(row.status, "OK");
    const legacy = { ...row }; delete legacy.origin;
    ObservationSchema.parse(legacy);
    const groups = summarize([
      row, { ...row, origin: { ...origin, region: "US" } },
      { ...row, origin: { ...origin, networkProfile: "fixture-proxy" } },
      { ...row, origin: { ...origin, observerId: "another-runner" } }, legacy,
    ], []);
    assert.equal(groups.length, 5);
    for (const group of groups) {
      MetricGroupSchema.parse(group);
      assert.equal(group.sampleCount, 1);
      assert.deepEqual(group.verdictCounts, { PASS: 0, FAIL: 0, UNVERIFIABLE: 0 });
    }
  } finally {
    await observer.close();
    await new Promise<void>((r) => rpc.close(() => r()));
  }
});

test("capability filters distinguish declared/observed unsupported from temporary rate limits and unknown support", async () => {
  const request = input(["demo-unsupported"]);
  const candidates = await first.engine.candidates(request);
  assert.equal(candidates[0].eligible, false);
  assert(
    candidates[0].rankingReasons.some((r) =>
      r.includes("RECENT_OBSERVED_UNSUPPORTED"),
    ),
  );
  const rate = (await first.engine.candidates(input(["demo-rate-limit"])))[0];
  assert.equal(rate.eligible, true);
  const valid = first.engine.config.services.find(
    (s) => s.serviceId === "demo-valid",
  )!;
  const cap = structuredClone(valid.capabilities);
  try {
    valid.capabilities.blockHashes = [];
    const run = await consume(base, input(["demo-valid"]));
    assert.equal(run.attempts.length, 0);
    assert.equal(run.accepted, null);
    assert(run.candidates[0].rankingReasons.includes("BLOCK_UNSUPPORTED"));
    valid.capabilities = { ...cap, blockHashes: null, proof: "UNKNOWN" };
    const unknown = await consume(base, input(["demo-valid"]));
    assert.equal(unknown.status, "SUCCEEDED");
    assert(
      unknown.candidates[0].rankingReasons.some((r) =>
        r.startsWith("CAPABILITY_UNKNOWN"),
      ),
    );
  } finally {
    valid.capabilities = cap;
  }
});

test("expiry and caller baseline conflict cannot produce an accepted result", async () => {
  const expired = input(["demo-valid"]);
  expired.task.validity = { notBefore: "0", expiresAt: "1" };
  const run = await consume(base, expired);
  assert.equal(run.accepted, null);
  assert(run.attempts[0].verification?.reasonCodes.includes("REQUEST_EXPIRED"));
  const profile = first.engine.config.contexts[0],
    baseline = profile.trustedBlock!;
  try {
    profile.trustedBlock = { ...baseline, blockHash: "0x" + "11".repeat(32) };
    const conflict = await consume(base, input(["demo-valid"]));
    assert.equal(conflict.accepted, null);
    assert(
      conflict.attempts[0].verification?.reasonCodes.includes(
        "BASELINE_CONFLICT",
      ),
    );
  } finally {
    profile.trustedBlock = baseline;
  }
});

test("stale and revoked historical evidence does not affect new choices", async () => {
  const request = {
    ...input(["demo-wrong-block", "demo-valid"]),
    useHistoricalEvidence: true,
  };
  const profile = second.engine.config.contexts[0];
  const original = profile.keyBindings;
  try {
    profile.keyBindings = original.map((k) => ({ ...k, revokedAt: "1" }));
    const revoked = await second.engine.candidates(request);
    assert(revoked.every((c) => c.applicableEvidenceIds.length === 0));
  } finally {
    profile.keyBindings = original;
  }
  const rows = second.engine.store.evidenceRows();
  try {
    for (const row of rows)
      second.engine.store.saveEvidenceRow({
        ...row,
        createdAt: "2000-01-01T00:00:00.000Z",
      });
    const old = await second.engine.candidates(request);
    assert(old.every((c) => c.applicableEvidenceIds.length === 0));
  } finally {
    for (const row of rows) second.engine.store.saveEvidenceRow(row);
  }
});

test("one database permits one active writer and imported reports do not inflate local measurement counts", async () => {
  assert.throws(() => start_server({ ...config, port: 0 }), /active writer/);
  const request = input(["demo-valid"]);
  const current = (await api(other, "/api/services")).candidates.find(
    (c: Candidate) => c.serviceId === "demo-valid",
  );
  const before = current.metrics.reduce(
    (n: number, m: any) => n + m.verdictCounts.PASS,
    0,
  );
  const run = await consume(base, request);
  await api(
    other,
    "/api/evidence/import",
    await evidence(run.accepted!.evidenceId),
  );
  const after = (await api(other, "/api/services")).candidates
    .find((c: Candidate) => c.serviceId === "demo-valid")
    .metrics.reduce((n: number, m: any) => n + m.verdictCounts.PASS, 0);
  assert.equal(after, before);
});
