import {
  SCHEMA_VERSION, RULE_VERSION, canonical_json, EvidenceBundleSchema, EvidenceManifestSchema,
  TaskSpecSchema, DeliveryEnvelopeSchema, VerificationContextSchema, ProvenanceSchema,
  type EvidenceBundle, type EvidenceManifest, type ReasonCode, type ReplayResult,
} from '@verdict/protocol';
import { digest, verify_delivery } from '@verdict/core';

export type { ReplayResult } from '@verdict/protocol';
export async function build_evidence(requestInput: unknown, deliveryInput: unknown, contextInput: unknown, provenanceInput: unknown): Promise<{ bundle: EvidenceBundle; manifest: EvidenceManifest }> {
  const request = TaskSpecSchema.parse(requestInput);
  const delivery = DeliveryEnvelopeSchema.parse(deliveryInput);
  const context = VerificationContextSchema.parse(contextInput);
  const provenance = ProvenanceSchema.parse(provenanceInput);
  if (provenance.mode === 'UI_MOCK') throw new Error('UI_MOCK cannot be published as evidence');
  const result = await verify_delivery(request, delivery, context);
  const bundle = EvidenceBundleSchema.parse({
    schemaVersion: SCHEMA_VERSION, ruleVersion: context.ruleVersion,
    request, delivery, baseline: context.trustedBlock ?? null, contextHash: digest(context), result, provenance,
  });
  const manifest = EvidenceManifestSchema.parse({ schemaVersion: SCHEMA_VERSION, evidenceHash: digest(bundle), hashAlgorithm: 'keccak256-jcs', bundleFile: 'bundle.json' });
  return { bundle, manifest };
}
export async function replay_evidence(bundleInput: unknown, manifestInput: unknown, contextInput: unknown): Promise<ReplayResult> {
  const manifest = EvidenceManifestSchema.parse(manifestInput);
  const evidenceHash = digest(bundleInput);
  if (manifest.evidenceHash !== evidenceHash) return { artifactIntegrity: 'MISMATCH', comparison: 'NOT_COMPARABLE', evidenceHash, reasonCodes: ['ARTIFACT_MISMATCH'] };
  const bundle = EvidenceBundleSchema.parse(bundleInput);
  const context = VerificationContextSchema.parse(contextInput);
  if (bundle.provenance.mode === 'UI_MOCK') return { artifactIntegrity: 'VERIFIED', comparison: 'NOT_COMPARABLE', evidenceHash, reasonCodes: ['UI_MOCK_REJECTED'] };
  if (manifest.schemaVersion !== SCHEMA_VERSION || bundle.schemaVersion !== SCHEMA_VERSION) return { artifactIntegrity: 'VERIFIED', comparison: 'NOT_COMPARABLE', evidenceHash, reasonCodes: ['SCHEMA_UNSUPPORTED'] };
  // Re-run the bundle's rule only if the caller also accepts that rule. Unknown versions never fall back silently.
  const supported = bundle.ruleVersion === RULE_VERSION && context.ruleVersion === RULE_VERSION;
  const effectiveContext = supported ? context : { ...context, ruleVersion: bundle.ruleVersion !== RULE_VERSION ? bundle.ruleVersion : context.ruleVersion };
  const recomputedResult = await verify_delivery(bundle.request, bundle.delivery, effectiveContext);
  if (!supported) return { artifactIntegrity: 'VERIFIED', comparison: 'NOT_COMPARABLE', evidenceHash, recomputedResult, reasonCodes: ['RULE_UNSUPPORTED'] };
  const sameContext = digest(context) === bundle.contextHash;
  const matches = canonical_json(recomputedResult) === canonical_json(bundle.result)
    && canonical_json(bundle.baseline) === canonical_json(context.trustedBlock ?? null);
  const comparison = !sameContext ? 'CONTEXT_DIFFERENT' : matches ? 'MATCH' : 'MISMATCH';
  return { artifactIntegrity: 'VERIFIED', comparison, evidenceHash, recomputedResult,
    reasonCodes: [...new Set([...recomputedResult.reasonCodes, ...(!sameContext ? ['CONTEXT_MISMATCH' as const] : !matches ? ['REPORT_MISMATCH' as const] : [])])] };
}
/** Consumers must re-run the evidence under their own trust configuration before grouping it. */
export async function fact_key(bundleInput: unknown, contextInput: unknown): Promise<string> {
  const bundle = EvidenceBundleSchema.parse(bundleInput);
  if (bundle.schemaVersion !== SCHEMA_VERSION || bundle.ruleVersion !== RULE_VERSION || bundle.provenance.mode === 'UI_MOCK') throw new Error('Unsupported fact');
  const context = VerificationContextSchema.parse(contextInput);
  const result = await verify_delivery(bundle.request, bundle.delivery, context);
  if (result.attributionStatus !== 'VERIFIED' || result.verdict === 'UNVERIFIABLE'
      || (result.verdict === 'FAIL' && !result.attributableFailure)) throw new Error('Fact is not an attributable verified delivery');
  return digest({
    serviceId: bundle.delivery.serviceId, serviceVersion: bundle.delivery.serviceVersion,
    dataChainId: bundle.request.dataChainId, account: bundle.request.account, blockHash: bundle.request.blockHash,
    fields: [...bundle.request.fields].sort(), evidencePolicyId: bundle.request.evidencePolicyId, ruleVersion: bundle.ruleVersion,
    facts: result.checks.filter(c => c.scope === 'data').sort((a, b) => a.checkId.localeCompare(b.checkId)).map(c => ({ checkId: c.checkId, status: c.status, requirement: c.requirement, actual: c.actual, reasonCode: c.reasonCode ?? null })),
  });
}
