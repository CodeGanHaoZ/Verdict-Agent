import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { start_server, load_server_config } from "@verdict/server";
import { digest } from "@verdict/core";
import { evaluateBlind } from "../../scripts/dev/evaluate-blind.mjs";
import { loadBlindCases } from "../../scripts/dev/agent-dataset.mjs";
let app, material, contextId;
before(async () => {
  const scenario = loadBlindCases().cases.find(
    (c) => c.id === "blind-wrong-account",
  );
  const result = await evaluateBlind(scenario, { seed: 710 });
  assert(result.passed, result.failure);
  material = JSON.parse(
    readFileSync(resolve(result.outputDirectory, "evidence.json"), "utf8"),
  )[0];
  assert.equal(material.bundle.result.verdict, "FAIL");
  const config = load_server_config(
    resolve(result.outputDirectory, "local-two.json"),
  );
  config.port = 0;
  config.dataDir = resolve(result.outputDirectory, "audit-attacks");
  contextId = config.contexts[0].contextId;
  app = start_server(config);
  await app.ready;
});
after(async () => {
  await app?.close();
});
const rejection = (e) => {
  assert.equal(e.code, 422);
  return true;
};

test("a rehashed forged PASS report cannot enter the index", async () => {
  const copy = structuredClone(material);
  copy.bundle.result.verdict = "PASS";
  copy.manifest.evidenceHash = digest(copy.bundle);
  await assert.rejects(
    app.engine.importEvidence({ ...copy, contextId }),
    rejection,
  );
  assert.equal(app.engine.store.evidenceRows().length, 0);
});
test("body tampering with the original manifest is rejected", async () => {
  const copy = structuredClone(material);
  copy.bundle.delivery.response.values.balance = "123";
  await assert.rejects(
    app.engine.importEvidence({ ...copy, contextId }),
    rejection,
  );
  assert.equal(app.engine.store.evidenceRows().length, 0);
});
test("rehashed UI_MOCK cannot enter public evidence or publication state", async () => {
  const copy = structuredClone(material);
  copy.bundle.provenance.mode = "UI_MOCK";
  copy.manifest.evidenceHash = digest(copy.bundle);
  await assert.rejects(
    app.engine.importEvidence({ ...copy, contextId }),
    rejection,
  );
  assert.equal(app.engine.store.evidenceRows().length, 0);
});
test("a new instance with revoked trust does not adopt the original report", async () => {
  const bindings = app.engine.config.contexts[0].keyBindings;
  app.engine.config.contexts[0].keyBindings = bindings.map((b) => ({
    ...b,
    revokedAt: "1",
  }));
  try {
    await assert.rejects(
      app.engine.importEvidence({ ...material, contextId }),
      rejection,
    );
  } finally {
    app.engine.config.contexts[0].keyBindings = bindings;
  }
  assert.equal(app.engine.store.evidenceRows().length, 0);
});
test("concurrent forwards reverify the same failure and preserve one indexed artifact", async () => {
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      app.engine.importEvidence({ ...material, contextId }),
    ),
  );
  assert(results.every((r) => r.result.recomputedResult.verdict === "FAIL"));
  const rows = app.engine.store.evidenceRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].publication.status, "not_requested");
});

test("expired evidence reproduces FAIL at another caller time, while a changed admission status is still rejected", async () => {
  const scenario = loadBlindCases().cases.find((c) => c.id === "blind-expired");
  const result = await evaluateBlind(scenario, { seed: 711 });
  assert(result.passed, result.failure);
  const evidence = JSON.parse(
    readFileSync(resolve(result.outputDirectory, "evidence.json"), "utf8"),
  )[0];
  const config = load_server_config(
    resolve(result.outputDirectory, "local-two.json"),
  );
  config.port = 0;
  config.dataDir = resolve(result.outputDirectory, "later-clock");
  config.contexts[0].historicalEvaluationTime = String(
    Math.floor(Date.now() / 1000) + 10,
  );
  const later = start_server(config);
  await later.ready;
  try {
    const imported = await later.engine.importEvidence({
      ...evidence,
      contextId: config.contexts[0].contextId,
    });
    assert.equal(imported.consistent, true);
    assert.equal(imported.result.recomputedResult.verdict, "FAIL");
    assert(
      imported.result.recomputedResult.reasonCodes.includes("DELIVERY_EXPIRED"),
    );
    const forged = structuredClone(evidence);
    forged.bundle.result.checks.find(
      (c) => c.checkId === "delivery-validity",
    ).status = "PASS";
    forged.manifest.evidenceHash = digest(forged.bundle);
    await assert.rejects(
      later.engine.importEvidence({
        ...forged,
        contextId: config.contexts[0].contextId,
      }),
      rejection,
    );
  } finally {
    await later.close();
  }
});
