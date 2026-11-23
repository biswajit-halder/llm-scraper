import { openRouterSchema } from '../lib/validate';
import type { JsonObject } from '../lib/jsonSchema';
import type { Env } from '../types';

export interface LlmResult {
  raw: string;
  model: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
}

export class ModelCallFailure extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'ModelCallFailure';
  }
}

export async function callModel(
  env: Env,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  jsonSchema: JsonObject,
  schemaName: string,
): Promise<LlmResult> {
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/biswajit-halder/llm-scraper',
        'X-Title': 'LLM Scraper',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0,
        max_tokens: 1200,
        provider: { require_parameters: true },
        response_format: {
          type: 'json_schema',
          json_schema: { name: schemaName, strict: true, schema: jsonSchema },
        },
      }),
      signal: AbortSignal.timeout(Number(env.REQUEST_TIMEOUT_MS)),
    });
  } catch (error) {
    throw new ModelCallFailure('network_error', true, error instanceof Error ? error.message : 'network error');
  }

  if (response.status === 402) throw new ModelCallFailure('no_credits', false, 'OpenRouter account has no credits');
  if (!response.ok) {
    const code = response.status === 429 ? 'rate_limited' : `http_${response.status}`;
    throw new ModelCallFailure(code, response.status === 429 || response.status >= 500, code);
  }

  let parsed;
  try {
    parsed = openRouterSchema.safeParse(await response.json());
  } catch {
    throw new ModelCallFailure('malformed_response', false, 'Upstream response was not valid JSON');
  }
  if (!parsed.success) {
    throw new ModelCallFailure('malformed_response', false, 'Upstream response lacked choices[0].message.content');
  }
  return {
    raw: parsed.data.choices[0]!.message.content,
    model,
    latencyMs: Date.now() - started,
    tokensIn: parsed.data.usage?.prompt_tokens ?? 0,
    tokensOut: parsed.data.usage?.completion_tokens ?? 0,
  };
}

export function extractJson(text: string): string | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return start >= 0 && end > start ? cleaned.slice(start, end + 1) : null;
}
