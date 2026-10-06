import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical_json, parse_json_strict, TaskSpecSchema, DeliveryEnvelopeSchema, HashSchema, SIGNING_DOMAIN } from '@verdict/protocol';
import { sample } from '../../../fixtures/core/helpers.js';

test('RFC 8785 number serialization and UTF-16 property order', () => {
  assert.equal(canonical_json({ numbers: [333333333.33333329, 1e-27, 0.002], '\u20ac': 2, '😀': 3, a: 1 }), '{"a":1,"numbers":[333333333.3333333,1e-27,0.002],"€":2,"😀":3}');
  assert.equal(canonical_json({ b: [2, 1], a: -0 }), '{"a":0,"b":[2,1]}');
  assert.equal(HashSchema.parse(SIGNING_DOMAIN.salt).length, 66);
});
test('strict JSON rejects duplicates, comments, trailing commas and unsafe numbers', () => {
  for (const text of ['{"a":1,"a":2}', '{"x":{"a":1,"\\u0061":2}}', '{"a":1,}', '{/*x*/"a":1}', '[9007199254740993]', '{"x":"\\ud800"}', 'true false']) assert.throws(() => parse_json_strict(text));
  assert.deepEqual(parse_json_strict('{"a":"9007199254740993"}'), { a: '9007199254740993' });
});
test('canonicalization rejects non JSON and excessive input', () => {
  for (const value of [NaN, Infinity, 1n, undefined, { a: undefined }, new Date(), '\ud800', { ['\udc00']: 1 }, Array(2)]) assert.throws(() => canonical_json(value));
  assert.throws(() => parse_json_strict(' '.repeat(2 * 1024 * 1024 + 1)));
  assert.throws(() => parse_json_strict('['.repeat(70) + '0' + ']'.repeat(70)));
});
test('schemas reject unexpected keys, floats, duplicate fields, invalid encodings and excessive proofs', async () => {
  const s = await sample();
  assert.throws(() => TaskSpecSchema.parse({ ...s.request, verdict: 'PASS' }));
  assert.throws(() => TaskSpecSchema.parse({ ...s.request, dataChainId: '01' }));
  assert.throws(() => TaskSpecSchema.parse({ ...s.request, dataChainId: (2n ** 256n).toString() }));
  assert.throws(() => TaskSpecSchema.parse({ ...s.request, fields: ['balance', 'balance'] }));
  assert.throws(() => TaskSpecSchema.parse({ ...s.request, validity: { notBefore: '10', expiresAt: '9' } }));
  assert.throws(() => TaskSpecSchema.parse({ ...s.request, budget: { ...s.request.budget, maxAttempts: 1.5 } }));
  assert.throws(() => DeliveryEnvelopeSchema.parse({ ...s.delivery, response: { ...s.delivery.response, accountProof: Array(65).fill('0x01') } }));
});
