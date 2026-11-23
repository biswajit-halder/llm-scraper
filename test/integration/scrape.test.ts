import { describe, expect, it } from 'vitest';
import app from '../../src/index';
import {
  createAuthKey, makeEnv, post, stubFetch, TEST_URL, VALID_ARTICLE,
} from '../helpers/mock';

describe('POST /v1/scrape', () => {
  it('requires a key, a URL and a schema', async () => {
    const env = makeEnv();
    const anonymous = post('/v1/scrape', { url: TEST_URL, schema_id: 'article' });
    expect((await app.request(anonymous.path, anonymous.init, env)).status).toBe(401);

    const key = await createAuthKey(env);
    const noSchema = post('/v1/scrape', { url: TEST_URL }, key);
    expect((await app.request(noSchema.path, noSchema.init, env)).status).toBe(400);
  });

  it('extracts schema-valid JSON and serves repeats from cache', async () => {
    const env = makeEnv();
    const key = await createAuthKey(env);
    const fetchMock = stubFetch({ llm: [VALID_ARTICLE] });
    const request = post('/v1/scrape', { url: TEST_URL, schema_id: 'article' }, key);

    const first = await app.request(request.path, request.init, env);
    expect(first.status).toBe(201);
    const body = (await first.json()) as Record<string, any>;
    expect(body.data.title).toBe('Example Article');
    expect(body.strategy).toBe('model');
    expect(body.cached).toBe(false);
    expect(body.calls_spent).toBe(1);
    expect(body.source.text_chars).toBeGreaterThan(80);
    const callsAfterFirst = fetchMock.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThanOrEqual(3);

    const second = await app.request(request.path, request.init, env);
    const cached = (await second.json()) as Record<string, any>;
    expect(cached.cached).toBe(true);
    expect(cached.calls_spent).toBe(0);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('honors robots.txt and blocks SSRF targets', async () => {
    const env = makeEnv();
    const key = await createAuthKey(env);
    stubFetch({ robots: 'User-agent: *\nDisallow: /article' });
    const blocked = post('/v1/scrape', { url: TEST_URL, schema_id: 'article' }, key);
    const robotsResponse = await app.request(blocked.path, blocked.init, env);
    expect(robotsResponse.status).toBe(403);
    expect(((await robotsResponse.json()) as any).error.code).toBe('ROBOTS_DISALLOWED');

    const ssrf = post('/v1/scrape', { url: 'http://127.0.0.1/admin', schema_id: 'article' }, key);
    const ssrfResponse = await app.request(ssrf.path, ssrf.init, env);
    expect(ssrfResponse.status).toBe(400);
    expect(((await ssrfResponse.json()) as any).error.code).toBe('SSRF_BLOCKED');
  });

  it('accepts a caller-supplied schema and applies strict validation', async () => {
    const env = makeEnv();
    const key = await createAuthKey(env);
    stubFetch({
      llm: [
        JSON.stringify({ product_name: 'Widget', price: '$9.99', invented: true }),
        JSON.stringify({ product_name: 'Widget', price: '$9.99' }),
      ],
    });
    const request = post('/v1/scrape', {
      url: TEST_URL,
      schema: {
        name: 'mini_product',
        json_schema: {
          type: 'object',
          properties: {
            product_name: { type: 'string' },
            price: { type: ['string', 'null'] },
          },
        },
      },
    }, key);
    const response = await app.request(request.path, request.init, env);
    const body = (await response.json()) as Record<string, any>;
    // The extra field is rejected, then the repair call returns a clean object.
    expect(response.status).toBe(201);
    expect(body.strategy).toBe('model');
    expect(body.data.product_name).toBe('Widget');
    expect(body.failures[0].code).toBe('invalid_json');
  });

  it('returns a JSON skeleton when every model fails', async () => {
    const env = makeEnv();
    const key = await createAuthKey(env);
    stubFetch({ llm: [{ status: 500 }] });
    const request = post('/v1/scrape', { url: TEST_URL, schema_id: 'article' }, key);
    const response = await app.request(request.path, request.init, env);
    const body = (await response.json()) as Record<string, any>;
    expect(response.status).toBe(201);
    expect(body.strategy).toBe('fallback');
    expect(body.reason).toBe('all_models_failed');
    expect(body.data).toHaveProperty('title', null);
    expect(body.data.topics).toEqual([]);
  });

  it('skips model calls when the daily quota is exhausted', async () => {
    const env = makeEnv({ DAILY_REQUEST_LIMIT: '0' });
    const key = await createAuthKey(env);
    const fetchMock = stubFetch({ llm: ['{}'] });
    const request = post('/v1/scrape', { url: TEST_URL, schema_id: 'article' }, key);
    const response = await app.request(request.path, request.init, env);
    const body = (await response.json()) as Record<string, any>;
    expect(body.strategy).toBe('fallback');
    expect(body.reason).toBe('quota_exhausted');
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('openrouter.ai/api/v1/chat'))).toBe(false);
  });
});
