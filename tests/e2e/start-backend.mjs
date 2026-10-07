// Isolated real services for browser tests. Does not touch .local/instances or user's ports.
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { generatePrivateKey } from "viem/accounts";
import { start_demo } from "@verdict/demo-service";
import { start_server, ServerConfigSchema } from "@verdict/server";
const dir = mkdtempSync(resolve(tmpdir(), "verdict-browser-"));
const fixture = resolve(
  "fixtures/core/ethereum-mainnet-26134149/snapshot.json",
);
const snapshot = JSON.parse(readFileSync(fixture, "utf8"));
const demos = [],
  services = [],
  bindings = [];
for (const variant of ["wrong-block", "wrong-value", "valid"]) {
  const id = "demo-" + variant,
    key = resolve(dir, id + ".key");
  writeFileSync(key, generatePrivateKey(), { mode: 0o600 });
  const demo = start_demo({
    serviceId: id,
    version: "1",
    host: "127.0.0.1",
    port: 0,
    privateKeyFile: key,
    dataDir: resolve(dir, id),
    fixtureFile: fixture,
    alternateFixtureFile: resolve("fixtures/core/mainnet-corpus/24000000.json"),
    variant,
    testFaults: false,
    delayMs: 80,
  });
  demos.push(demo);
  const port = await demo.ready;
  services.push({
    serviceId: id,
    version: "1",
    transport: "signed-http",
    source: variant === "valid" ? "FROZEN" : "FAULT_INJECTION",
    endpoint: `http://127.0.0.1:${port}/deliver`,
    capabilities: demo.capabilities,
    quoteWei: "0",
    timeoutMs: 3000,
  });
  bindings.push({
    serviceId: id,
    serviceVersion: "1",
    identityChainId: "1",
    signer: demo.signer,
    validFrom: "0",
    validUntil: "4102444800",
    authority: "Browser test operator-authorized key",
  });
}
const contexts = [
  {
    schemaVersion: "1.0.0",
    contextId: "browser-demo",
    ruleVersion: "eth-account-v1",
    policy: {
      id: "signed-account-v1",
      requireSignature: true,
      minimumFinality: "any-pinned",
    },
    trustedBlock: {
      dataChainId: "1",
      blockHash: snapshot.header.hash,
      stateRoot: snapshot.header.stateRoot,
      source: "Operator-pinned reviewed test fixture",
      finality: "historical-checkpoint",
    },
    identityChainId: "1",
    keyBindings: bindings,
  },
];
const one = start_server(
  ServerConfigSchema.parse({
    instanceId: "browser-one",
    host: "127.0.0.1",
    port: 3101,
    dataDir: resolve(dir, "one"),
    corsOrigins: ["http://127.0.0.1:5174"],
    services,
    contexts,
  }),
);
const two = start_server(
  ServerConfigSchema.parse({
    instanceId: "browser-two",
    host: "127.0.0.1",
    port: 3102,
    dataDir: resolve(dir, "two"),
    corsOrigins: ["http://127.0.0.1:5174"],
    services,
    contexts,
  }),
);
await one.ready;
await two.ready;
console.log("Browser test backends ready");
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await one.close();
    await two.close();
    for (const demo of demos) await demo.close();
    process.exit(0);
  });
