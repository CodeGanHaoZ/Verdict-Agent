import {
  Agent,
  type AgentTool,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import {
  createModels,
  createProvider,
  createAssistantMessageEventStream,
  type Model,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { Type } from "typebox";
import { z } from "zod";
import { type AgentError, type AgentUsage } from "@verdict/protocol";
import type { AgentConfig } from "./config.js";

export class AgentFailure extends Error {
  constructor(public reason: AgentError) {
    super(reason);
  }
}
export const emptyUsage = (): AgentUsage => ({
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: null,
});
export function businessTool(
  name: string,
  description: string,
  schema: z.ZodType,
  execute: (args: any, signal?: AbortSignal) => Promise<unknown>,
): AgentTool {
  return {
    name,
    label: name,
    description,
    parameters: Type.Unsafe(z.toJSONSchema(schema)),
    executionMode: "sequential",
    execute: async (_id, args, signal) => {
      const parsed = schema.safeParse(args);
      if (!parsed.success) throw new AgentFailure("TOOL_INVALID");
      const result = await execute(parsed.data, signal);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: {},
      };
    },
  };
}
export type PiCallbacks = {
  onRequest: () => void;
  onUsage: (message: AssistantMessage) => void;
  onText: (text: string) => void;
  onTool: (
    stage: "start" | "end",
    id: string,
    name: string,
    data: unknown,
  ) => void;
  beforeTool: () => void;
  terminal?: () => boolean;
};
export async function drivePi(
  config: AgentConfig,
  input: {
    system: string;
    prompt: string;
    tools: AgentTool[];
    maxRequests: number;
    maxToolCalls: number;
    signal: AbortSignal;
    callbacks: PiCallbacks;
  },
) {
  const models = createModels();
  const model: Model<"openai-completions"> = {
    id: config.modelId,
    name: config.modelId,
    api: "openai-completions",
    provider: "verdict-compatible",
    baseUrl: config.baseURL,
    reasoning: false,
    input: ["text"],
    contextWindow: config.contextWindow,
    maxTokens: config.outputTokens,
    cost: config.pricePerMillion ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
  };
  models.setProvider(
    createProvider({
      id: model.provider,
      models: [model],
      auth: {
        apiKey: {
          name: "Explicit Verdict environment key",
          resolve: async () => ({
            auth: { apiKey: process.env[config.apiKeyEnv] },
          }),
        },
      },
      api: openAICompletionsApi(),
    }),
  );
  let requests = 0,
    toolCalls = 0,
    reason: AgentError | null = null,
    requestTimer: ReturnType<typeof setTimeout> | undefined;
  const fail = (value: AgentError) => {
    reason ??= value;
    agent.abort();
  };
  const streamFn: StreamFn = (m, ctx, options) => {
    clearTimeout(requestTimer);
    if (input.signal.aborted) {
      fail("CANCELLED");
    }
    if (++requests > input.maxRequests) {
      fail("MODEL_LIMIT");
    }
    if (JSON.stringify(ctx).length > config.maxInputChars) fail("MODEL_LIMIT");
    if (reason) {
      const stream = createAssistantMessageEventStream();
      stream.push({
        type: "error",
        reason: "error",
        error: {
          role: "assistant",
          content: [],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: "error",
          errorMessage: reason,
          timestamp: Date.now(),
        },
      });
      return stream;
    }
    input.callbacks.onRequest();
    requestTimer = setTimeout(
      () => fail("MODEL_TIMEOUT"),
      config.requestTimeoutMs,
    );
    return models.streamSimple(m, ctx, {
      ...options,
      fetch: async (url, init) => {
        const response = await fetch(url, { ...init, redirect: "error" });
        if (response.status === 429) reason ??= "MODEL_RATE_LIMITED";
        else if (response.status >= 400) reason ??= "MODEL_ERROR";
        return response;
      },
      maxRetries: 0,
      maxRetryDelayMs: 1,
      timeoutMs: config.requestTimeoutMs,
      maxTokens: config.outputTokens,
      cacheRetention: "none",
      transport: "sse",
      onResponse: ({ status }) => {
        if (status === 429) fail("MODEL_RATE_LIMITED");
        else if (status >= 400) fail("MODEL_ERROR");
      },
    });
  };
  const agent = new Agent({
    initialState: {
      model,
      systemPrompt: input.system,
      tools: input.tools,
      thinkingLevel: "off",
    },
    streamFn,
    toolExecution: "sequential",
    beforeToolCall: async () => {
      if (reason || input.signal.aborted)
        return { block: true, reason: reason ?? "CANCELLED", terminate: true };
      try {
        input.callbacks.beforeTool();
      } catch (e) {
        fail(e instanceof AgentFailure ? e.reason : "TOOL_INVALID");
        return { block: true, reason: reason!, terminate: true };
      }
      if (++toolCalls > input.maxToolCalls) {
        fail("TOOL_LIMIT");
        return { block: true, reason: "TOOL_LIMIT", terminate: true };
      }
    },
    finishTurn: () =>
      reason || input.callbacks.terminal?.() ? { action: "end" } : undefined,
  });
  agent.subscribe((event) => {
    if (event.type === "message_end" && event.message.role === "assistant") {
      clearTimeout(requestTimer);
      const message = event.message;
      input.callbacks.onUsage(message);
      const text = message.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      if (text) input.callbacks.onText(text.slice(0, 6000));
      if (message.stopReason === "error" || message.stopReason === "aborted")
        reason ??= input.signal.aborted ? "CANCELLED" : "MODEL_ERROR";
    }
    if (event.type === "tool_execution_start")
      input.callbacks.onTool("start", event.toolCallId, event.toolName, {
        arguments:
          event.args && typeof event.args === "object"
            ? Object.fromEntries(
                Object.entries(event.args)
                  .filter(
                    ([key, value]) =>
                      ["serviceId", "evidenceId", "targetId"].includes(key) &&
                      typeof value === "string",
                  )
                  .map(([key, value]) => [key, String(value).slice(0, 160)]),
              )
            : {},
      });
    if (event.type === "tool_execution_end") {
      // Only sanitized business-tool output is persisted. PI parser errors may contain attacker-supplied arguments.
      if (event.isError) {
        reason ??= "TOOL_INVALID";
        input.callbacks.onTool("end", event.toolCallId, event.toolName, {
          error: "TOOL_INVALID",
        });
        agent.abort();
      } else
        input.callbacks.onTool(
          "end",
          event.toolCallId,
          event.toolName,
          event.result.content,
        );
    }
  });
  const abort = () => fail("CANCELLED");
  input.signal.addEventListener("abort", abort, { once: true });
  try {
    if (input.signal.aborted) throw new AgentFailure("CANCELLED");
    await agent.prompt(input.prompt);
    await agent.waitForIdle();
    if (reason) throw new AgentFailure(reason);
  } finally {
    clearTimeout(requestTimer);
    input.signal.removeEventListener("abort", abort);
  }
}
export function addUsage(
  usage: AgentUsage,
  message: AssistantMessage,
  config: AgentConfig,
) {
  const u = message.usage;
  usage.inputTokens += u.input;
  usage.outputTokens += u.output;
  usage.cacheReadTokens += u.cacheRead;
  usage.cacheWriteTokens += u.cacheWrite;
  const p = config.pricePerMillion;
  usage.costUsd = p
    ? (usage.inputTokens * p.input +
        usage.outputTokens * p.output +
        usage.cacheReadTokens * p.cacheRead +
        usage.cacheWriteTokens * p.cacheWrite) /
      1e6
    : null;
}
