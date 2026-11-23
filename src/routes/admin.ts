import { Hono } from 'hono';
import { createKey, listKeys, setKeyRevoked } from '../db/queries';
import { NotFoundError, ValidationError } from '../lib/errors';
import { generateApiKey, sha256 } from '../lib/hash';
import { newId } from '../lib/ids';
import { adminOnly } from '../middleware/adminOnly';
import type { AppEnv } from '../types';

export const admin = new Hono<AppEnv>();

admin.post('/keys', adminOnly, async (c) => {
  let label = 'cli';
  try {
    const body = (await c.req.json()) as { label?: string };
    if (body?.label) label = body.label.slice(0, 60);
  } catch {
    /* label is optional */
  }
  const { raw, prefix } = generateApiKey();
  await createKey(c.env, {
    id: newId('key'), hash: await sha256(raw), prefix, label,
    daily: Number(c.env.KEY_DAILY_LIMIT), perMinute: Number(c.env.PER_MINUTE_LIMIT),
  });
  return c.json({ key: raw, prefix, label, note: 'Store this key now — only its SHA-256 hash is retained.' });
});

admin.get('/keys', adminOnly, async (c) => c.json({ items: await listKeys(c.env) }));

admin.post('/keys/:id/revoke', adminOnly, async (c) => {
  const id = c.req.param('id');
  if (!id) throw new ValidationError('Key id is required');
  const keys = await listKeys(c.env);
  if (!keys.some((key) => key.id === id)) throw new NotFoundError('API key not found');
  await setKeyRevoked(c.env, id, true);
  return c.json({ id, revoked: true });
});
