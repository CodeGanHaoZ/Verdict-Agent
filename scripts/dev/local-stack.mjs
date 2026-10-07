import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

export function createLocalStack({ agent } = {}) {
  // Foreground child handles, never a reused PID file or another user's running service.
  const root = process.cwd();
  const local = resolve(root, ".local");
  mkdirSync(local, { recursive: true });
  const directory = mkdtempSync(resolve(local, "verify-local-"));
  const children = [];
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function launch(file, args = [], modelAccess = false) {
    const env = {
      ...process.env,
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost",
    };
    if (!modelAccess) delete env[agent?.apiKeyEnv ?? "VERDICT_PI_API_KEY"];
    controller.signal.throwIfAborted();
    const child = spawn(
      process.execPath,
      [
        ...(modelAccess ? ["--use-env-proxy"] : []),
        resolve(root, file),
        ...args,
      ],
      {
        cwd: root,
        windowsHide: true,
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
        env,
        signal: controller.signal,
      },
    );
    const record = {
      child,
      stdout: "",
      stderr: "",
      port: null,
      done: false,
      failure: null,
    };
    let pending = "";
    child.stdout.on("data", (buffer) => {
      const text = buffer.toString();
      record.stdout = (record.stdout + text).slice(-65536);
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop().slice(-65536);
      for (const line of lines) {
        try {
          const value = JSON.parse(line);
          if (
            (value.event === "listening" || value.service === "demo") &&
            Number.isInteger(value.port)
          )
            record.port = value.port;
        } catch {
          /* Only the local program's structured listening record is relevant. */
        }
      }
    });
    child.stderr.on("data", (buffer) => {
      record.stderr = (record.stderr + buffer.toString()).slice(-16384);
    });
    record.exited = new Promise((resolveExit) => {
      child.on("error", (error) => {
        record.failure = error;
      });
      child.on("close", (code) => {
        record.done = true;
        resolveExit(code);
      });
    });
    children.push(record);
    return record;
  }

  async function command(file, args = []) {
    const record = launch(file, args);
    const code = await record.exited;
    if (record.failure || code !== 0)
      throw new Error(
        `Child command failed: ${file}\n${record.stderr}\n${record.stdout}`,
      );
    process.stdout.write(record.stdout);
  }

  async function service(file, name, config, modelAccess = false) {
    const configFile = resolve(directory, name + ".json");
    writeFileSync(
      configFile,
      JSON.stringify(
        { ...config, port: 0, dataDir: resolve(directory, name) },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    const launchId = randomUUID();
    const record = launch(
      file,
      ["--config", configFile, "--launch-id", launchId],
      modelAccess,
    );
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      controller.signal.throwIfAborted();
      if (record.done)
        throw new Error(`Service startup failed: ${name}\n${record.stderr}`);
      if (record.port) {
        const base = `http://127.0.0.1:${record.port}`;
        const response = await fetch(base + "/health", {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(2000),
          ]),
        });
        const health = await response.json();
        if (!response.ok || health.launchId !== launchId)
          throw new Error(`Service ownership check failed: ${name}`);
        return base;
      }
      await wait(25);
    }
    throw new Error(`Service startup timed out: ${name}`);
  }

  async function start() {
    await command("scripts/dev/setup.mjs", [directory]);
    const read = (name) =>
      JSON.parse(readFileSync(resolve(directory, name + ".json"), "utf8"));
    const endpoints = new Map();
    for (const name of ["demo-wrong-block", "demo-wrong-value", "demo-valid"])
      endpoints.set(
        name,
        (await service("services/demo/dist/main.js", name, read(name))) +
          "/deliver",
      );
    const byName = new Map();
    for (const name of ["local-two", "local-one"]) {
      const config = read(name);
      config.services = config.services.map((s) => ({
        ...s,
        endpoint: endpoints.get(s.serviceId) ?? s.endpoint,
      }));
      if (name === "local-one" && agent)
        config.agent = {
          ...agent,
          replayTargets: [
            { id: "local-two", baseURL: byName.get("local-two") },
          ],
        };
      byName.set(
        name,
        await service("apps/server/dist/main.js", name, config, !!config.agent),
      );
    }
    return {
      bases: [byName.get("local-one"), byName.get("local-two")],
      serviceURLs: [...endpoints.values()].map((url) =>
        url.replace(/\/deliver$/, ""),
      ),
    };
  }
  async function close() {
    for (const record of children)
      if (!record.done) record.child.kill("SIGTERM");
    await Promise.race([
      Promise.all(children.map((r) => r.exited)),
      wait(5000),
    ]);
    for (const record of children)
      if (!record.done) record.child.kill("SIGKILL");
    await Promise.all(children.map((r) => r.exited));
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
  return { start, close, command, directory };
}
