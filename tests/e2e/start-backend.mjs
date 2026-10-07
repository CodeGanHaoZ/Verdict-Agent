// Browser tests use real PI, signer, proof and SQLite code with an explicitly scripted model transport.
import { harness } from "../integration/pi-harness.ts";
import { start_server } from "@verdict/server";
import { resolve } from "node:path";
const h = await harness({
  port: 3101,
  instanceId: "browser-one",
  corsOrigins: ["http://127.0.0.1:5174"],
});
const second = start_server({
  ...h.config,
  agent: undefined,
  instanceId: "browser-two",
  port: 3102,
  dataDir: resolve(h.config.dataDir, "../second"),
});
await second.ready;
console.log("Isolated browser backends ready; model source TEST_TRANSPORT");
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await second.close();
    await h.close();
    process.exit(0);
  });
