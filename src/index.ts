import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { AppError } from './lib/errors';
import { admin } from './routes/admin';
import { demo } from './routes/demo';
import { schemas } from './routes/schemas';
import { scrape } from './routes/scrape';
import { usage } from './routes/usage';
import { getQuotaStatus } from './services/quota';
import type { AppEnv } from './types';

const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', c.env.ALLOWED_ORIGIN || '*');
  c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-admin-token');
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

app.get('/health', async (c) =>
  c.json({
    ok: true,
    service: 'llm-scraper',
    version: '1.0.0',
    quota: await getQuotaStatus(c.env),
  }),
);

app.route('/demo', demo);
app.route('/v1/scrape', scrape);
app.route('/v1/schemas', schemas);
app.route('/v1/usage', usage);
app.route('/admin', admin);

app.notFound((c) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Route not found', retryable: false } }, 404),
);

app.onError((err, c) => {
  if (err instanceof AppError) {
    if (err.retryAfter !== undefined) c.header('Retry-After', String(err.retryAfter));
    if (err.code === 'UNAUTHORIZED') c.header('WWW-Authenticate', 'Bearer');
    return c.json(err.toBody(), err.status as ContentfulStatusCode);
  }
  console.error(err);
  return c.json(
    { error: { code: 'INTERNAL', message: 'Unexpected server error', retryable: false } },
    500,
  );
});

export default app;
