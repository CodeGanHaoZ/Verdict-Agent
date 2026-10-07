import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import {
  canonical_json,
  parse_json_strict,
  TaskSpecSchema,
  HeaderSchema,
  DeliveryEnvelopeSchema,
  type TaskSpec,
  type DeliveryEnvelope,
  type Capabilities,
} from "@verdict/protocol";
import { request_digest, delivery_typed_data } from "@verdict/core";

const ConfigSchema = z.strictObject({
  serviceId: z.string().regex(/^[\w.-]+$/),
  version: z.string().min(1),
  host: z.enum(["127.0.0.1", "localhost"]).default("127.0.0.1"),
  port: z.number().int().min(0).max(65535),
  privateKeyFile: z.string(),
  dataDir: z.string(),
  fixtureFile: z.string(),
  alternateFixtureFile: z.string(),
  variant: z.enum([
    "wrong-block",
    "wrong-value",
    "valid",
    "missing-proof",
    "rate-limit",
    "timeout",
    "unsupported",
    "bad-signature",
    "wrong-account",
    "wrong-request",
    "wrong-chain",
    "expired",
    "missing-header",
    "missing-field",
    "corrupt-proof",
    "truncated-proof",
    "unsigned",
    "post-sign-tamper",
    "invalid-json",
    "oversized-response",
    "repair-after-first",
  ]),
  testFaults: z.boolean().default(false),
  delayMs: z.number().int().min(0).max(10000).default(0),
});
export type DemoConfig = z.infer<typeof ConfigSchema>;
export function load_demo_config(file: string): DemoConfig {
  const config = ConfigSchema.parse(
    parse_json_strict(readFileSync(file, "utf8")),
  );
  const base = dirname(resolve(file));
  return {
    ...config,
    privateKeyFile: resolve(base, config.privateKeyFile),
    dataDir: resolve(base, config.dataDir),
    fixtureFile: resolve(base, config.fixtureFile),
    alternateFixtureFile: resolve(base, config.alternateFixtureFile),
  };
}
async function body(req: IncomingMessage): Promise<unknown> {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new Error("JSON_REQUIRED");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const c of req) {
    bytes += c.length;
    if (bytes > 256 * 1024) throw new Error("BODY_LIMIT");
    chunks.push(c);
  }
  return parse_json_strict(Buffer.concat(chunks).toString("utf8"));
}
function send(res: ServerResponse, code: number, data: unknown) {
  res.writeHead(code, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data));
}
export function start_demo(configInput: DemoConfig, launchId = "foreground") {
  const config = ConfigSchema.parse(configInput);
  if (
    !["wrong-block", "wrong-value", "valid"].includes(config.variant) &&
    !config.testFaults
  )
    throw new Error("Additional fault modes require explicit testFaults=true");
  const primary = JSON.parse(readFileSync(config.fixtureFile, "utf8"));
  const alternate = JSON.parse(
    readFileSync(config.alternateFixtureFile, "utf8"),
  );
  HeaderSchema.parse(primary.header);
  HeaderSchema.parse(alternate.header);
  const privateKey = readFileSync(config.privateKeyFile, "utf8").trim();
  if (!/^0x[0-9a-f]{64}$/.test(privateKey))
    throw new Error("Invalid local demo key");
  const signer = privateKeyToAccount(privateKey as `0x${string}`);
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(resolve(config.dataDir, "deliveries.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS deliveries(request_id TEXT PRIMARY KEY, digest TEXT NOT NULL, body TEXT);",
  );
  const pending = new Map<string, Promise<DeliveryEnvelope>>();
  let received = 0;
  const capabilities: Capabilities = {
    dataChainIds: ["1"],
    blockHashes: [primary.header.hash],
    accounts: primary.accounts.map((a: { address: string }) => a.address),
    fields: ["balance", "nonce", "codeHash", "storageRoot"],
    proof: "SUPPORTED",
    signature: "SUPPORTED",
    methods: ["deliver"],
  };
  const source = config.variant === "valid" ? "FROZEN" : "FAULT_INJECTION";
  async function deliver(task: TaskSpec): Promise<DeliveryEnvelope> {
    if (config.delayMs) await new Promise((r) => setTimeout(r, config.delayMs));
    const chosen = config.variant === "wrong-block" ? alternate : primary;
    let record = chosen.accounts.find(
      (a: { address: string }) => a.address === task.account,
    );
    const supported =
      task.dataChainId === "1" &&
      task.blockHash === primary.header.hash &&
      record &&
      config.variant !== "unsupported";
    if (config.variant === "wrong-account")
      record = primary.accounts.find(
        (a: { address: string }) => a.address !== task.account,
      );
    const now = String(Math.floor(Date.now() / 1000));
    const d = DeliveryEnvelopeSchema.parse({
      schemaVersion: "1.0.0",
      serviceId: config.serviceId,
      serviceVersion: config.version,
      requestHash: request_digest(task),
      dataChainId: task.dataChainId,
      blockHash: supported ? chosen.header.hash : task.blockHash,
      identityChainId: "1",
      deliveryStatus: supported ? "delivered" : "unsupported",
      issuedAt: now,
      expiresAt: task.validity.expiresAt,
      response: supported
        ? {
            dataChainId: "1",
            account:
              config.variant === "wrong-account"
                ? record.address
                : task.account,
            blockHash: chosen.header.hash,
            header: HeaderSchema.parse(chosen.header),
            accountProof: record.proof.accountProof,
            values: {
              balance: BigInt(record.proof.balance).toString(),
              nonce: BigInt(record.proof.nonce).toString(),
              codeHash: record.proof.codeHash,
              storageRoot: record.proof.storageHash,
            },
          }
        : null,
    });
    const repairFault =
      config.variant === "repair-after-first" &&
      Number(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM deliveries WHERE body IS NOT NULL",
          )
          .get()!.n,
      ) === 0;
    if (d.response && (config.variant === "wrong-value" || repairFault))
      d.response.values.balance = (
        BigInt(d.response.values.balance!) + 1n
      ).toString();
    if (d.response && config.variant === "missing-proof")
      delete d.response.accountProof;
    if (d.response && config.variant === "missing-header")
      delete d.response.header;
    if (d.response && config.variant === "missing-field")
      delete d.response.values.balance;
    if (d.response && config.variant === "corrupt-proof")
      d.response.accountProof![0] = "0xc0";
    if (d.response && config.variant === "truncated-proof")
      d.response.accountProof = d.response.accountProof!.slice(0, 1);
    if (config.variant === "wrong-request")
      d.requestHash = "0x" + "11".repeat(32);
    if (config.variant === "wrong-chain") {
      d.dataChainId = "10";
      if (d.response) d.response.dataChainId = "10";
    }
    if (config.variant === "expired") {
      d.issuedAt = String(Number(now) - 60);
      d.expiresAt = String(Number(now) - 30);
    }
    d.signature = await signer.signTypedData(delivery_typed_data(d));
    if (config.variant === "unsigned") delete d.signature;
    if (d.response && config.variant === "post-sign-tamper")
      d.response.values.balance = (
        BigInt(d.response.values.balance!) + 1n
      ).toString();
    if (config.variant === "bad-signature")
      d.signature = "0x" + "00".repeat(65);
    db.prepare("UPDATE deliveries SET body=? WHERE request_id=?").run(
      canonical_json(d),
      task.requestId,
    );
    return d;
  }
  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        send(res, 200, {
          serviceId: config.serviceId,
          version: config.version,
          launchId,
          source,
          received,
          generated: Number(
            (
              db
                .prepare(
                  "SELECT COUNT(*) AS n FROM deliveries WHERE body IS NOT NULL",
                )
                .get() as { n: number }
            ).n,
          ),
        });
        return;
      }
      if (req.method === "GET" && req.url === "/capabilities") {
        send(res, 200, {
          serviceId: config.serviceId,
          version: config.version,
          source,
          capabilities,
        });
        return;
      }
      if (req.method !== "POST" || req.url !== "/deliver") {
        send(res, 404, { error: "NOT_FOUND" });
        return;
      }
      const task = TaskSpecSchema.parse(await body(req));
      received++;
      if (config.variant === "invalid-json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"deliveryStatus":"delivered","deliveryStatus":"rejected"}');
        return;
      }
      if (config.variant === "oversized-response") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ testPayload: "x".repeat(2 * 1024 * 1024 + 1) }),
        );
        return;
      }
      if (config.variant === "rate-limit") {
        res.setHeader("retry-after", "1");
        send(res, 429, { error: "TEST_RATE_LIMIT" });
        return;
      }
      if (config.variant === "timeout") {
        await new Promise((r) => setTimeout(r, config.delayMs || 2000));
        send(res, 503, { error: "TEST_TIMEOUT" });
        return;
      }
      const hash = request_digest(task);
      const old = db
        .prepare("SELECT digest,body FROM deliveries WHERE request_id=?")
        .get(task.requestId) as
        | { digest: string; body: string | null }
        | undefined;
      if (old) {
        if (old.digest !== hash) {
          send(res, 409, { error: "REQUEST_ID_CONFLICT" });
          return;
        }
        if (old.body) {
          send(res, 200, parse_json_strict(old.body));
          return;
        }
        const inFlight = pending.get(task.requestId);
        if (!inFlight) {
          send(res, 409, { error: "INCOMPLETE_PREVIOUS_DELIVERY" });
          return;
        }
        send(res, 200, await inFlight);
        return;
      }
      db.prepare("INSERT INTO deliveries(request_id,digest) VALUES(?,?)").run(
        task.requestId,
        hash,
      );
      const promise = deliver(task);
      pending.set(task.requestId, promise);
      try {
        send(res, 200, await promise);
      } finally {
        pending.delete(task.requestId);
      }
    } catch {
      if (!res.headersSent) send(res, 400, { error: "INVALID_REQUEST" });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 5000;
  const ready = new Promise<number>((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () =>
      resolveReady((server.address() as { port: number }).port),
    );
  });
  return {
    server,
    ready,
    capabilities,
    signer: signer.address.toLowerCase(),
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      await Promise.allSettled(pending.values());
      db.close();
    },
  };
}
