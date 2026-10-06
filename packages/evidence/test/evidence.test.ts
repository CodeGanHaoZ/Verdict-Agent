import test from 'node:test';
import assert from 'node:assert/strict';
import { build_evidence, replay_evidence, fact_key } from '@verdict/evidence';
import { digest, request_digest } from '@verdict/core';
import { sample } from '../../../fixtures/core/helpers.js';

test('bundle export and recomputation reproduce full result', async () => {
  const s = await sample(); const e = await build_evidence(s.request, s.delivery, s.context, s.provenance);
  const r = await replay_evidence(e.bundle, e.manifest, s.context);
  assert.equal(r.artifactIntegrity, 'VERIFIED'); assert.equal(r.comparison, 'MATCH');
  assert.deepEqual(r.recomputedResult, e.bundle.result);
  assert.equal('evidenceHash' in e.bundle, false);
});
test('tampering is detected against manifest without using original verdict', async () => {
  const s = await sample(); const e = await build_evidence(s.request, s.delivery, s.context, s.provenance);
  e.bundle.delivery.response!.values.balance = '1';
  const r = await replay_evidence(e.bundle, e.manifest, s.context);
  assert.equal(r.artifactIntegrity, 'MISMATCH'); assert.equal(r.recomputedResult, undefined);
});
test('re-hashing a forged report does not evade re-execution', async () => {
  const s = await sample(); const e = await build_evidence(s.request, s.delivery, s.context, s.provenance);
  e.bundle.result.verdict = 'FAIL'; e.manifest.evidenceHash = digest(e.bundle);
  const r = await replay_evidence(e.bundle, e.manifest, s.context);
  assert.equal(r.artifactIntegrity, 'VERIFIED'); assert.equal(r.comparison, 'MISMATCH'); assert.equal(r.recomputedResult!.verdict, 'PASS');
});
test('re-hashing a changed signed answer still fails signature and field checks', async () => {
  const s = await sample(); const e = await build_evidence(s.request, s.delivery, s.context, s.provenance);
  e.bundle.delivery.response!.values.balance = '1'; e.manifest.evidenceHash = digest(e.bundle);
  const r = await replay_evidence(e.bundle, e.manifest, s.context);
  assert.equal(r.comparison, 'MISMATCH'); assert.equal(r.recomputedResult!.verdict, 'FAIL'); assert.equal(r.recomputedResult!.attributionStatus, 'INVALID');
});
test('new caller trust config is used, never package-declared identity', async () => {
  const s = await sample(); const e = await build_evidence(s.request, s.delivery, s.context, s.provenance);
  const r = await replay_evidence(e.bundle, e.manifest, { ...s.context, keyBindings: [] });
  assert.equal(r.comparison, 'CONTEXT_DIFFERENT'); assert.equal(r.recomputedResult!.verdict, 'UNVERIFIABLE');
});
test('bundle baseline cannot lie even after content hash is recomputed', async () => {
  const s = await sample(); const e = await build_evidence(s.request, s.delivery, s.context, s.provenance);
  e.bundle.baseline!.stateRoot = '0x' + '00'.repeat(32); e.manifest.evidenceHash = digest(e.bundle);
  const r = await replay_evidence(e.bundle, e.manifest, s.context);
  assert.equal(r.comparison, 'MISMATCH');
});
test('unknown schema or rule is not replayed using a silent replacement', async () => {
  const s = await sample();
  for (const which of ['rule', 'schema']) {
    const e = await build_evidence(s.request, s.delivery, s.context, s.provenance);
    if (which === 'rule') e.bundle.ruleVersion = 'unknown'; else e.bundle.schemaVersion = '9';
    e.manifest.evidenceHash = digest(e.bundle);
    const r = await replay_evidence(e.bundle, e.manifest, s.context);
    assert.equal(r.comparison, 'NOT_COMPARABLE'); assert.notEqual(r.recomputedResult?.verdict, 'PASS');
  }
});
test('UI mock is rejected from evidence creation and imported replay', async () => {
  const s = await sample(); await assert.rejects(() => build_evidence(s.request, s.delivery, s.context, { ...s.provenance, mode: 'UI_MOCK' }));
  const e = await build_evidence(s.request, s.delivery, s.context, s.provenance);
  e.bundle.provenance.mode = 'UI_MOCK'; e.manifest.evidenceHash = digest(e.bundle);
  const r = await replay_evidence(e.bundle, e.manifest, s.context);
  assert.deepEqual(r.reasonCodes, ['UI_MOCK_REJECTED']);
});
test('fact grouping ignores request IDs, signature randomness and reporter metadata', async () => {
  const s = await sample(); const first = await build_evidence(s.request, s.delivery, s.context, s.provenance);
  s.request.requestId = 'different-nonce'; s.delivery.requestHash = request_digest(s.request);
  const second = await build_evidence(s.request, await s.sign(s.delivery), s.context, { ...s.provenance, description: 'Re-reported same verified fact' });
  assert.notEqual(first.manifest.evidenceHash, second.manifest.evidenceHash);
  assert.equal(await fact_key(first.bundle, s.context), await fact_key(second.bundle, s.context));
  s.delivery.response!.values.balance = '1';
  const wrong = await build_evidence(s.request, await s.sign(s.delivery), s.context, s.provenance);
  assert.notEqual(await fact_key(first.bundle, s.context), await fact_key(wrong.bundle, s.context));
});
