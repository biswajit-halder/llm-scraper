import { describe, expect, it } from 'vitest';
import { isPathAllowed, parseRobots } from '../../src/lib/robots';

describe('robots.txt parsing', () => {
  it('uses the longest matching rule', () => {
    const groups = parseRobots([
      'User-agent: *',
      'Disallow: /private',
      'Allow: /private/public',
      '',
      'User-agent: googlebot',
      'Disallow: /',
    ].join('\n'));
    expect(isPathAllowed(groups, '/private/secret', 'llm-scraper/1.0')).toBe(false);
    expect(isPathAllowed(groups, '/private/public/page', 'llm-scraper/1.0')).toBe(true);
    expect(isPathAllowed(groups, '/article', 'llm-scraper/1.0')).toBe(true);
    expect(isPathAllowed(groups, '/article', 'googlebot')).toBe(false);
  });

  it('treats an empty disallow as allow-all', () => {
    const groups = parseRobots('User-agent: *\nDisallow:');
    expect(isPathAllowed(groups, '/anything', 'llm-scraper')).toBe(true);
  });
});
