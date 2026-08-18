import { createHash } from 'node:crypto';

export class ArtifactError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ArtifactError';
  }
}

export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ArtifactError('evidence contains a non-finite number');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new ArtifactError(`unsupported evidence value: ${typeof value}`);
}

export function parseArtifact(bytes, label) {
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new ArtifactError(`${label} artifact is not valid JSON`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.artifactVersion !== 1 || !Array.isArray(value.rows)) {
    throw new ArtifactError(`${label} artifact must be an object with artifactVersion 1 and a rows array`);
  }
  if (value.rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new ArtifactError(`${label} artifact rows must be objects`);
  }
  return {
    rows: value.rows,
    metadata: {
      artifactVersion: value.artifactVersion,
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  };
}
