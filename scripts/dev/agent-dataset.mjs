import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const id = z.string().regex(/^[a-z][a-z0-9-]*$/);
const common = {
  id,
  title: z.string().min(1),
  suite: z.enum(["smoke", "extended"]),
  accountIndex: z.number().int().min(0),
  candidateIds: z
    .array(z.enum(["demo-wrong-block", "demo-wrong-value", "demo-valid"]))
    .min(1)
    .max(3),
  prompt: z.string().min(1).max(6000),
  maxAttempts: z.number().int().min(1).max(3),
};
const Case = z.discriminatedUnion("mode", [
  z.strictObject({
    ...common,
    mode: z.literal("execute"),
    expected: z.strictObject({
      runStatus: z.enum(["SUCCEEDED", "STOPPED"]),
      verdicts: z
        .array(z.enum(["PASS", "FAIL", "UNVERIFIABLE"]))
        .min(1)
        .max(3),
      requiredTools: z.array(
        z.enum(["request_verified_state", "replay_evidence"]),
      ),
    }),
  }),
  z.strictObject({
    ...common,
    mode: z.literal("incomplete"),
    expected: z.strictObject({
      agentStatus: z.literal("STOPPED"),
      mustNotCallServices: z.literal(true),
    }),
  }),
]);
export function loadDataset(root = process.cwd()) {
  const manifest = JSON.parse(
    readFileSync(resolve(root, "fixtures/agent/manifest.json"), "utf8"),
  );
  const bytes = readFileSync(
    resolve(root, "fixtures/agent", manifest.caseFile),
  );
  assert.equal(
    hash(bytes),
    manifest.caseFileSha256,
    "Scenario file hash mismatch",
  );
  const cases = z.array(Case).min(1).parse(JSON.parse(bytes));
  assert.equal(
    new Set(cases.map((c) => c.id)).size,
    cases.length,
    "Duplicate case ID",
  );
  for (const source of manifest.sources) {
    assert(
      source.path.startsWith("fixtures/core/") && !source.path.includes(".."),
    );
    const sourceBytes = readFileSync(resolve(root, source.path));
    assert.equal(hash(sourceBytes), source.sha256, source.path);
    const snapshot = JSON.parse(sourceBytes);
    assert.equal(snapshot.header.hash, source.blockHash);
    assert.deepEqual(
      snapshot.accounts.map((a) => a.address),
      source.accounts,
    );
  }
  const fixture = JSON.parse(
    readFileSync(resolve(root, manifest.taskFixture), "utf8"),
  );
  for (const c of cases) {
    assert(
      fixture.accounts[c.accountIndex],
      c.id + ": missing account fixture",
    );
    assert.equal(new Set(c.candidateIds).size, c.candidateIds.length);
    for (const [, name] of c.prompt.matchAll(/\{(\w+)\}/g))
      assert(["account", "blockHash", "candidateIds"].includes(name));
    if (c.mode === "execute") {
      assert(c.expected.verdicts.length <= c.maxAttempts);
      assert.equal(
        c.expected.runStatus === "SUCCEEDED",
        c.expected.verdicts.at(-1) === "PASS",
      );
    }
  }
  return { manifest, cases, fixture, caseHash: hash(bytes) };
}
export function renderPrompt(c, fixture) {
  const values = {
    account: fixture.accounts[c.accountIndex].address,
    blockHash: fixture.header.hash,
    candidateIds: c.candidateIds.join("、"),
  };
  return c.prompt.replace(/\{(\w+)\}/g, (_, name) => values[name]);
}
