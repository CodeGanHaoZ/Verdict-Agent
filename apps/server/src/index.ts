import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { z } from "zod";
import {
  API_VERSION,
  CreateReplaySchema,
  CreateRunSchema,
  parse_json_strict,
} from "@verdict/protocol";
import { Engine } from "./engine.js";
import { AgentService } from "./agent-service.js";
import { ApiError } from "./store.js";
import { type ServerConfig } from "./config.js";
import { call_tool, describe_environment, tool_catalog } from "./tools.js";
export { Engine, reports_consistent } from "./engine.js";
export {
  load_server_config,
  ServerConfigSchema,
  trusted_context,
  type ServerConfig,
} from "./config.js";
export { ApiError } from "./store.js";

async function body(req: IncomingMessage): Promise<unknown> {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new ApiError(415, "JSON_REQUIRED");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new ApiError(413, "BODY_LIMIT");
    chunks.push(chunk);
  }
  try {
    return parse_json_strict(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "INVALID_JSON");
  }
}
function send(res: ServerResponse, code: number, data: unknown) {
  res.writeHead(code, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(data));
}
export function start_server(config: ServerConfig, launchId = "foreground") {
  const engine = new Engine(config);
  const agents = new AgentService(engine);
  let observationJob: Promise<unknown> | null = null;
  const server = createServer(async (req, res) => {
    try {
      const origin = req.headers.origin;
      // Loopback binding + host/origin checks keep browser-based DNS rebinding from submitting jobs.
      const host = req.headers.host?.split(":")[0];
      if (!host || !["localhost", "127.0.0.1"].includes(host))
        throw new ApiError(403, "HOST_NOT_ALLOWED");
      if (origin) {
        if (!engine.config.corsOrigins.includes(origin))
          throw new ApiError(403, "ORIGIN_NOT_ALLOWED");
        res.setHeader("access-control-allow-origin", origin);
        res.setHeader("vary", "origin");
      }
      if (req.method === "OPTIONS") {
        res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
        res.setHeader("access-control-allow-headers", "content-type");
        res.writeHead(204);
        res.end();
        return;
      }
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if(req.method==='POST' && path==='/api/guard/reports/import'){send(res,200,agents.reports.import(await body(req)));return;}
      if(req.method==='GET' && path==='/api/guard/reports'){send(res,200,agents.reports.list());return;}
      if(req.method==='GET' && path==='/api/guard/tasks'){send(res,200,agents.guardTasks());return;}
      if(req.method==='GET' && path==='/api/guard/rules'){send(res,200,agents.reports.rules());return;}
      const reportRoute=path.match(/^\/api\/guard\/reports\/(0x[0-9a-f]{64})(?:\/(candidate|replay))?$/);
      if(reportRoute && req.method==='GET' && !reportRoute[2]){send(res,200,agents.reports.get(reportRoute[1]));return;}
      if(reportRoute && req.method==='POST' && reportRoute[2]==='replay'){send(res,200,await agents.replayIncident(reportRoute[1],await body(req)));return;}
      if(reportRoute && req.method==='POST' && reportRoute[2]==='candidate'){send(res,200,agents.reports.candidate(reportRoute[1]));return;}
      const exportRoute=path.match(/^\/api\/guard\/tasks\/([\w-]+)\/decisions\/(\d+)\/export$/);
      if(req.method==='POST' && exportRoute){send(res,200,agents.exportIncident(exportRoute[1],Number(exportRoute[2]),await body(req)));return;}
      if(req.method==='GET' && exportRoute){send(res,200,agents.exportIncident(exportRoute[1],Number(exportRoute[2])));return;}
      const guardRoute=path.match(/^\/api\/guard\/tasks\/([\w-]+)$/);
      if(req.method==='GET' && guardRoute){send(res,200,agents.guard.state(guardRoute[1]));return;}
      const telemetryRoute=path.match(/^\/api\/guard\/tasks\/([\w-]+)\/telemetry(?:\/(import))?$/);
      if(req.method==='GET' && telemetryRoute && !telemetryRoute[2]){send(res,200,await agents.guardTelemetry(telemetryRoute[1]));return;}
      if(req.method==='POST' && telemetryRoute && telemetryRoute[2]==='import'){send(res,200,agents.guardTelemetryImport(telemetryRoute[1],await body(req)));return;}
      if (req.method === "GET" && path === "/api/agent/meta") {
        send(res, 200, agents.info());
        return;
      }
      if (req.method === "POST" && path === "/api/agent/runs") {
        send(res, 202, agents.createAgent(await body(req)));
        return;
      }
      if (req.method === "POST" && path === "/api/agent/drafts") {
        send(res, 202, agents.createDraft(await body(req)));
        return;
      }
      const draftRoute = path.match(
        /^\/api\/agent\/drafts\/([\w-]+)(?:\/(revise|confirm))?$/,
      );
      if (draftRoute) {
        const [, id, action] = draftRoute;
        if (req.method === "GET" && !action) {
          send(res, 200, agents.draft(id));
          return;
        }
        if (req.method === "POST" && action === "revise") {
          send(res, 200, agents.reviseDraft(id, await body(req)));
          return;
        }
        if (req.method === "POST" && action === "confirm") {
          send(res, 202, agents.confirmDraft(id, await body(req)));
          return;
        }
      }
      const agentRoute = path.match(
        /^\/api\/agent\/runs\/([\w-]+)(?:\/(events|stop))?$/,
      );
      if (agentRoute) {
        const [, id, action] = agentRoute;
        if (req.method === "GET" && !action) {
          send(res, 200, agents.store.agent(id));
          return;
        }
        if (req.method === "GET" && action === "events") {
          const after = Number(
            new URL(req.url!, "http://localhost").searchParams.get("after") ??
              0,
          );
          if (!Number.isSafeInteger(after) || after < 0)
            throw new ApiError(400, "INVALID_CURSOR");
          send(res, 200, { events: agents.store.events(id, after) });
          return;
        }
        if (req.method === "POST" && action === "stop") {
          z.strictObject({}).parse(await body(req));
          send(res, 200, agents.stop(id));
          return;
        }
      }
      if (req.method === "GET" && path === "/health") {
        send(res, 200, {
          instanceId: config.instanceId,
          apiVersion: API_VERSION,
          launchId,
        });
        return;
      }
      if (req.method === "GET" && path === "/api/meta") {
        send(res, 200, describe_environment(engine));
        return;
      }
      if (req.method === "GET" && path === "/api/tools") {
        send(res, 200, { apiVersion: API_VERSION, tools: tool_catalog });
        return;
      }
      if (req.method === "POST" && path === "/api/tools/call") {
        send(res, 200, { apiVersion: API_VERSION, result: await call_tool(engine, await body(req)) });
        return;
      }
      if (req.method === "GET" && path === "/api/services") {
        send(res, 200, {
          apiVersion: API_VERSION,
          candidates: await engine.candidates(),
        });
        return;
      }
      if (req.method === "POST" && path === "/api/selection") {
        send(res, 200, {
          apiVersion: API_VERSION,
          candidates: await engine.candidates(
            CreateRunSchema.parse(await body(req)),
          ),
        });
        return;
      }
      if (req.method === "POST" && path === "/api/runs") {
        send(res, 202, engine.createRun(await body(req)));
        return;
      }
      const run = path.match(/^\/api\/runs\/([\w-]+)$/);
      if (req.method === "GET" && run) {
        send(res, 200, engine.store.run(run[1]));
        return;
      }
      if (req.method === "POST" && path === "/api/evidence/import") {
        send(res, 200, await engine.importEvidence(await body(req)));
        return;
      }
      if (req.method === "GET" && path === "/api/evidence") {
        send(res, 200, {
          evidence: engine.store.evidenceRows().map((r) => ({
            evidenceId: r.id,
            contextId: r.contextId,
            createdAt: r.createdAt,
            publication: r.publication,
          })),
        });
        return;
      }
      const evidence = path.match(
        /^\/api\/evidence\/(0x[0-9a-f]{64})(?:\/(bundle|manifest))?$/,
      );
      if (req.method === "GET" && evidence) {
        const row = engine.store.evidenceRow(evidence[1]);
        if (evidence[2] === "manifest") {
          send(res, 200, row.manifest);
          return;
        }
        if (evidence[2] === "bundle") {
          const stored = engine.store.readEvidence(row.id);
          res.writeHead(200, {
            "content-type": "application/json",
            "content-disposition": `attachment; filename="${row.id}.json"`,
            "x-content-type-options": "nosniff",
          });
          res.end(stored.bytes);
          return;
        }
        let integrity = "VERIFIED";
        try {
          engine.store.readEvidence(row.id);
        } catch (e) {
          integrity =
            e instanceof ApiError && e.message === "ARTIFACT_MISMATCH"
              ? "MISMATCH"
              : "UNAVAILABLE";
        }
        send(res, 200, {
          evidenceId: row.id,
          manifest: row.manifest,
          artifactIntegrity: integrity,
          contextId: row.contextId,
          evaluatedAt: row.evaluatedAt,
          publication: row.publication,
          bundleUrl: `/api/evidence/${row.id}/bundle`,
          replays: engine.store
            .replays()
            .filter((r) => r.evidenceId === row.id),
        });
        return;
      }
      if (req.method === "POST" && path === "/api/replays") {
        const input = CreateReplaySchema.parse(await body(req));
        send(res, 202, {
          replayId: engine.createReplay(input.evidenceId, input.contextId),
        });
        return;
      }
      const replay = path.match(/^\/api\/replays\/([\w-]+)$/);
      if (req.method === "GET" && replay) {
        send(res, 200, engine.store.replay(replay[1]));
        return;
      }
      if (req.method === "GET" && path === "/api/observations") {
        send(res, 200, { observations: engine.store.observations() });
        return;
      }
      if (req.method === "POST" && path === "/api/observations") {
        z.strictObject({}).parse(await body(req));
        if (!observationJob)
          observationJob = engine.observeRpc().finally(() => {
            observationJob = null;
          });
        send(res, 200, { observations: await observationJob });
        return;
      }
      throw new ApiError(404, "NOT_FOUND");
    } catch (e) {
      if (!res.headersSent)
        send(
          res,
          e instanceof ApiError ? e.code : e instanceof z.ZodError ? 400 : 500,
          {
            error:
              e instanceof ApiError
                ? e.message
                : e instanceof z.ZodError
                  ? "INVALID_INPUT"
                  : "INTERNAL_ERROR",
          },
        );
      else res.end();
    }
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 15000;
  const ready = new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () =>
      resolve((server.address() as { port: number }).port),
    );
  });
  return {
    engine,
    agents,
    server,
    ready,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      await observationJob;
      await agents.close();
      await engine.close();
    },
  };
}
