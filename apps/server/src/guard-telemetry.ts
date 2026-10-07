import { z } from "zod";
import { digest } from "@verdict/core";
import {
  createTypedSpanStarter,
  defineTelemetrySchema,
  InMemoryTelemetryContext,
} from "@earendil-works/pi-telemetry";
import type { GuardState } from "./guard.js";

// Vendor-neutral activity contract (FR-G02): Guard activities and decisions map onto
// pi-telemetry spans so third-party plugins can consume or supply the stream. Only digests
// and decision metadata leave the instance; raw arguments, prompts, and materials never do.
export const GUARD_TELEMETRY_SCHEMA = defineTelemetrySchema({
  version: 1,
  spans: {
    "verdict.guard.review": {
      description:
        "One Guard authorization review of a proposed agent action or imported external activity",
      parents: { kind: "any" },
      startAttributes: {
        "verdict.agent_id": {
          type: "string",
          required: true,
          description: "Guarded agent id",
        },
        "verdict.sequence": {
          type: "number",
          required: true,
          description: "Activity sequence within the guard task",
        },
        "verdict.action": {
          type: "string",
          required: true,
          description:
            "Proposed action name; imported external activities are prefixed with telemetry.",
        },
        "verdict.activity_source": {
          type: "string",
          required: true,
          values: ["ACTOR", "EXTERNAL"],
          description: "Who proposed the activity",
        },
      },
      endAttributes: {
        "verdict.verdict": {
          type: "string",
          description: "Decision verdict: ALLOW | BLOCK | UNCERTAIN",
        },
        "verdict.reason_code": {
          type: "string",
          description: "Short reason code; never free-text quotations",
        },
        "verdict.latency_ms": {
          type: "number",
          description: "Review latency in milliseconds",
        },
        "verdict.arguments_digest": {
          type: "string",
          description: "Digest of the proposed arguments; raw arguments never leave the instance",
        },
        "verdict.arguments_status": {
          type: "string",
          description: "Activity status: PENDING | BLOCKED | AUTHORIZED | EXECUTED",
        },
      },
      status: { default: "ok", errorWhen: "The proposed action was blocked" },
    },
  },
} as const);

export async function telemetryFromTask(agentId: string, state: GuardState) {
  const context = new InMemoryTelemetryContext();
  const startSpan = createTypedSpanStarter(context, [GUARD_TELEMETRY_SCHEMA]);
  for (const activity of state.activities) {
    const decision = state.decisions.find(
      (d) => d.sequence === activity.sequence,
    );
    const blocked =
      decision?.verdict === "BLOCK" || activity.status === "BLOCKED";
    await startSpan(
      "verdict.guard.review",
      {
        "verdict.agent_id": agentId,
        "verdict.sequence": activity.sequence,
        "verdict.action": activity.action,
        "verdict.activity_source": activity.source,
      },
      async (span) => {
        span.setAttributes({
          ...(decision
            ? {
                "verdict.verdict": decision.verdict,
                "verdict.reason_code": decision.reasonCode,
                "verdict.latency_ms": decision.latencyMs,
              }
            : {}),
          "verdict.arguments_digest": digest(activity.args),
          "verdict.arguments_status": activity.status,
        });
        if (blocked)
          span.setStatus({
            status: "error",
            error: {
              name: "GUARD_BLOCKED",
              message: decision?.reasonCode ?? "BLOCKED",
            },
          });
        return null;
      },
    );
  }
  return { schema: GUARD_TELEMETRY_SCHEMA, spans: context.getSpans() };
}

const flatAttributes = z.record(
  z.string().max(120),
  z.union([z.string().max(400), z.number().finite(), z.boolean()]),
);
const InboundSpanSchema = z.strictObject({
  name: z.string().regex(/^[a-zA-Z0-9_.-]{1,120}$/),
  attributes: flatAttributes.default({}),
  events: z
    .array(
      z.strictObject({
        name: z.string().regex(/^[a-zA-Z0-9_.-]{1,120}$/),
        attributes: flatAttributes.default({}),
      }),
    )
    .max(16)
    .default([]),
  status: z.enum(["ok", "error"]).optional(),
});
export const TelemetryImportSchema = z.strictObject({
  spans: z.array(InboundSpanSchema).min(1).max(200),
});
export type InboundTelemetrySpan = z.infer<typeof InboundSpanSchema>;

// Imported spans enter the ledger as EXTERNAL activity only. They never authorize an
// action, and the reviewer sees their digests and names, never attribute payloads.
export function parseTelemetryImport(raw: unknown): InboundTelemetrySpan[] {
  return TelemetryImportSchema.parse(raw).spans;
}
