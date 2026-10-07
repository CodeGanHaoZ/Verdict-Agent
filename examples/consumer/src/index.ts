import {
  CreateRunSchema,
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
