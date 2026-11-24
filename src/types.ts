import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import type { JsonObject } from './lib/jsonSchema';

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  OPENROUTER_API_KEY: string;
  ADMIN_TOKEN: string;
  DEFAULT_MODELS: string;
  REQUEST_TIMEOUT_MS: string;
  FETCH_TIMEOUT_MS: string;
  CACHE_TTL_SECONDS: string;
  PAGE_CACHE_TTL_SECONDS: string;
  MODELS_CACHE_TTL_SECONDS: string;
  PER_MINUTE_LIMIT: string;
  DAILY_REQUEST_LIMIT: string;
  KEY_DAILY_LIMIT: string;
  PROMPT_VERSION: string;
  MAX_BYTES: string;
  MAX_TEXT_CHARS: string;
  ALLOWED_HOSTS: string;
  BLOCKED_HOSTS: string;
  ALLOWED_ORIGIN: string;
}

export interface AuthContext {
  keyId: string;
  label: string;
  perMinuteLimit: number;
  dailyLimit: number;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext };
};

export interface ApiKeyRow {
  id: string;
  key_hash: string;
  key_prefix: string;
  label: string;
  daily_limit: number;
  per_minute_limit: number;
  revoked: number;
  created_at: string;
  last_used_at: string | null;
}

export interface FreeModel {
  id: string;
  name: string;
  contextLength: number | null;
  structuredOutputs: boolean;
}

export interface SchemaSpec {
  id: string;
  name: string;
  description: string;
  jsonSchema: JsonObject;
  systemPrompt: string;
}

export interface PageContent {
  url: string;
  finalUrl: string;
  title: string | null;
  text: string;
  truncated: boolean;
  contentHash: string;
  fromCache: boolean;
}

export interface ExtractionOutcome {
  data: JsonObject;
  strategy: 'model';
  model: string;
  callsSpent: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  failures: Array<{ model: string; code: string }>;
}

export interface ScrapeResult {
  data: JsonObject;
  source: {
    url: string;
    final_url: string;
    title: string | null;
    text_chars: number;
    truncated: boolean;
    content_hash: string;
  };
  schema: { name: string; hash: string };
  strategy: 'model';
  model: string;
  cached: boolean;
  calls_spent: number;
  failures: Array<{ model: string; code: string }>;
  created_at: string;
}

export interface ScrapeRecord extends ScrapeResult {
  id: string;
  api_key_id: string;
  status: string;
  text_preview: string;
}
