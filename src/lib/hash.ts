/** SHA-256 via Web Crypto — available in Workers and Node 22. */
export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(',')}}`;
}

export function generateApiKey(): { raw: string; prefix: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const secret = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const prefix = secret.slice(0, 8);
  return { raw: `scr_${prefix}${secret.slice(8)}`, prefix };
}

export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
