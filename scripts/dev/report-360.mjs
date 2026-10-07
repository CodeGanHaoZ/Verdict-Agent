import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const paths = process.argv.slice(2);
if (!paths.length) throw Error("Pass one or more 360 report.json paths");
const median = (xs) =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null;
const ratio = (n, d) => ({
  numerator: n,
  denominator: d,
  rate: d ? n / d : null,
});
const summaries = paths.map((path) => {
  const report = JSON.parse(readFileSync(path, "utf8")),
    rows = report.rows;
  const attempts = rows.flatMap((r) =>
    (r.attempts ?? []).map((a) => ({
      ...a,
      accepted: r.accepted?.evidenceId === a.evidenceId && !!a.evidenceId,
    })),
  );
  const bad = attempts.filter((a) => a.verdict === "FAIL"),
    unknown = attempts.filter((a) => a.verdict === "UNVERIFIABLE"),
    good = attempts.filter((a) => a.verdict === "PASS" && !a.runtimeReason);
  const fallback = rows.filter(
    (r) =>
      r.profile.scenario.fallback &&
      ["delivery", "transport"].includes(r.profile.scenario.category),
  );
  const usedFallback = fallback.filter((r) =>
    (r.attempts ?? []).some((a) => a.serviceId === r.profile.probeId),
  );
  return {
    path: resolve(path),
    mode: report.mode,
    caseHash: report.caseHash,
    total: rows.length,
    workflowCompletion: ratio(rows.filter((r) => r.passed).length, rows.length),
    invalidDeliveryBlocked: ratio(
      bad.filter((a) => !a.accepted).length,
      bad.length,
    ),
    insufficientEvidenceBlocked: ratio(
      unknown.filter((a) => !a.accepted).length,
      unknown.length,
    ),
    validDeliveryNotAdopted: ratio(
      good.filter((a) => !a.accepted).length,
      good.length,
    ),
    fallbackAfterExposure: ratio(
      usedFallback.filter((r) => r.runStatus === "SUCCEEDED").length,
      usedFallback.length,
    ),
    plannedFallbackCompleted: ratio(
      fallback.filter((r) => r.runStatus === "SUCCEEDED").length,
      fallback.length,
    ),
    noDelivery: rows.filter((r) => !r.attempts?.length).length,
    modelErrors: rows
      .filter((r) => r.modelError)
      .map((r) => ({ id: r.id, error: r.modelError })),
    failures: rows
      .filter((r) => !r.passed)
      .map((r) => ({ id: r.id, failure: r.failure })),
    medianWallMs: median(rows.map((r) => r.durationMs)),
    requests: rows.reduce((n, r) => n + (r.usage?.requests ?? 0), 0),
    inputTokens: rows.reduce((n, r) => n + (r.usage?.inputTokens ?? 0), 0),
    outputTokens: rows.reduce((n, r) => n + (r.usage?.outputTokens ?? 0), 0),
    cacheReadTokens: rows.reduce(
      (n, r) => n + (r.usage?.cacheReadTokens ?? 0),
      0,
    ),
    modelCostUsd: null,
  };
});
const output = resolve(".local/360-summary.json");
writeFileSync(
  output,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      notes: [
        "Conditional rates use only actually attempted deliveries, not unexercised faults.",
        "Completion includes model errors; safe stopping is not counted as successful workflow completion.",
        "Good controls share FAULT_INJECTION exercise labels; no claimed provider incident or global reliability rate.",
      ],
      summaries,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ output, summaries }, null, 2));
