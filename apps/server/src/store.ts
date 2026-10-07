import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { digest } from "@verdict/core";
import {
  canonical_json,
  parse_json_strict,
  EvidenceBundleSchema,
  PublicationSchema,
  type EvidenceBundle,
  type EvidenceManifest,
  type Observation,
  type Publication,
  type RunSnapshot,
  type ReplaySnapshot,
} from "@verdict/protocol";

export class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}
export type EvidenceRow = {
  id: string;
  manifest: EvidenceManifest;
  contextId: string;
  evaluatedAt: string;
  createdAt: string;
  publication: Publication;
};
export class Store {
  readonly db: DatabaseSync;
  private writer: DatabaseSync;
  constructor(readonly dir: string) {
    mkdirSync(resolve(dir, "evidence"), { recursive: true, mode: 0o700 });
    // Hold an exclusive transaction on a separate lock database for this writer's lifetime.
    // SQLite releases it on process death; simultaneous recovery cannot steal a stale PID lock.
    this.writer = new DatabaseSync(resolve(dir, "writer.sqlite"));
    try {
      this.writer.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE");
    } catch {
      this.writer.close();
      throw new Error("Data directory already has an active writer");
    }
    try {
      this.db = new DatabaseSync(resolve(dir, "index.sqlite"));
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, input_hash TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS consumed(request_id TEXT PRIMARY KEY, run_id TEXT UNIQUE NOT NULL, evidence_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS observations(id TEXT PRIMARY KEY, service_id TEXT NOT NULL, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS replays(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      `);
      for (const row of this.db
        .prepare("SELECT body FROM runs WHERE status IN ('QUEUED','RUNNING')")
        .all() as { body: string }[]) {
        const run = JSON.parse(row.body) as RunSnapshot;
        run.status = "STOPPED";
        run.stopReason = "INTERRUPTED";
        run.finishedAt = new Date().toISOString();
        for (const attempt of run.attempts)
          if (attempt.status === "RUNNING") {
            attempt.status = "INTERRUPTED";
            attempt.runtimeReason = "INTERRUPTED";
            attempt.endedAt = run.finishedAt;
          }
        this.saveRun(run);
      }
      for (const replay of this.replays())
        if (["QUEUED", "RUNNING"].includes(replay.status))
          this.saveReplay({
            ...replay,
            status: "ERROR",
            error: "INTERRUPTED",
            finishedAt: new Date().toISOString(),
          });
      for (const row of this.evidenceRows()) {
        row.publication = PublicationSchema.parse(row.publication);
        this.saveEvidenceRow(row);
      }
      for (const row of this.evidenceRows())
        if (row.publication.status === "pending")
          this.saveEvidenceRow({
            ...row,
            publication: {
              ...row.publication,
              status: "failed",
              error: "INTERRUPTED",
            },
          });
    } catch (e) {
      this.writer.close();
      throw e;
    }
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  reserveRun(
    inputHash: string,
    run: RunSnapshot,
  ): { run: RunSnapshot; fresh: boolean } {
    return this.transaction(() => {
      const old = this.db
        .prepare("SELECT input_hash,body FROM runs WHERE request_id=?")
        .get(run.task.requestId) as
        | { input_hash: string; body: string }
        | undefined;
      if (old) {
        if (old.input_hash !== inputHash)
          throw new ApiError(409, "REQUEST_ID_CONFLICT");
        return { run: JSON.parse(old.body), fresh: false };
      }
      this.db
        .prepare("INSERT INTO runs VALUES(?,?,?,?,?)")
        .run(
          run.runId,
          run.task.requestId,
          inputHash,
          run.status,
          canonical_json(run),
        );
      return { run, fresh: true };
    });
  }
  run(id: string): RunSnapshot {
    const row = this.db.prepare("SELECT body FROM runs WHERE id=?").get(id) as
      | { body: string }
      | undefined;
    if (!row) throw new ApiError(404, "RUN_NOT_FOUND");
    return JSON.parse(row.body);
  }
  saveRun(run: RunSnapshot) {
    this.db
      .prepare("UPDATE runs SET status=?,body=? WHERE id=?")
      .run(run.status, canonical_json(run), run.runId);
  }
  claim(id: string): boolean {
    return this.transaction(() => {
      const run = this.run(id);
      if (run.status !== "QUEUED") return false;
      run.status = "RUNNING";
      run.startedAt = new Date().toISOString();
      this.saveRun(run);
      return true;
    });
  }
  consumed(requestId: string): boolean {
    return !!this.db
      .prepare("SELECT 1 FROM consumed WHERE request_id=?")
      .get(requestId);
  }
  adopt(run: RunSnapshot) {
    if (
      run.status !== "SUCCEEDED" ||
      !run.accepted ||
      run.attempts.at(-1)?.verification?.verdict !== "PASS" ||
      run.attempts.at(-1)?.runtimeReason
    )
      throw new Error("Invalid adoption");
    this.transaction(() => {
      if (this.run(run.runId).status !== "RUNNING")
        throw new Error("Run no longer active");
      this.db
        .prepare("INSERT INTO consumed VALUES(?,?,?)")
        .run(run.task.requestId, run.runId, run.accepted!.evidenceId);
      this.saveRun(run);
    });
  }
  localVerdicts(serviceId: string) {
    const output: {
      source: Observation["source"];
      block: string;
      verdict: EvidenceBundle["result"]["verdict"];
    }[] = [];
    const since = Date.now() - 86400000;
    for (const row of this.db
      .prepare("SELECT body FROM runs ORDER BY rowid DESC LIMIT 10000")
      .all() as { body: string }[]) {
      const run = JSON.parse(row.body) as RunSnapshot;
      for (const a of run.attempts)
        if (
          a.serviceId === serviceId &&
          a.verification &&
          Date.parse(a.endedAt) >= since
        )
          output.push({
            source: a.source,
            block: run.task.blockHash,
            verdict: a.verification.verdict,
          });
    }
    return output;
  }
  saveObservation(o: Observation) {
    this.db
      .prepare("INSERT INTO observations VALUES(?,?,?)")
      .run(o.observationId, o.serviceId, canonical_json(o));
  }
  observations(): Observation[] {
    return (
      this.db
        .prepare(
          "SELECT body FROM observations ORDER BY rowid DESC LIMIT 10000",
        )
        .all() as { body: string }[]
    ).map((r) => JSON.parse(r.body));
  }
  evidenceRows(): EvidenceRow[] {
    return (
      this.db
        .prepare("SELECT body FROM evidence ORDER BY rowid DESC LIMIT 10000")
        .all() as { body: string }[]
    ).map((r) => JSON.parse(r.body));
  }
  evidenceRow(id: string): EvidenceRow {
    const row = this.db
      .prepare("SELECT body FROM evidence WHERE id=?")
      .get(id) as { body: string } | undefined;
    if (!row) throw new ApiError(404, "EVIDENCE_NOT_FOUND");
    return JSON.parse(row.body);
  }
  saveEvidenceRow(row: EvidenceRow) {
    this.db
      .prepare(
        "INSERT INTO evidence VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(row.id, canonical_json(row));
  }
  saveEvidence(
    bundle: EvidenceBundle,
    manifest: EvidenceManifest,
    contextId: string,
    evaluatedAt: string,
  ): EvidenceRow {
    if (
      bundle.provenance.mode === "UI_MOCK" ||
      digest(bundle) !== manifest.evidenceHash
    )
      throw new Error("Invalid evidence");
    const id = manifest.evidenceHash;
    const existing = this.db
      .prepare("SELECT body FROM evidence WHERE id=?")
      .get(id) as { body: string } | undefined;
    if (existing) {
      this.readEvidence(id);
      return JSON.parse(existing.body);
    }
    const file = resolve(this.dir, "evidence", id + ".json");
    const bytes = canonical_json(bundle);
    try {
      writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (readFileSync(file, "utf8") !== bytes)
        throw new ApiError(422, "ARTIFACT_MISMATCH");
    }
    const row: EvidenceRow = {
      id,
      manifest: { ...manifest, bundleFile: id + ".json" },
      contextId,
      evaluatedAt,
      createdAt: new Date().toISOString(),
      publication: {
        status: "not_requested",
        adapter: "not_configured",
        attemptedAt: null,
        error: null,
        attemptId: null,
        attempts: 0,
      },
    };
    this.saveEvidenceRow(row);
    return row;
  }
  readEvidence(id: string): {
    row: EvidenceRow;
    bundle: EvidenceBundle;
    bytes: string;
  } {
    const row = this.evidenceRow(id);
    let bytes: string;
    try {
      bytes = readFileSync(
        resolve(this.dir, "evidence", row.id + ".json"),
        "utf8",
      );
    } catch {
      throw new ApiError(422, "EVIDENCE_UNAVAILABLE");
    }
    try {
      const bundle = EvidenceBundleSchema.parse(parse_json_strict(bytes));
      if (digest(bundle) !== row.id) throw new Error();
      return { row, bundle, bytes };
    } catch {
      throw new ApiError(422, "ARTIFACT_MISMATCH");
    }
  }
  saveReplay(r: ReplaySnapshot) {
    this.db
      .prepare(
        "INSERT INTO replays VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(r.replayId, canonical_json(r));
  }
  replays(): ReplaySnapshot[] {
    return (
      this.db.prepare("SELECT body FROM replays").all() as { body: string }[]
    ).map((r) => JSON.parse(r.body));
  }
  replay(id: string): ReplaySnapshot {
    const r = this.db.prepare("SELECT body FROM replays WHERE id=?").get(id) as
      | { body: string }
      | undefined;
    if (!r) throw new ApiError(404, "REPLAY_NOT_FOUND");
    return JSON.parse(r.body);
  }
  close() {
    this.db.close();
    this.writer.exec("ROLLBACK");
    this.writer.close();
  }
}
export const newId = () => randomUUID();
