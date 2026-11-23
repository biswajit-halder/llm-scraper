import { FetchFailedError, SsrfBlockedError } from './errors';

/** CIDR blocks that must never be reachable from a user-supplied URL. */
const BLOCKED_V4: Array<[base: string, bits: number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((((nums[0]! << 24) >>> 0) + (nums[1]! << 16) + (nums[2]! << 8) + nums[3]!) >>> 0);
}

function inV4Cidr(value: number, base: string, bits: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (baseInt & mask);
}

export function isBlockedIp(rawIp: string): boolean {
  const ip = rawIp.replace(/^\[|\]$/g, '').toLowerCase();
  const v4 = ipv4ToInt(ip);
  if (v4 !== null) return BLOCKED_V4.some(([base, bits]) => inV4Cidr(v4, base, bits));
  if (!ip.includes(':')) return false;
  if (ip === '::' || ip === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isBlockedIp(mapped[1]!);
  const first = Number.parseInt(ip.split(':')[0] || '0', 16);
  if (first >= 0xfc00 && first <= 0xfdff) return true;
  if (first >= 0xfe80 && first <= 0xfebf) return true;
  return ip.startsWith('2001:db8:');
}

function isIpLiteral(host: string): boolean {
  return ipv4ToInt(host) !== null || host.includes(':');
}

function hostMatches(host: string, list: string): boolean {
  return list
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => host === entry || host.endsWith(`.${entry}`));
}

export function assertPublicUrl(
  raw: string,
  policy: { allowedHosts: string; blockedHosts: string },
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfBlockedError('Invalid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SsrfBlockedError('Only http(s) URLs are allowed');
  }
  if (url.username || url.password) throw new SsrfBlockedError('URLs with credentials are not allowed');

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new SsrfBlockedError('Local hostnames are not allowed');
  }
  if (policy.allowedHosts && !hostMatches(host, policy.allowedHosts)) {
    throw new SsrfBlockedError(`Host ${host} is not in the allowlist`);
  }
  if (policy.blockedHosts && hostMatches(host, policy.blockedHosts)) {
    throw new SsrfBlockedError(`Host ${host} is blocklisted`);
  }
  if (isIpLiteral(host) && isBlockedIp(host)) {
    throw new SsrfBlockedError('Private or reserved IP addresses are not allowed');
  }
  return url;
}

/** DNS-over-HTTPS prevents DNS rebinding past the hostname checks. */
async function resolvePublicIps(hostname: string): Promise<string[]> {
  const query = async (type: 'A' | 'AAAA'): Promise<string[]> => {
    const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`;
    const response = await fetch(url, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new FetchFailedError(`DNS lookup failed (${response.status})`);
    const data = (await response.json()) as { Answer?: Array<{ type: number; data: string }> };
    const recordType = type === 'A' ? 1 : 28;
    return (data.Answer ?? [])
      .filter((answer) => answer.type === recordType)
      .map((answer) => answer.data.replace(/\.$/, ''));
  };
  const addresses = [...(await query('A')), ...(await query('AAAA').catch(() => [] as string[]))];
  if (addresses.length === 0) throw new SsrfBlockedError('Hostname did not resolve');
  if (addresses.some(isBlockedIp)) {
    throw new SsrfBlockedError('Hostname resolves to a private or reserved IP address');
  }
  return addresses;
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) throw new FetchFailedError('Source response is too large');
  const reader = response.body?.getReader();
  if (!reader) throw new FetchFailedError('Source response has no body');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new FetchFailedError('Source response is too large');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export interface SafeFetchResult {
  body: Uint8Array;
  contentType: string;
  finalUrl: string;
}

export interface FetchOptions {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  allowedHosts: string;
  blockedHosts: string;
  userAgent: string;
}

/** Validate → host policy → DNS → fetch, re-checking every redirect hop. */
export async function fetchSafe(rawUrl: string, options: FetchOptions): Promise<SafeFetchResult> {
  const policy = { allowedHosts: options.allowedHosts, blockedHosts: options.blockedHosts };
  const maxRedirects = options.maxRedirects ?? 3;
  let current = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const url = assertPublicUrl(current, policy);
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!isIpLiteral(host)) await resolvePublicIps(host);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        redirect: 'manual',
        signal: AbortSignal.timeout(options.timeoutMs),
        headers: { 'user-agent': options.userAgent },
      });
    } catch (error) {
      if (error instanceof SsrfBlockedError) throw error;
      throw new FetchFailedError(`Fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || hop === maxRedirects) throw new FetchFailedError('Too many redirects');
      current = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) throw new FetchFailedError(`Source returned HTTP ${response.status}`);
    const body = await readLimited(response, options.maxBytes);
    if (body.byteLength === 0) throw new FetchFailedError('Source response was empty');
    return {
      body,
      contentType: (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase(),
      finalUrl: url.toString(),
    };
  }
  throw new FetchFailedError('Too many redirects');
}
