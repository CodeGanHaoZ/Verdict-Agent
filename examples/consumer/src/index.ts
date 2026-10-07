import {
  CreateRunSchema,
  AgentToolCallSchema,
  type AgentToolCall,
  RunSnapshotSchema,
  type CreateRun,
  type RunSnapshot,
} from "@verdict/protocol";
export async function api(
  base: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const response = await fetch(new URL(path, base), {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(`API ${response.status}: ${JSON.stringify(value)}`);
  return value;
}

export async function call_tool(base: string, call: AgentToolCall): Promise<any> {
  const response = await api(base, "/api/tools/call", AgentToolCallSchema.parse(call));
  return response.result;
}

export class AcceptanceStopped extends Error {
  constructor(public readonly run: RunSnapshot) {
    super(`Acceptance stopped: ${run.stopReason ?? run.status}; runId=${run.runId}`);
    this.name = "AcceptanceStopped";
  }
}

// Fail closed: downstream business code receives only values accepted in this run.
export async function guard(base: string, raw: CreateRun): Promise<NonNullable<RunSnapshot["accepted"]>> {
  const input = CreateRunSchema.parse(raw);
  const { runId } = await call_tool(base, { name: "verify_before_use", arguments: input });
  const deadline = Date.now() + input.task.budget.timeoutMs + 10000;
  while (Date.now() < deadline) {
    const run = RunSnapshotSchema.parse(await call_tool(base, { name: "get_run", arguments: { runId } }));
    if (run.status === "SUCCEEDED" && run.accepted !== null) return run.accepted;
    if (["SUCCEEDED", "STOPPED", "ERROR"].includes(run.status)) throw new AcceptanceStopped(run);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Acceptance polling deadline exceeded; query runId=${runId} before resubmitting`);
}
export async function consume(
  base: string,
  input: CreateRun,
): Promise<RunSnapshot> {
  const { runId } = await api(base, "/api/runs", CreateRunSchema.parse(input));
  const deadline = Date.now() + input.task.budget.timeoutMs + 10000;
  while (Date.now() < deadline) {
    const run = RunSnapshotSchema.parse(await api(base, `/api/runs/${runId}`));
    if (["SUCCEEDED", "STOPPED", "ERROR"].includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    "Consumer polling deadline exceeded; query the same runId before submitting new work",
  );
}
