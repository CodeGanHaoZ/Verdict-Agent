import type { ModelRequestTiming } from "@verdict/protocol";
import type { AgentConfig } from "./config.js";

// Only timings and byte counts are retained; never response text, reasoning or headers.
export class ModelTiming {
  private start = performance.now();
  private firstTimer: ReturnType<typeof setTimeout>;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private totalTimer: ReturnType<typeof setTimeout>;
  private ended = false;
  readonly result: ModelRequestTiming;
  constructor(
    request: number,
    config: AgentConfig,
    private timeout: () => void,
    private publish: (result: ModelRequestTiming) => void,
  ) {
    this.result = {
      request,
      headersMs: null,
      firstByteMs: null,
      firstEventMs: null,
      firstOutputMs: null,
      totalMs: 0,
      bytesReceived: 0,
      chunksReceived: 0,
      httpStatus: null,
      timeoutStage: null,
      completion: "ERROR",
      stopReason: null,
      requestTimeoutMs: config.requestTimeoutMs,
      firstEventTimeoutMs: config.firstEventTimeoutMs,
      streamIdleTimeoutMs: config.streamIdleTimeoutMs,
    };
    this.totalTimer = setTimeout(
      () => this.expire("REQUEST_TOTAL"),
      config.requestTimeoutMs,
    );
    this.firstTimer = setTimeout(
      () => this.expire("FIRST_EVENT"),
      config.firstEventTimeoutMs,
    );
  }
  private elapsed() {
    return Math.round(performance.now() - this.start);
  }
  private expire(stage: NonNullable<ModelRequestTiming["timeoutStage"]>) {
    if (this.ended) return;
    this.result.timeoutStage = stage;
    this.finish("TIMEOUT");
    this.timeout();
  }
  headers(status: number) {
    if (!this.ended) {
      this.result.headersMs = this.elapsed();
      this.result.httpStatus = status;
    }
  }
  bytes(size: number) {
    if (this.ended) return;
    this.result.firstByteMs ??= this.elapsed();
    this.result.bytesReceived += size;
    this.result.chunksReceived++;
    // Transport activity is not proof of semantic progress. First-event and total
    // deadlines remain active even if a server sends only heartbeats.
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(
      () => this.expire("STREAM_IDLE"),
      this.result.streamIdleTimeoutMs,
    );
  }
  event(kind: string) {
    if (
      this.ended ||
      ![
        "text_delta",
        "thinking_delta",
        "toolcall_delta",
        "toolcall_end",
      ].includes(kind)
    )
      return;
    this.result.firstEventMs ??= this.elapsed();
    clearTimeout(this.firstTimer);
    if (kind !== "thinking_delta") this.result.firstOutputMs ??= this.elapsed();
  }
  finish(
    completion: ModelRequestTiming["completion"],
    stopReason: string | null = null,
  ) {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.firstTimer);
    clearTimeout(this.idleTimer);
    clearTimeout(this.totalTimer);
    this.result.totalMs = this.elapsed();
    this.result.completion = completion;
    this.result.stopReason = stopReason;
    this.publish({ ...this.result });
  }
}
