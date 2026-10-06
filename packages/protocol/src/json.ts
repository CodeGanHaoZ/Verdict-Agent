import canonicalize from 'canonicalize';
import { parseTree, type Node, type ParseError } from 'jsonc-parser';

export const MAX_JSON_BYTES = 2 * 1024 * 1024;
function valid_string(s: string): void {
  // RFC 8785 requires rejection of lone UTF-16 surrogates.
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s)) throw new Error('Invalid Unicode surrogate');
}
function validate(value: unknown, depth = 0, seen = new Set<object>()): void {
  if (depth > 64) throw new Error('JSON nesting limit');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') { valid_string(value); return; }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error('Unsafe JSON number; use decimal strings');
    return;
  }
  if (typeof value !== 'object') throw new Error('Non-JSON value');
  if (seen.has(value)) throw new Error('Cyclic JSON');
  seen.add(value);
  if (Array.isArray(value)) { for (const v of value) validate(v, depth + 1, seen); }
  else {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Non-plain JSON object');
    for (const [key, v] of Object.entries(value)) { valid_string(key); validate(v, depth + 1, seen); }
  }
  seen.delete(value);
}
export function canonical_json(value: unknown): string {
  validate(value);
  const result = canonicalize(value);
  if (typeof result !== 'string') throw new Error('Cannot canonicalize value');
  if (new TextEncoder().encode(result).length > MAX_JSON_BYTES) throw new Error('JSON byte limit');
  return result;
}
export function parse_json_strict(text: string): unknown {
  if (new TextEncoder().encode(text).length > MAX_JSON_BYTES) throw new Error('JSON byte limit');
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false });
  if (!root || errors.length) throw new Error('Invalid strict JSON');
  function inspect(node: Node, depth: number): void {
    if (depth > 64) throw new Error('JSON nesting limit');
    if (node.type === 'object') {
      const keys = new Set<string>();
      for (const prop of node.children ?? []) {
        const key = prop.children![0].value as string;
        if (keys.has(key)) throw new Error('Duplicate JSON key');
        keys.add(key);
      }
    }
    for (const child of node.children ?? []) inspect(child, depth + 1);
  }
  inspect(root, 0);
  const value: unknown = JSON.parse(text);
  validate(value);
  return value;
}
