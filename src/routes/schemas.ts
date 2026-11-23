import { Hono } from 'hono';
import { auth } from '../middleware/auth';
import { listSchemas } from '../schemas/registry';
import type { AppEnv } from '../types';

export const schemas = new Hono<AppEnv>();

schemas.get('/', auth, (c) =>
  c.json({
    items: listSchemas(),
    note: 'You may also POST your own schema object with name + json_schema.',
  }),
);
