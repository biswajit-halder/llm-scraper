import { describe, expect, it } from 'vitest';
import app from '../../src/index';
import {
  createAuthKey, makeEnv, post, stubFetch, TEST_URL, VALID_ARTICLE,
} from '../helpers/mock';

const ADMIN = { 'x-admin-token': 'admin-token' };

describe('admin keys', () => {
  it('mints, lists and revokes keys', async () => {
    const env = makeEnv();
    const denied = post('/admin/keys', { label: 'laptop' });
    expect((await app.request(denied.path, denied.init, env)).status).toBe(401);

    const mint = post('/admin/keys', { label: 'laptop' }, undefined, ADMIN);
    const created = (await (await app.request(mint.path, mint.init, env)).json()) as { key: string; prefix: string };
    expect(created.key.startsWith('scr_')).toBe(true);

    const listed = (await (await app.request('/admin/keys', { headers: ADMIN }, env)).json()) as {
      items: Array<{ id: string; key_prefix: string }>;
    };
    const id = listed.items.find((item) => item.key_prefix === created.prefix)!.id;
    const revoke = post(`/admin/keys/${id}/revoke`, {}, undefined, ADMIN);
    expect((await (await app.request(revoke.path, revoke.init, env)).json() as { revoked: boolean }).revoked).toBe(true);
    expect((await app.request('/v1/usage', { headers: { authorization: `Bearer ${created.key}` } }, env)).status).toBe(401);
  });
});

describe('usage and history', () => {
  it('records a scrape and its usage', async () => {
    const env = makeEnv();
    const key = await createAuthKey(env);
    stubFetch({ llm: [VALID_ARTICLE] });
    const request = post('/v1/scrape', { url: TEST_URL, schema_id: 'article' }, key);
    const created = (await (await app.request(request.path, request.init, env)).json()) as { id: string };

    const history = (await (await app.request('/v1/scrape', { headers: { authorization: `Bearer ${key}` } }, env)).json()) as {
      items: Array<{ id: string }>;
    };
    expect(history.items[0]?.id).toBe(created.id);

    const one = await app.request(`/v1/scrape/${created.id}`, { headers: { authorization: `Bearer ${key}` } }, env);
    expect(((await one.json()) as { data: { title: string } }).data.title).toBe('Example Article');

    const usage = (await (await app.request('/v1/usage', { headers: { authorization: `Bearer ${key}` } }, env)).json()) as {
      aggregate: { scrapes: number; calls: number; tokens: number };
    };
    expect(usage.aggregate.scrapes).toBe(1);
    expect(usage.aggregate.calls).toBe(1);
    expect(usage.aggregate.tokens).toBe(30);
  });
});
