import { writeFileSync, mkdirSync } from "node:fs";
import { api } from "../../examples/consumer/dist/index.js";
const base = process.argv[2] ?? "http://127.0.0.1:3001";
const result = await api(base, "/api/observations", {});
mkdirSync(".local/b-demo", { recursive: true });
writeFileSync(
  ".local/b-demo/live-observations.json",
  JSON.stringify(result, null, 2),
);
for (const o of result.observations)
  console.log(
    JSON.stringify({
      service: o.serviceId,
      method: o.method,
      block: o.requestedBlock,
      status: o.status,
      capability: o.capability,
      httpStatus: o.httpStatus,
      rpcCode: o.rpcCode,
      latencyMs: o.latencyMs,
      response: o.response,
      source: o.source,
    }),
  );
