import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, cp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { canonical_json } from '@verdict/protocol';
import { build_evidence } from '@verdict/evidence';
import { digest } from '@verdict/core';
import { sample } from '../../../fixtures/core/helpers.js';

const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
function run(dir: string, context = true) {
  return spawnSync(process.execPath, [cli, join(dir, 'bundle.json'), ...(context ? ['--context', join(dir, 'trusted-context.json')] : []), '--json'], { cwd: tmpdir(), encoding: 'utf8', timeout: 10000 });
}
test('separate process replays copied evidence after original export directory is removed', async () => {
  const first = await mkdtemp(join(tmpdir(), 'verdict-export-')); const second = await mkdtemp(join(tmpdir(), 'verdict-replay-'));
  try {
    const s = await sample(); const e = await build_evidence(s.request, s.delivery, s.context, s.provenance);
    await writeFile(join(first, 'bundle.json'), canonical_json(e.bundle)); await writeFile(join(first, 'manifest.json'), canonical_json(e.manifest)); await writeFile(join(first, 'trusted-context.json'), canonical_json(s.context));
    await cp(first, second, { recursive: true }); await rm(first, { recursive: true, force: true });
    let child = run(second); assert.equal(child.status, 0, child.stderr); assert.equal(JSON.parse(child.stdout).comparison, 'MATCH');
    assert.deepEqual(JSON.parse(child.stdout).recomputedResult, e.bundle.result);
    child = run(second, false); assert.equal(child.status, 1); // context is mandatory, never auto-trusted from export
    e.bundle.delivery.response!.values.balance = '1'; await writeFile(join(second, 'bundle.json'), canonical_json(e.bundle));
    child = run(second); assert.equal(child.status, 4); assert.equal(JSON.parse(child.stdout).artifactIntegrity, 'MISMATCH');
    e.manifest.evidenceHash = digest(e.bundle); await writeFile(join(second, 'manifest.json'), canonical_json(e.manifest));
    child = run(second); assert.equal(child.status, 4); assert.equal(JSON.parse(child.stdout).recomputedResult.attributionStatus, 'INVALID');
    const text = await readFile(join(second, 'bundle.json'), 'utf8');
    await writeFile(join(second, 'bundle.json'), text.replace('{', '{"schemaVersion":"9",'));
    child = run(second); assert.equal(child.status, 1); assert.match(child.stderr, /Duplicate JSON key/);
  } finally { await rm(first, { recursive: true, force: true }); await rm(second, { recursive: true, force: true }); }
});
test('CLI exit codes distinguish truthful failing report and unknown rule from file errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'verdict-exit-'));
  try {
    const s = await sample(); s.delivery.response!.values.balance = '1'; s.delivery = await s.sign(s.delivery);
    let e = await build_evidence(s.request, s.delivery, s.context, s.provenance);
    async function save() { await writeFile(join(dir, 'bundle.json'), canonical_json(e.bundle)); await writeFile(join(dir, 'manifest.json'), canonical_json(e.manifest)); await writeFile(join(dir, 'trusted-context.json'), canonical_json(s.context)); }
    await save(); let child = run(dir); assert.equal(child.status, 2, child.stderr); assert.equal(JSON.parse(child.stdout).comparison, 'MATCH');
    s.context.ruleVersion = 'future'; e = await build_evidence(s.request, s.delivery, s.context, s.provenance);
    await save(); child = run(dir); assert.equal(child.status, 3); assert.ok(JSON.parse(child.stdout).reasonCodes.includes('RULE_UNSUPPORTED'));
    await rm(join(dir, 'bundle.json')); child = run(dir); assert.equal(child.status, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
