import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { api, consume } from "@verdict/consumer";
import { start_server, load_server_config } from "@verdict/server";
import { digest, request_digest } from "@verdict/core";
import { createLocalStack } from "./local-stack.mjs";
export async function boundaryAttacks() {
  const stack = createLocalStack();
  const rows = [];
  const check = async (id, goal, fn) => {
    const row = { id, goal, result: "INCONCLUSIVE" };
    try {
      row.observed = await fn();
      row.result = "RESISTED";
    } catch (e) {
      row.error = e.message;
      row.result = "FAILED_CHECK";
    }
    rows.push(row);
  };
  try {
    const { bases, serviceURLs } = await stack.start();
    const base = bases[0],
      second = bases[1],
      meta = await api(base, "/api/meta");
    const input = () => {
      const now = Math.floor(Date.now() / 1000);
      return {
        contextId: meta.contexts[0].contextId,
        candidateIds: ["demo-valid"],
        useHistoricalEvidence: false,
        task: {
          schemaVersion: "1.0.0",
          requestId: randomUUID(),
          dataChainId: "1",
          account: meta.capabilities[0].accounts[0],
          blockHash: meta.contexts[0].trustedBlock.blockHash,
          fields: ["balance", "nonce", "codeHash", "storageRoot"],
          evidencePolicyId: "signed-account-v1",
          validity: {
            notBefore: String(now - 5),
            expiresAt: String(now + 600),
          },
          budget: { maxAttempts: 3, timeoutMs: 5000, maxCostWei: "0" },
        },
      };
    };
    const failing = await consume(base, {
      ...input(),
      candidateIds: ["demo-wrong-value"],
    });
    const badId = failing.attempts[0].evidenceId;
    const bad = {
      bundle: await api(base, `/api/evidence/${badId}/bundle`),
      manifest: await api(base, `/api/evidence/${badId}/manifest`),
    };
    const good = await consume(base, input());
    const goodBundle = await api(
      base,
      `/api/evidence/${good.accepted.evidenceId}/bundle`,
    );
    const post = async (path, body, target = second, headers = {}) => {
      const r = await fetch(target + path, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
      return { status: r.status, value: await r.json() };
    };
    await check(
      "rehashed-fake-pass",
      "将已签名错误证据报告改成 PASS 并重新计算摘要",
      async () => {
        const p = structuredClone(bad);
        p.bundle.result.verdict = "PASS";
        p.manifest.evidenceHash = digest(p.bundle);
        const r = await post("/api/evidence/import", {
          ...p,
          contextId: input().contextId,
        });
        assert.equal(r.status, 422);
        return r;
      },
    );
    await check(
      "self-authorized-context",
      "证据导入夹带攻击者自授信任配置",
      async () => {
        const r = await post("/api/evidence/import", {
          ...bad,
          contextId: input().contextId,
          context: { policy: { requireSignature: false } },
        });
        assert.equal(r.status, 400);
        return r;
      },
    );
    await check(
      "untrusted-baseline",
      "重哈希后替换证据里的 stateRoot",
      async () => {
        const p = structuredClone(bad);
        p.bundle.baseline.stateRoot = "0x" + "11".repeat(32);
        p.manifest.evidenceHash = digest(p.bundle);
        const r = await post("/api/evidence/import", {
          ...p,
          contextId: input().contextId,
        });
        assert.equal(r.status, 422);
        return r;
      },
    );
    await check("duplicate-json-key", "重复 JSON 键混淆参数解析", async () => {
      const r = await post(
        "/api/tools/call",
        '{"name":"describe_environment","name":"publish","arguments":{}}',
      );
      assert.equal(r.status, 400);
      return r;
    });
    await check("browser-origin", "外部站点跨域提交任务", async () => {
      const r = await post("/api/runs", input(), base, {
        origin: "https://attacker.invalid",
      });
      assert.equal(r.status, 403);
      return r;
    });
    await check("dns-rebinding-host", "恶意 Host 指向 loopback", async () => {
      const r = await new Promise((resolve, reject) => {
        const q = httpRequest(
          base + "/api/runs",
          {
            method: "POST",
            headers: {
              host: "attacker.invalid",
              "content-type": "application/json",
            },
          },
          (res) => {
            let text = "";
            res.on("data", (c) => (text += c));
            res.on("end", () =>
              resolve({ status: res.statusCode, value: JSON.parse(text) }),
            );
          },
        );
        q.on("error", reject);
        q.end(JSON.stringify(input()));
      });
      assert.equal(r.status, 403);
      return r;
    });
    await check(
      "tool-name-escalation",
      "调用未授权 shell／发布工具",
      async () => {
        const r = await post("/api/tools/call", {
          name: "execute_shell",
          arguments: { command: "REDTEAM_NO_EXECUTION" },
        });
        assert.equal(r.status, 400);
        return r;
      },
    );
    await check(
      "manifest-path-traversal",
      "manifest.bundleFile 指向本地私有文件",
      async () => {
        const path = resolve(stack.directory, "private-canary.txt");
        const secret = "REDTEAM_PRIVATE_FILE_" + randomUUID();
        writeFileSync(path, secret, { mode: 0o600 });
        const p = structuredClone(bad);
        p.manifest.bundleFile = path;
        const r = await post("/api/evidence/import", {
          ...p,
          contextId: input().contextId,
        });
        assert.equal(r.status, 200);
        const downloaded = await api(second, `/api/evidence/${badId}/bundle`);
        assert.equal(digest(downloaded), badId);
        assert(!JSON.stringify(downloaded).includes(secret));
        return {
          importStatus: r.status,
          downloadDigest: badId,
          privateCanaryExposed: false,
        };
      },
    );
    await check(
      "concurrent-replay",
      "同一任务并发重复提交诱发多次服务副作用",
      async () => {
        const req = input();
        const before = await api(serviceURLs[2], "/health");
        const responses = await Promise.all(
          Array.from({ length: 8 }, () => api(base, "/api/runs", req)),
        );
        const finished = await consume(base, req);
        const after = await api(serviceURLs[2], "/health");
        assert.equal(new Set(responses.map((r) => r.runId)).size, 1);
        assert.equal(finished.attempts.length, 1);
        assert.equal(after.received - before.received, 1);
        return { requestCount: 8, runCount: 1, serviceCalls: 1 };
      },
    );
    await check(
      "evidence-vote-laundering",
      "修改无关描述制造多个证据哈希，企图放大同一反证权重",
      async () => {
        const query = {
          ...input(),
          candidateIds: ["demo-wrong-value", "demo-valid"],
          useHistoricalEvidence: true,
        };
        const before = await api(second, "/api/selection", query);
        for (let i = 0; i < 5; i++) {
          const p = structuredClone(bad);
          p.bundle.provenance.description = "REDTEAM_DUPLICATE_FORWARD_" + i;
          p.manifest.evidenceHash = digest(p.bundle);
          const r = await post("/api/evidence/import", {
            ...p,
            contextId: query.contextId,
          });
          assert.equal(r.status, 200);
        }
        const after = await api(second, "/api/selection", query);
        assert.equal(
          after.candidates.find((c) => c.serviceId === "demo-wrong-value")
            .applicableEvidenceIds.length,
          1,
        );
        assert.deepEqual(
          before.candidates.map((c) => c.serviceId),
          after.candidates.map((c) => c.serviceId),
        );
        return {
          forwardedHashes: 5,
          applicableFacts: 1,
          rankingUnchanged: true,
        };
      },
    );
    await check(
      "unknown-rule-downgrade",
      "把证据规则改成未实现版本，企图触发宽松默认规则",
      async () => {
        const p = structuredClone(bad);
        p.bundle.ruleVersion = "attacker-rule-v999";
        p.manifest.evidenceHash = digest(p.bundle);
        const r = await post("/api/evidence/import", {
          ...p,
          contextId: input().contextId,
        });
        assert.equal(r.status, 422);
        assert.equal(r.value.error, "RULE_UNSUPPORTED");
        return r;
      },
    );
    // Malicious delivery service is controlled locally; no external target is contacted.
    let body = structuredClone(goodBundle.delivery),
      redirect = false,
      stripSignature = false,
      sinkHits = 0;
    const sink = createServer((req, res) => {
      sinkHits++;
      res.end("redteam-local-canary");
    });
    await new Promise((r) => sink.listen(0, "127.0.0.1", r));
    const malicious = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const task = JSON.parse(Buffer.concat(chunks));
      if (redirect) {
        res.writeHead(302, {
          location: `http://127.0.0.1:${sink.address().port}/secret`,
        });
        res.end();
      } else {
        const output = structuredClone(body);
        if (stripSignature) {
          delete output.signature;
          output.requestHash = request_digest(task);
          output.issuedAt = String(Math.floor(Date.now() / 1000));
          output.expiresAt = task.validity.expiresAt;
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(output));
      }
    });
    await new Promise((r) => malicious.listen(0, "127.0.0.1", r));
    const config = load_server_config(
      resolve(stack.directory, "local-one.json"),
    );
    config.port = 0;
    config.dataDir = resolve(stack.directory, "malicious-delivery");
    config.services = config.services
      .filter((s) => s.serviceId === "demo-valid")
      .map((s) => ({
        ...s,
        endpoint: `http://127.0.0.1:${malicious.address().port}/deliver`,
      }));
    const target = start_server(config);
    const targetBase = `http://127.0.0.1:${await target.ready}`;
    try {
      await check(
        "signed-response-replay",
        "将另一请求的合法签名交付重放给当前任务",
        async () => {
          const r = await consume(targetBase, input());
          assert.equal(r.accepted, null);
          assert(
            r.attempts[0].verification.reasonCodes.includes("REQUEST_MISMATCH"),
          );
          return {
            status: r.status,
            reason: r.attempts[0].verification.reasonCodes,
          };
        },
      );
      await check(
        "signature-stripping",
        "删除重放交付中的签名企图降级归属要求",
        async () => {
          stripSignature = true;
          const r = await consume(targetBase, input());
          assert.equal(r.accepted, null);
          assert.equal(
            r.attempts[0].verification.attributionStatus,
            "UNSIGNED",
          );
          assert.equal(r.attempts[0].verification.dataVerdict, "PASS");
          assert.equal(r.attempts[0].verification.verdict, "UNVERIFIABLE");
          return {
            status: r.status,
            attribution: "UNSIGNED",
            dataVerdict: "PASS",
            verdict: "UNVERIFIABLE",
          };
        },
      );
      await check(
        "redirect-ssrf",
        "服务302重定向到未配置的本地敏感端点",
        async () => {
          redirect = true;
          const r = await consume(targetBase, input());
          assert.equal(r.accepted, null);
          assert.equal(sinkHits, 0);
          return {
            status: r.status,
            sinkHits,
            runtimeReason: r.attempts[0].runtimeReason,
          };
        },
      );
    } finally {
      await target.close();
      await new Promise((r) => malicious.close(r));
      await new Promise((r) => sink.close(r));
    }
  } finally {
    await stack.close();
  }
  const report = {
    mode: "REAL_LOCAL_HTTP_NO_MODEL",
    directory: stack.directory,
    rows,
    checkedAt: new Date().toISOString(),
  };
  writeFileSync(
    resolve(stack.directory, "redteam-boundaries.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  return report;
}
if (process.argv[1]?.endsWith("redteam-boundaries.mjs")) {
  const r = await boundaryAttacks();
  console.log(JSON.stringify(r, null, 2));
  if (r.rows.some((x) => x.result !== "RESISTED")) process.exitCode = 1;
}
