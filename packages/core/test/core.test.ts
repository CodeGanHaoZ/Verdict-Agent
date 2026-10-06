import test from 'node:test';
import assert from 'node:assert/strict';
import { verify_delivery, request_digest, hash_header } from '@verdict/core';
import { HeaderSchema, type VerificationResult, type ReasonCode } from '@verdict/protocol';
import { sample, snapshot } from '../../../fixtures/core/helpers.js';

const zero = '0x' + '00'.repeat(32);
function has(r: VerificationResult, reason: ReasonCode) { assert.ok(r.reasonCodes.includes(reason), JSON.stringify(r)); }

test('captured mainnet header hashes to independently recorded checkpoint', () => {
  assert.equal(hash_header(HeaderSchema.parse(snapshot.header)), '0xe0743902f44425ff740070d696e93edeba3f6cfb2424a3fd18fb342a61a3df8f');
  assert.equal(snapshot.crossCheck.stateRoot, snapshot.header.stateRoot);
});
test('real WETH inclusion proof, all fields and authorized EIP-712 signature pass', async () => {
  const s = await sample(); const r = await verify_delivery(s.request, s.delivery, s.context);
  assert.equal(r.verdict, 'PASS'); assert.equal(r.dataVerdict, 'PASS'); assert.equal(r.attributionStatus, 'VERIFIED');
  assert.equal(r.checks.find(c => c.checkId === 'field-balance')?.actual, '2148726676449398451377656');
  assert.equal(r.checks.find(c => c.checkId === 'account-proof')?.status, 'PASS');
  assert.deepEqual(r.reasonCodes, []); assert.ok(r.checks.every(c => c.evidenceRefs.length));
});
test('real non-existence proof validates explicit absence sentinels', async () => {
  const s = await sample(1); const r = await verify_delivery(s.request, s.delivery, s.context);
  assert.equal(r.verdict, 'PASS'); assert.match(r.checks.find(c => c.checkId === 'account-proof')!.actual, /absent/);
  assert.equal(r.checks.find(c => c.checkId === 'field-balance')?.actual, '0');
});
test('signed wrong block is refused with attributable evidence', async () => {
  const s = await sample(); s.delivery.blockHash = zero;
  const r = await verify_delivery(s.request, await s.sign(s.delivery), s.context);
  assert.equal(r.verdict, 'FAIL'); assert.equal(r.attributionStatus, 'VERIFIED'); assert.equal(r.attributableFailure, true); has(r, 'BLOCK_MISMATCH');
});
test('signed wrong balance contradicts proof and fails; valid history itself is not stale', async () => {
  const s = await sample(); s.delivery.response!.values.balance = '1';
  const r = await verify_delivery(s.request, await s.sign(s.delivery), s.context);
  assert.equal(r.verdict, 'FAIL'); assert.equal(r.attributableFailure, true); has(r, 'FIELD_MISMATCH');
});
test('unsigned data can be verified without establishing provider attribution', async () => {
  const s = await sample(); delete s.delivery.signature;
  const strict = await verify_delivery(s.request, s.delivery, s.context);
  assert.equal(strict.dataVerdict, 'PASS'); assert.equal(strict.verdict, 'UNVERIFIABLE'); assert.equal(strict.attributionStatus, 'UNSIGNED');
  s.request.evidencePolicyId = 'proof-only-v1'; s.context.policy = { ...s.context.policy, id: 'proof-only-v1', requireSignature: false };
  s.delivery.requestHash = request_digest(s.request);
  const loose = await verify_delivery(s.request, s.delivery, s.context);
  assert.equal(loose.verdict, 'PASS'); assert.equal(loose.attributionStatus, 'UNSIGNED');
});
test('wrong unsigned value is rejected but cannot be publicly attributed', async () => {
  const s = await sample(); delete s.delivery.signature; s.delivery.response!.values.balance = '1';
  const r = await verify_delivery(s.request, s.delivery, s.context);
  assert.equal(r.verdict, 'FAIL'); assert.equal(r.attributableFailure, false);
});
test('post-signature mutation invalidates attribution and cannot become a provider accusation', async () => {
  const s = await sample(); s.delivery.response!.values.balance = '1';
  const r = await verify_delivery(s.request, s.delivery, s.context);
  assert.equal(r.verdict, 'FAIL'); assert.equal(r.attributionStatus, 'INVALID'); assert.equal(r.attributableFailure, false); has(r, 'SIGNATURE_INVALID');
});
test('invalid signature on otherwise valid data is UNVERIFIABLE, not a data failure', async () => {
  const s = await sample(); s.delivery.signature = '0x' + '00'.repeat(65);
  const r = await verify_delivery(s.request, s.delivery, s.context);
  assert.equal(r.dataVerdict, 'PASS'); assert.equal(r.verdict, 'UNVERIFIABLE'); assert.equal(r.attributionStatus, 'INVALID');
});
test('missing proof, header and requested value remain unknown', async () => {
  for (const field of ['accountProof', 'header', 'balance'] as const) {
    const s = await sample();
    if (field === 'balance') delete s.delivery.response!.values.balance; else delete s.delivery.response![field];
    const r = await verify_delivery(s.request, await s.sign(s.delivery), s.context);
    assert.equal(r.verdict, 'UNVERIFIABLE'); has(r, 'EVIDENCE_MISSING');
  }
});
test('truncated and corrupted proof cannot pass', async () => {
  for (const mode of ['truncated', 'corrupted']) {
    const s = await sample();
    if (mode === 'truncated') s.delivery.response!.accountProof!.pop();
    else s.delivery.response!.accountProof![0] = '0x00';
    const r = await verify_delivery(s.request, await s.sign(s.delivery), s.context);
    assert.equal(r.verdict, 'FAIL'); has(r, 'PROOF_INVALID');
  }
});
test('proof for a different account is not accepted under the requested address', async () => {
  const s = await sample(); s.delivery.response!.accountProof = snapshot.accounts[1].proof.accountProof;
  const r = await verify_delivery(s.request, await s.sign(s.delivery), s.context);
  assert.notEqual(r.verdict, 'PASS');
});
test('header tampering is found before proof verification', async () => {
  const s = await sample(); s.delivery.response!.header!.extraData = '0x';
  const r = await verify_delivery(s.request, await s.sign(s.delivery), s.context);
  assert.equal(r.verdict, 'FAIL'); has(r, 'HEADER_INVALID');
});
test('missing fork-specific header material is unknown, never reconstructed by defaults', async () => {
  const s = await sample(); delete s.delivery.response!.header!.requestsHash;
  const r = await verify_delivery(s.request, await s.sign(s.delivery), s.context);
  assert.equal(r.verdict, 'UNVERIFIABLE'); has(r, 'HEADER_UNSUPPORTED');
});
test('missing/conflicting/unfinalized baseline cannot be replaced by the service header', async () => {
  for (const mode of ['missing', 'conflicting', 'finality']) {
    const s = await sample();
    if (mode === 'missing') delete s.context.trustedBlock;
    else if (mode === 'conflicting') s.context.trustedBlock!.blockHash = zero;
    else s.context.policy.minimumFinality = 'finalized';
    const r = await verify_delivery(s.request, s.delivery, s.context);
    assert.equal(r.verdict, 'UNVERIFIABLE'); assert.equal(r.attributableFailure, false);
  }
});
test('unknown rule/schema/network are explicit unsupported results', async () => {
  const s = await sample();
  has(await verify_delivery(s.request, s.delivery, { ...s.context, ruleVersion: 'future-v9' }), 'RULE_UNSUPPORTED');
  has(await verify_delivery({ ...s.request, schemaVersion: '9' }, s.delivery, s.context), 'SCHEMA_UNSUPPORTED');
  has(await verify_delivery({ ...s.request, dataChainId: '999' }, s.delivery, s.context), 'NETWORK_UNSUPPORTED');
});
test('key absence, revocation and wrong identity chain cannot establish attribution', async () => {
  for (const mode of ['missing', 'revoked', 'chain']) {
    const s = await sample();
    if (mode === 'missing') s.context.keyBindings = [];
    else if (mode === 'revoked') s.context.keyBindings[0].revokedAt = s.context.evaluatedAt;
    else s.context.identityChainId = '2';
    const r = await verify_delivery(s.request, s.delivery, s.context);
    assert.equal(r.dataVerdict, 'PASS'); assert.equal(r.verdict, 'UNVERIFIABLE'); assert.equal(r.attributionStatus, 'UNRESOLVED');
  }
});
test('changing request, expiry or live consumption prevents reuse', async () => {
  const s = await sample();
  has(await verify_delivery({ ...s.request, requestId: 'other' }, s.delivery, s.context), 'REQUEST_MISMATCH');
  const expired = { ...s.context, evaluatedAt: String(BigInt(s.request.validity.expiresAt) + 1n) };
  has(await verify_delivery(s.request, s.delivery, expired), 'REQUEST_EXPIRED');
  const reused = { ...s.context, mode: 'live', consumedRequestIds: [s.request.requestId] };
  const r = await verify_delivery(s.request, s.delivery, reused);
  assert.equal(r.verdict, 'FAIL'); has(r, 'REQUEST_REPLAYED');
});
test('unsupported/rejected is a non-delivery observation, not an attributable data failure', async () => {
  for (const status of ['unsupported', 'rejected'] as const) {
    const s = await sample(); s.delivery.deliveryStatus = status; s.delivery.response = null;
    const r = await verify_delivery(s.request, await s.sign(s.delivery), s.context);
    assert.equal(r.verdict, 'UNVERIFIABLE'); assert.equal(r.attributableFailure, false);
  }
});
test('caller cannot silently downgrade the meaning of the signed policy', async () => {
  const s = await sample(); s.context.policy.requireSignature = false;
  const r = await verify_delivery(s.request, s.delivery, s.context);
  assert.equal(r.verdict, 'UNVERIFIABLE'); has(r, 'POLICY_UNSUPPORTED');
});

test('absence sentinels require a real non-existence proof and cannot excuse missing data', async () => {
  const s = await sample(1);
  s.delivery.response!.values.balance = '1';
  let r = await verify_delivery(s.request, await s.sign(s.delivery), s.context);
  assert.equal(r.verdict, 'FAIL'); has(r, 'FIELD_MISMATCH');
  s.delivery.response!.values.balance = '0'; delete s.delivery.response!.accountProof;
  r = await verify_delivery(s.request, await s.sign(s.delivery), s.context);
  assert.equal(r.verdict, 'UNVERIFIABLE'); has(r, 'EVIDENCE_MISSING');
});
test('domain, service version, response address and data chain changes are checked independently', async () => {
  const domain = await sample(); domain.delivery.identityChainId = '2';
  assert.equal((await verify_delivery(domain.request, domain.delivery, domain.context)).attributionStatus, 'UNRESOLVED');
  const version = await sample(); version.delivery.serviceVersion = 'other';
  assert.equal((await verify_delivery(version.request, await version.sign(version.delivery), version.context)).attributionStatus, 'UNRESOLVED');
  const address = await sample(); address.delivery.response!.account = snapshot.accounts[1].address;
  has(await verify_delivery(address.request, await address.sign(address.delivery), address.context), 'ACCOUNT_MISMATCH');
  const chain = await sample(); chain.delivery.response!.dataChainId = '2';
  has(await verify_delivery(chain.request, await chain.sign(chain.delivery), chain.context), 'CHAIN_MISMATCH');
});
