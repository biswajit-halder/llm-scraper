import { NotFoundError } from '../lib/errors';
import { toStrictJsonSchema, type JsonObject } from '../lib/jsonSchema';
import type { SchemaSpec } from '../types';

const SYSTEM_BASE = [
  'You are a precise web-scraping extraction engine.',
  'Return ONLY a single JSON object that conforms exactly to the supplied JSON schema.',
  'Never output markdown fences or commentary.',
  'Copy values that are marked as grounded verbatim from the page. Never guess or infer them.',
  'Use null for unknown fields; never invent a value to fill a field.',
  'Prefer the page title and main article/product content over navigation text.',
].join('\n');

function make(
  id: string,
  name: string,
  description: string,
  jsonSchema: JsonObject,
  extra: string,
): SchemaSpec {
  return { id, name, description, jsonSchema: toStrictJsonSchema(jsonSchema), systemPrompt: `${SYSTEM_BASE}\n${extra}` };
}

const specs: SchemaSpec[] = [
  make('article', 'Article', 'Title, author, date, summary, topics and tone of an article.', {
    type: 'object',
    properties: {
      title: { type: ['string', 'null'], 'x-grounded': true },
      author: { type: ['string', 'null'], 'x-grounded': true },
      published_at: { type: ['string', 'null'], description: 'Date exactly as written on the page', 'x-grounded': true },
      summary: { type: ['string', 'null'], description: 'Two sentence summary derived from the text' },
      topics: { type: 'array', items: { type: 'string' } },
      tone: { type: ['string', 'null'], enum: ['positive', 'neutral', 'negative', 'unknown'] },
    },
  }, 'Keep `summary` to at most two sentences. `topics` should contain at most 8 short tags.'),
  make('product', 'Product', 'Name, brand, price, rating, availability and key features of a product page.', {
    type: 'object',
    properties: {
      name: { type: ['string', 'null'], 'x-grounded': true },
      brand: { type: ['string', 'null'], 'x-grounded': true },
      price: { type: ['string', 'null'], description: 'Price including currency symbol as shown', 'x-grounded': true },
      rating: { type: ['number', 'null'] },
      availability: { type: ['string', 'null'], enum: ['in_stock', 'out_of_stock', 'preorder', 'unknown'] },
      features: { type: 'array', items: { type: 'string' } },
    },
  }, 'Do not convert prices; copy them as displayed. `rating` must be a number between 0 and 5.'),
  make('job_posting', 'Job posting', 'Role, company, location, employment type, salary and requirements.', {
    type: 'object',
    properties: {
      title: { type: ['string', 'null'], 'x-grounded': true },
      company: { type: ['string', 'null'], 'x-grounded': true },
      location: { type: ['string', 'null'], 'x-grounded': true },
      employment_type: { type: ['string', 'null'], enum: ['full_time', 'part_time', 'contract', 'internship', 'unknown'] },
      salary: { type: ['string', 'null'], 'x-grounded': true },
      requirements: { type: 'array', items: { type: 'string' } },
    },
  }, 'Classify employment_type into the provided enum; use "unknown" when the page does not say.'),
];

const registry = new Map(specs.map((spec) => [spec.id, spec]));

export function customSchemaSpec(
  name: string,
  description: string | undefined,
  jsonSchema: JsonObject,
): SchemaSpec {
  return {
    id: 'custom',
    name,
    description: description ?? `Custom schema: ${name}`,
    jsonSchema,
    systemPrompt: `${SYSTEM_BASE}\nExtract exactly the fields defined by the caller's schema.`,
  };
}

export function getSchema(id: string): SchemaSpec {
  const spec = registry.get(id);
  if (!spec) throw new NotFoundError(`Unknown schema "${id}"`);
  return spec;
}

export function listSchemas(): Array<Omit<SchemaSpec, 'systemPrompt'>> {
  return specs.map(({ systemPrompt: _prompt, ...rest }) => rest);
}
