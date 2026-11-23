-- Shared D1 database (cmg-db). All tables are prefixed so commit-message-cli
-- and llm-scraper can coexist without collisions.

CREATE TABLE IF NOT EXISTS scraper_api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  label TEXT NOT NULL,
  daily_limit INTEGER NOT NULL DEFAULT 50,
  per_minute_limit INTEGER NOT NULL DEFAULT 20,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS scraper_rate_counters (
  key_id TEXT PRIMARY KEY,
  minute_start INTEGER NOT NULL,
  day_start INTEGER NOT NULL,
  minute_used INTEGER NOT NULL DEFAULT 0,
  day_used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scraper_quota_daily (
  day TEXT PRIMARY KEY,
  calls_used INTEGER NOT NULL DEFAULT 0,
  daily_limit INTEGER NOT NULL DEFAULT 50,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scraper_scrapes (
  id TEXT PRIMARY KEY,
  api_key_id TEXT NOT NULL,
  url TEXT NOT NULL,
  final_url TEXT NOT NULL,
  schema_name TEXT NOT NULL,
  schema_hash TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  cache_hit INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  strategy TEXT NOT NULL,
  model TEXT NOT NULL,
  calls_spent INTEGER NOT NULL DEFAULT 0,
  data_json TEXT NOT NULL,
  text_preview TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scraper_scrapes_key_created ON scraper_scrapes(api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scraper_scrapes_url_schema ON scraper_scrapes(url, schema_hash);

CREATE TABLE IF NOT EXISTS scraper_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key_id TEXT NOT NULL,
  scrape_id TEXT NOT NULL,
  model TEXT NOT NULL,
  cache_hit INTEGER NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scraper_usage_key_created ON scraper_usage(api_key_id, created_at DESC);
