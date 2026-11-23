import { z } from 'zod';
import { ValidationError } from './errors';

export const scrapeSchema = z
  .object({
    url: z.string().min(1).max(2000),
    schema_id: z.string().min(1).max(60).optional(),
    schema: z
      .object({
        name: z.string().min(1).max(60),
        description: z.string().max(500).optional(),
        json_schema: z.unknown(),
      })
      .optional(),
    options: z
      .object({
        max_chars: z.number().int().min(1000).max(16000).optional(),
        follow_robots: z.boolean().optional(),
      })
      .optional(),
  })
  .refine((value) => Boolean(value.schema_id || value.schema), {
    message: 'Provide either schema_id or schema',
  });

export const openRouterSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .optional(),
});

export const freeModelsResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string().optional(),
      context_length: z.number().nullable().optional(),
      pricing: z.object({ prompt: z.union([z.string(), z.number()]) }).optional(),
      supported_parameters: z.array(z.string()).optional(),
    }),
  ),
});

export function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(
      'Request validation failed',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

export async function parseJsonOrThrow<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError('Body must be valid JSON');
  }
  return parseOrThrow(schema, body);
}
