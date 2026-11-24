import { QuotaExhaustedError, UpstreamError } from '../lib/errors';
import { groundingIssues, validateJson, type JsonObject } from '../lib/jsonSchema';
import type { Env, ExtractionOutcome, PageContent, SchemaSpec } from '../types';
import { callModel, extractJson, ModelCallFailure } from './llm';

export interface ExtractionContext {
  env: Env;
  page: PageContent;
  schema: SchemaSpec;
  models: string[];
  reserveExtra: () => Promise<boolean>;
}

export function buildUserPrompt(page: PageContent, schema: SchemaSpec): string {
  return [
    `Extract a "${schema.name}" object from the page below.`,
    `URL: ${page.finalUrl}`,
    `Title: ${page.title ?? 'unknown'}`,
    '',
    'PAGE TEXT:',
    page.text,
  ].join('\n');
}

interface Counters {
  callsSpent: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

function parseAndValidate(
  raw: string,
  schema: JsonObject,
  sourceText: string,
): { value: JsonObject | null; issues: string[] } {
  const json = extractJson(raw);
  if (!json) return { value: null, issues: ['response did not contain a JSON object'] };
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { value: null, issues: ['response contained invalid JSON'] };
  }
  const issues = [
    ...validateJson(value, schema),
    ...groundingIssues(value, schema, sourceText),
  ];
  return issues.length === 0 ? { value: value as JsonObject, issues: [] } : { value: null, issues };
}

function schemaName(schema: SchemaSpec): string {
  return schema.id.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 60);
}

/**
 * Strict extraction: every emitted result must match the schema AND be grounded
 * in the page. Failures are errors — no fabricated skeleton is ever returned or
 * cached. This mirrors the rule that an invalid source must never win.
 */
export async function extractStructured(ctx: ExtractionContext): Promise<ExtractionOutcome> {
  const counters: Counters = { callsSpent: 0, tokensIn: 0, tokensOut: 0, latencyMs: 0 };
  const failures: ExtractionOutcome['failures'] = [];
  const userPrompt = buildUserPrompt(ctx.page, ctx.schema);
  const sourceText = `${ctx.page.title ?? ''}\n${ctx.page.text}`;

  for (const model of ctx.models) {
    if (!(await ctx.reserveExtra())) throw new QuotaExhaustedError();
    try {
      const result = await callModel(ctx.env, model, ctx.schema.systemPrompt, userPrompt, ctx.schema.jsonSchema, schemaName(ctx.schema));
      counters.callsSpent += 1;
      counters.latencyMs += result.latencyMs;
      counters.tokensIn += result.tokensIn;
      counters.tokensOut += result.tokensOut;

      let parsed = parseAndValidate(result.raw, ctx.schema.jsonSchema, sourceText);
      if (parsed.value) {
        return { data: parsed.value, strategy: 'model', model, ...counters, failures };
      }

      failures.push({ model, code: 'invalid_or_ungrounded_json' });
      if (!(await ctx.reserveExtra())) throw new QuotaExhaustedError();
      const repairSystem = [
        ctx.schema.systemPrompt,
        `The previous response failed validation: ${parsed.issues.join('; ')}`,
        `Previous response: ${result.raw.slice(0, 2000)}`,
        'Return a corrected JSON object only, using only values present in the page.',
      ].join('\n');
      const repaired = await callModel(ctx.env, model, repairSystem, userPrompt, ctx.schema.jsonSchema, schemaName(ctx.schema));
      counters.callsSpent += 1;
      counters.latencyMs += repaired.latencyMs;
      counters.tokensIn += repaired.tokensIn;
      counters.tokensOut += repaired.tokensOut;
      parsed = parseAndValidate(repaired.raw, ctx.schema.jsonSchema, sourceText);
      if (parsed.value) {
        return { data: parsed.value, strategy: 'model', model, ...counters, failures };
      }
      failures.push({ model, code: 'repair_failed' });
    } catch (error) {
      if (error instanceof QuotaExhaustedError) throw error;
      const code = error instanceof ModelCallFailure ? error.code : 'unexpected_error';
      failures.push({ model, code });
    }
  }
  throw new UpstreamError('All models failed to produce valid, grounded JSON', failures);
}
