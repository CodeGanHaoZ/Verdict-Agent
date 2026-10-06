import { createBlockHeaderFromRPC } from '@ethereumjs/block';
import { Common, Mainnet } from '@ethereumjs/common';
import { verifyMerkleProof } from '@ethereumjs/mpt';
import { bytesToHex, hexToBytes, createAccountFromRLP } from '@ethereumjs/util';
import { keccak256, toBytes, recoverTypedDataAddress } from 'viem';
import {
  SCHEMA_VERSION, RULE_VERSION, SIGNING_DOMAIN, DELIVERY_TYPES, canonical_json,
  TaskSpecSchema, DeliveryEnvelopeSchema, VerificationContextSchema,
  type TaskSpec, type DeliveryEnvelope, type VerificationContext, type VerificationResult,
  type CheckResult, type ReasonCode, type Header, type Verdict,
} from '@verdict/protocol';

export const digest = (value: unknown): `0x${string}` => keccak256(toBytes(canonical_json(value)));
export const request_digest = (request: TaskSpec): `0x${string}` => digest(TaskSpecSchema.parse(request));
/** One EIP-712 payload for signers and verifiers; never accepts a precomputed response digest. */
export function delivery_typed_data(input: DeliveryEnvelope) {
  const d = DeliveryEnvelopeSchema.parse(input);
  return {
    domain: { ...SIGNING_DOMAIN, chainId: BigInt(d.identityChainId) }, types: DELIVERY_TYPES,
    primaryType: 'Delivery' as const,
    message: { serviceId: d.serviceId, serviceVersion: d.serviceVersion, requestHash: d.requestHash as `0x${string}`,
      responseHash: digest(d.response), deliveryStatus: d.deliveryStatus, dataChainId: BigInt(d.dataChainId),
      blockHash: d.blockHash as `0x${string}`, issuedAt: BigInt(d.issuedAt), expiresAt: BigInt(d.expiresAt) },
  };
}
/** RPC extras must be filtered by adapters, never silently by the verifier. */
export function hash_header(header: Header): string {
  const common = new Common({ chain: Mainnet });
  common.setHardforkBy({ blockNumber: BigInt(header.number), timestamp: BigInt(header.timestamp) });
  const forkFields: [number, (keyof Header)[]][] = [
    [1559, ['baseFeePerGas']], [4895, ['withdrawalsRoot']],
    [4844, ['blobGasUsed', 'excessBlobGas']], [4788, ['parentBeaconBlockRoot']], [7685, ['requestsHash']],
  ];
  for (const [eip, fields] of forkFields) {
    for (const field of fields) {
      if (common.isActivatedEIP(eip) !== (header[field] !== undefined)) throw new Error(`Hardfork field mismatch: ${field}`);
    }
  }
  // The RPC header constructor uses precisely the consensus header fields validated above.
  return bytesToHex(createBlockHeaderFromRPC(header as Parameters<typeof createBlockHeaderFromRPC>[0], { common }).hash());
}
function aggregate(checks: CheckResult[]): Verdict {
  if (checks.some(c => c.status === 'FAIL')) return 'FAIL';
  if (!checks.length || checks.some(c => c.status === 'UNKNOWN' || c.status === 'NOT_COVERED')) return 'UNVERIFIABLE';
  return 'PASS';
}
export async function verify_delivery(requestInput: unknown, deliveryInput: unknown, contextInput: unknown): Promise<VerificationResult> {
  // Invalid shape is an input error. Missing supported evidence is represented by optional fields below.
  const request = TaskSpecSchema.parse(requestInput);
  const delivery = DeliveryEnvelopeSchema.parse(deliveryInput);
  const context = VerificationContextSchema.parse(contextInput);
  canonical_json({ request, delivery, context }); // Bound aggregate input before cryptographic work.
  const checks: CheckResult[] = [];
  let attribution: VerificationResult['attributionStatus'] = 'UNRESOLVED';
  const add = (checkId: string, scope: CheckResult['scope'], status: CheckResult['status'], requirement: string, actual: string, refs: string[], reasonCode?: ReasonCode) => {
    checks.push({ checkId, scope, status, requirement, actual, evidenceRefs: refs, ...(reasonCode ? { reasonCode } : {}) });
  };
  const match = (id: string, scope: CheckResult['scope'], expected: string, actual: string, refs: string[], reason: ReasonCode) => {
    add(id, scope, expected === actual ? 'PASS' : 'FAIL', expected, actual, refs, expected === actual ? undefined : reason);
    return expected === actual;
  };
  const finish = (): VerificationResult => {
    const dataVerdict = aggregate(checks.filter(c => c.scope === 'data'));
    const admission = aggregate(checks.filter(c => c.scope === 'admission'));
    let verdict: Verdict = dataVerdict === 'FAIL' || admission === 'FAIL' ? 'FAIL' :
      dataVerdict === 'PASS' && admission === 'PASS' ? 'PASS' : 'UNVERIFIABLE';
    if (context.policy.requireSignature && attribution !== 'VERIFIED' && verdict !== 'FAIL') verdict = 'UNVERIFIABLE';
    return {
      schemaVersion: SCHEMA_VERSION, ruleVersion: context.ruleVersion, verdict, dataVerdict,
      attributionStatus: attribution, deliveryStatus: delivery.deliveryStatus,
      reasonCodes: [...new Set(checks.flatMap(c => c.reasonCode ? [c.reasonCode] : []))], checks,
      attributableFailure: dataVerdict === 'FAIL' && attribution === 'VERIFIED' && admission === 'PASS'
        && checks.some(c => c.checkId === 'baseline' && c.status === 'PASS'),
    };
  };
  if ([request.schemaVersion, delivery.schemaVersion, context.schemaVersion].some(v => v !== SCHEMA_VERSION)) {
    add('schema', 'admission', 'UNKNOWN', SCHEMA_VERSION, 'Unsupported schema version', [], 'SCHEMA_UNSUPPORTED'); return finish();
  }
  if (context.ruleVersion !== RULE_VERSION) {
    add('rule', 'admission', 'UNKNOWN', RULE_VERSION, context.ruleVersion, [], 'RULE_UNSUPPORTED'); return finish();
  }
  if (request.dataChainId !== '1') {
    add('network', 'data', 'UNKNOWN', 'Ethereum mainnet (1)', request.dataChainId, ['#/request/dataChainId'], 'NETWORK_UNSUPPORTED'); return finish();
  }
  const policies: Record<string, boolean> = { 'signed-account-v1': true, 'proof-only-v1': false };
  const policyKnown = context.policy.id === request.evidencePolicyId && policies[request.evidencePolicyId] === context.policy.requireSignature;
  add('policy', 'admission', policyKnown ? 'PASS' : 'UNKNOWN', 'Caller-accepted supported policy', request.evidencePolicyId, ['#/request/evidencePolicyId'], policyKnown ? undefined : 'POLICY_UNSUPPORTED');
  match('request-binding', 'admission', request_digest(request), delivery.requestHash, ['#/request', '#/delivery/requestHash'], 'REQUEST_MISMATCH');
  const at = BigInt(context.evaluatedAt);
  const requestValid = at >= BigInt(request.validity.notBefore) && at <= BigInt(request.validity.expiresAt);
  add('request-validity', 'admission', requestValid ? 'PASS' : 'FAIL', 'Context time in request validity window', context.evaluatedAt, ['#/request/validity'], requestValid ? undefined : 'REQUEST_EXPIRED');
  const deliveryValid = BigInt(delivery.issuedAt) >= BigInt(request.validity.notBefore)
    && BigInt(delivery.issuedAt) <= at && at <= BigInt(delivery.expiresAt)
    && BigInt(delivery.expiresAt) <= BigInt(request.validity.expiresAt);
  add('delivery-validity', 'admission', deliveryValid ? 'PASS' : 'FAIL', 'Delivery valid at caller evaluation time', context.evaluatedAt, ['#/delivery/issuedAt', '#/delivery/expiresAt'], deliveryValid ? undefined : 'DELIVERY_EXPIRED');
  const replayed = context.mode === 'live' && context.consumedRequestIds.includes(request.requestId);
  add('request-replay', 'admission', replayed ? 'FAIL' : 'PASS', 'Unconsumed live request, or explicit historical replay', context.mode, ['#/request/requestId'], replayed ? 'REQUEST_REPLAYED' : undefined);

  if (!delivery.signature) {
    attribution = 'UNSIGNED';
    add('signature', 'attribution', 'UNKNOWN', 'Authorized service signature', 'No signature', ['#/delivery/signature'], 'SIGNATURE_MISSING');
  } else if (delivery.identityChainId !== context.identityChainId) {
    add('signature', 'attribution', 'UNKNOWN', context.identityChainId, delivery.identityChainId, ['#/delivery/identityChainId'], 'ATTRIBUTION_UNRESOLVED');
  } else {
    const bindings = context.keyBindings.filter(k => k.serviceId === delivery.serviceId && k.serviceVersion === delivery.serviceVersion
      && k.identityChainId === context.identityChainId && BigInt(k.validFrom) <= at && at <= BigInt(k.validUntil)
      && (k.revokedAt === undefined || at < BigInt(k.revokedAt)));
    if (!bindings.length) {
      add('signature', 'attribution', 'UNKNOWN', 'Caller-trusted key binding at evaluation time', 'No active key binding', ['#/delivery/serviceId'], 'ATTRIBUTION_UNRESOLVED');
    } else {
      try {
        const signer = (await recoverTypedDataAddress({ ...delivery_typed_data(delivery), signature: delivery.signature as `0x${string}` })).toLowerCase();
        const valid = bindings.some(k => k.signer === signer);
        attribution = valid ? 'VERIFIED' : 'INVALID';
        add('signature', 'attribution', valid ? 'PASS' : 'UNKNOWN', 'Recovered signer is authorized by caller', signer, ['#/delivery/signature'], valid ? undefined : 'SIGNATURE_INVALID');
      } catch {
        attribution = 'INVALID';
        add('signature', 'attribution', 'UNKNOWN', 'Recoverable authorized signature', 'Invalid EIP-712 signature', ['#/delivery/signature'], 'SIGNATURE_INVALID');
      }
    }
  }
  if (delivery.deliveryStatus !== 'delivered' || !delivery.response) {
    const code = delivery.deliveryStatus === 'unsupported' ? 'UNSUPPORTED' : delivery.deliveryStatus === 'rejected' ? 'REJECTED' : 'EVIDENCE_MISSING';
    add('delivery', 'data', 'UNKNOWN', 'Delivered account evidence', delivery.deliveryStatus, ['#/delivery'], code); return finish();
  }
  const response = delivery.response;
  match('delivery-chain', 'data', request.dataChainId, delivery.dataChainId, ['#/request/dataChainId', '#/delivery/dataChainId'], 'CHAIN_MISMATCH');
  match('response-chain', 'data', request.dataChainId, response.dataChainId, ['#/delivery/response/dataChainId'], 'CHAIN_MISMATCH');
  match('delivery-block', 'data', request.blockHash, delivery.blockHash, ['#/request/blockHash', '#/delivery/blockHash'], 'BLOCK_MISMATCH');
  match('response-block', 'data', request.blockHash, response.blockHash, ['#/delivery/response/blockHash'], 'BLOCK_MISMATCH');
  match('account', 'data', request.account, response.account, ['#/request/account', '#/delivery/response/account'], 'ACCOUNT_MISMATCH');
  const baseline = context.trustedBlock;
  if (!baseline) {
    add('baseline', 'data', 'UNKNOWN', 'Independently selected trusted block', 'Missing', ['#/baseline'], 'BASELINE_UNTRUSTED'); return finish();
  }
  const baselineMatches = baseline.blockHash === request.blockHash && baseline.dataChainId === request.dataChainId;
  const finalityOK = context.policy.minimumFinality === 'any-pinned'
    || context.policy.minimumFinality === 'safe' && ['safe', 'finalized'].includes(baseline.finality)
    || context.policy.minimumFinality === 'finalized' && baseline.finality === 'finalized';
  add('baseline', 'data', baselineMatches && finalityOK ? 'PASS' : 'UNKNOWN', 'Caller baseline matches request and finality policy', baseline.blockHash + '/' + baseline.finality, ['#/baseline'], baselineMatches && finalityOK ? undefined : 'BASELINE_CONFLICT');
  if (!baselineMatches || !finalityOK) return finish();
  if (!response.header) {
    add('header', 'data', 'UNKNOWN', 'Full fork-specific header', 'Missing', ['#/delivery/response/header'], 'EVIDENCE_MISSING'); return finish();
  }
  let computed: string;
  try { computed = hash_header(response.header); }
  catch {
    add('header', 'data', 'UNKNOWN', 'Supported complete Ethereum header', 'Header cannot be encoded under mainnet fork rules', ['#/delivery/response/header'], 'HEADER_UNSUPPORTED'); return finish();
  }
  const headerMatches = computed === baseline.blockHash && computed === response.header.hash && response.header.stateRoot === baseline.stateRoot;
  add('header', 'data', headerMatches ? 'PASS' : 'FAIL', baseline.blockHash + '/' + baseline.stateRoot, computed + '/' + response.header.stateRoot, ['#/delivery/response/header', '#/baseline'], headerMatches ? undefined : 'HEADER_INVALID');
  if (!headerMatches) return finish();
  if (!response.accountProof?.length) {
    add('account-proof', 'data', 'UNKNOWN', 'Account inclusion or absence proof', 'Missing', ['#/delivery/response/accountProof'], 'EVIDENCE_MISSING'); return finish();
  }
  let values: Record<string, string>;
  try {
    const encoded = await verifyMerkleProof(hexToBytes(request.account as `0x${string}`), response.accountProof.map(p => hexToBytes(p as `0x${string}`)), { root: hexToBytes(baseline.stateRoot as `0x${string}`), useKeyHashing: true });
    if (encoded === null) {
      // These are absence sentinels, not the hashes of an existing empty account.
      values = { balance: '0', nonce: '0', codeHash: '0x' + '00'.repeat(32), storageRoot: '0x' + '00'.repeat(32) };
      add('account-proof', 'data', 'PASS', 'Valid proof under trusted stateRoot', 'Account absent; protocol zero-hash absence sentinels', ['#/delivery/response/accountProof', '#/baseline/stateRoot']);
    } else {
      const account = createAccountFromRLP(encoded);
      values = { balance: account.balance.toString(), nonce: account.nonce.toString(), codeHash: bytesToHex(account.codeHash), storageRoot: bytesToHex(account.storageRoot) };
      add('account-proof', 'data', 'PASS', 'Valid proof under trusted stateRoot', 'Account inclusion verified', ['#/delivery/response/accountProof', '#/baseline/stateRoot']);
    }
  } catch {
    add('account-proof', 'data', 'FAIL', 'Valid proof under trusted stateRoot', 'Proof path, root or account encoding invalid', ['#/delivery/response/accountProof', '#/baseline/stateRoot'], 'PROOF_INVALID'); return finish();
  }
  // Check every supplied account field, and require every requested one.
  const fields = new Set([...request.fields, ...Object.keys(response.values)]);
  for (const field of fields) {
    const actual = response.values[field as keyof typeof response.values];
    if (actual === undefined) add('field-' + field, 'data', 'UNKNOWN', values[field], 'Missing requested field', ['#/delivery/response/values/' + field], 'EVIDENCE_MISSING');
    else match('field-' + field, 'data', values[field], actual, ['#/delivery/response/values/' + field, '#/delivery/response/accountProof'], 'FIELD_MISMATCH');
  }
  return finish();
}
