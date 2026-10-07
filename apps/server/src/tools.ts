import { z } from "zod";
import { API_VERSION, AgentToolArguments, AgentToolCallSchema } from "@verdict/protocol";
import type { Engine } from "./engine.js";

const descriptions: Record<keyof typeof AgentToolArguments, string> = {
  describe_environment: "Read operator-configured task policies, pinned blocks and service capabilities. These are configuration, not independently verified consensus.",
  find_service: "Select configured candidates for this task using scoped evidence. Ranking never exempts the next delivery from acceptance.",
  verify_before_use: "Start deterministic acceptance and bounded fallback. Returns a runId, not accepted data. Poll get_run; use only SUCCEEDED with non-null accepted. STOPPED or ERROR must stop this data dependency. Retry the exact same requestId and arguments after an uncertain response.",
  get_run: "Read an acceptance run. Only SUCCEEDED with non-null accepted permits use of its accepted values. Do not use raw candidate or rejected response values.",
  download_evidence: "Download the complete evidence bundle and manifest after checking stored content integrity. Evidence cannot authorize its own trust context.",
  report_outcome: "Import a complete bundle and manifest under a local contextId. The server recomputes proof, signature and checks before indexing; this is not a self-reported rating or verdict.",
  replay_evidence: "Start independent re-verification of stored evidence under a configured context. Returns replayId; poll get_replay. COMPLETED alone never means PASS.",
  get_replay: "Read recomputed evidence checks, integrity and report consistency. A successful replay may confirm FAIL or UNVERIFIABLE. Historical replay does not authorize a new delivery.",
};

export const tool_catalog = Object.entries(AgentToolArguments).map(([name, schema]) => ({
  name,
  description: descriptions[name as keyof typeof AgentToolArguments],
  inputSchema: z.toJSONSchema(schema, { io: "input" }),
}));

export function describe_environment(engine: Engine) {
  const config = engine.config;
  return {
    apiVersion: API_VERSION,
    instanceId: config.instanceId,
    publicationAdapter: config.publicationAdapter,
    contexts: config.contexts.map((c) => ({
      contextId: c.contextId, ruleVersion: c.ruleVersion, policy: c.policy, trustedBlock: c.trustedBlock,
    })),
    capabilities: config.services.filter((s) => s.transport === "signed-http")
      .map((s) => ({ serviceId: s.serviceId, ...s.capabilities })),
  };
}

export async function call_tool(engine: Engine, raw: unknown): Promise<unknown> {
  const call = AgentToolCallSchema.parse(raw);
  switch (call.name) {
    case "describe_environment": return describe_environment(engine);
    case "find_service": return { apiVersion: API_VERSION, candidates: await engine.candidates(call.arguments) };
    case "verify_before_use": return engine.createRun(call.arguments);
    case "get_run": return engine.store.run(call.arguments.runId);
    case "download_evidence": {
      const { row, bundle } = engine.store.readEvidence(call.arguments.evidenceId);
      return { bundle, manifest: row.manifest };
    }
    case "report_outcome": return engine.importEvidence(call.arguments);
    case "replay_evidence": return { replayId: engine.createReplay(call.arguments.evidenceId, call.arguments.contextId) };
    case "get_replay": return engine.store.replay(call.arguments.replayId);
  }
}
