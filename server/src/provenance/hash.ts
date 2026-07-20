// Deterministic hashing for import provenance.
//
// Two distinct hashes are recorded for every import:
//   * fileSha256    — SHA-256 of the raw bytes exactly as read from disk.
//                     Changes if so much as a byte of whitespace changes.
//   * contentSha256 — SHA-256 of the CANONICALIZED content that was actually
//                     parsed. Stable across insignificant reformatting, which
//                     is what makes "the same data, reimported" detectable.
//
// Both are computed BEFORE any transformation runs, so the recorded hash always
// describes the untransformed source.

import { createHash } from 'node:crypto';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export function sha256Bytes(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// Canonical JSON: object keys sorted lexicographically at every depth, no
// insignificant whitespace. Two payloads that differ only in key order or
// formatting canonicalize identically, so their hashes match.
export function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k] as JsonValue)}`);
  return `{${parts.join(',')}}`;
}

export function canonicalHash(value: JsonValue): string {
  return sha256Bytes(canonicalize(value));
}
