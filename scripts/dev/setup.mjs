import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const root = process.cwd();
const base = resolve(root, process.argv[2] ?? ".local/b-demo");
const relativeBase = relative(resolve(root, ".local"), base);
if (relativeBase.startsWith("..") || isAbsolute(relativeBase))
  throw new Error("Demo configuration directory must be within .local");
mkdirSync(base, { recursive: true, mode: 0o700 });
const fixture = resolve(
  root,
  "fixtures/core/ethereum-mainnet-26134149/snapshot.json",
);
const alternate = resolve(root, "fixtures/core/mainnet-corpus/24000000.json");
const snapshot = JSON.parse(readFileSync(fixture, "utf8"));
const write = (path, value) => {
  if (!existsSync(path))
    writeFileSync(path, JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
};
const services = [];
const bindings = [];
for (const [index, variant] of [
  "wrong-block",
  "wrong-value",
  "valid",
].entries()) {
  const serviceId = "demo-" + variant;
  const privateKeyFile = resolve(base, serviceId + ".key");
  if (!existsSync(privateKeyFile))
    writeFileSync(privateKeyFile, generatePrivateKey() + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  const signer = privateKeyToAccount(
    readFileSync(privateKeyFile, "utf8").trim(),
  ).address.toLowerCase();
  const config = {
    serviceId,
    version: "1",
    host: "127.0.0.1",
    port: 14301 + index,
    privateKeyFile,
    dataDir: resolve(base, serviceId),
    fixtureFile: fixture,
    alternateFixtureFile: alternate,
    variant,
    testFaults: false,
    delayMs: 0,
  };
  write(resolve(base, serviceId + ".json"), config);
  services.push({
    serviceId,
    version: "1",
    endpoint: `http://127.0.0.1:${config.port}/deliver`,
    transport: "signed-http",
    source: variant === "valid" ? "FROZEN" : "FAULT_INJECTION",
    quoteWei: "0",
    timeoutMs: 3000,
    capabilities: {
      dataChainIds: ["1"],
      blockHashes: [snapshot.header.hash],
      accounts: snapshot.accounts.map((a) => a.address),
      fields: ["balance", "nonce", "codeHash", "storageRoot"],
      proof: "SUPPORTED",
      signature: "SUPPORTED",
      methods: ["deliver"],
    },
  });
  bindings.push({
    serviceId,
    serviceVersion: "1",
    identityChainId: "1",
    signer,
    validFrom: "0",
    validUntil: "4102444800",
    authority:
      "Explicit local operator authorization of generated demo key; not RPC provider identity",
  });
}
for (const [serviceId, endpoint] of [
  ["rpc-drpc", "https://eth.drpc.org"],
  ["rpc-publicnode", "https://ethereum-rpc.publicnode.com"],
])
  services.push({
    serviceId,
    version: "public",
    endpoint,
    transport: "rpc-observation",
    source: "LIVE",
    quoteWei: null,
    timeoutMs: 8000,
    capabilities: {
      dataChainIds: ["1"],
      blockHashes: null,
      accounts: null,
      fields: ["balance", "nonce", "codeHash", "storageRoot"],
      proof: "UNKNOWN",
      signature: "UNSUPPORTED",
      methods: ["eth_chainId", "eth_getBlockByNumber", "eth_getProof"],
    },
  });
for (const [index, instanceId] of ["local-one", "local-two"].entries()) {
  const context = {
    schemaVersion: "1.0.0",
    contextId: "mainnet-demo",
    ruleVersion: "eth-account-v1",
    policy: {
      id: "signed-account-v1",
      requireSignature: true,
      minimumFinality: "any-pinned",
    },
    identityChainId: "1",
    keyBindings: bindings,
    trustedBlock: {
      dataChainId: "1",
      blockHash: snapshot.header.hash,
      stateRoot: snapshot.header.stateRoot,
      source:
        "Operator-pinned reviewed fixtures/core/ethereum-mainnet-26134149; not independent consensus verification",
      finality: "historical-checkpoint",
    },
  };
  write(resolve(base, instanceId + ".json"), {
    instanceId,
    host: "127.0.0.1",
    port: 3001 + index,
    dataDir: process.argv[2] ? resolve(base, "instances", instanceId) : resolve(root, ".local/instances", instanceId),
    corsOrigins: ["http://localhost:5173", "http://127.0.0.1:5173"],
    historyMaxAgeMs: 86400000,
    publicationAdapter: "not_configured",
    contexts: [context],
    services,
  });
}
console.log(
  `Local keys and two independent operator configurations are ready in ${base} (existing files preserved).`,
);
console.log(
  "Review checkpoint and key bindings before use. No consensus, provider identity or chain publication is implied.",
);
