import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { vi } from 'vitest';
import type { Env } from '../../src/types';

type Row = Record<string, unknown>;
const n = (value: unknown) => Number(value ?? 0);

const DEFAULT_HTML = `<!doctype html><html><head><title>Example Article</title></head><body>
<nav>Home About Contact Login</nav><header>Site header</header>
<article><h1>Example Article</h1><p>The city council approved a new public transport plan on Tuesday.</p>
<p>The plan adds twelve electric buses and extends two routes into the northern district.</p>
<p>Officials said the changes should reduce commute times by roughly fifteen percent.</p></article>
<footer>Copyright 2026</footer></body></html>`;

class FakeD1 {
  apiKeys: Row[] = [];
  rateCounters: Row[] = [];
  quotaDaily: Row[] = [];
  scrapes: Row[] = [];
  usage: Row[] = [];
  private nextUsageId = 1;

  prepare(sql: string) {
    const tag = sql.trimStart().split('\n')[0]!.replace('-- q:', '').trim();
    return new FakeStatement(this, tag);
  }

  dispatch(tag: string, p: unknown[]): Row[] {
    switch (tag) {
      case 'findKey': return this.apiKeys.filter((row) => row.key_hash === p[0]);
      case 'touchKey': {
        const row = this.apiKeys.find((item) => item.id === p[1]);
        if (row) row.last_used_at = p[0];
        return [];
      }
      case 'createKey':
        this.apiKeys.push({
          id: p[0], key_hash: p[1], key_prefix: p[2], label: p[3],
          daily_limit: p[4], per_minute_limit: p[5], revoked: 0,
          created_at: p[6], last_used_at: null,
        });
        return [];
      case 'listKeys': return this.apiKeys;
      case 'revokeKey': {
        const row = this.apiKeys.find((item) => item.id === p[1]);
        if (row) row.revoked = p[0];
        return [];
      }
      case 'getRate': return this.rateCounters.filter((row) => row.key_id === p[0]);
      case 'createRate':
        this.rateCounters.push({
          key_id: p[0], minute_start: p[1], day_start: p[2], minute_used: p[3], day_used: p[4],
        });
        return [];
      case 'resetRate':
        this.rateCounters = this.rateCounters.filter((row) => row.key_id !== p[0]);
        return [];
      case 'incrementRate': {
        const row = this.rateCounters.find((item) => item.key_id === p[2]);
        if (!row || row.minute_start !== p[3] || row.day_start !== p[4]) return [];
        const minute = n(row.minute_used) + n(p[0]);
        const day = n(row.day_used) + n(p[1]);
        if (minute > n(p[6]) || day > n(p[8])) return [];
        row.minute_used = minute;
        row.day_used = day;
        return [{ minute_used: minute, day_used: day }];
      }
      case 'getQuota': return this.quotaDaily.filter((row) => row.day === p[0]);
      case 'createQuota':
        this.quotaDaily.push({ day: p[0], calls_used: p[1], daily_limit: p[2], updated_at: p[3] });
        return [];
      case 'reserveQuota': {
        const row = this.quotaDaily.find((item) => item.day === p[2]);
        if (!row) return [];
        const next = n(row.calls_used) + n(p[0]);
        if (next > n(p[4])) return [];
        row.calls_used = next;
        return [{ calls_used: next }];
      }
      case 'insertScrape':
        this.scrapes.push({
          id: p[0], api_key_id: p[1], url: p[2], final_url: p[3], schema_name: p[4],
          schema_hash: p[5], content_hash: p[6], cache_hit: p[7], status: p[8],
          strategy: p[9], model: p[10], calls_spent: p[11], data_json: p[12],
          text_preview: p[13], created_at: p[14],
        });
        return [];
      case 'getScrape': return this.scrapes.filter((row) => row.id === p[0]);
      case 'listScrapes':
        return this.scrapes
          .filter((row) => row.api_key_id === p[0])
          .slice()
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
          .slice(0, n(p[1]));
      case 'insertUsage':
        this.usage.push({
          id: this.nextUsageId++, api_key_id: p[0], scrape_id: p[1], model: p[2],
          cache_hit: p[3], tokens_in: p[4], tokens_out: p[5], latency_ms: p[6],
          status: p[7], created_at: p[8],
        });
        return [];
      case 'usageAggregate': {
        const rows = this.usage.filter(
          (row) => row.api_key_id === p[0] && String(row.created_at) >= String(p[1]),
        );
        return [{
          scrapes: new Set(rows.map((row) => row.scrape_id)).size,
          cache_hits: rows.filter((row) => n(row.cache_hit) === 1).length,
          tokens: rows.reduce((sum, row) => sum + n(row.tokens_in) + n(row.tokens_out), 0),
          calls: rows.filter((row) => n(row.cache_hit) === 0).length,
        }];
      }
      case 'usageEvents':
        return this.usage.filter((row) => row.api_key_id === p[0]).slice().reverse().slice(0, n(p[1]));
      default: throw new Error(`Unexpected SQL tag: ${tag}`);
    }
  }
}

class FakeStatement {
  private params: unknown[] = [];
  constructor(private readonly db: FakeD1, private readonly tag: string) {}
  bind(...params: unknown[]) {
    const statement = new FakeStatement(this.db, this.tag);
    statement.params = params;
    return statement;
  }
  async first<T>(column?: string): Promise<T | null> {
    const row = this.db.dispatch(this.tag, this.params)[0];
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }
  async all<T>(): Promise<{ results: T[]; success: boolean; meta: unknown }> {
    return { results: this.db.dispatch(this.tag, this.params) as T[], success: true, meta: {} };
  }
  async run(): Promise<{ success: boolean }> {
    this.db.dispatch(this.tag, this.params);
    return { success: true };
  }
}

class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string) {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return type === 'json' ? JSON.parse(value) : value;
  }
  async put(key: string, value: string, _options?: unknown) {
    this.store.set(key, value);
  }
}

export interface TestEnv extends Env {
  fakeDb: FakeD1;
  fakeKv: FakeKV;
}

export function makeEnv(overrides: Partial<Env> = {}): TestEnv {
  const fakeDb = new FakeD1();
  const fakeKv = new FakeKV();
  const models = ['model/a:free', 'model/b:free', 'model/c:free'].map((id) => ({
    id, name: id, contextLength: null, structuredOutputs: true,
  }));
  fakeKv.store.set('models:free', JSON.stringify(models));
  return {
    DB: fakeDb as unknown as D1Database,
    CACHE: fakeKv as unknown as KVNamespace,
    OPENROUTER_API_KEY: 'test-key',
    ADMIN_TOKEN: 'admin-token',
    DEFAULT_MODELS: 'model/a:free,model/b:free,model/c:free',
    REQUEST_TIMEOUT_MS: '2000',
    FETCH_TIMEOUT_MS: '2000',
    CACHE_TTL_SECONDS: '604800',
    PAGE_CACHE_TTL_SECONDS: '3600',
    MODELS_CACHE_TTL_SECONDS: '21600',
    PER_MINUTE_LIMIT: '20',
    DAILY_REQUEST_LIMIT: '50',
    KEY_DAILY_LIMIT: '500',
    PROMPT_VERSION: 'test-v1',
    MAX_BYTES: '1048576',
    MAX_TEXT_CHARS: '16000',
    ALLOWED_HOSTS: '',
    BLOCKED_HOSTS: '',
    ALLOWED_ORIGIN: '*',
    fakeDb,
    fakeKv,
    ...overrides,
  };
}

export async function createAuthKey(env: TestEnv): Promise<string> {
  const { createKey } = await import('../../src/db/queries');
  const { generateApiKey, sha256 } = await import('../../src/lib/hash');
  const { newId } = await import('../../src/lib/ids');
  const { raw, prefix } = generateApiKey();
  await createKey(env, {
    id: newId('key'), hash: await sha256(raw), prefix, label: 'test',
    daily: Number(env.KEY_DAILY_LIMIT), perMinute: Number(env.PER_MINUTE_LIMIT),
  });
  return raw;
}

export const TEST_URL = 'http://93.184.216.34/article';

export function llmResponse(content: string) {
  return JSON.stringify({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 20, completion_tokens: 10 },
  });
}

export interface StubOptions {
  robots?: string;
  robotsStatus?: number;
  html?: string;
  contentType?: string;
  pageStatus?: number;
  llm?: Array<string | { status: number }>;
}

/** Routes fetch calls by host so tests never touch the network. */
export function stubFetch(options: StubOptions = {}) {
  let index = 0;
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith('https://openrouter.ai/api/v1/chat/completions')) {
      const next = options.llm?.[Math.min(index++, (options.llm?.length ?? 1) - 1)] ?? '{}';
      if (typeof next !== 'string') return new Response('{}', { status: next.status });
      return new Response(llmResponse(next), { status: 200 });
    }
    if (url.includes('/robots.txt')) {
      return new Response(options.robots ?? 'User-agent: *\nAllow: /', {
        status: options.robotsStatus ?? 200,
      });
    }
    if (url.startsWith('http://93.184.216.34')) {
      return new Response(options.html ?? DEFAULT_HTML, {
        status: options.pageStatus ?? 200,
        headers: { 'content-type': options.contentType ?? 'text/html; charset=utf-8' },
      });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

export function post(path: string, body: unknown, token?: string, extra: Record<string, string> = {}) {
  return {
    path,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...extra,
      },
      body: JSON.stringify(body),
    },
  };
}

export const VALID_ARTICLE = JSON.stringify({
  title: 'Example Article',
  author: null,
  published_at: 'Tuesday',
  summary: 'The council approved twelve electric buses and two extended routes.',
  topics: ['transport', 'city'],
  tone: 'neutral',
});
