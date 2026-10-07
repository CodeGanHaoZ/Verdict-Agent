import { z } from 'zod';

// Separate from account-delivery evidence: these are pre-signing RPC observations.
export const WalletAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(s => s.toLowerCase());
export const WalletQuantitySchema = z.string().regex(/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/);
export const WalletLinkIdSchema = z.string().uuid();
export const WalletHashSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const Amount = z.string().regex(/^(0|[1-9][0-9]{0,77})$/).refine(v => BigInt(v) < 2n ** 256n);
export const WalletTransactionSchema = z.strictObject({
  chainId: WalletQuantitySchema, from: WalletAddressSchema, to: WalletAddressSchema,
  value: WalletQuantitySchema, data: z.string().regex(/^0x(?:[0-9a-f]{2})*$/).max(32770),
});
export const PreparedWalletTransactionSchema = WalletTransactionSchema.extend({
  nonce: WalletQuantitySchema, gas: WalletQuantitySchema,
  maxFeePerGas: WalletQuantitySchema, maxPriorityFeePerGas: WalletQuantitySchema,
});
export const WalletIntentSchema = z.strictObject({
  account: WalletAddressSchema, chainId: WalletQuantitySchema, recipient: WalletAddressSchema,
  maxValueWei: Amount, maxTotalFeeWei: Amount, operation: z.literal('native_transfer'),
});
export const CreateWalletReviewSchema = z.strictObject({
  clientRequestId: z.string().min(1).max(100).regex(/^[\w-]+$/),
  transaction: WalletTransactionSchema, intent: WalletIntentSchema,
  traceId: WalletLinkIdSchema.optional(), parentAgentId: WalletLinkIdSchema.optional(), graphRunId: WalletLinkIdSchema.optional(),
});
export const WalletCheckSchema = z.strictObject({
  id: z.string(), status: z.enum(['PASS', 'FAIL', 'UNKNOWN']), reason: z.string(),
  source: z.enum(['HARD_RULE', 'RPC_OBSERVATION']), facts: z.record(z.string(), z.string()),
});
export const WalletStateObservationSchema = z.strictObject({
  blockNumber:WalletQuantitySchema, blockHash:WalletHashSchema,
  senderBalance:Amount, recipientBalance:Amount, senderNonce:WalletQuantitySchema,
});
export const WalletObservedTransactionSchema = PreparedWalletTransactionSchema.extend({
  hash:WalletHashSchema, blockNumber:WalletQuantitySchema.nullable(), blockHash:WalletHashSchema.nullable(),
}).strict();
export const WalletObservedReceiptSchema = z.strictObject({
  transactionHash:WalletHashSchema, from:WalletAddressSchema, to:WalletAddressSchema,
  status:z.enum(['0x0','0x1']), blockNumber:WalletQuantitySchema, blockHash:WalletHashSchema,
  gasUsed:WalletQuantitySchema,
});
export const WalletReceiptReportSchema = z.strictObject({
  txHash:WalletHashSchema, transactionFound:z.boolean(),
  receiptStatus:z.enum(['UNKNOWN','SUCCESS','FAIL','REJECTED']),
  blockNumber:WalletQuantitySchema.nullable(),blockHash:WalletHashSchema.nullable(),gasUsed:WalletQuantitySchema.nullable(),
  error:z.string().max(160).nullable(), postStateStatus:z.enum(['NOT_CHECKED','UNKNOWN','POST_STATE_RECHECKED']).optional(),
});
export const WalletPostStateSchema = z.strictObject({
  senderBalanceBefore:Amount,senderBalanceAfter:Amount,senderBalanceDelta:z.string().regex(/^-?[0-9]+$/),
  recipientBalanceBefore:Amount,recipientBalanceAfter:Amount,recipientBalanceDelta:z.string().regex(/^-?[0-9]+$/),
  senderNonceBefore:WalletQuantitySchema,senderNonceAfter:WalletQuantitySchema,senderNonceDelta:z.string().regex(/^-?[0-9]+$/),
  receiptStatus:z.enum(['SUCCESS','FAIL']),blockNumber:WalletQuantitySchema,blockHash:WalletHashSchema,
  source:z.literal('RPC_OBSERVATION'),confirmation:z.literal('RECEIPT_CONFIRMED'),
});
export const WalletReviewSchema = z.strictObject({
  schemaVersion: z.literal('wallet-review-v1'), reviewId: z.string(), clientRequestId: z.string(),
  traceId: WalletLinkIdSchema.optional(), parentAgentId: WalletLinkIdSchema.optional(), graphRunId: WalletLinkIdSchema.optional(),
  inputDigest: z.string(), transactionDigest: z.string().nullable(),
  transaction: WalletTransactionSchema, intent: WalletIntentSchema,
  preparedTransaction: PreparedWalletTransactionSchema.nullable(),
  status: z.enum(['QUEUED', 'REVIEWING', 'ALLOWED', 'BLOCKED', 'UNCERTAIN', 'CONSUMED', 'CANCELLED', 'INTERRUPTED', 'EXPIRED']),
  reason: z.string(), createdAt: z.number(), expiresAt: z.number().nullable(),
  checks: z.array(WalletCheckSchema),
  events: z.array(z.strictObject({sequence: z.number(), kind: z.enum(['STATE','TOOL_START','TOOL_END']), name:z.string(), at:z.number()})),
  reviewer: z.strictObject({modelId:z.string(), source:z.enum(['LIVE','TEST_TRANSPORT']), verdict:z.enum(['ALLOW','BLOCK','UNCERTAIN']).nullable()}),
  usage: z.strictObject({requests:z.number(), inputTokens:z.number(), outputTokens:z.number(), cacheReadTokens:z.number(), cacheWriteTokens:z.number(), costUsd:z.number().nullable()}),
  // A preflight result is neither a transaction receipt nor a guarantee of future state.
  broadcastStatus: z.literal('NOT_BROADCAST_BY_SERVER'),
  receiptReport: WalletReceiptReportSchema.optional(),
  postState: WalletPostStateSchema.optional(),
  evidenceRef:WalletHashSchema.optional(),
});
export const ConsumeWalletReviewSchema = z.strictObject({transaction: PreparedWalletTransactionSchema});
export const BroadcastWalletReviewSchema = z.strictObject({txHash:z.string().regex(/^0x[0-9a-fA-F]{64}$/)});
export const WalletMetaSchema = z.strictObject({
  configured:z.boolean(), reason:z.string(), supportedOperations:z.array(z.literal('native_transfer')),
  networks:z.array(z.strictObject({chainId:WalletQuantitySchema, name:z.string(), maxValueWei:Amount, maxTotalFeeWei:Amount, nativeSymbol:z.string().optional(), ready:z.boolean()})),
});
export type WalletTransaction = z.infer<typeof WalletTransactionSchema>;
export type PreparedWalletTransaction = z.infer<typeof PreparedWalletTransactionSchema>;
export type WalletIntent = z.infer<typeof WalletIntentSchema>;
export type WalletReview = z.infer<typeof WalletReviewSchema>;
export type WalletCheck = z.infer<typeof WalletCheckSchema>;
export type WalletReceiptReport = z.infer<typeof WalletReviewSchema>['receiptReport'];
export type WalletPostState = z.infer<typeof WalletReviewSchema>['postState'];

// Local/private export for explicit exchange. Never put this packet in Agent Graph or A evidence.
export const WalletEvidenceBodySchema = z.strictObject({
  version:z.literal('wallet-observation-v1'),chainId:z.literal('0x3c8'),nativeSymbol:z.literal('tBOT'),
  walletReviewId:WalletLinkIdSchema,traceId:WalletLinkIdSchema,
  observationSource:z.enum(['LIVE','TEST_TRANSPORT']),capturedAt:z.string().datetime(),
  intent:WalletIntentSchema,preparedTransaction:PreparedWalletTransactionSchema,
  before:WalletStateObservationSchema,transaction:WalletObservedTransactionSchema,
  receipt:WalletObservedReceiptSchema,after:WalletStateObservationSchema,postState:WalletPostStateSchema,
  authority:z.literal('RPC_OBSERVATION_ONLY'),
});
export const WalletEvidencePacketSchema=z.strictObject({evidenceRef:WalletHashSchema,body:WalletEvidenceBodySchema});
export const ReplayWalletEvidenceSchema=z.strictObject({packet:WalletEvidencePacketSchema});
export const WalletEvidenceReplaySchema=z.strictObject({
  evidenceRef:WalletHashSchema,integrity:z.enum(['VERIFIED','MISMATCH']),
  status:z.enum(['MATCH','MISMATCH','UNKNOWN']),reason:z.string(),
  authority:z.literal('RPC_OBSERVATION_ONLY'),reviewAndPermit:z.literal('NOT_REPLAYED'),
  observationSource:z.enum(['LIVE','TEST_TRANSPORT']),postState:WalletPostStateSchema.optional(),
});
export type WalletStateObservation=z.infer<typeof WalletStateObservationSchema>;
export type WalletEvidencePacket=z.infer<typeof WalletEvidencePacketSchema>;
export type WalletEvidenceReplay=z.infer<typeof WalletEvidenceReplaySchema>;
