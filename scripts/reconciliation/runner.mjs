import { canonicalJson } from './artifact.mjs';
import { normalizeValue, validateDomainConfig } from './domains.mjs';

export const TOOL_VERSION = 'russell-vault-reconciliation/1.0.0';
const SEVERITY = { none: 0, cosmetic: 1, material: 2, financial: 3 };

function indexRows(rows, keyName, side) {
  const index = new Map();
  for (const row of rows) {
    if (!Object.hasOwn(row, keyName) || row[keyName] === null || row[keyName] === '') throw new Error(`${side} row is missing comparison key ${keyName}`);
    const key = row[keyName];
    if (!['string', 'number'].includes(typeof key) || (typeof key === 'number' && !Number.isFinite(key))) throw new Error(`${side} comparison keys must be finite numbers or strings`);
    const identity = canonicalJson(key);
    if (index.has(identity)) throw new Error(`${side} artifact has duplicate comparison key ${String(key)}`);
    index.set(identity, { key, row });
  }
  return index;
}

function aggregate(rows, config) {
  const numericSums = {};
  for (const field of config.aggregateNumericFields) {
    let sum = 0;
    for (const row of rows) {
      const value = row[field];
      if (value === null || value === undefined) continue;
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`aggregate numeric field ${field} must contain only finite numbers, null, or missing values`);
      sum += value;
      if (!Number.isSafeInteger(sum) && rows.every((candidate) => Number.isInteger(candidate[field] ?? 0))) throw new Error(`aggregate numeric field ${field} exceeds safe integer precision`);
    }
    numericSums[field] = Object.is(sum, -0) ? 0 : sum;
  }
  const groupCounts = {};
  for (const field of config.aggregateGroupFields) {
    const counts = new Map();
    for (const row of rows) {
      const encoded = canonicalJson(Object.hasOwn(row, field) ? row[field] : null);
      counts.set(encoded, (counts.get(encoded) ?? 0) + 1);
    }
    groupCounts[field] = Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
  }
  return { rowCount: rows.length, distinctComparisonKeyCount: rows.length, numericSums, groupCounts };
}

export function reconcileArtifacts(source, target, rawConfig) {
  const config = validateDomainConfig(rawConfig);
  const sourceIndex = indexRows(source.rows, config.comparisonKey, 'source');
  const targetIndex = indexRows(target.rows, config.comparisonKey, 'target');
  const identities = [...new Set([...sourceIndex.keys(), ...targetIndex.keys()])].sort();
  const findings = identities.map((identity) => {
    const left = sourceIndex.get(identity);
    const right = targetIndex.get(identity);
    if (!left) return { comparisonKeyValue: right.key, verdict: 'target_only', fieldDifferences: [], materiality: 'material' };
    if (!right) return { comparisonKeyValue: left.key, verdict: 'source_only', fieldDifferences: [], materiality: 'material' };
    const differences = [];
    let materiality = 'none';
    for (const field of config.comparedFields) {
      const sourceValue = Object.hasOwn(left.row, field.name) ? left.row[field.name] : null;
      const targetValue = Object.hasOwn(right.row, field.name) ? right.row[field.name] : null;
      if (canonicalJson(normalizeValue(sourceValue, field.normalize)) !== canonicalJson(normalizeValue(targetValue, field.normalize))) {
        differences.push({ field: field.name, source: sourceValue, target: targetValue });
        if (SEVERITY[field.materiality] > SEVERITY[materiality]) materiality = field.materiality;
      }
    }
    return { comparisonKeyValue: left.key, verdict: differences.length ? 'matched_with_differences' : 'matched_identical', fieldDifferences: differences, materiality };
  });
  const verdictCounts = Object.fromEntries(['matched_identical', 'matched_with_differences', 'source_only', 'target_only'].map((value) => [value, findings.filter((finding) => finding.verdict === value).length]));
  const materialityCounts = Object.fromEntries(['none', 'cosmetic', 'material', 'financial'].map((value) => [value, findings.filter((finding) => finding.materiality === value).length]));
  return {
    tool: TOOL_VERSION,
    domain: config.domain,
    comparisonKey: config.comparisonKey,
    sourceArtifact: source.metadata,
    targetArtifact: target.metadata,
    l1: { source: aggregate(source.rows, config), target: aggregate(target.rows, config), agreementIsReconciliationPass: false },
    findings,
    verdictCounts,
    materialityCounts,
  };
}
