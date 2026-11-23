import type { ApiKeyRow, Env, ScrapeRecord } from '../types';

/**
 * Every statement starts with a `-- q:<name>` tag. D1 ignores SQL comments;
 * the in-memory test double uses the tag to route to a handler.
 */
const Q = {
  findKey: `-- q:findKey
SELECT id, key_hash, key_prefix, label, daily_limit, per_minute_limit, revoked, created_at, last_used_at
FROM scraper_api_keys WHERE key_hash = ?`,
  touchKey: `-- q:touchKey
UPDATE scraper_api_keys SET last_used_at = ? WHERE id = ?`,
  createKey: `-- q:createKey
INSERT INTO scraper_api_keys (id, key_hash, key_prefix, label, daily_limit, per_minute_limit, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?)`,
  listKeys: `-- q:listKeys
SELECT id, key_prefix, label, daily_limit, per_minute_limit, revoked, created_at, last_used_at FROM scraper_api_keys ORDER BY created_at DESC LIMIT 50`,
  revokeKey: `-- q:revokeKey
UPDATE scraper_api_keys SET revoked = ? WHERE id = ?`,
  getRate: `-- q:getRate
SELECT key_id, minute_start, day_start, minute_used, day_used FROM scraper_rate_counters WHERE key_id = ?`,
  createRate: `-- q:createRate
INSERT INTO scraper_rate_counters (key_id, minute_start, day_start, minute_used, day_used) VALUES (?, ?, ?, ?, ?)`,
  resetRate: `-- q:resetRate
DELETE FROM scraper_rate_counters WHERE key_id = ?`,
  incrementRate: `-- q:incrementRate
UPDATE scraper_rate_counters SET minute_used = minute_used + ?, day_used = day_used + ?
WHERE key_id = ? AND minute_start = ? AND day_start = ?
  AND minute_used + ? <= ? AND day_used + ? <= ?
RETURNING minute_used, day_used`,
  getQuota: `-- q:getQuota
SELECT day, calls_used, daily_limit FROM scraper_quota_daily WHERE day = ?`,
  createQuota: `-- q:createQuota
INSERT INTO scraper_quota_daily (day, calls_used, daily_limit, updated_at) VALUES (?, ?, ?, ?)`,
  reserveQuota: `-- q:reserveQuota
UPDATE scraper_quota_daily SET calls_used = calls_used + ?, updated_at = ?
WHERE day = ? AND calls_used + ? <= ?
RETURNING calls_used`,
  insertScrape: `-- q:insertScrape
INSERT INTO scraper_scrapes (id, api_key_id, url, final_url, schema_name, schema_hash, content_hash,
  cache_hit, status, strategy, model, calls_spent, data_json, text_preview, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  getScrape: `-- q:getScrape
SELECT id, api_key_id, url, final_url, schema_name, schema_hash, content_hash,
  cache_hit, status, strategy, model, calls_spent, data_json, text_preview, created_at
FROM scraper_scrapes WHERE id = ?`,
  listScrapes: `-- q:listScrapes
SELECT id, url, schema_name, strategy, cached, status, created_at
FROM scraper_scrapes WHERE api_key_id = ? ORDER BY created_at DESC LIMIT ?`,
  insertUsage: `-- q:insertUsage
INSERT INTO scraper_usage (api_key_id, scrape_id, model, cache_hit, tokens_in, tokens_out, latency_ms, status, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  usageAggregate: `-- q:usageAggregate
SELECT COUNT(DISTINCT scrape_id) AS scrapes,
  SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END) AS cache_hits,
  SUM(tokens_in + tokens_out) AS tokens,
  COUNT(*) AS calls
FROM scraper_usage WHERE api_key_id = ? AND created_at >= ?`,
  usageEvents: `-- q:usageEvents
SELECT model, status, cache_hit, latency_ms, tokens_in, tokens_out, created_at
FROM scraper_usage WHERE api_key_id = ? ORDER BY id DESC LIMIT ?`,
} as const;

export interface RateCounter {
  key_id: string;
  minute_start: number;
  day_start: number;
  minute_used: number;
  day_used: number;
}

export interface QuotaRow {
  day: string;
  calls_used: number;
  daily_limit: number;
}

export async function findApiKeyByHash(env: Env, hash: string): Promise<ApiKeyRow | null> {
  return env.DB.prepare(Q.findKey).bind(hash).first<ApiKeyRow>();
}

export async function touchApiKey(env: Env, id: string): Promise<void> {
  await env.DB.prepare(Q.touchKey).bind(new Date().toISOString(), id).run();
}

export async function createKey(
  env: Env,
  input: { id: string; hash: string; prefix: string; label: string; daily: number; perMinute: number },
): Promise<void> {
  await env.DB.prepare(Q.createKey)
    .bind(input.id, input.hash, input.prefix, input.label, input.daily, input.perMinute, new Date().toISOString())
    .run();
}

export async function listKeys(env: Env): Promise<ApiKeyRow[]> {
  const result = await env.DB.prepare(Q.listKeys).all<ApiKeyRow>();
  return result.results ?? [];
}

export async function setKeyRevoked(env: Env, id: string, revoked: boolean): Promise<void> {
  await env.DB.prepare(Q.revokeKey).bind(revoked ? 1 : 0, id).run();
}

export async function getRateCounter(env: Env, keyId: string): Promise<RateCounter | null> {
  return env.DB.prepare(Q.getRate).bind(keyId).first<RateCounter>();
}

export async function createRateCounter(
  env: Env, keyId: string, minuteStart: number, dayStart: number, cost: number,
): Promise<void> {
  await env.DB.prepare(Q.createRate).bind(keyId, minuteStart, dayStart, cost, cost).run();
}

export async function resetRateCounter(
  env: Env, keyId: string, minuteStart: number, dayStart: number, cost: number,
): Promise<void> {
  await env.DB.prepare(Q.resetRate).bind(keyId).run();
  await createRateCounter(env, keyId, minuteStart, dayStart, cost);
}

export async function incrementRateCounter(
  env: Env,
  args: { keyId: string; minuteStart: number; dayStart: number; cost: number; perMinute: number; perDay: number },
): Promise<{ minute_used: number; day_used: number } | null> {
  return env.DB.prepare(Q.incrementRate)
    .bind(args.cost, args.cost, args.keyId, args.minuteStart, args.dayStart,
      args.cost, args.perMinute, args.cost, args.perDay)
    .first<{ minute_used: number; day_used: number }>();
}

export async function getQuotaDay(env: Env, day: string): Promise<QuotaRow | null> {
  return env.DB.prepare(Q.getQuota).bind(day).first<QuotaRow>();
}

export async function createQuotaDay(env: Env, day: string, limit: number, cost: number): Promise<void> {
  await env.DB.prepare(Q.createQuota).bind(day, cost, limit, new Date().toISOString()).run();
}

export async function reserveQuota(
  env: Env, args: { day: string; cost: number; limit: number },
): Promise<number | null> {
  const row = await env.DB.prepare(Q.reserveQuota)
    .bind(args.cost, new Date().toISOString(), args.day, args.cost, args.limit)
    .first<{ calls_used: number }>();
  return row?.calls_used ?? null;
}

export async function insertScrape(env: Env, record: ScrapeRecord): Promise<void> {
  await env.DB.prepare(Q.insertScrape)
    .bind(
      record.id, record.api_key_id, record.source.url, record.source.final_url,
      record.schema.name, record.schema.hash, record.source.content_hash,
      record.cached ? 1 : 0, record.status, record.strategy, record.model,
      record.calls_spent, JSON.stringify(record.data), record.text_preview, record.created_at,
    )
    .run();
}

export async function getScrape(env: Env, id: string): Promise<ScrapeRecord | null> {
  const row = await env.DB.prepare(Q.getScrape).bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: String(row.id),
    api_key_id: String(row.api_key_id),
    data: JSON.parse(String(row.data_json)) as ScrapeRecord['data'],
    source: {
      url: String(row.url),
      final_url: String(row.final_url),
      title: null,
      text_chars: 0,
      truncated: false,
      content_hash: String(row.content_hash),
    },
    schema: { name: String(row.schema_name), hash: String(row.schema_hash) },
    strategy: row.strategy === 'fallback' ? 'fallback' : 'model',
    model: String(row.model),
    cached: Number(row.cache_hit) === 1,
    calls_spent: Number(row.calls_spent),
    failures: [],
    created_at: String(row.created_at),
    status: String(row.status),
    text_preview: String(row.text_preview),
  };
}

export async function listScrapes(env: Env, keyId: string, limit: number) {
  const result = await env.DB.prepare(Q.listScrapes).bind(keyId, limit).all<{
    id: string; url: string; schema_name: string; strategy: string;
    cached: number; status: string; created_at: string;
  }>();
  return result.results ?? [];
}

export async function insertUsage(
  env: Env,
  event: {
    keyId: string; scrapeId: string; model: string; cacheHit: boolean;
    tokensIn: number; tokensOut: number; latencyMs: number; status: string;
  },
): Promise<void> {
  await env.DB.prepare(Q.insertUsage)
    .bind(event.keyId, event.scrapeId, event.model, event.cacheHit ? 1 : 0,
      event.tokensIn, event.tokensOut, event.latencyMs, event.status, new Date().toISOString())
    .run();
}

export async function getUsageAggregate(env: Env, keyId: string, sinceIso: string) {
  const row = await env.DB.prepare(Q.usageAggregate)
    .bind(keyId, sinceIso)
    .first<{ scrapes: number; cache_hits: number; tokens: number; calls: number }>();
  return {
    scrapes: row?.scrapes ?? 0,
    cache_hits: row?.cache_hits ?? 0,
    tokens: row?.tokens ?? 0,
    calls: row?.calls ?? 0,
  };
}

export async function getUsageEvents(env: Env, keyId: string, limit: number) {
  const result = await env.DB.prepare(Q.usageEvents).bind(keyId, limit).all<{
    model: string; status: string; cache_hit: number;
    latency_ms: number; tokens_in: number; tokens_out: number; created_at: string;
  }>();
  return result.results ?? [];
}
