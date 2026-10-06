#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { parse_json_strict } from '@verdict/protocol';
import { replay_evidence } from '@verdict/evidence';

async function load(path: string): Promise<unknown> {
  const info = await stat(path);
  if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error('Input must be a regular JSON file of at most 2 MiB');
  return parse_json_strict(await readFile(path, 'utf8'));
}
async function main(): Promise<void> {
  const args = parseArgs({ allowPositionals: true, options: {
    context: { type: 'string' }, manifest: { type: 'string' }, json: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' },
  } });
  if (args.values.help) {
    console.log('z-verify <bundle.json> --context <trusted-context.json> [--manifest manifest.json] [--json]\nExit: 0 PASS; 2 verified FAIL; 3 unknown/context changed; 4 integrity/report mismatch; 1 input error.\nContext must be independently accepted by the verifier. No network calls are made.'); return;
  }
  if (args.positionals.length !== 1 || !args.values.context) throw new Error('Usage: z-verify <bundle.json> --context <trusted-context.json> [--manifest manifest.json] [--json]');
  const path = args.positionals[0];
  const [bundle, manifest, context] = await Promise.all([load(path), load(args.values.manifest ?? join(dirname(path), 'manifest.json')), load(args.values.context)]);
  const result = await replay_evidence(bundle, manifest, context);
  if (args.values.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Integrity: ${result.artifactIntegrity}\nReport comparison: ${result.comparison}\nVerdict: ${result.recomputedResult?.verdict ?? 'UNVERIFIABLE'}\nData: ${result.recomputedResult?.dataVerdict ?? 'UNVERIFIABLE'}\nAttribution: ${result.recomputedResult?.attributionStatus ?? 'UNRESOLVED'}`);
    for (const c of result.recomputedResult?.checks ?? []) console.log(`[${c.status}] ${c.checkId}: ${c.actual}${c.reasonCode ? ' (' + c.reasonCode + ')' : ''}`);
    console.log(`Reasons: ${result.reasonCodes.join(', ') || 'none'}`);
    console.log('Scope: caller-pinned block and key policy; no consensus or provider-independence guarantee.');
  }
  process.exitCode = result.artifactIntegrity === 'MISMATCH' || result.comparison === 'MISMATCH' ? 4
    : result.comparison !== 'MATCH' || !result.recomputedResult || result.recomputedResult.verdict === 'UNVERIFIABLE' ? 3
    : result.recomputedResult.verdict === 'FAIL' ? 2 : 0;
}
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Input error';
  console.error(JSON.stringify({ error: 'INPUT_INVALID', message })); process.exitCode = 1;
});
