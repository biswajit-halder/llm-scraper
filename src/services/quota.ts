import { createQuotaDay, getQuotaDay, reserveQuota as reserveInDb } from '../db/queries';
import { utcDay } from '../lib/hash';
import type { Env } from '../types';

function secondsUntilUtcMidnight(): number {
  const now = new Date();
  return Math.max(1, Math.ceil(
    (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000,
  ));
}

export async function reserveExtractionQuota(env: Env, cost = 1): Promise<boolean> {
  const day = utcDay();
  const limit = Number(env.DAILY_REQUEST_LIMIT);
  let used = await reserveInDb(env, { day, cost, limit });
  if (used === null) {
    const existing = await getQuotaDay(env, day);
    if (!existing) {
      await createQuotaDay(env, day, limit, 0);
      used = await reserveInDb(env, { day, cost, limit });
    }
  }
  return used !== null;
}

export async function getQuotaStatus(env: Env) {
  const row = await getQuotaDay(env, utcDay());
  const limit = row?.daily_limit ?? Number(env.DAILY_REQUEST_LIMIT);
  const used = row?.calls_used ?? 0;
  return {
    day: utcDay(),
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetsInSeconds: secondsUntilUtcMidnight(),
  };
}
