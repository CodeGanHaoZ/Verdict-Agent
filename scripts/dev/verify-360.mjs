import { mkdirSync, writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ServerConfigSchema } from "@verdict/server";
import { loadBlindCases } from "./agent-dataset.mjs";
import { evaluateBlind } from "./evaluate-blind.mjs";
const mode = process.argv[2] ?? "offline",
  filter = process.argv[3] ?? "all";
if (!["offline", "live"].includes(mode)) throw Error("Use offline or live");
let agent;
if (mode === "live") {
  agent = ServerConfigSchema.shape.agent.unwrap().parse({
    baseURL: process.env.VERDICT_PI_BASE_URL,
    modelId: process.env.VERDICT_PI_MODEL,
    apiKeyEnv: process.env.VERDICT_PI_KEY_ENV ?? "VERDICT_PI_API_KEY",
    compatibility: process.env.VERDICT_PI_COMPAT ?? "openai",
    outputTokens: Number(process.env.VERDICT_PI_OUTPUT_TOKENS ?? 1024),
    maxInputChars: Number(
      process.env.VERDICT_PI_MAX_INPUT_CHARS ??
        (process.env.VERDICT_PI_COMPAT === "glm" ? 64000 : 32000),
    ),
    source: "LIVE",
    requestTimeoutMs: Number(
      process.env.VERDICT_PI_REQUEST_TIMEOUT_MS ?? 90000,
    ),
    firstEventTimeoutMs: Number(
      process.env.VERDICT_PI_FIRST_EVENT_TIMEOUT_MS ?? 60000,
    ),
    streamIdleTimeoutMs: Number(
      process.env.VERDICT_PI_STREAM_IDLE_TIMEOUT_MS ?? 15000,
    ),
  });
  if (!process.env[agent.apiKeyEnv])
    throw Error("Configured key environment missing");
}
const { cases, caseHash, manifest } = loadBlindCases();
const selected =
  filter === "all" ? cases : cases.filter((c) => c.id === filter);
if (!selected.length) throw Error("Unknown case");
mkdirSync(".local", { recursive: true });
const directory = mkdtempSync(resolve(".local/360-report-"));
writeFileSync(
  resolve(directory, "blind-cases.json"),
  readFileSync(resolve("fixtures/agent", manifest.blindCaseFile)),
  { mode: 0o600 },
);
const report = {
  datasetVersion: manifest.datasetVersion,
  caseHash,
  mode: modelMode(),
  startedAt: new Date().toISOString(),
  rows: [],
};
function modelMode() {
  return mode === "live" ? "LIVE_PI" : "DETERMINISTIC_EXECUTOR";
}
const save = () =>
  writeFileSync(
    resolve(directory, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
console.log(
  JSON.stringify({
    event: "360-start",
    directory,
    mode: report.mode,
    cases: selected.length,
  }),
);
for (const c of selected)
  for (const seed of c.seeds) {
    const row = await evaluateBlind(c, { agent, seed });
    report.rows.push(row);
    save();
    console.log(
      JSON.stringify({
        case: c.id,
        seed,
        passed: row.passed,
        protected: row.protected,
        error: row.modelError,
        failure: row.failure,
        requests: row.usage?.requests,
        durationMs: row.durationMs,
      }),
    );
  }
report.finishedAt = new Date().toISOString();
report.passed = report.rows.every((r) => r.passed);
save();
console.log(
  JSON.stringify({
    event: "360-end",
    passed: report.passed,
    report: resolve(directory, "report.json"),
  }),
);
if (!report.passed) process.exitCode = 1;
