import { emptyResult, validateJson, type JsonObject } from '../lib/jsonSchema';
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
    page.truncated ? 'Note: the page text was truncated to the configured limit.' : '',
    '',
    'PAGE TEXT:',
    page.text,
  ].filter(Boolean).join('\n');
}

interface Counters {
  callsSpent: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

function parseAndValidate(raw: string, schema: JsonObject): { value: JsonObject | null; issues: string[] } {
  const json = extractJson(raw);
  if (!json) return { value: null, issues: ['response did not contain a JSON object'] };
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { value: null, issues: ['response contained invalid JSON'] };
  }
  const issues = validateJson(value, schema);
  return issues.length === 0 ? { value: value as JsonObject, issues: [] } : { value: null, issues };
}

function fallback(
  ctx: ExtractionContext,
  counters: Counters,
  failures: ExtractionOutcome['failures'],
  reason: string,
): ExtractionOutcome {
  return {
    data: emptyResult(ctx.schema.jsonSchema),
    strategy: 'fallback',
    model: 'json-skeleton',
    callsSpent: counters.callsSpent,
    tokensIn: counters.tokensIn,
    tokensOut: counters.tokensOut,
    latencyMs: counters.latencyMs,
    failures,
    reason,
  };
}

/** Model attempts, schema repair, model fallback, then a null-only JSON skeleton. */
export async function extractStructured(ctx: ExtractionContext): Promise<ExtractionOutcome> {
  const counters: Counters = { callsSpent: 0, tokensIn: 0, tokensOut: 0, latencyMs: 0 };
  const failures: ExtractionOutcome['failures'] = [];
  const userPrompt = buildUserPrompt(ctx.page, ctx.schema);

  for (const model of ctx.models) {
    if (!(await ctx.reserveExtra())) return fallback(ctx, counters, failures, 'quota_exhausted');
    try {
      const result = await callModel(
        ctx.env, model, ctx.schema.systemPrompt, userPrompt, ctx.schema.jsonSchema,
        ctx.schema.id.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 60),
      );
      counters.callsSpent += 1;
      counters.latencyMs += result.latencyMs;
      counters.tokensIn += result.tokensIn;
      counters.tokensOut += result.tokensOut;

      let parsed = parseAndValidate(result.raw, ctx.schema.jsonSchema);
      if (parsed.value) {
        return { data: parsed.value, strategy: 'model', model, ...counters, failures };
      }

      failures.push({ model, code: 'invalid_json' });
      if (!(await ctx.reserveExtra())) return fallback(ctx, counters, failures, 'quota_exhausted');
      const repairSystem = [
        ctx.schema.systemPrompt,
        `The previous response failed validation: ${parsed.issues.join('; ')}`,
        `Previous response: ${result.raw.slice(0, 2000)}`,
        'Return a corrected JSON object only.',
      ].join('\n');
      const repaired = await callModel(
        ctx.env, model, repairSystem, userPrompt, ctx.schema.jsonSchema,
        ctx.schema.id.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 60),
      );
      counters.callsSpent += 1;
      counters.latencyMs += repaired.latencyMs;
      counters.tokensIn += repaired.tokensIn;
      counters.tokensOut += repaired.tokensOut;
      parsed = parseAndValidate(repaired.raw, ctx.schema.jsonSchema);
      if (parsed.value) {
        return { data: parsed.value, strategy: 'model', model, ...counters, failures };
      }
      failures.push({ model, code: 'repair_failed' });
    } catch (error) {
      const code = error instanceof ModelCallFailure ? error.code : 'unexpected_error';
      failures.push({ model, code });
    }
  }
  return fallback(ctx, counters, failures, failures.length > 0 ? 'all_models_failed' : 'no_models');
}
