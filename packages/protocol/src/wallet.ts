import { z } from 'zod';

// Separate from account-delivery evidence: these are pre-signing RPC observations.
export const WalletAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(s => s.toLowerCase());
export const WalletQuantitySchema = z.string().regex(/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/);
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
});
export const WalletCheckSchema = z.strictObject({
  id: z.string(), status: z.enum(['PASS', 'FAIL', 'UNKNOWN']), reason: z.string(),
  source: z.enum(['HARD_RULE', 'RPC_OBSERVATION']), facts: z.record(z.string(), z.string()),
});
export const WalletReviewSchema = z.strictObject({
  schemaVersion: z.literal('wallet-review-v1'), reviewId: z.string(), clientRequestId: z.string(),
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
});
export const ConsumeWalletReviewSchema = z.strictObject({transaction: PreparedWalletTransactionSchema});
export const WalletMetaSchema = z.strictObject({
  configured:z.boolean(), reason:z.string(), supportedOperations:z.array(z.literal('native_transfer')),
  networks:z.array(z.strictObject({chainId:WalletQuantitySchema, name:z.string(), maxValueWei:Amount, maxTotalFeeWei:Amount, ready:z.boolean()})),
});
export type WalletTransaction = z.infer<typeof WalletTransactionSchema>;
export type PreparedWalletTransaction = z.infer<typeof PreparedWalletTransactionSchema>;
export type WalletIntent = z.infer<typeof WalletIntentSchema>;
export type WalletReview = z.infer<typeof WalletReviewSchema>;
export type WalletCheck = z.infer<typeof WalletCheckSchema>;
