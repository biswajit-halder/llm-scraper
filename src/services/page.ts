import { assertPublicUrl } from '../lib/fetchSafe';
import { sha256 } from '../lib/hash';
import { assertRobotsAllowed } from '../lib/robots';
import { toReadableContent } from '../lib/text';
import type { Env, PageContent } from '../types';
import { fetchSafe } from '../lib/fetchSafe';

const USER_AGENT = 'llm-scraper/1.0 (+portfolio project)';

/** Validate → page cache → robots → SSRF-safe fetch → readable text. */
export async function loadPage(
  env: Env,
  rawUrl: string,
  maxChars: number,
  followRobots = true,
): Promise<PageContent> {
  const url = assertPublicUrl(rawUrl, {
    allowedHosts: env.ALLOWED_HOSTS,
    blockedHosts: env.BLOCKED_HOSTS,
  });
  const urlKey = await sha256(url.toString());
  const cached = await env.CACHE.get(`page:${urlKey}`, 'json');
  if (cached) return { ...(cached as PageContent), fromCache: true };

  if (followRobots) {
    await assertRobotsAllowed(url, { timeoutMs: Number(env.FETCH_TIMEOUT_MS), userAgent: USER_AGENT });
  }
  const fetched = await fetchSafe(url.toString(), {
    maxBytes: Number(env.MAX_BYTES),
    timeoutMs: Number(env.FETCH_TIMEOUT_MS),
    allowedHosts: env.ALLOWED_HOSTS,
    blockedHosts: env.BLOCKED_HOSTS,
    userAgent: USER_AGENT,
  });
  const readable = toReadableContent(fetched.body, fetched.contentType, maxChars);

  const page: PageContent = {
    url: rawUrl,
    finalUrl: fetched.finalUrl,
    title: readable.title,
    text: readable.text,
    truncated: readable.truncated,
    contentHash: await sha256(readable.text),
    fromCache: false,
  };
  await env.CACHE.put(`page:${urlKey}`, JSON.stringify(page), {
    expirationTtl: Number(env.PAGE_CACHE_TTL_SECONDS),
  });
  return page;
}

export async function resultCacheKey(
  url: string,
  schemaHash: string,
  contentHash: string,
  promptVersion: string,
): Promise<string> {
  return sha256(JSON.stringify({ v: 1, url, schemaHash, contentHash, promptVersion }));
}

export async function getCachedExtraction(env: Env, key: string): Promise<unknown | null> {
  return env.CACHE.get(`result:${key}`, 'json');
}

export async function putCachedExtraction(env: Env, key: string, value: unknown): Promise<void> {
  await env.CACHE.put(`result:${key}`, JSON.stringify(value), {
    expirationTtl: Number(env.CACHE_TTL_SECONDS),
  });
}
