import { resolve } from "node:path";
import { ServerConfigSchema } from "@verdict/server";
import { createLocalStack } from "./local-stack.mjs";
import { evaluateAgent } from "./evaluate-agent.mjs";
// Configuration is explicit; no credential discovery and no automatic live run in CI.
const agent = ServerConfigSchema.shape.agent.unwrap().parse({
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
  requestTimeoutMs: Number(process.env.VERDICT_PI_REQUEST_TIMEOUT_MS ?? 90000),
  firstEventTimeoutMs: Number(
    process.env.VERDICT_PI_FIRST_EVENT_TIMEOUT_MS ?? 60000,
  ),
  streamIdleTimeoutMs: Number(
    process.env.VERDICT_PI_STREAM_IDLE_TIMEOUT_MS ?? 15000,
  ),
});
if (!process.env[agent.apiKeyEnv])
  throw new Error("Configured model key environment variable is missing");
const stack = createLocalStack({ agent });
try {
  const { bases, serviceURLs } = await stack.start();
  const outputFile = resolve(stack.directory, "evaluation.json");
  console.log(
    JSON.stringify({
      event: "live-evaluation-start",
      directory: stack.directory,
      model: agent.modelId,
      suite: process.argv[2] ?? "smoke",
    }),
  );
  const result = await evaluateAgent(bases[0], {
    suite: process.argv[2] ?? "smoke",
    outputFile,
    serviceURLs,
  });
  console.log(
    JSON.stringify({
      event: "live-evaluation-end",
      passed: result.passed,
      outputFile,
    }),
  );
  if (!result.passed) process.exitCode = 1;
} finally {
  await stack.close();
}
