import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { TaskSpecSchema, DeliveryEnvelopeSchema, VerificationContextSchema, HeaderSchema, RULE_VERSION, SCHEMA_VERSION, type DeliveryEnvelope } from '@verdict/protocol';
import { delivery_typed_data, request_digest } from '@verdict/core';

export const snapshotPath = fileURLToPath(new URL('./ethereum-mainnet-26134149/snapshot.json', import.meta.url));
export const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
/** Local demonstration signer over real chain data, NOT a signature by the RPC provider. */
export async function sample(accountIndex = 0) {
  const signer = privateKeyToAccount(generatePrivateKey());
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = String(now + 3600);
  const record = snapshot.accounts[accountIndex];
  const request = TaskSpecSchema.parse({
    schemaVersion: SCHEMA_VERSION, requestId: 'sample-' + accountIndex, dataChainId: '1', account: record.address,
    blockHash: snapshot.header.hash, fields: ['balance', 'nonce', 'codeHash', 'storageRoot'], evidencePolicyId: 'signed-account-v1',
    validity: { notBefore: String(now - 60), expiresAt }, budget: { maxAttempts: 3, timeoutMs: 10000, maxCostWei: '0' },
  });
  const context = VerificationContextSchema.parse({
    schemaVersion: SCHEMA_VERSION, contextId: 'local-mainnet-checkpoint-demo', ruleVersion: RULE_VERSION,
    mode: 'historical', evaluatedAt: String(now), timeSource: 'Local export/test evaluation time; not proof of RPC delivery time',
    policy: { id: request.evidencePolicyId, requireSignature: true, minimumFinality: 'any-pinned' },
    trustedBlock: { dataChainId: '1', blockHash: snapshot.header.hash, stateRoot: snapshot.header.stateRoot, source: snapshot.baselineSource + ' (caller-accepted checkpoint)', finality: 'unfinalized' },
    identityChainId: '1', keyBindings: [{ serviceId: 'local-fixture-adapter', serviceVersion: '1', identityChainId: '1', signer: signer.address.toLowerCase(), validFrom: String(now - 60), validUntil: expiresAt, authority: 'Explicitly accepted local demo key; not the RPC provider identity' }], consumedRequestIds: [],
  });
  const unsigned = DeliveryEnvelopeSchema.parse({
    schemaVersion: SCHEMA_VERSION, serviceId: 'local-fixture-adapter', serviceVersion: '1', requestHash: request_digest(request),
    dataChainId: '1', blockHash: request.blockHash, identityChainId: '1', deliveryStatus: 'delivered', issuedAt: String(now), expiresAt,
    response: { dataChainId: '1', blockHash: request.blockHash, account: request.account,
      values: { balance: BigInt(record.proof.balance).toString(), nonce: BigInt(record.proof.nonce).toString(), codeHash: record.proof.codeHash, storageRoot: record.proof.storageHash },
      header: HeaderSchema.parse(snapshot.header), accountProof: record.proof.accountProof },
  });
  const sign = async (delivery: DeliveryEnvelope) => DeliveryEnvelopeSchema.parse({ ...delivery, signature: await signer.signTypedData(delivery_typed_data(delivery)) });
  const delivery = await sign(unsigned);
  const provenance = { mode: 'FROZEN' as const, source: snapshot.proofSource, capturedAt: String(Math.floor(Date.parse(snapshot.capturedAt) / 1000)), description: 'Real Ethereum mainnet account proof; local fixture adapter signature generated at export time. Provider attribution is NOT claimed.' };
  return { request, context, delivery, provenance, sign };
}
