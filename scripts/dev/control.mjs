import { spawn } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
const root = process.cwd(),
  base = resolve(root, ".local/b-demo"),
  registry = resolve(base, "processes.json");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function owned(entry) {
  try {
    const args = readFileSync(`/proc/${entry.pid}/cmdline`, "utf8").split("\0");
    return (
      args.includes(entry.launchId) &&
      args.includes(entry.file) &&
      args.includes("--launch-id")
    );
  } catch {
    return false;
  }
}
async function stop(entries) {
  for (const e of entries) if (owned(e)) process.kill(e.pid, "SIGTERM");
  for (let i = 0; i < 100 && entries.some(owned); i++) await wait(100);
  for (const e of entries) if (owned(e)) process.kill(e.pid, "SIGKILL");
}
if (process.argv[2] === "stop") {
  const entries = existsSync(registry)
    ? JSON.parse(readFileSync(registry, "utf8"))
    : [];
  await stop(entries);
  if (existsSync(registry)) unlinkSync(registry);
  console.log("Stopped owned B demo processes; keys and data preserved.");
} else if (process.argv[2] === "start") {
  if (
    existsSync(registry) &&
    JSON.parse(readFileSync(registry, "utf8")).some(owned)
  )
    throw new Error(
      "B processes are already running. Use npm run dev:stop first.",
    );
  const entries = [];
  mkdirSync(base, { recursive: true });
  const names = [
    "demo-wrong-block",
    "demo-wrong-value",
    "demo-valid",
    "local-one",
    "local-two",
  ];
  try {
    for (const name of names) {
      const config = resolve(base, name + ".json");
      if (!existsSync(config)) throw new Error("Run npm run dev:init first");
      const data = JSON.parse(readFileSync(config, "utf8"));
      const file = resolve(
        root,
        name.startsWith("demo-")
          ? "services/demo/dist/main.js"
          : "apps/server/dist/main.js",
      );
      const launchId = randomUUID();
      const log = openSync(resolve(base, name + ".log"), "a", 0o600);
      const noProxy = [
        process.env.NO_PROXY ?? process.env.no_proxy ?? "",
        "localhost",
        "127.0.0.1",
        "::1",
      ]
        .filter(Boolean)
        .join(",");
      const child = spawn(
        process.execPath,
        ["--use-env-proxy", file, "--config", config, "--launch-id", launchId],
        {
          cwd: root,
          detached: true,
          stdio: ["ignore", log, log],
          env: { ...process.env, NO_PROXY: noProxy, no_proxy: noProxy },
        },
      );
      closeSync(log);
      child.unref();
      const entry = { pid: child.pid, file, launchId, port: data.port, name };
      entries.push(entry);
      writeFileSync(registry, JSON.stringify(entries, null, 2), {
        mode: 0o600,
      });
      let ready = false;
      for (let i = 0; i < 60; i++) {
        await wait(100);
        try {
          const res = await fetch(`http://127.0.0.1:${data.port}/health`, {
            signal: AbortSignal.timeout(400),
          });
          const health = await res.json();
          if (health.launchId === launchId) {
            ready = true;
            break;
          }
        } catch {}
        if (!owned(entry)) break;
      }
      if (!ready)
        throw new Error(
          `${name} failed to start; inspect its .local/b-demo log`,
        );
    }
    console.log(
      "Three signed services: 14301–14303. Independent backends: http://127.0.0.1:3001 and http://127.0.0.1:3002",
    );
  } catch (e) {
    await stop(entries);
    if (existsSync(registry)) unlinkSync(registry);
    throw e;
  }
} else throw new Error("Usage: control.mjs start | stop");
