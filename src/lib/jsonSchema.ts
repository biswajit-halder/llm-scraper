import { ValidationError } from './errors';

export type JsonObject = Record<string, unknown>;

/**
 * Sanitize a caller-supplied JSON Schema into the strict subset accepted by
 * OpenRouter structured outputs: no additional properties, every property
 * required, nullability carried by `type: ["string", "null"]`.
 */
export function toStrictJsonSchema(input: unknown): JsonObject {
  const result = sanitize(input, 0);
  if (result.type !== 'object' || !result.properties) {
    throw new ValidationError('schema.json_schema must describe an object with properties');
  }
  return result;
}

function sanitize(node: unknown, depth: number): JsonObject {
  if (depth > 12 || !node || typeof node !== 'object' || Array.isArray(node)) {
    return { type: 'string' };
  }
  const source = node as JsonObject;
  const out: JsonObject = {};

  if (typeof source.type === 'string' || Array.isArray(source.type)) out.type = source.type;
  if (typeof source.description === 'string') out.description = source.description.slice(0, 500);
  if (typeof source['x-grounded'] === 'boolean') out['x-grounded'] = source['x-grounded'];
  if (Array.isArray(source.enum)) out.enum = source.enum.slice(0, 50);
  if (typeof source.minimum === 'number') out.minimum = source.minimum;
  if (typeof source.maximum === 'number') out.maximum = source.maximum;
  if (typeof source.minLength === 'number') out.minLength = source.minLength;
  if (typeof source.maxLength === 'number') out.maxLength = source.maxLength;

  if (source.type === 'object' || (source.properties && typeof source.properties === 'object')) {
    const properties = source.properties as JsonObject;
    const keys = Object.keys(properties);
    if (keys.length === 0) throw new ValidationError('Each object schema needs at least one property');
    if (keys.length > 40) throw new ValidationError('At most 40 properties per object are allowed');
    out.type = 'object';
    out.properties = Object.fromEntries(
      keys.map((key) => [key.slice(0, 60), sanitize(properties[key], depth + 1)]),
    );
    out.required = Object.keys(out.properties as JsonObject);
    out.additionalProperties = false;
  } else if (source.type === 'array' || source.items) {
    out.type = 'array';
    out.items = sanitize(source.items ?? { type: 'string' }, depth + 1);
  } else if (!out.type) {
    out.type = 'string';
  }
  return out;
}

function matchesType(value: unknown, type: unknown): boolean {
  switch (type) {
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return false;
  }
}

/** Minimal, dependency-free JSON Schema validator for the supported subset. */
export function validateJson(value: unknown, schema: JsonObject, path = '$'): string[] {
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length > 0 && !types.some((type) => matchesType(value, type))) {
    return [`${path}: expected ${types.join(' | ')}`];
  }
  if (value === null) return [];
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
    return [`${path}: value is not in enum`];
  }

  const issues: string[] = [];
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) issues.push(`${path}: too short`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) issues.push(`${path}: too long`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) issues.push(`${path}: below minimum`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) issues.push(`${path}: above maximum`);
  }
  if (typeof value === 'object' && !Array.isArray(value) && types.includes('object')) {
    const object = value as JsonObject;
    const properties = (schema.properties ?? {}) as JsonObject;
    for (const key of Array.isArray(schema.required) ? schema.required : []) {
      if (!(String(key) in object)) issues.push(`${path}.${String(key)}: required`);
    }
    for (const [key, nested] of Object.entries(object)) {
      const child = properties[key] as JsonObject | undefined;
      if (!child && schema.additionalProperties === false) issues.push(`${path}.${key}: unexpected property`);
      else if (child) issues.push(...validateJson(nested, child, `${path}.${key}`));
    }
  }
  if (Array.isArray(value) && types.includes('array')) {
    const items = schema.items as JsonObject | undefined;
    if (items) value.forEach((item, index) => issues.push(...validateJson(item, items, `${path}[${index}]`)));
  }
  return issues;
}

/**
 * Reject facts the model invented. Only fields explicitly marked with
 * `x-grounded: true` are checked, because summaries and topic tags are derived
 * rather than copied. This keeps "invalid" from becoming "authoritative".
 */
export function groundingIssues(
  value: unknown,
  schema: JsonObject,
  sourceText: string,
  path = '$',
): string[] {
  const haystack = sourceText.toLowerCase();
  const issues: string[] = [];

  if (schema['x-grounded'] === true && value !== null && value !== undefined) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const needle = String(value).trim().toLowerCase();
      if (needle.length > 1 && !haystack.includes(needle)) {
        issues.push(`${path}: "${String(value)}" is not present in the page text`);
      }
    }
  }

  if (typeof value === 'object' && value !== null) {
    const properties = (schema.properties ?? {}) as JsonObject;
    if (Array.isArray(value)) {
      const itemSchema = schema.items as JsonObject | undefined;
      if (itemSchema) {
        value.forEach((item, index) => {
          issues.push(...groundingIssues(item, itemSchema, sourceText, `${path}[${index}]`));
        });
      }
    } else {
      for (const [key, nested] of Object.entries(value as JsonObject)) {
        const child = properties[key] as JsonObject | undefined;
        if (child) issues.push(...groundingIssues(nested, child, sourceText, `${path}.${key}`));
      }
    }
  }
  return issues;
}
