// Explicit operator configuration, never discovers credentials from other applications.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const file = resolve(process.argv[2] ?? ".local/b-demo/local-one.json");
const baseURL = process.env.VERDICT_PI_BASE_URL,
  modelId = process.env.VERDICT_PI_MODEL,
  apiKeyEnv = process.env.VERDICT_PI_KEY_ENV ?? "VERDICT_PI_API_KEY";
if (!baseURL || !modelId)
  throw new Error(
    "Set VERDICT_PI_BASE_URL and VERDICT_PI_MODEL, optionally VERDICT_PI_KEY_ENV. No key values are written.",
  );
const u = new URL(baseURL);
if (
  u.username ||
  u.password ||
  u.search ||
  u.hash ||
  !(
    u.protocol === "https:" ||
    (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))
  )
)
  throw new Error("Invalid model endpoint");
if (!/^[A-Z_][A-Z0-9_]*$/.test(apiKeyEnv))
  throw new Error("Invalid key environment variable name");
const config = JSON.parse(readFileSync(file, "utf8"));
const compatibility = process.env.VERDICT_PI_COMPAT ?? "openai";
if (!["openai", "glm"].includes(compatibility))
  throw new Error("VERDICT_PI_COMPAT must be openai or glm");
const outputTokens = Number(process.env.VERDICT_PI_OUTPUT_TOKENS ?? 1024);
if (!Number.isInteger(outputTokens) || outputTokens < 64 || outputTokens > 8192)
  throw new Error("VERDICT_PI_OUTPUT_TOKENS must be 64..8192");
const timeouts = {
  requestTimeoutMs: Number(process.env.VERDICT_PI_REQUEST_TIMEOUT_MS ?? 90000),
  firstEventTimeoutMs: Number(
    process.env.VERDICT_PI_FIRST_EVENT_TIMEOUT_MS ?? 60000,
  ),
  streamIdleTimeoutMs: Number(
    process.env.VERDICT_PI_STREAM_IDLE_TIMEOUT_MS ?? 15000,
  ),
};
if (
  Object.values(timeouts).some(
    (n) => !Number.isInteger(n) || n < 1 || n > 120000,
  )
)
  throw new Error("Model timeouts must be 1..120000 ms");
const maxInputChars = Number(
  process.env.VERDICT_PI_MAX_INPUT_CHARS ??
    (compatibility === "glm" ? 64000 : 32000),
);
if (
  !Number.isInteger(maxInputChars) ||
  maxInputChars < 1000 ||
  maxInputChars > 64000
)
  throw new Error("VERDICT_PI_MAX_INPUT_CHARS must be 1000..64000");
config.agent = {
  maxInputChars,
  ...timeouts,
  baseURL,
  modelId,
  apiKeyEnv,
  compatibility,
  outputTokens,
  source: "LIVE",
  accountAliases: { weth: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" },
  replayTargets: [{ id: "local-two", baseURL: "http://127.0.0.1:3002" }],
};
writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
console.log(
  "PI profile saved. Export the configured key in the server process environment and restart. No credentials were printed or stored.",
);
