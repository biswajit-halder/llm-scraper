import { freeModelsResponseSchema } from '../lib/validate';
import type { Env, FreeModel } from '../types';

function configured(env: Env): FreeModel[] {
  return env.DEFAULT_MODELS.split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => ({ id, name: id, contextLength: null, structuredOutputs: true }));
}

/** Fetch the changing free roster from OpenRouter, cached in KV for 6 hours. */
export async function getFreeModels(env: Env): Promise<FreeModel[]> {
  const cached = await env.CACHE.get('models:free', 'json');
  if (cached) return cached as FreeModel[];
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      signal: AbortSignal.timeout(Number(env.REQUEST_TIMEOUT_MS)),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = freeModelsResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('Malformed roster');
    const models = parsed.data.data
      .filter((item) => item.pricing && String(item.pricing.prompt) === '0')
      .map((item) => ({
        id: item.id,
        name: item.name ?? item.id,
        contextLength: item.context_length ?? null,
        structuredOutputs: item.supported_parameters?.includes('structured_outputs') ?? false,
      }));
    if (models.length > 0) {
      await env.CACHE.put('models:free', JSON.stringify(models), {
        expirationTtl: Number(env.MODELS_CACHE_TTL_SECONDS),
      });
      return models;
    }
  } catch {
    /* Offline — the configured list is still valid. */
  }
  return configured(env);
}

export async function resolveModels(env: Env): Promise<string[]> {
  const ids = configured(env).map((model) => model.id);
  const allowed = new Set((await getFreeModels(env)).filter((m) => m.structuredOutputs).map((m) => m.id));
  const valid = ids.filter((id) => allowed.has(id));
  return valid.length > 0 ? valid : ids;
}
