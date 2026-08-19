const MATERIALITIES = new Set(['none', 'cosmetic', 'material', 'financial']);
const NORMALIZATIONS = new Set(['trim', 'lowercase', 'trim_lowercase']);

export function validateDomainConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('domain config must be an object');
  for (const name of ['domain', 'comparisonKey']) {
    if (typeof config[name] !== 'string' || !config[name].trim()) throw new TypeError(`${name} must be a non-empty string`);
  }
  if (!Array.isArray(config.comparedFields) || config.comparedFields.length === 0) throw new TypeError('comparedFields must be non-empty');
  const names = config.comparedFields.map((field) => field.name);
  if (new Set(names).size !== names.length || names.includes(config.comparisonKey)) throw new TypeError('compared field names must be unique and exclude comparisonKey');
  for (const field of config.comparedFields) {
    if (!field || typeof field.name !== 'string' || !field.name || !MATERIALITIES.has(field.materiality)) throw new TypeError('each compared field needs a name and valid materiality');
    if (field.normalize !== undefined && !NORMALIZATIONS.has(field.normalize)) throw new TypeError(`unsupported normalization for ${field.name}`);
  }
  for (const group of ['aggregateNumericFields', 'aggregateGroupFields']) {
    if (!Array.isArray(config[group] ?? [])) throw new TypeError(`${group} must be an array`);
    if (new Set(config[group] ?? []).size !== (config[group] ?? []).length) throw new TypeError(`${group} must not contain duplicates`);
  }
  return Object.freeze({
    domain: config.domain,
    comparisonKey: config.comparisonKey,
    comparedFields: config.comparedFields.map((field) => Object.freeze({ ...field })),
    aggregateNumericFields: [...(config.aggregateNumericFields ?? [])],
    aggregateGroupFields: [...(config.aggregateGroupFields ?? [])],
  });
}

export function normalizeValue(value, rule) {
  if (!rule || typeof value !== 'string') return value;
  if (rule === 'trim') return value.trim();
  if (rule === 'lowercase') return value.toLowerCase();
  return value.trim().toLowerCase();
}
