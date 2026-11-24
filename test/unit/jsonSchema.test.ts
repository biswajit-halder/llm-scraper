import { describe, expect, it } from 'vitest';
import { groundingIssues, toStrictJsonSchema, validateJson } from '../../src/lib/jsonSchema';

const input = {
  type: 'object',
  properties: {
    name: { type: ['string', 'null'] },
    tags: { type: 'array', items: { type: 'string' } },
    status: { type: ['string', 'null'], enum: ['ok', 'failed'] },
  },
};

describe('JSON Schema helpers', () => {
  it('makes schemas strict for structured outputs', () => {
    const strict = toStrictJsonSchema(input);
    expect(strict.additionalProperties).toBe(false);
    expect(strict.required).toEqual(['name', 'tags', 'status']);
    expect((strict.items as undefined) ?? null).toBeNull();
    expect((strict.properties as Record<string, Record<string, unknown>>).tags.items).toEqual({ type: 'string' });
  });

  it('validates nested values, enums and nullable fields', () => {
    const strict = toStrictJsonSchema(input);
    expect(validateJson({ name: null, tags: ['a'], status: 'ok' }, strict)).toEqual([]);
    expect(validateJson({ name: 'x', tags: [3], status: 'ok' }, strict)[0]).toContain('expected string');
    expect(validateJson({ name: 'x', tags: [], status: 'bad' }, strict)[0]).toContain('enum');
    expect(validateJson({ name: 'x', tags: [] }, strict)[0]).toContain('required');
    expect(validateJson({ name: 'x', tags: [], status: null, extra: 1 }, strict)[0]).toContain('unexpected');
  });

  it('rejects invented facts in fields marked as grounded', () => {
    const strict = toStrictJsonSchema({
      type: 'object',
      properties: {
        title: { type: ['string', 'null'], 'x-grounded': true },
        summary: { type: ['string', 'null'] },
      },
    });
    const text = 'The council approved twelve electric buses on Tuesday.';
    expect(groundingIssues({ title: 'Twelve electric buses', summary: 'Transit improves' }, strict, text)).toEqual([]);
    expect(groundingIssues({ title: 'A brand new stadium', summary: 'Transit improves' }, strict, text)[0]).toContain('not present');
    expect(groundingIssues({ title: null, summary: 'anything' }, strict, text)).toEqual([]);
  });
});
