import { start_server, load_server_config } from "./index.js";
const arg = (name: string) => process.argv[process.argv.indexOf(name) + 1];
if (!process.argv.includes("--config"))
  throw new Error("Usage: server --config local-config.json");
const app = start_server(
  load_server_config(arg("--config")),
  process.argv.includes("--launch-id") ? arg("--launch-id") : "foreground",
);
console.log(JSON.stringify({ event: "listening", port: await app.ready }));
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void app.close().then(() => process.exit(0));
  });
