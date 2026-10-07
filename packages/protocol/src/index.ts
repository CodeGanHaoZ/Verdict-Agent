import { z } from 'zod';
export { canonical_json, parse_json_strict } from './json.js';

export const SCHEMA_VERSION = '1.0.0';
export const RULE_VERSION = 'eth-account-v1';
export const SIGNING_DOMAIN = { name: 'VerdictAgentDelivery', version: '1', salt: '0x766572646963742d6167656e742d64656c69766572792d763100000000000000' } as const;
export const DELIVERY_TYPES = { Delivery: [
  { name: 'serviceId', type: 'string' }, { name: 'serviceVersion', type: 'string' },
  { name: 'requestHash', type: 'bytes32' }, { name: 'responseHash', type: 'bytes32' },
  { name: 'deliveryStatus', type: 'string' }, { name: 'dataChainId', type: 'uint256' },
  { name: 'blockHash', type: 'bytes32' }, { name: 'issuedAt', type: 'uint256' },
  { name: 'expiresAt', type: 'uint256' },
] } as const;
export const VerdictSchema = z.enum(['PASS', 'FAIL', 'UNVERIFIABLE']);
export const AttributionSchema = z.enum(['VERIFIED', 'UNSIGNED', 'INVALID', 'UNRESOLVED']);
export const CheckStatusSchema = z.enum(['PASS', 'FAIL', 'UNKNOWN', 'NOT_APPLICABLE', 'NOT_COVERED']);
export const DeliveryStatusSchema = z.enum(['delivered', 'unsupported', 'rejected']);
export const ArtifactIntegritySchema = z.enum(['VERIFIED', 'MISMATCH', 'UNAVAILABLE', 'NOT_CHECKED']);
export const ProvenanceModeSchema = z.enum(['LIVE', 'FROZEN', 'FAULT_INJECTION', 'UI_MOCK']);
export const RunStatusSchema = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'STOPPED', 'ERROR']);
export const ReplayStatusSchema = z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'ERROR']);
export const AnchorStatusSchema = z.enum(['not_requested', 'pending', 'confirmed', 'failed']);
export const ReasonCodeSchema = z.enum([
  'SCHEMA_UNSUPPORTED', 'RULE_UNSUPPORTED', 'NETWORK_UNSUPPORTED', 'POLICY_UNSUPPORTED',
  'BLOCK_MISMATCH', 'BASELINE_CONFLICT', 'BASELINE_UNTRUSTED', 'HEADER_INVALID', 'HEADER_UNSUPPORTED',
  'CHAIN_MISMATCH', 'ACCOUNT_MISMATCH', 'FIELD_MISMATCH', 'PROOF_INVALID',
  'SIGNATURE_INVALID', 'ATTRIBUTION_UNRESOLVED', 'SIGNATURE_MISSING', 'REQUEST_MISMATCH',
  'REQUEST_EXPIRED', 'REQUEST_REPLAYED', 'DELIVERY_EXPIRED', 'UNSUPPORTED', 'REJECTED',
  'RATE_LIMITED', 'TIMEOUT', 'EVIDENCE_MISSING', 'BUDGET_EXHAUSTED', 'NO_ACCEPTABLE_DELIVERY',
  'ARTIFACT_MISMATCH', 'REPORT_MISMATCH', 'CONTEXT_MISMATCH', 'INPUT_INVALID', 'UI_MOCK_REJECTED',
]);
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;
export const DecimalSchema = z.string().regex(/^(0|[1-9][0-9]*)$/).max(78).refine(v => BigInt(v) < 2n ** 256n, 'uint256 overflow');
export const AddressSchema = z.string().regex(/^0x[0-9a-f]{40}$/);
export const HashSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const BytesSchema = z.string().regex(/^0x(?:[0-9a-f]{2})*$/);
const QuantitySchema = z.string().regex(/^0x(?:0|[1-9a-f][0-9a-f]*)$/).max(66);
const Id = z.string().min(1).max(160);
const SchemaVersion = z.string().min(1).max(40);
export const FieldSchema = z.enum(['balance', 'nonce', 'codeHash', 'storageRoot']);
export const TaskSpecSchema = z.strictObject({
  schemaVersion: SchemaVersion, requestId: Id, dataChainId: DecimalSchema,
  account: AddressSchema, blockHash: HashSchema,
  fields: z.array(FieldSchema).min(1).max(4).refine(v => new Set(v).size === v.length, 'duplicate field'),
  evidencePolicyId: Id,
  validity: z.strictObject({ notBefore: DecimalSchema, expiresAt: DecimalSchema }).refine(v => BigInt(v.notBefore) <= BigInt(v.expiresAt)),
  budget: z.strictObject({ maxAttempts: z.number().int().min(1).max(100), timeoutMs: z.number().int().min(1).max(600000), maxCostWei: DecimalSchema }),
});
// Exact RPC header fields needed for Ethereum execution-header hashing. Unknown fields are rejected.
export const HeaderSchema = z.strictObject({
  hash: HashSchema, parentHash: HashSchema, sha3Uncles: HashSchema, miner: AddressSchema,
  stateRoot: HashSchema, transactionsRoot: HashSchema, receiptsRoot: HashSchema,
  logsBloom: z.string().regex(/^0x[0-9a-f]{512}$/), difficulty: QuantitySchema,
  number: QuantitySchema, gasLimit: QuantitySchema, gasUsed: QuantitySchema,
  timestamp: QuantitySchema, extraData: BytesSchema.max(66), mixHash: HashSchema,
  nonce: z.string().regex(/^0x[0-9a-f]{16}$/),
  baseFeePerGas: QuantitySchema.optional(), withdrawalsRoot: HashSchema.optional(),
  blobGasUsed: QuantitySchema.optional(), excessBlobGas: QuantitySchema.optional(),
  parentBeaconBlockRoot: HashSchema.optional(), requestsHash: HashSchema.optional(),
});
export const ValuesSchema = z.strictObject({ balance: DecimalSchema.optional(), nonce: DecimalSchema.optional(), codeHash: HashSchema.optional(), storageRoot: HashSchema.optional() });
export const ResponseSchema = z.strictObject({
  dataChainId: DecimalSchema, account: AddressSchema, blockHash: HashSchema, values: ValuesSchema,
  header: HeaderSchema.optional(), accountProof: z.array(BytesSchema.min(4).max(65538)).max(64).optional(),
});
export const DeliveryEnvelopeSchema = z.strictObject({
  schemaVersion: SchemaVersion, serviceId: Id, serviceVersion: Id, requestHash: HashSchema,
  dataChainId: DecimalSchema, blockHash: HashSchema, identityChainId: DecimalSchema,
  deliveryStatus: DeliveryStatusSchema, issuedAt: DecimalSchema, expiresAt: DecimalSchema,
  response: ResponseSchema.nullable(), signature: z.string().regex(/^0x[0-9a-f]{130}$/).optional(),
});
export const TrustedBlockSchema = z.strictObject({
  dataChainId: DecimalSchema, blockHash: HashSchema, stateRoot: HashSchema,
  source: z.string().min(1).max(1000), finality: z.enum(['finalized', 'safe', 'unfinalized', 'historical-checkpoint']),
});
export const KeyBindingSchema = z.strictObject({
  serviceId: Id, serviceVersion: Id, identityChainId: DecimalSchema, signer: AddressSchema,
  validFrom: DecimalSchema, validUntil: DecimalSchema, revokedAt: DecimalSchema.optional(), authority: z.string().min(1).max(1000),
}).refine(v => BigInt(v.validFrom) <= BigInt(v.validUntil));
export const VerificationContextSchema = z.strictObject({
  schemaVersion: SchemaVersion, contextId: Id, ruleVersion: Id,
  mode: z.enum(['live', 'historical']), evaluatedAt: DecimalSchema, timeSource: z.string().min(1).max(1000),
  policy: z.strictObject({ id: Id, requireSignature: z.boolean(), minimumFinality: z.enum(['any-pinned', 'safe', 'finalized']) }),
  trustedBlock: TrustedBlockSchema.optional(), identityChainId: DecimalSchema,
  keyBindings: z.array(KeyBindingSchema).max(1000), consumedRequestIds: z.array(Id).max(10000),
});
export const CheckResultSchema = z.strictObject({
  checkId: Id, scope: z.enum(['data', 'attribution', 'admission']), requirement: z.string(), actual: z.string(),
  status: CheckStatusSchema, reasonCode: ReasonCodeSchema.optional(), evidenceRefs: z.array(z.string()),
});
export const VerificationResultSchema = z.strictObject({
  schemaVersion: SchemaVersion, ruleVersion: Id, verdict: VerdictSchema, dataVerdict: VerdictSchema,
  attributionStatus: AttributionSchema, deliveryStatus: DeliveryStatusSchema,
  reasonCodes: z.array(ReasonCodeSchema), checks: z.array(CheckResultSchema), attributableFailure: z.boolean(),
});
export const ProvenanceSchema = z.strictObject({
  mode: ProvenanceModeSchema, source: z.string().min(1).max(2000), capturedAt: DecimalSchema,
  description: z.string().min(1).max(2000),
});
export const EvidenceBundleSchema = z.strictObject({
  schemaVersion: SchemaVersion, ruleVersion: Id, request: TaskSpecSchema, delivery: DeliveryEnvelopeSchema,
  baseline: TrustedBlockSchema.nullable(), contextHash: HashSchema,
  result: VerificationResultSchema, provenance: ProvenanceSchema,
});
export const EvidenceManifestSchema = z.strictObject({
  schemaVersion: SchemaVersion, evidenceHash: HashSchema, hashAlgorithm: z.literal('keccak256-jcs'),
  bundleFile: z.string().min(1).max(300),
});
export type TaskSpec = z.infer<typeof TaskSpecSchema>;
export type Header = z.infer<typeof HeaderSchema>;
export type DeliveryEnvelope = z.infer<typeof DeliveryEnvelopeSchema>;
export type VerificationContext = z.infer<typeof VerificationContextSchema>;
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
export type CheckResult = z.infer<typeof CheckResultSchema>;
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;
export type EvidenceManifest = z.infer<typeof EvidenceManifestSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;

export const ReplayResultSchema = z.strictObject({
  artifactIntegrity: z.enum(['VERIFIED', 'MISMATCH']),
  comparison: z.enum(['MATCH', 'MISMATCH', 'CONTEXT_DIFFERENT', 'NOT_COMPARABLE']),
  evidenceHash: HashSchema, reasonCodes: z.array(ReasonCodeSchema),
  recomputedResult: VerificationResultSchema.optional(),
});
export type ReplayResult = z.infer<typeof ReplayResultSchema>;

// Additive B API objects. A's schema/rule versions and verdict semantics are unchanged.
export const API_VERSION = '1.0.0';
export const ObservationStatusSchema = z.enum(['OK', 'UNSUPPORTED', 'RATE_LIMITED', 'TIMEOUT', 'ERROR', 'INVALID_RESPONSE']);
export const CapabilityStatusSchema = z.enum(['SUPPORTED', 'UNSUPPORTED', 'UNKNOWN']);
// Operator-declared vantage point, not geolocation attestation or evidence of data correctness.
const ObservationLabel = z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/);
export const ObservationOriginSchema = z.strictObject({
  observerId: ObservationLabel, region: ObservationLabel.nullable(),
  networkProfile: ObservationLabel.nullable(), provenance: z.literal('OPERATOR_CONFIGURED'),
});
export const RuntimeReasonSchema = z.enum([...ReasonCodeSchema.options, 'NETWORK_ERROR', 'INVALID_RESPONSE', 'SERVICE_ID_MISMATCH', 'COST_UNKNOWN', 'INTERRUPTED', 'INTERNAL_ERROR', 'CONTEXT_UNAVAILABLE', 'AGENT_STOPPED', 'AGENT_ERROR', 'CANCELLED']);
export const CapabilitiesSchema = z.strictObject({
  dataChainIds: z.array(DecimalSchema).nullable(), blockHashes: z.array(HashSchema).nullable(),
  accounts: z.array(AddressSchema).nullable(), fields: z.array(FieldSchema),
  proof: CapabilityStatusSchema, signature: CapabilityStatusSchema, methods: z.array(z.string()),
});
export const ObservationSchema = z.strictObject({
  observationId: Id, serviceId: Id, method: z.string(), requestedBlock: z.string().nullable(),
  account: AddressSchema.nullable(), source: ProvenanceModeSchema, recordedAt: z.string().datetime(),
  status: ObservationStatusSchema, capability: CapabilityStatusSchema,
  latencyMs: z.number().nonnegative(), httpStatus: z.number().int().nullable(), rpcCode: z.number().int().nullable(),
  response: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  correctness: z.literal('NOT_CHECKED'),
  origin: ObservationOriginSchema.nullable().optional(),
});
export const MetricGroupSchema = z.strictObject({
  source: ProvenanceModeSchema, method: z.string(), requestedBlock: z.string().nullable(),
  origin: ObservationOriginSchema.nullable().optional(),
  windowStart: z.string().datetime(), windowEnd: z.string().datetime(), sampleCount: z.number().int(),
  responses: z.number().int(), errors: z.number().int(), unsupported: z.number().int(),
  rateLimited: z.number().int(), timeouts: z.number().int(), medianLatencyMs: z.number().nullable(),
  verdictCounts: z.strictObject({ PASS: z.number().int(), FAIL: z.number().int(), UNVERIFIABLE: z.number().int() }),
});
export const CandidateSchema = z.strictObject({
  serviceId: Id, version: Id, transport: z.enum(['signed-http', 'rpc-observation']),
  source: ProvenanceModeSchema, declaredCapabilities: CapabilitiesSchema,
  observedCapabilities: z.array(ObservationSchema), metrics: z.array(MetricGroupSchema),
  quoteWei: DecimalSchema.nullable(), eligible: z.boolean(), rankingReasons: z.array(z.string()),
  applicableEvidenceIds: z.array(HashSchema),
});
export const AttemptSchema = z.strictObject({
  status: z.enum(['RUNNING', 'COMPLETED', 'INTERRUPTED']).default('COMPLETED'),
  attemptId: Id, serviceId: Id, startedAt: z.string().datetime(), endedAt: z.string().datetime(),
  source: ProvenanceModeSchema, observationStatus: ObservationStatusSchema,
  runtimeReason: RuntimeReasonSchema.nullable(), latencyMs: z.number(), reservedCostWei: DecimalSchema,
  verification: VerificationResultSchema.nullable(), evidenceId: HashSchema.nullable(),
});
export const RunSnapshotSchema = z.strictObject({
  apiVersion: z.literal(API_VERSION), runId: Id, status: RunStatusSchema, task: TaskSpecSchema,
  contextId: Id, useHistoricalEvidence: z.boolean(), candidates: z.array(CandidateSchema), attempts: z.array(AttemptSchema),
  accepted: z.strictObject({ serviceId: Id, evidenceId: HashSchema, blockHash: HashSchema, values: ValuesSchema }).nullable(),
  stopReason: RuntimeReasonSchema.nullable(), spentWei: DecimalSchema,
  createdAt: z.string().datetime(), startedAt: z.string().datetime().nullable(), finishedAt: z.string().datetime().nullable(),
});
export const CreateRunSchema = z.strictObject({
  task: TaskSpecSchema, contextId: Id, candidateIds: z.array(Id).min(1).max(32).optional(),
  useHistoricalEvidence: z.boolean().default(true),
});
export const ReplaySnapshotSchema = z.strictObject({
  apiVersion: z.literal(API_VERSION), replayId: Id, evidenceId: HashSchema, contextId: Id,
  status: ReplayStatusSchema, result: ReplayResultSchema.nullable(), reportConsistent: z.boolean().nullable(),
  error: z.string().nullable(), createdAt: z.string().datetime(), finishedAt: z.string().datetime().nullable(),
});
export const PublicationSchema = z.strictObject({
  status: AnchorStatusSchema, adapter: z.enum(['not_configured', 'test_failure']),
  attemptedAt: z.string().datetime().nullable(), error: z.string().nullable(),
  attemptId: Id.nullable().default(null), attempts: z.number().int().nonnegative().default(0),
});
export const ImportEvidenceSchema = z.strictObject({ bundle: EvidenceBundleSchema, manifest: EvidenceManifestSchema, contextId: Id });
export const CreateReplaySchema = z.strictObject({ evidenceId: HashSchema, contextId: Id });
export type Candidate = z.infer<typeof CandidateSchema>;
export type Capabilities = z.infer<typeof CapabilitiesSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
export type MetricGroup = z.infer<typeof MetricGroupSchema>;
export type Attempt = z.infer<typeof AttemptSchema>;
export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;
export type CreateRun = z.infer<typeof CreateRunSchema>;
export type ReplaySnapshot = z.infer<typeof ReplaySnapshotSchema>;
export type Publication = z.infer<typeof PublicationSchema>;
export type RuntimeReason = z.infer<typeof RuntimeReasonSchema>;

// Host-neutral function tools. The descriptions are local code, never service metadata.
export const AgentToolArguments = {
  describe_environment: z.strictObject({}),
  find_service: CreateRunSchema,
  verify_before_use: CreateRunSchema,
  get_run: z.strictObject({ runId: Id }),
  download_evidence: z.strictObject({ evidenceId: HashSchema }),
  report_outcome: ImportEvidenceSchema,
  replay_evidence: CreateReplaySchema,
  get_replay: z.strictObject({ replayId: Id }),
};
export const AgentToolCallSchema = z.discriminatedUnion('name', [
  z.strictObject({ name: z.literal('describe_environment'), arguments: AgentToolArguments.describe_environment }),
  z.strictObject({ name: z.literal('find_service'), arguments: AgentToolArguments.find_service }),
  z.strictObject({ name: z.literal('verify_before_use'), arguments: AgentToolArguments.verify_before_use }),
  z.strictObject({ name: z.literal('get_run'), arguments: AgentToolArguments.get_run }),
  z.strictObject({ name: z.literal('download_evidence'), arguments: AgentToolArguments.download_evidence }),
  z.strictObject({ name: z.literal('report_outcome'), arguments: AgentToolArguments.report_outcome }),
  z.strictObject({ name: z.literal('replay_evidence'), arguments: AgentToolArguments.replay_evidence }),
  z.strictObject({ name: z.literal('get_replay'), arguments: AgentToolArguments.get_replay }),
]);
export type AgentToolCall = z.input<typeof AgentToolCallSchema>;
export type ObservationOrigin = z.infer<typeof ObservationOriginSchema>;

// PI orchestration is mutable application state, never part of the signed evidence schema.
export const AGENT_API_VERSION = '1.1.0';
export const AgentErrorSchema = z.enum(['MODEL_NOT_CONFIGURED','MODEL_ERROR','MODEL_RATE_LIMITED','MODEL_TIMEOUT','MODEL_LIMIT','TOOL_LIMIT','TOOL_INVALID','NO_VERIFIED_RESULT','CANCELLED','INTERRUPTED','DRAFT_INVALID','DRAFT_EXPIRED','BUDGET_EXHAUSTED','INTERNAL_ERROR']);
export const AgentUsageSchema = z.strictObject({ requests:z.number().int().nonnegative(), inputTokens:z.number().nonnegative(), outputTokens:z.number().nonnegative(), cacheReadTokens:z.number().nonnegative(), cacheWriteTokens:z.number().nonnegative(), costUsd:z.number().nonnegative().nullable() });
export const AgentConditionsSchema = z.strictObject({
  contextId:Id, account:AddressSchema, blockHash:HashSchema,
  fields:TaskSpecSchema.shape.fields, candidateIds:z.array(Id).min(1).max(32),
  useHistoricalEvidence:z.boolean(), budget:TaskSpecSchema.shape.budget,
});
export const AgentProposalSchema = z.strictObject({
  contextId:Id.nullable(), account:AddressSchema.nullable(), blockHash:HashSchema.nullable(),
  fields:TaskSpecSchema.shape.fields, candidateIds:z.array(Id).min(1).max(32),
  useHistoricalEvidence:z.boolean(), budget:TaskSpecSchema.shape.budget,
  missing:z.array(z.string().max(300)).max(12), explanation:z.string().max(3000),
});
export const AgentDraftSchema = z.strictObject({
  apiVersion:z.literal(API_VERSION), draftId:Id, clientRequestId:Id, version:z.number().int().positive(),
  status:z.enum(['GENERATING','READY','NEEDS_INPUT','CONFIRMED','ERROR','EXPIRED']),
  prompt:z.string().min(1).max(6000), proposal:AgentProposalSchema.nullable(), usage:AgentUsageSchema,
  error:AgentErrorSchema.nullable(), agentId:Id.nullable(), createdAt:z.string().datetime(), expiresAt:z.string().datetime(),
});
export const AgentSnapshotSchema = z.strictObject({
  apiVersion:z.enum([API_VERSION, AGENT_API_VERSION]), agentId:Id, draftId:Id.nullable(), runId:Id.nullable(),
  status:z.enum(['QUEUED','RUNNING','COMPLETED','STOPPED','ERROR']),
  modelStatus:z.enum(['IDLE','RUNNING','COMPLETED','ERROR','CANCELLED']),
  modelId:Id, modelSource:z.enum(['LIVE','TEST_TRANSPORT']), usage:AgentUsageSchema,
  toolCalls:z.number().int().nonnegative(), error:AgentErrorSchema.nullable(), explanation:z.string().max(6000),
  eventSequence:z.number().int().nonnegative(), createdAt:z.string().datetime(), finishedAt:z.string().datetime().nullable(),
});
export const AgentEventSchema = z.strictObject({
  agentId:Id, sequence:z.number().int().positive(), at:z.string().datetime(),
  type:z.enum(['STATUS','MODEL_REQUEST','ASSISTANT_TEXT','TOOL_START','TOOL_END','ERROR']),
  toolName:z.string().optional(), toolCallId:z.string().optional(), data:z.unknown(),
});
export const CreateAgentDraftSchema=z.strictObject({clientRequestId:Id,prompt:z.string().trim().min(1).max(6000)});
export const UpdateAgentDraftSchema=z.strictObject({version:z.number().int().positive(),conditions:AgentConditionsSchema});
export const ConfirmAgentDraftSchema=z.strictObject({version:z.number().int().positive()});
export type AgentConditions=z.infer<typeof AgentConditionsSchema>;
export type AgentProposal=z.infer<typeof AgentProposalSchema>;
export type AgentDraft=z.infer<typeof AgentDraftSchema>;
export type AgentSnapshot=z.infer<typeof AgentSnapshotSchema>;
export type AgentEvent=z.infer<typeof AgentEventSchema>;
export type AgentUsage=z.infer<typeof AgentUsageSchema>;
export type AgentError=z.infer<typeof AgentErrorSchema>;

// Direct PI task submission; execution does not require a draft confirmation.
export const CreateAgentRunSchema = z.strictObject({clientRequestId:Id,prompt:z.string().trim().min(1).max(6000)});
