import { Hono } from 'hono';
import { z } from 'zod';
import { getScrape, insertScrape, insertUsage, listScrapes } from '../db/queries';
import { NotFoundError } from '../lib/errors';
import { sha256, stableStringify } from '../lib/hash';
import { newId } from '../lib/ids';
import { toStrictJsonSchema } from '../lib/jsonSchema';
import { parseJsonOrThrow, parseOrThrow, scrapeSchema } from '../lib/validate';
import { auth } from '../middleware/auth';
import { customSchemaSpec, getSchema } from '../schemas/registry';
import { extractStructured } from '../services/extraction';
import { resolveModels } from '../services/models';
import {
  getCachedExtraction, loadPage, putCachedExtraction, resultCacheKey,
} from '../services/page';
import { getQuotaStatus, reserveExtractionQuota } from '../services/quota';
import { consumeRateLimit } from '../services/rateLimit';
import type { AppEnv, ScrapeRecord, ScrapeResult } from '../types';

export const scrape = new Hono<AppEnv>();

function publicRecord(record: ScrapeRecord, quota: unknown, usage: unknown, failures: unknown, reason?: string) {
  return {
    id: record.id,
    data: record.data,
    source: record.source,
    schema: record.schema,
    strategy: record.strategy,
    model: record.model,
    cached: record.cached,
    calls_spent: record.calls_spent,
    failures,
    quota,
    usage,
    ...(reason ? { reason } : {}),
  };
}

scrape.post('/', auth, async (c) => {
  const input = await parseJsonOrThrow(c.req.raw, scrapeSchema);
  const schema = input.schema_id
    ? getSchema(input.schema_id)
    : customSchemaSpec(
        input.schema!.name,
        input.schema!.description,
        toStrictJsonSchema(input.schema!.json_schema),
      );
  const schemaHash = await sha256(stableStringify(schema.jsonSchema));
  const maxChars = input.options?.max_chars ?? Number(c.env.MAX_TEXT_CHARS);
  const keyId = c.get('auth').keyId;

  // Charge per-key abuse protection on every request, including cache hits.
  await consumeRateLimit(c.env, keyId);

  const page = await loadPage(c.env, input.url, maxChars, input.options?.follow_robots !== false);
  const cacheKey = await resultCacheKey(page.url, schemaHash, page.contentHash, c.env.PROMPT_VERSION);
  const cached = (await getCachedExtraction(c.env, cacheKey)) as {
    data: ScrapeResult['data']; strategy: ScrapeResult['strategy']; model: string;
  } | null;

  if (cached) {
    await insertUsage(c.env, {
      keyId, scrapeId: 'cache', model: 'cache', cacheHit: true,
      tokensIn: 0, tokensOut: 0, latencyMs: 0, status: 'cache_hit',
    });
    return c.json({
      id: 'cache',
      data: cached.data,
      source: {
        url: page.url, final_url: page.finalUrl, title: page.title,
        text_chars: page.text.length, truncated: page.truncated, content_hash: page.contentHash,
      },
      schema: { name: schema.name, hash: schemaHash },
      strategy: cached.strategy,
      model: 'cache',
      cached: true,
      calls_spent: 0,
      failures: [],
      quota: await getQuotaStatus(c.env),
      usage: { calls_spent: 0, tokens_in: 0, tokens_out: 0, latency_ms: 0 },
    });
  }

  const models = await resolveModels(c.env);
  const outcome = await extractStructured({
    env: c.env,
    page,
    schema,
    models,
    reserveExtra: () => reserveExtractionQuota(c.env, 1),
  });

  const result: ScrapeResult = {
    data: outcome.data,
    source: {
      url: page.url,
      final_url: page.finalUrl,
      title: page.title,
      text_chars: page.text.length,
      truncated: page.truncated,
      content_hash: page.contentHash,
    },
    schema: { name: schema.name, hash: schemaHash },
    strategy: outcome.strategy,
    model: outcome.model,
    cached: false,
    calls_spent: outcome.callsSpent,
    failures: outcome.failures,
    created_at: new Date().toISOString(),
  };
  const record: ScrapeRecord = {
    ...result,
    id: newId('scr'),
    api_key_id: keyId,
    status: outcome.strategy === 'model' ? 'ok' : 'fallback',
    text_preview: page.text.slice(0, 240),
  };

  await insertScrape(c.env, record);
  if (outcome.strategy === 'model') {
    await putCachedExtraction(c.env, cacheKey, {
      data: outcome.data, strategy: outcome.strategy, model: outcome.model,
    });
  }
  await insertUsage(c.env, {
    keyId,
    scrapeId: record.id,
    model: outcome.model,
    cacheHit: false,
    tokensIn: outcome.tokensIn,
    tokensOut: outcome.tokensOut,
    latencyMs: outcome.latencyMs,
    status: outcome.strategy === 'model' ? 'ok' : 'fallback',
  });

  return c.json(
    publicRecord(
      record,
      await getQuotaStatus(c.env),
      {
        calls_spent: outcome.callsSpent,
        tokens_in: outcome.tokensIn,
        tokens_out: outcome.tokensOut,
        latency_ms: outcome.latencyMs,
      },
      outcome.failures,
      outcome.reason,
    ),
    201,
  );
});

scrape.get('/', auth, async (c) => {
  const limit = parseOrThrow(z.coerce.number().int().min(1).max(100).default(20), c.req.query('limit') ?? 20);
  return c.json({ items: await listScrapes(c.env, c.get('auth').keyId, limit) });
});

scrape.get('/:id', auth, async (c) => {
  const record = await getScrape(c.env, c.req.param('id'));
  if (!record || record.api_key_id !== c.get('auth').keyId) throw new NotFoundError('Scrape not found');
  return c.json(record);
});
