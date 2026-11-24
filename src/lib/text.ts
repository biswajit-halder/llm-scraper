import { ContentTruncatedError, UnsupportedContentError } from './errors';

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®',
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
    if (entity.startsWith('#')) {
      const hex = entity.toLowerCase().startsWith('#x');
      const code = Number.parseInt(hex ? entity.slice(2) : entity.slice(1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[entity.toLowerCase()] ?? '';
  });
}

export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 1)
    .join('\n')
    .trim();
}

function cleanFragment(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    ?? html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = match ? cleanFragment(match[1]!) : '';
  return title ? title.slice(0, 200) : null;
}

/** Regex-based boilerplate stripping: no DOM dependency in the Workers runtime. */
export function htmlToText(html: string): string {
  let body = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const main = body.match(/<(article|main)\b[^>]*>[\s\S]*?<\/\1>/i);
  if (main && main[0].length > 200) body = main[0];

  body = body
    .replace(/<(script|style|nav|header|footer|aside|form|svg|noscript|iframe|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*\b(?:class|id)\s*=\s*["'][^"']*(?:nav|menu|footer|header|sidebar|advert|cookie|comment|related|social|share|breadcrumb)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  return normalizeText(decodeEntities(body));
}

export interface ReadableContent {
  text: string;
  title: string | null;
  truncated: boolean;
}

export function toReadableContent(
  bytes: Uint8Array,
  contentType: string,
  maxChars: number,
): ReadableContent {
  const raw = new TextDecoder('utf-8').decode(bytes);
  let text: string;
  let title: string | null = null;

  if (contentType.includes('html') || contentType.includes('xhtml')) {
    title = extractTitle(raw);
    text = htmlToText(raw);
  } else if (
    contentType.startsWith('text/') ||
    contentType === 'application/json' ||
    contentType === 'application/xml'
  ) {
    text = normalizeText(raw);
  } else {
    throw new UnsupportedContentError(`Unsupported content type: ${contentType || 'unknown'}`);
  }

  // A truncated-but-successful fetch must never become an authoritative result.
  if (text.length > maxChars) throw new ContentTruncatedError(maxChars);
  if (text.length < 80) throw new UnsupportedContentError('The page has too little usable text');
  return { text, title, truncated: false };
}
