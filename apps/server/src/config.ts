import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import {
  CapabilitiesSchema,
  ObservationOriginSchema,
  DecimalSchema,
  ProvenanceModeSchema,
  VerificationContextSchema,
  parse_json_strict,
  type VerificationContext,
} from "@verdict/protocol";

const Endpoint = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["127.0.0.1", "localhost"].includes(url.hostname)))
    );
  }, "Only configured HTTPS or loopback HTTP endpoints without credentials are allowed");
export const AgentConfigSchema = z.strictObject({
  baseURL: Endpoint,
  modelId: z.string().min(1).max(160),
  apiKeyEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
  compatibility: z.enum(["openai", "glm"]).default("openai"),
  source: z.enum(["LIVE", "TEST_TRANSPORT"]).default("LIVE"),
  accountAliases: z
    .record(z.string(), z.string().regex(/^0x[0-9a-f]{40}$/))
    .default({}),
  draftRequests: z.number().int().min(1).max(2).default(2),
  runRequests: z.number().int().min(1).max(8).default(8),
  toolCalls: z.number().int().min(1).max(12).default(12),
  requestTimeoutMs: z.number().int().min(1).max(30000).default(30000),
  outputTokens: z.number().int().min(64).max(8192).default(1024),
  contextWindow: z.number().int().min(4096).max(200000).default(32768),
  maxInputChars: z.number().int().min(1000).max(64000).default(32000),
  maxAttempts: z.number().int().min(1).max(100).default(3),
  maxDurationMs: z.number().int().min(1).max(600000).default(180000),
  maxCostWei: DecimalSchema.default("0"),
  pricePerMillion: z
    .strictObject({
      input: z.number().nonnegative(),
      output: z.number().nonnegative(),
      cacheRead: z.number().nonnegative(),
      cacheWrite: z.number().nonnegative(),
    })
    .optional(),
  replayTargets: z
    .array(
      z.strictObject({ id: z.string().min(1).max(160), baseURL: Endpoint }),
    )
    .max(4)
    .default([]),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export const ServerConfigSchema = z.strictObject({
  agent: AgentConfigSchema.optional(),
  instanceId: z.string().regex(/^[\w.-]+$/),
  host: z.literal("127.0.0.1").default("127.0.0.1"),
  port: z.number().int().min(0).max(65535),
  dataDir: z.string(),
  rpcObservationOrigin: ObservationOriginSchema.nullable().default(null),
  corsOrigins: z
    .array(
      z
        .string()
        .url()
        .refine((s) =>
          ["localhost", "127.0.0.1"].includes(new URL(s).hostname),
        ),
    )
    .default(["http://localhost:5173"]),
  historyMaxAgeMs: z.number().int().min(1).max(2592000000).default(86400000),
  publicationAdapter: z
    .enum(["not_configured", "test_failure"])
    .default("not_configured"),
  contexts: z
    .array(
      VerificationContextSchema.omit({
        mode: true,
        evaluatedAt: true,
        timeSource: true,
        consumedRequestIds: true,
      }).extend({ historicalEvaluationTime: DecimalSchema.optional() }),
    )
    .min(1),
  services: z
    .array(
      z.strictObject({
        serviceId: z.string().min(1).max(160),
        version: z.string().min(1),
        endpoint: Endpoint,
        transport: z.enum(["signed-http", "rpc-observation"]),
        source: ProvenanceModeSchema.refine((v) => v !== "UI_MOCK"),
        capabilities: CapabilitiesSchema,
        quoteWei: DecimalSchema.nullable(),
        timeoutMs: z.number().int().min(1).max(30000),
      }),
    )
    .max(32),
});
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type ServiceConfig = ServerConfig["services"][number];
export function load_server_config(file: string): ServerConfig {
  const config = ServerConfigSchema.parse(
    parse_json_strict(readFileSync(file, "utf8")),
  );
  return {
    ...config,
    dataDir: resolve(dirname(resolve(file)), config.dataDir),
  };
}
export function trusted_context(
  config: ServerConfig,
  id: string,
  mode: "live" | "historical",
  localTime?: string,
  consumedRequestIds: string[] = [],
): VerificationContext {
  const profile = config.contexts.find((c) => c.contextId === id);
  if (!profile) throw new Error("CONTEXT_UNAVAILABLE");
  const { historicalEvaluationTime, ...accepted } = profile;
  return VerificationContextSchema.parse({
    ...accepted,
    mode,
    evaluatedAt:
      mode === "historical"
        ? (historicalEvaluationTime ??
          localTime ??
          String(Math.floor(Date.now() / 1000)))
        : String(Math.floor(Date.now() / 1000)),
    timeSource:
      mode === "historical" && (historicalEvaluationTime ?? localTime)
        ? "local operator policy / locally recorded verification time"
        : "local system clock",
    consumedRequestIds,
  });
}
