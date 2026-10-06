import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { canonical_json } from '@verdict/protocol';
import { build_evidence } from '@verdict/evidence';
import { sample } from './helpers.js';

const directory = resolve(process.argv[2] ?? '.local/a-demo');
await mkdir(directory, { recursive: true });
const input = await sample();
const { bundle, manifest } = await build_evidence(input.request, input.delivery, input.context, input.provenance);
if (bundle.result.verdict !== 'PASS') throw new Error('Real sample did not pass: ' + JSON.stringify(bundle.result));
await writeFile(join(directory, 'bundle.json'), canonical_json(bundle));
await writeFile(join(directory, 'manifest.json'), canonical_json(manifest));
await writeFile(join(directory, 'trusted-context.json'), canonical_json(input.context));
console.log(JSON.stringify({ directory, blockHash: bundle.request.blockHash, account: bundle.request.account, verdict: bundle.result.verdict, dataVerdict: bundle.result.dataVerdict, attribution: bundle.result.attributionStatus, evidenceHash: manifest.evidenceHash, notice: 'Generated local adapter signature, not RPC provider signature. Review and independently accept trusted-context.json before replay.' }, null, 2));
