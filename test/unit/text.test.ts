import { describe, expect, it } from 'vitest';
import { extractTitle, htmlToText, normalizeText, toReadableContent } from '../../src/lib/text';
import { ContentTruncatedError, UnsupportedContentError } from '../../src/lib/errors';

const HTML = `<html><head><title>My Story</title></head><body>
<nav>Navigation links here</nav><script>alert('secret')</script>
<article><p>The council approved twelve electric buses on Tuesday morning.</p>
<p>Officials expect a noticeable reduction in commute times across the city.</p></article>
<footer>Copyright text</footer></body></html>`;

const bytes = (text: string) => new TextEncoder().encode(text);

describe('HTML to readable text', () => {
  it('extracts the title and strips boilerplate', () => {
    expect(extractTitle(HTML)).toBe('My Story');
    const text = htmlToText(HTML);
    expect(text).toContain('twelve electric buses');
    expect(text).not.toContain('Navigation links');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('Copyright');
  });

  it('decodes entities and normalizes whitespace', () => {
    expect(htmlToText('a&nbsp;&amp; b \n\n\n cc')).toBe('a & b\ncc');
    expect(normalizeText('a  b \n\n\n cc')).toBe('a b\ncc');
  });

  it('rejects pages with too little text or an unsupported type', () => {
    expect(() => toReadableContent(bytes('<p>short</p>'), 'text/html', 1000)).toThrow(UnsupportedContentError);
    expect(() => toReadableContent(bytes('x'.repeat(120)), 'image/png', 1000)).toThrow(UnsupportedContentError);
    expect(() => toReadableContent(bytes('a'.repeat(120)), 'text/plain', 50)).toThrow(ContentTruncatedError);
    expect(toReadableContent(bytes('a'.repeat(120)), 'text/plain', 200).truncated).toBe(false);
  });
});
