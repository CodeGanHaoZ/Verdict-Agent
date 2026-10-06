#!/usr/bin/env python3
"""Fetch public, pinned Ethereum proof material to ignored local staging; no transactions."""
import argparse
import datetime
import json
from pathlib import Path
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--block', default='latest', help='latest, safe, finalized, or hex block number')
parser.add_argument('--proof-source', choices=['https://eth.drpc.org', 'https://ethereum-rpc.publicnode.com'], default='https://eth.drpc.org')
args = parser.parse_args()
baseline_source = 'https://ethereum-rpc.publicnode.com' if args.proof_source != 'https://ethereum-rpc.publicnode.com' else 'https://eth.drpc.org'


def rpc(url, method, params):
    request = urllib.request.Request(url, data=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode(), headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(request, timeout=25) as response:
        result = json.loads(response.read(2 * 1024 * 1024))
    if 'error' in result:
        raise RuntimeError(f'{method}: {result["error"]}')
    return result['result']


if rpc(args.proof_source, 'eth_chainId', []) != '0x1' or rpc(baseline_source, 'eth_chainId', []) != '0x1':
    raise RuntimeError('Expected Ethereum mainnet')
block = rpc(args.proof_source, 'eth_getBlockByNumber', [args.block, False])
if not block:
    raise RuntimeError('Block unavailable')
accounts = []
for address in ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', '0x6f6e2d636861696e2d73616d706c652d61303031']:
    proof = rpc(args.proof_source, 'eth_getProof', [address, [], block['number']])
    if rpc(args.proof_source, 'eth_getBlockByNumber', [block['number'], False])['hash'] != block['hash']:
        raise RuntimeError('Block changed while acquiring proof; discard this capture')
    accounts.append({'address': address, 'proof': proof, 'queryMode': 'blockNumber-with-hash-check'})
other = rpc(baseline_source, 'eth_getBlockByHash', [block['hash'], False])
if not other or other['hash'] != block['hash'] or other['stateRoot'] != block['stateRoot']:
    raise RuntimeError('Sources disagree; do not create a trusted baseline')
result = {'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'chainId': '1', 'baselineSource': baseline_source, 'proofSource': args.proof_source, 'header': block, 'crossCheckHeader': other, 'accounts': accounts}
output = Path('.local/capture') / (block['hash'] + '.json')
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'path': str(output), 'blockNumber': int(block['number'], 16), 'blockHash': block['hash'], 'proofNodes': [len(a['proof']['accountProof']) for a in accounts], 'status': 'Captured only; cryptographic verification and human baseline acceptance still required. Two sources do not prove consensus or independence.'}))
