import { randomUUID } from "node:crypto";
import {
  parse_json_strict,
  type Observation,
  type ObservationOrigin,
  type MetricGroup,
  type VerificationResult,
} from "@verdict/protocol";

export class TransportError extends Error {
  constructor(
    public status: Observation["status"],
    public httpStatus: number | null = null,
    public rpcCode: number | null = null,
  ) {
    super(status);
  }
}
export async function fetch_json(
  url: string,
  options: {
    body: unknown;
    timeoutMs: number;
    signal?: AbortSignal;
    maxBytes?: number;
  },
): Promise<{ data: unknown; httpStatus: number }> {
  const signal = options.signal
    ? AbortSignal.any([
        options.signal,
        AbortSignal.timeout(Math.max(1, options.timeoutMs)),
      ])
    : AbortSignal.timeout(Math.max(1, options.timeoutMs));
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0",
      },
      body: JSON.stringify(options.body),
      redirect: "error",
      signal,
    });
    if (response.status === 429) {
      await response.body?.cancel();
      throw new TransportError("RATE_LIMITED", 429);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new TransportError("ERROR", response.status);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new TransportError("INVALID_RESPONSE", response.status);
    const chunks: Uint8Array[] = [];
    let size = 0;
    const limit = options.maxBytes ?? 2 * 1024 * 1024;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) {
          await reader.cancel();
          throw new TransportError("INVALID_RESPONSE", response.status);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    try {
      return {
        data: parse_json_strict(Buffer.concat(chunks).toString("utf8")),
        httpStatus: response.status,
      };
    } catch {
      throw new TransportError("INVALID_RESPONSE", response.status);
    }
  } catch (e) {
    if (e instanceof TransportError) throw e;
    if (signal.aborted) throw new TransportError("TIMEOUT");
    throw new TransportError("ERROR"); // Never expose URLs, credentials, or remote error text.
  }
}
export function observation(
  serviceId: string,
  method: string,
  source: Observation["source"],
  block: string | null,
  account: string | null,
): Observation {
  return {
    observationId: randomUUID(),
    serviceId,
    method,
    requestedBlock: block,
    account,
    source,
    recordedAt: new Date().toISOString(),
    status: "ERROR",
    capability: "UNKNOWN",
    latencyMs: 0,
    httpStatus: null,
    rpcCode: null,
    response: {},
    correctness: "NOT_CHECKED",
  };
}
export async function probe_rpc(input: {
  serviceId: string;
  endpoint: string;
  method: string;
  params: unknown[];
  block?: string;
  account?: string;
  timeoutMs: number;
  origin?: ObservationOrigin | null;
}): Promise<Observation> {
  const item = observation(
    input.serviceId,
    input.method,
    "LIVE",
    input.block ?? null,
    input.account ?? null,
  );
  const start = performance.now();
  if (input.origin) item.origin = input.origin;
  try {
    const { data, httpStatus } = await fetch_json(input.endpoint, {
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: input.method,
        params: input.params,
      },
      timeoutMs: input.timeoutMs,
    });
    item.httpStatus = httpStatus;
    const rpc = data as {
      id?: unknown;
      jsonrpc?: unknown;
      result?: unknown;
      error?: { code?: unknown; message?: unknown };
    } | null;
    if (!rpc || rpc.jsonrpc !== "2.0" || rpc.id !== 1)
      throw new TransportError("INVALID_RESPONSE", httpStatus);
    if (rpc.error) {
      const code = typeof rpc.error.code === "number" ? rpc.error.code : null;
      item.rpcCode = code;
      const message =
        typeof rpc.error.message === "string" ? rpc.error.message : "";
      if (
        code === -32601 ||
        /proof window|pruned|historical.*unavailable|missing trie node|not supported|unsupported/i.test(
          message,
        )
      ) {
        item.status = "UNSUPPORTED";
        item.capability = "UNSUPPORTED";
        item.response = {
          restriction:
            code === -32601
              ? "METHOD_UNSUPPORTED"
              : "REQUESTED_RANGE_OR_PARAMETER_UNSUPPORTED",
        };
      } else if (code === 429 || /rate limit|too many requests/i.test(message))
        item.status = "RATE_LIMITED";
      else item.status = "ERROR";
    } else {
      const result = rpc.result;
      if (input.method === "eth_chainId") {
        if (typeof result !== "string" || !/^0x[0-9a-f]+$/i.test(result))
          throw new TransportError("INVALID_RESPONSE", httpStatus);
        item.response = { chainId: BigInt(result).toString() };
      } else if (input.method === "eth_getBlockByNumber") {
        const block = result as Record<string, unknown> | null;
        if (
          !block ||
          typeof block.hash !== "string" ||
          !/^0x[0-9a-f]{64}$/i.test(block.hash) ||
          typeof block.number !== "string" ||
          !/^0x[0-9a-f]+$/i.test(block.number)
        )
          throw new TransportError("INVALID_RESPONSE", httpStatus);
        item.response = {
          blockHash: block.hash,
          blockNumber: BigInt(block.number).toString(),
        };
      } else if (input.method === "eth_getProof") {
        const proof = result as Record<string, unknown> | null;
        if (
          !proof ||
          !Array.isArray(proof.accountProof) ||
          typeof proof.address !== "string" ||
          !/^0x[0-9a-f]{40}$/i.test(proof.address)
        )
          throw new TransportError("INVALID_RESPONSE", httpStatus);
        item.response = {
          account: proof.address.toLowerCase(),
          proofNodes: proof.accountProof.length,
        };
        for (const key of ["balance", "nonce", "codeHash", "storageHash"]) {
          const value = proof[key];
          if (
            typeof value === "string" &&
            /^0x[0-9a-f]+$/i.test(value) &&
            value.length <= 66
          )
            item.response[key] = value;
        }
      } else throw new TransportError("INVALID_RESPONSE", httpStatus);
      item.status = "OK";
      item.capability = "SUPPORTED";
    }
  } catch (e) {
    const error = e instanceof TransportError ? e : new TransportError("ERROR");
    item.status = error.status;
    item.httpStatus = error.httpStatus;
  }
  item.latencyMs = Math.round((performance.now() - start) * 100) / 100;
  return item;
}
export function summarize(
  observations: Observation[],
  verdicts: {
    source: Observation["source"];
    block: string;
    verdict: VerificationResult["verdict"];
  }[],
  now = Date.now(),
): MetricGroup[] {
  const start = new Date(now - 86400000).toISOString(),
    end = new Date(now).toISOString();
  const groups = new Map<string, Observation[]>();
  for (const o of observations.filter(
    (o) => o.recordedAt >= start && o.recordedAt <= end,
  )) {
    const key = JSON.stringify([o.source, o.method, o.requestedBlock,
      o.origin?.observerId ?? null, o.origin?.region ?? null, o.origin?.networkProfile ?? null]);
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  return [...groups.values()].map((rows) => {
    const first = rows[0];
    const times = rows
      .filter((r) => r.httpStatus !== null)
      .map((r) => r.latencyMs)
      .sort((a, b) => a - b);
    const counts = { PASS: 0, FAIL: 0, UNVERIFIABLE: 0 };
    if (first.method === "deliver")
      for (const v of verdicts.filter(
        (v) => v.source === first.source && v.block === first.requestedBlock,
      ))
        counts[v.verdict]++;
    return {
      source: first.source,
      ...(first.origin ? { origin: first.origin } : {}),
      method: first.method,
      requestedBlock: first.requestedBlock,
      windowStart: start,
      windowEnd: end,
      sampleCount: rows.length,
      responses: rows.filter((r) => r.httpStatus !== null).length,
      errors: rows.filter((r) =>
        ["ERROR", "INVALID_RESPONSE"].includes(r.status),
      ).length,
      unsupported: rows.filter((r) => r.status === "UNSUPPORTED").length,
      rateLimited: rows.filter((r) => r.status === "RATE_LIMITED").length,
      timeouts: rows.filter((r) => r.status === "TIMEOUT").length,
      medianLatencyMs: times.length
        ? (times[Math.floor((times.length - 1) / 2)] +
            times[Math.floor(times.length / 2)]) /
          2
        : null,
      verdictCounts: counts,
    };
  });
}
