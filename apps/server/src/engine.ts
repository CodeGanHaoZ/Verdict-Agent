import { performance } from "node:perf_hooks";
import { digest, verify_delivery } from "@verdict/core";
import { build_evidence, fact_key, replay_evidence } from "@verdict/evidence";
import {
  fetch_json,
  observation,
  probe_rpc,
  summarize,
  TransportError,
} from "@verdict/observations";
import {
  API_VERSION,
  RULE_VERSION,
  SCHEMA_VERSION,
  canonical_json,
  CreateRunSchema,
  DeliveryEnvelopeSchema,
  ImportEvidenceSchema,
  type Attempt,
  type Candidate,
  type CreateRun,
  type EvidenceBundle,
  type EvidenceManifest,
  type ReplayResult,
  type ReplaySnapshot,
  type RunSnapshot,
  type RuntimeReason,
  type TaskSpec,
  type VerificationContext,
  type VerificationResult,
} from "@verdict/protocol";
import {
  ServerConfigSchema,
  trusted_context,
  type ServerConfig,
  type ServiceConfig,
} from "./config.js";
import { ApiError, newId, Store, type EvidenceRow } from "./store.js";

const iso = () => new Date().toISOString();
// Clock/mode descriptions may differ across independent contexts. All statuses, reasons,
// requirements, signature/proof results and non-time actuals must still agree.
export function reports_consistent(
  original: VerificationResult,
  recomputed: VerificationResult,
): boolean {
  const normalize = (result: VerificationResult) => ({
    ...result,
    checks: result.checks.map((c) =>
      ["request-validity", "delivery-validity", "request-replay"].includes(
        c.checkId,
      ) && c.status === "PASS"
        ? { ...c, actual: "<caller-context>" }
        : c,
    ),
  });
  return (
    canonical_json(normalize(original)) ===
    canonical_json(normalize(recomputed))
  );
}
export class Engine {
  readonly config: ServerConfig;
  readonly store: Store;
  private jobs = new Set<Promise<unknown>>();
  private shuttingDown = false;
  constructor(config: ServerConfig) {
    this.config = ServerConfigSchema.parse(config);
    for (const key of ["services", "contexts"] as const) {
      const ids = this.config[key].map((v) =>
        "serviceId" in v ? v.serviceId : v.contextId,
      );
      if (new Set(ids).size !== ids.length)
        throw new Error("Duplicate configuration IDs");
    }
    this.store = new Store(config.dataDir);
  }
  private schedule(job: Promise<unknown>) {
    this.jobs.add(job);
    void job.finally(() => this.jobs.delete(job)).catch(() => {});
  }
  context(id: string, mode: "live" | "historical", localTime?: string) {
    try {
      return trusted_context(this.config, id, mode, localTime);
    } catch {
      throw new ApiError(400, "CONTEXT_UNAVAILABLE");
    }
  }
  private validate(input: CreateRun) {
    this.context(input.contextId, "live");
    if (
      input.candidateIds &&
      (new Set(input.candidateIds).size !== input.candidateIds.length ||
        input.candidateIds.some(
          (id) => !this.config.services.some((s) => s.serviceId === id),
        ))
    )
      throw new ApiError(400, "INVALID_CANDIDATE_IDS");
  }
  async checked(
    bundle: EvidenceBundle,
    manifest: EvidenceManifest,
    context: VerificationContext,
  ): Promise<{ result: ReplayResult; consistent: boolean }> {
    const result = await replay_evidence(bundle, manifest, context);
    const consistent =
      result.artifactIntegrity === "VERIFIED" &&
      !!result.recomputedResult &&
      !["NOT_COMPARABLE", "MISMATCH"].includes(result.comparison) &&
      canonical_json(bundle.baseline) ===
        canonical_json(context.trustedBlock ?? null) &&
      reports_consistent(bundle.result, result.recomputedResult);
    return { result, consistent };
  }
  private sourceAccepted(bundle: EvidenceBundle): boolean {
    const service = this.config.services.find(
      (s) =>
        s.serviceId === bundle.delivery.serviceId &&
        s.version === bundle.delivery.serviceVersion,
    );
    return (
      !!service &&
      service.source === bundle.provenance.mode &&
      service.transport === "signed-http"
    );
  }
  async importEvidence(input: unknown) {
    const { bundle, manifest, contextId } = ImportEvidenceSchema.parse(input);
    const existing = this.store
      .evidenceRows()
      .find((r) => r.id === manifest.evidenceHash && r.contextId === contextId);
    const context = this.context(
      contextId,
      "historical",
      existing?.evaluatedAt,
    );
    const checked = await this.checked(bundle, manifest, context);
    if (!checked.consistent)
      throw new ApiError(
        422,
        checked.result.reasonCodes.includes("RULE_UNSUPPORTED")
          ? "RULE_UNSUPPORTED"
          : checked.result.artifactIntegrity === "MISMATCH"
            ? "ARTIFACT_MISMATCH"
            : bundle.provenance.mode === "UI_MOCK"
              ? "UI_MOCK_REJECTED"
              : "REPORT_OR_CONTEXT_MISMATCH",
      );
    if (!this.sourceAccepted(bundle))
      throw new ApiError(422, "SOURCE_NOT_ACCEPTED");
    const row = this.store.saveEvidence(
      bundle,
      manifest,
      contextId,
      context.evaluatedAt,
    );
    return { evidenceId: row.id, ...checked };
  }
  private async historical(
    task: TaskSpec,
    contextId: string,
    service: ServiceConfig,
  ): Promise<string[]> {
    const facts = new Map<string, string>();
    // Local acceptance age, not the untrusted provenance timestamp, bounds relevance.
    for (const row of this.store.evidenceRows().slice(0, 256)) {
      if (
        row.contextId !== contextId ||
        Date.now() - Date.parse(row.createdAt) > this.config.historyMaxAgeMs
      )
        continue;
      try {
        const { bundle } = this.store.readEvidence(row.id);
        const request = bundle.request;
        if (
          bundle.delivery.serviceId !== service.serviceId ||
          bundle.delivery.serviceVersion !== service.version ||
          !this.sourceAccepted(bundle) ||
          request.dataChainId !== task.dataChainId ||
          request.blockHash !== task.blockHash ||
          request.account !== task.account ||
          request.evidencePolicyId !== task.evidencePolicyId ||
          canonical_json([...request.fields].sort()) !==
            canonical_json([...task.fields].sort())
        )
          continue;
        const context = this.context(contextId, "historical", row.evaluatedAt);
        const checked = await this.checked(bundle, row.manifest, context);
        if (
          !checked.consistent ||
          !checked.result.recomputedResult?.attributableFailure
        )
          continue;
        // Current authorization still matters even when reproducing an older evaluation time.
        const now = BigInt(Math.floor(Date.now() / 1000));
        const signer = checked.result.recomputedResult.checks.find(
          (c) => c.checkId === "signature",
        )?.actual;
        if (
          !context.keyBindings.some(
            (k) =>
              k.serviceId === service.serviceId &&
              k.serviceVersion === service.version &&
              k.identityChainId === context.identityChainId &&
              k.signer === signer &&
              BigInt(k.validFrom) <= now &&
              now <= BigInt(k.validUntil) &&
              (k.revokedAt === undefined || now < BigInt(k.revokedAt)),
          )
        )
          continue;
        const key = await fact_key(bundle, context);
        if (!facts.has(key)) facts.set(key, row.id);
      } catch {
        /* Missing, modified, or newly unauthorized evidence cannot influence selection. */
      }
    }
    return [...facts.values()];
  }
  async candidates(input?: CreateRun): Promise<Candidate[]> {
    if (input) this.validate(input);
    const allObservations = this.store.observations();
    const candidates: Candidate[] = [];
    for (const service of this.config.services) {
      if (
        input?.candidateIds &&
        !input.candidateIds.includes(service.serviceId)
      )
        continue;
      const observed = allObservations.filter(
        (o) =>
          o.serviceId === service.serviceId &&
          (service.transport === "rpc-observation" ||
            o.response.serviceVersion === service.version),
      );
      const reasons: string[] = [];
      let eligible = true;
      const exclude = (reason: string) => {
        eligible = false;
        reasons.push(reason);
      };
      if (service.transport !== "signed-http")
        exclude(
          "RPC_OBSERVATION_ONLY: unsigned RPC is not a signed delivery adapter",
        );
      if (service.quoteWei === null)
        exclude("COST_UNKNOWN: unknown price is not treated as free");
      const task = input?.task,
        cap = service.capabilities;
      if (task) {
        for (const [values, target, label] of [
          [cap.dataChainIds, task.dataChainId, "CHAIN"],
          [cap.blockHashes, task.blockHash, "BLOCK"],
          [cap.accounts, task.account, "ACCOUNT"],
        ] as const) {
          if (values && !values.includes(target))
            exclude(label + "_UNSUPPORTED");
          else if (values === null)
            reasons.push(label + "_UNKNOWN: bounded current attempt required");
        }
        if (task.fields.some((f) => !cap.fields.includes(f)))
          exclude("FIELDS_UNSUPPORTED");
        if (cap.proof === "UNSUPPORTED") exclude("PROOF_UNSUPPORTED");
        if (
          cap.signature === "UNSUPPORTED" &&
          this.context(input!.contextId, "live").policy.requireSignature
        )
          exclude("SIGNATURE_UNSUPPORTED");
        if (cap.proof === "UNKNOWN" || cap.signature === "UNKNOWN")
          reasons.push(
            "CAPABILITY_UNKNOWN: no support inferred from missing observations",
          );
        const latest = observed.find(
          (o) =>
            o.method === "deliver" &&
            o.requestedBlock === task.blockHash &&
            o.account === task.account &&
            Date.parse(o.recordedAt) > Date.now() - 300000,
        );
        if (latest?.capability === "UNSUPPORTED")
          exclude(
            "RECENT_OBSERVED_UNSUPPORTED: same account/block/version; expires after 5 minutes",
          );
      }
      const ids =
        input?.useHistoricalEvidence && eligible
          ? await this.historical(input.task, input.contextId, service)
          : [];
      reasons.push(
        ids.length
          ? "VERIFIED_APPLICABLE_FAILURE: lower priority, current delivery may still recover"
          : "NO_HISTORICAL_PENALTY: current verification remains mandatory",
      );
      const verdicts = this.store.localVerdicts(service.serviceId);
      candidates.push({
        serviceId: service.serviceId,
        version: service.version,
        transport: service.transport,
        source: service.source,
        declaredCapabilities: cap,
        observedCapabilities: observed.slice(0, 50),
        metrics: summarize(observed, verdicts),
        quoteWei: service.quoteWei,
        eligible,
        rankingReasons: reasons,
        applicableEvidenceIds: ids,
      });
    }
    const local = (c: Candidate) =>
      c.metrics.find(
        (m) =>
          m.method === "deliver" &&
          m.source === c.source &&
          m.requestedBlock === input?.task.blockHash,
      );
    const order = new Map(this.config.services.map((s, i) => [s.serviceId, i]));
    const sourceOrder = new Map<Candidate["source"], number>(
      this.config.services
        .map((s) => s.source)
        .filter((v, i, a) => a.indexOf(v) === i)
        .map((source, i) => [source, i]),
    );
    candidates.sort((a, b) => {
      let cmp =
        Number(b.eligible) - Number(a.eligible) ||
        Number(a.applicableEvidenceIds.length > 0) -
          Number(b.applicableEvidenceIds.length > 0);
      if (cmp) return cmp;
      // A source-group key prevents non-transitive comparisons between mixed sample types.
      cmp = sourceOrder.get(a.source)! - sourceOrder.get(b.source)!;
      if (cmp) return cmp;
      const x = local(a),
        y = local(b);
      // Compare local measurements only with the same provenance and task block.
      if (a.source === b.source && x && y) {
        cmp =
          (x.errors + x.rateLimited + x.timeouts) / x.sampleCount -
          (y.errors + y.rateLimited + y.timeouts) / y.sampleCount;
        if (cmp) return cmp;
      }
      if (a.quoteWei !== null && b.quoteWei !== null) {
        cmp =
          BigInt(a.quoteWei) < BigInt(b.quoteWei)
            ? -1
            : BigInt(a.quoteWei) > BigInt(b.quoteWei)
              ? 1
              : 0;
        if (cmp) return cmp;
      }
      if (
        a.source === b.source &&
        x?.medianLatencyMs != null &&
        y?.medianLatencyMs != null
      ) {
        cmp = x.medianLatencyMs - y.medianLatencyMs;
        if (cmp) return cmp;
      }
      return order.get(a.serviceId)! - order.get(b.serviceId)!;
    });
    for (const c of candidates)
      c.rankingReasons.push(
        "ORDER: eligibility → applicable failure (boolean, no vote count) → configured provenance group → comparable local failure rate → known quote → comparable latency → configured order",
      );
    return candidates;
  }
  private activeRuns = new Map<
    string,
    {
      run: RunSnapshot;
      input: CreateRun;
      deadline: number;
      controller: AbortController;
      inFlight?: Promise<RunSnapshot>;
      inFlightService?: string;
    }
  >();
  reserveRun(raw: unknown) {
    const input = CreateRunSchema.parse(raw);
    this.validate(input);
    if (this.shuttingDown) throw new ApiError(503, "SHUTTING_DOWN");
    const initial: RunSnapshot = {
      apiVersion: API_VERSION,
      runId: newId(),
      status: "QUEUED",
      task: input.task,
      contextId: input.contextId,
      useHistoricalEvidence: input.useHistoricalEvidence,
      candidates: [],
      attempts: [],
      accepted: null,
      stopReason: null,
      spentWei: "0",
      createdAt: iso(),
      startedAt: null,
      finishedAt: null,
    };
    return this.store.reserveRun(digest(input), initial);
  }
  createRun(raw: unknown): { runId: string; duplicate: boolean } {
    const input = CreateRunSchema.parse(raw);
    const reserved = this.reserveRun(input);
    if (reserved.fresh) this.schedule(this.execute(reserved.run.runId, input));
    return { runId: reserved.run.runId, duplicate: !reserved.fresh };
  }
  async startManaged(id: string, input: CreateRun) {
    if (!this.store.claim(id)) throw new ApiError(409, "RUN_ALREADY_STARTED");
    const run = this.store.run(id);
    const active = {
      run,
      input,
      deadline: performance.now() + run.task.budget.timeoutMs,
      controller: new AbortController(),
    };
    this.activeRuns.set(id, active);
    run.candidates = await this.candidates(input);
    this.store.saveRun(run);
    const context = this.context(run.contextId, "live");
    if (context.ruleVersion !== RULE_VERSION)
      this.stopManaged(id, "RULE_UNSUPPORTED");
    else if (run.task.schemaVersion !== SCHEMA_VERSION)
      this.stopManaged(id, "SCHEMA_UNSUPPORTED");
    return run;
  }
  stopManaged(id: string, reason: RuntimeReason) {
    const active = this.activeRuns.get(id);
    const run = active?.run ?? this.store.run(id);
    if (run.status === "QUEUED" || run.status === "RUNNING") {
      run.status = "STOPPED";
      run.stopReason = reason;
      run.finishedAt = iso();
      active?.controller.abort();
      this.store.saveRun(run);
    }
    return run;
  }
  async releaseManaged(id: string) {
    const active = this.activeRuns.get(id);
    if (active?.inFlight) await active.inFlight.catch(() => {});
    this.activeRuns.delete(id);
  }
  attemptManaged(id: string, serviceId: string): Promise<RunSnapshot> {
    const active = this.activeRuns.get(id);
    if (!active || active.run.status !== "RUNNING")
      return Promise.reject(new ApiError(409, "RUN_TERMINAL"));
    if (active.inFlight && active.inFlightService === serviceId)
      return active.inFlight;
    const previous = active.run.attempts.find((a) => a.serviceId === serviceId);
    if (previous) return Promise.resolve(active.run);
    if (active.inFlight)
      return Promise.reject(new ApiError(409, "ATTEMPT_IN_PROGRESS"));
    const promise = this.performAttempt(active, serviceId).finally(() => {
      active.inFlight = undefined;
      active.inFlightService = undefined;
    });
    active.inFlight = promise;
    active.inFlightService = serviceId;
    return promise;
  }
  private async performAttempt(
    active: NonNullable<ReturnType<typeof this.activeRuns.get>>,
    serviceId: string,
  ): Promise<RunSnapshot> {
    const { run, input, deadline } = active;
    const choices = await this.candidates(input);
    if (run.status !== "RUNNING" || active.controller.signal.aborted)
      throw new ApiError(409, "RUN_TERMINAL");
    const candidate = choices.find(
      (c) => c.serviceId === serviceId && c.eligible,
    );
    if (!candidate) throw new ApiError(400, "CANDIDATE_NOT_ELIGIBLE");
    if (
      run.attempts.length >= run.task.budget.maxAttempts ||
      performance.now() >= deadline
    )
      return this.stopManaged(run.runId, "BUDGET_EXHAUSTED");
    const service = this.config.services.find(
      (s) => s.serviceId === serviceId,
    )!;
    const quote = BigInt(service.quoteWei!);
    if (BigInt(run.spentWei) + quote > BigInt(run.task.budget.maxCostWei))
      return this.stopManaged(run.runId, "BUDGET_EXHAUSTED");
    try {
      const start = performance.now();
      const attempt: Attempt = {
        status: "RUNNING",
        attemptId: newId(),
        serviceId: service.serviceId,
        startedAt: iso(),
        endedAt: iso(),
        source: service.source,
        observationStatus: "ERROR",
        runtimeReason: null,
        latencyMs: 0,
        reservedCostWei: quote.toString(),
        verification: null,
        evidenceId: null,
      };
      run.spentWei = (BigInt(run.spentWei) + quote).toString();
      run.attempts.push(attempt);
      this.store.saveRun(run); // Durable reservation before outbound side effects.
      const observed = observation(
        service.serviceId,
        "deliver",
        service.source,
        run.task.blockHash,
        run.task.account,
      );
      observed.response.serviceVersion = service.version;
      try {
        const response = await fetch_json(service.endpoint, {
          body: run.task,
          signal: active.controller.signal,
          timeoutMs: Math.max(
            1,
            Math.min(
              service.timeoutMs,
              Math.floor(deadline - performance.now()),
            ),
          ),
        });
        observed.httpStatus = response.httpStatus;
        observed.latencyMs =
          Math.round((performance.now() - start) * 100) / 100;
        const parsed = DeliveryEnvelopeSchema.safeParse(response.data);
        if (!parsed.success)
          throw new TransportError("INVALID_RESPONSE", response.httpStatus);
        const delivery = parsed.data;
        const context = this.context(run.contextId, "live");
        if (this.store.consumed(run.task.requestId))
          context.consumedRequestIds = [run.task.requestId];
        attempt.verification = await verify_delivery(
          run.task,
          delivery,
          context,
        );
        observed.status =
          delivery.deliveryStatus === "unsupported" ? "UNSUPPORTED" : "OK";
        observed.capability =
          delivery.deliveryStatus === "unsupported"
            ? "UNSUPPORTED"
            : "SUPPORTED";
        observed.response = {
          deliveryStatus: delivery.deliveryStatus,
          signaturePresent: !!delivery.signature,
          serviceVersion: service.version,
        };
        if (
          delivery.serviceId !== service.serviceId ||
          delivery.serviceVersion !== service.version
        )
          attempt.runtimeReason = "SERVICE_ID_MISMATCH";
        const evidence = await build_evidence(run.task, delivery, context, {
          mode: service.source,
          source: service.serviceId,
          capturedAt: context.evaluatedAt,
          description:
            service.source === "FAULT_INJECTION"
              ? "Controlled local fault-injection scenario; not an RPC provider incident"
              : service.source === "LIVE"
                ? "Live signed service delivery under caller-configured identity and baseline"
                : "Locally signed adapter delivery using recorded public account proof; signature is not from RPC provider",
        });
        const saved = this.store.saveEvidence(
          evidence.bundle,
          evidence.manifest,
          run.contextId,
          context.evaluatedAt,
        );
        attempt.evidenceId = saved.id;
        if (performance.now() >= deadline)
          attempt.runtimeReason = "BUDGET_EXHAUSTED";
        if (
          run.status === "RUNNING" &&
          !active.controller.signal.aborted &&
          attempt.verification.verdict === "PASS" &&
          !attempt.runtimeReason &&
          delivery.response
        ) {
          // Only requested, verified fields are exposed to the consumer.
          const values = Object.fromEntries(
            run.task.fields.map((field) => [
              field,
              delivery.response!.values[field],
            ]),
          );
          run.accepted = {
            serviceId: service.serviceId,
            evidenceId: saved.id,
            blockHash: run.task.blockHash,
            values,
          };
        }
      } catch (e) {
        if (!(e instanceof TransportError)) throw e;
        observed.latencyMs =
          Math.round((performance.now() - start) * 100) / 100;
        observed.status = e.status;
        observed.httpStatus = e.httpStatus;
        observed.rpcCode = e.rpcCode;
        attempt.runtimeReason =
          e.status === "ERROR"
            ? "NETWORK_ERROR"
            : e.status === "OK"
              ? "INVALID_RESPONSE"
              : e.status;
      }
      attempt.status = "COMPLETED";
      attempt.observationStatus = observed.status;
      attempt.latencyMs = Math.round((performance.now() - start) * 100) / 100;
      attempt.endedAt = iso();
      this.store.saveObservation(observed);
      if (run.accepted) {
        run.status = "SUCCEEDED";
        run.finishedAt = iso();
        this.store.adopt(run);
      } else {
        this.store.saveRun(run);
        if (performance.now() >= deadline)
          this.stopManaged(run.runId, "BUDGET_EXHAUSTED");
      }
      return run;
    } catch (error) {
      const last = run.attempts.at(-1);
      if (last?.status === "RUNNING") {
        last.status = "INTERRUPTED";
        last.runtimeReason = "INTERNAL_ERROR";
        last.endedAt = iso();
      }
      // Adoption may fail while committing. Never publish the in-memory SUCCEEDED
      // snapshot outside the atomic consumption transaction after a rollback.
      const persisted = this.store.run(run.runId);
      if (persisted.status === "SUCCEEDED") return persisted;
      run.accepted = null;
      if (persisted.status === "STOPPED") {
        run.status='STOPPED';run.stopReason=persisted.stopReason;run.finishedAt=persisted.finishedAt;
      } else {
        run.status = "ERROR";
        run.stopReason = "INTERNAL_ERROR";
        run.finishedAt = iso();
      }
      this.store.saveRun(run);
      throw error;
    }
  }
  private async execute(id: string, input: CreateRun) {
    try {
      const run = await this.startManaged(id, input);
      let budgetBlocked = false;
      for (const candidate of run.candidates.filter((c) => c.eligible)) {
        if (run.status !== "RUNNING") return;
        if (this.shuttingDown) {
          this.stopManaged(id, "INTERRUPTED");
          return;
        }
        if (
          BigInt(run.spentWei) + BigInt(candidate.quoteWei!) >
          BigInt(run.task.budget.maxCostWei)
        ) {
          budgetBlocked = true;
          continue;
        }
        await this.attemptManaged(id, candidate.serviceId);
      }
      this.stopManaged(
        id,
        budgetBlocked ? "BUDGET_EXHAUSTED" : "NO_ACCEPTABLE_DELIVERY",
      );
    } catch {
      this.stopManaged(id, "INTERNAL_ERROR");
    } finally {
      await this.releaseManaged(id);
    }
  }
  createReplay(evidenceId: string, contextId: string): string {
    this.store.evidenceRow(evidenceId);
    this.context(contextId, "historical");
    const replay: ReplaySnapshot = {
      apiVersion: API_VERSION,
      replayId: newId(),
      evidenceId,
      contextId,
      status: "QUEUED",
      result: null,
      reportConsistent: null,
      error: null,
      createdAt: iso(),
      finishedAt: null,
    };
    this.store.saveReplay(replay);
    this.schedule(this.executeReplay(replay));
    return replay.replayId;
  }
  private async executeReplay(replay: ReplaySnapshot) {
    replay.status = "RUNNING";
    this.store.saveReplay(replay);
    try {
      const { row, bundle } = this.store.readEvidence(replay.evidenceId);
      const context = this.context(
        replay.contextId,
        "historical",
        row.contextId === replay.contextId ? row.evaluatedAt : undefined,
      );
      const checked = await this.checked(bundle, row.manifest, context);
      replay.result = checked.result;
      replay.reportConsistent = checked.consistent;
      replay.status = "COMPLETED";
    } catch (e) {
      replay.status = "ERROR";
      replay.error = e instanceof ApiError ? e.message : "REPLAY_FAILED";
    }
    replay.finishedAt = iso();
    this.store.saveReplay(replay);
  }
  async observeRpc() {
    const outputs = [];
    for (const service of this.config.services.filter(
      (s) => s.transport === "rpc-observation",
    )) {
      const context = this.config.contexts[0];
      const account = this.config.services.find(
        (s) => s.transport === "signed-http",
      )?.capabilities.accounts?.[0];
      const probes: {
        method: string;
        params: unknown[];
        block?: string;
        account?: string;
      }[] = [
        { method: "eth_chainId", params: [] },
        {
          method: "eth_getBlockByNumber",
          params: ["finalized", false],
          block: "finalized",
        },
        {
          method: "eth_getBlockByNumber",
          params: ["0x16e3600", false],
          block: "0x16e3600",
        },
      ];
      if (account)
        probes.push(
          {
            method: "eth_getProof",
            params: [account, [], "latest"],
            block: "latest",
            account,
          },
          {
            method: "eth_getProof",
            params: [account, [], "0x16e3600"],
            block: "0x16e3600",
            account,
          },
        );
      if (context.trustedBlock && account)
        probes.push({
          method: "eth_getProof",
          params: [
            account,
            [],
            {
              blockHash: context.trustedBlock.blockHash,
              requireCanonical: true,
            },
          ],
          block: context.trustedBlock.blockHash,
          account,
        });
      for (const probe of probes) {
        const item = await probe_rpc({
          serviceId: service.serviceId,
          endpoint: service.endpoint,
          timeoutMs: service.timeoutMs,
          ...probe,
        });
        this.store.saveObservation(item);
        outputs.push(item);
      }
    }
    return outputs;
  }
  // Internal trusted queue boundary only. No public endpoint can spend gas or select an adapter.
  async publishForTest(id: string, retryOf?: string): Promise<EvidenceRow> {
    if (this.config.publicationAdapter !== "test_failure")
      throw new ApiError(409, "PUBLICATION_NOT_CONFIGURED");
    this.store.readEvidence(id);
    const claimed = this.store.transaction(() => {
      const row = this.store.evidenceRow(id);
      if (
        row.publication.status !== "not_requested" &&
        !(
          row.publication.status === "failed" &&
          retryOf === row.publication.attemptId
        )
      )
        return false;
      row.publication = {
        status: "pending",
        adapter: "test_failure",
        attemptedAt: iso(),
        error: null,
        attemptId: newId(),
        attempts: row.publication.attempts + 1,
      };
      this.store.saveEvidenceRow(row);
      return true;
    });
    if (claimed) {
      await Promise.resolve();
      const row = this.store.evidenceRow(id);
      row.publication = {
        ...row.publication,
        status: "failed",
        error: "INJECTED_TEST_ADAPTER_FAILURE; no chain transaction attempted",
      };
      this.store.saveEvidenceRow(row);
    }
    return this.store.evidenceRow(id);
  }
  async idle() {
    await Promise.allSettled([...this.jobs]);
  }
  async close() {
    this.shuttingDown = true;
    await this.idle();
    this.store.close();
  }
}
