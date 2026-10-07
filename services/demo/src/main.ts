import { parseArgs } from "node:util";
import { load_demo_config, start_demo } from "./index.js";
const args = parseArgs({
  options: { config: { type: "string" }, "launch-id": { type: "string" } },
});
if (!args.values.config) throw new Error("--config is required");
const app = start_demo(
  load_demo_config(args.values.config),
  args.values["launch-id"],
);
console.log(JSON.stringify({ service: "demo", port: await app.ready }));
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (!closing) {
      closing = true;
      void app.close().then(() => process.exit(0));
    }
  });
