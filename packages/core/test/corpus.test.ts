import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { verify_delivery } from '@verdict/core';
import { sample } from '../../../fixtures/core/helpers.js';

const root = new URL('../../../fixtures/core/mainnet-corpus/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8')) as {
  snapshots: { file: string; sha256: string; blockHash: string }[];
  cases: { id: string; snapshotFile: string; accountIndex: number; expectedVerdict: string; expectedValues: Record<string, string> }[];
};
const load = (file: string) => JSON.parse(readFileSync(new URL(file, root), 'utf8'));

test('recorded corpus bytes match reviewed SHA-256 values and cross-source checkpoint', () => {
  for (const entry of manifest.snapshots) {
    const bytes = readFileSync(new URL(entry.file, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    const data = JSON.parse(bytes.toString('utf8'));
    assert.equal(data.header.hash, entry.blockHash);
    assert.equal(data.crossCheck.blockHash, entry.blockHash);
    assert.equal(data.crossCheck.stateRoot, data.header.stateRoot);
  }
});
for (const c of manifest.cases) {
  test(`real mainnet corpus: ${c.id}`, async () => {
    const s = await sample(c.accountIndex, load(c.snapshotFile));
    const r = await verify_delivery(s.request, s.delivery, s.context);
    assert.equal(r.verdict, c.expectedVerdict, JSON.stringify(r));
    assert.equal(r.dataVerdict, 'PASS'); assert.equal(r.attributionStatus, 'VERIFIED');
    assert.deepEqual(r.reasonCodes, []);
    const values = Object.fromEntries(r.checks.filter(check => check.checkId.startsWith('field-')).map(check => [check.checkId.slice(6), check.actual]));
    assert.deepEqual(values, c.expectedValues);
  });
}
test('valid historical proof mixed with another real block is rejected', async () => {
  const s = await sample(0, load('14000000.json'));
  const other = load('18000000.json');
  s.delivery.response!.accountProof = other.accounts[0].proof.accountProof;
  const r = await verify_delivery(s.request, await s.sign(s.delivery), s.context);
  assert.equal(r.verdict, 'FAIL'); assert.ok(r.reasonCodes.includes('PROOF_INVALID'));
});
test('same-block valid proof for a different real account is rejected', async () => {
  const data = load('26134149.json'); const s = await sample(0, data);
  s.delivery.response!.accountProof = data.accounts[2].proof.accountProof;
  const r = await verify_delivery(s.request, await s.sign(s.delivery), s.context);
  assert.equal(r.verdict, 'FAIL'); assert.ok(r.reasonCodes.includes('PROOF_INVALID') || r.reasonCodes.includes('FIELD_MISMATCH'));
});
