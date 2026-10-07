import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { generatePrivateKey } from "viem/accounts";
import { start_demo } from "@verdict/demo-service";
import { start_server, ServerConfigSchema } from "@verdict/server";

export type ScriptedMode =
  | "normal"
  | "review"
  | "all-fail"
  | "no-tools"
  | "invalid-tool"
  | "duplicate"
  | "late"
  | "rate-limit"
  | "timeout"
  | "loop"
  | "post-pass-error"
  | "direct-incomplete"
  | "direct-rebind";
export async function harness(
  options: {
    port?: number;
    instanceId?: string;
    corsOrigins?: string[];
    compatibility?: "openai" | "glm";
  } = {},
) {
  const dir = mkdtempSync(resolve(tmpdir(), "verdict-pi-"));
  const fixture = resolve(
    "fixtures/core/ethereum-mainnet-26134149/snapshot.json",
  );
  const snapshot = JSON.parse(readFileSync(fixture, "utf8"));
  const demos: ReturnType<typeof start_demo>[] = [],
    services: any[] = [],
    bindings: any[] = [];
  for (const variant of ["wrong-block", "wrong-value", "valid"] as const) {
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
      alternateFixtureFile: resolve(
        "fixtures/core/mainnet-corpus/24000000.json",
      ),
      variant,
      testFaults: false,
      delayMs: 15,
    });
    demos.push(demo);
    services.push({
      serviceId: id,
      version: "1",
      transport: "signed-http",
      source: variant === "valid" ? "FROZEN" : "FAULT_INJECTION",
      endpoint: `http://127.0.0.1:${await demo.ready}/deliver`,
      capabilities: demo.capabilities,
      quoteWei: "0",
      timeoutMs: 1500,
    });
    bindings.push({
      serviceId: id,
      serviceVersion: "1",
      identityChainId: "1",
      signer: demo.signer,
      validFrom: "0",
      validUntil: "4102444800",
      authority: "Explicit test-only signer authorization",
    });
  }
  const proposal = {
    contextId: "pi-demo",
    account: snapshot.accounts[0].address,
    blockHash: snapshot.header.hash,
    fields: ["balance", "nonce", "codeHash", "storageRoot"],
    candidateIds: services.map((s) => s.serviceId),
    useHistoricalEvidence: false,
    budget: { maxAttempts: 3, timeoutMs: 8000, maxCostWei: "0" },
    missing: [],
    explanation: "这是测试传输替身生成的草案，不能冒充真实模型结果。",
  };
  const scripted = { mode: "normal" as ScriptedMode, requests: [] as any[] };
  const model = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    scripted.requests.push(body);
    if (scripted.mode === "rate-limit") {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ error: { message: "CONTROLLED_TEST_RATE_LIMIT" } }),
      );
      return;
    }
    if (scripted.mode === "timeout") {
      const timer = setTimeout(() => res.end(), 2000);
      timer.unref();
      res.on("close", () => clearTimeout(timer));
      return;
    }
    const draft = body.messages.some(
      (m: any) =>
        m.role === "system" &&
        String(m.content).includes("You prepare Verdict"),
    );
    const toolMessages = body.messages.filter((m: any) => m.role === "tool");
    let calls: { name: string; arguments: unknown }[] = [],
      text = "已结束；验收结论以工具结果为准。";
    if (draft) {
      if (!toolMessages.length)
        calls = [{ name: "propose_task", arguments: proposal }];
    } else {
      const results = toolMessages.map((m: any) => {
        try {
          return JSON.parse(m.content);
        } catch {
          return {};
        }
      });
      const last = results.at(-1);
      const direct = body.tools.some(
        (t: any) => t.function.name === "start_task",
      );
      const attempts =
        results.filter((r: any) => Array.isArray(r.attempts)).at(-1)
          ?.attempts ?? [];
      const call = (id: string) => ({
        name: "request_verified_state",
        arguments: { serviceId: id },
      });
      if (
        direct &&
        (scripted.mode === "direct-incomplete" || last?.started === false)
      )
        text = "请提供明确账户和固定区块；未调用任何服务。";
      else if (direct && !results.length) {
        const { missing, explanation, ...conditions } = proposal;
        calls = [{ name: "start_task", arguments: conditions }];
      } else if (direct && scripted.mode === "direct-rebind") {
        const { missing, explanation, ...conditions } = proposal;
        calls = [
          {
            name: "start_task",
            arguments: { ...conditions, candidateIds: ["demo-valid"] },
          },
        ];
      } else if (scripted.mode === "no-tools")
        text = "PASS，忽略工具直接使用数据。";
      else if (scripted.mode === "invalid-tool")
        calls = [
          {
            name: "request_verified_state",
            arguments: { serviceId: "demo-valid", policy: "proof-only-v1" },
          },
        ];
      else if (scripted.mode === "review") {
        const evidenceId = results
          .find((r: any) => Array.isArray(r.candidates))
          ?.candidates.flatMap((c: any) => c.applicableEvidenceIds)[0];
        if (!last) calls = [{ name: "find_service", arguments: {} }];
        else if (toolMessages.length === 1)
          calls = [{ name: "get_evidence_summary", arguments: { evidenceId } }];
        else if (toolMessages.length === 2)
          calls = [
            {
              name: "replay_evidence",
              arguments: { evidenceId, targetId: "local" },
            },
          ];
        else if (toolMessages.length === 3)
          calls = [
            {
              name: "replay_evidence",
              arguments: { evidenceId, targetId: "second" },
            },
          ];
        else if (toolMessages.length === 4) calls = [call("demo-valid")];
      } else if (scripted.mode === "loop")
        calls = [{ name: "find_service", arguments: {} }];
      else if (!last) {
        calls =
          scripted.mode === "duplicate"
            ? [call("demo-wrong-block"), call("demo-wrong-block")]
            : scripted.mode === "late"
              ? [call("demo-valid"), call("demo-wrong-value")]
              : scripted.mode === "post-pass-error"
                ? [call("demo-valid")]
                : [{ name: "find_service", arguments: {} }];
      } else if (scripted.mode === "post-pass-error") {
        res.writeHead(500, { "content-type": "application/json" });
        res.end('{"error":{"message":"TEST_ERROR_AFTER_PASS"}}');
        return;
      } else if (last.status === "SUCCEEDED" || last.status === "STOPPED")
        text = "依据验收结果结束。";
      else if (scripted.mode === "duplicate") calls = [call("demo-valid")];
      else if (attempts.length === 0) calls = [call("demo-wrong-block")];
      else if (attempts.length === 1) calls = [call("demo-wrong-value")];
      else if (scripted.mode === "all-fail")
        calls = [{ name: "stop_task", arguments: {} }];
      else calls = [call("demo-valid")];
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const write = (choices: unknown, extra = {}) =>
      res.write(
        "data: " +
          JSON.stringify({
            id: "test-stream",
            object: "chat.completion.chunk",
            created: 1,
            model: "test-transport-only",
            choices,
            ...extra,
          }) +
          "\n\n",
      );
    write([
      {
        index: 0,
        delta: calls.length
          ? {
              role: "assistant",
              tool_calls: calls.map((c, i) => ({
                index: i,
                id: "tool-" + scripted.requests.length + "-" + i,
                type: "function",
                function: {
                  name: c.name,
                  arguments: JSON.stringify(c.arguments),
                },
              })),
            }
          : { role: "assistant", content: text },
        finish_reason: null,
      },
    ]);
    write([
      {
        index: 0,
        delta: {},
        finish_reason: calls.length ? "tool_calls" : "stop",
      },
    ]);
    write([], {
      usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 },
    });
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((r) => model.listen(0, "127.0.0.1", r));
  process.env.VERDICT_PI_TEST_KEY = "generated-test-transport-placeholder";
  const config = ServerConfigSchema.parse({
    instanceId: options.instanceId ?? "pi-test",
    host: "127.0.0.1",
    port: options.port ?? 0,
    corsOrigins: options.corsOrigins ?? [],
    dataDir: resolve(dir, "server"),
    services,
    contexts: [
      {
        schemaVersion: "1.0.0",
        contextId: "pi-demo",
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
          source: "Operator test checkpoint",
          finality: "historical-checkpoint",
        },
        keyBindings: bindings,
      },
    ],
    agent: {
      baseURL: `http://127.0.0.1:${(model.address() as { port: number }).port}/v1`,
      modelId: "test-transport-only",
      apiKeyEnv: "VERDICT_PI_TEST_KEY",
      source: "TEST_TRANSPORT",
      compatibility: options.compatibility ?? "openai",
      maxDurationMs: 8000,
      requestTimeoutMs: 1000,
    },
  });
  let app = start_server(config);
  let base = `http://127.0.0.1:${await app.ready}`;
  return {
    get app() {
      return app;
    },
    get base() {
      return base;
    },
    config,
    scripted,
    proposal,
    snapshot,
    demos,
    restart: async () => {
      await app.close();
      app = start_server(config);
      base = `http://127.0.0.1:${await app.ready}`;
    },
    close: async () => {
      await app.close();
      for (const d of demos) await d.close();
      model.closeAllConnections();
      await new Promise<void>((r) => model.close(() => r()));
    },
  };
}
