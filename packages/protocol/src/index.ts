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
