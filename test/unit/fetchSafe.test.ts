import { describe, expect, it } from 'vitest';
import { assertPublicUrl, isBlockedIp } from '../../src/lib/fetchSafe';
import { SsrfBlockedError } from '../../src/lib/errors';

const policy = { allowedHosts: '', blockedHosts: '' };

describe('SSRF guards', () => {
  it('blocks local, private and non-http URLs', () => {
    expect(() => assertPublicUrl('http://localhost/admin', policy)).toThrow(SsrfBlockedError);
    expect(() => assertPublicUrl('http://127.0.0.1/admin', policy)).toThrow(SsrfBlockedError);
    expect(() => assertPublicUrl('http://[::1]/', policy)).toThrow(SsrfBlockedError);
    expect(() => assertPublicUrl('file:///etc/passwd', policy)).toThrow(SsrfBlockedError);
    expect(() => assertPublicUrl('https://u:p@example.com/', policy)).toThrow(SsrfBlockedError);
    expect(isBlockedIp('169.254.169.254')).toBe(true);
    expect(isBlockedIp('93.184.216.34')).toBe(false);
  });

  it('enforces host allow/block lists', () => {
    expect(() => assertPublicUrl('https://evil.example.com', { ...policy, allowedHosts: 'good.com' })).toThrow(SsrfBlockedError);
    expect(assertPublicUrl('https://www.good.com/a', { ...policy, allowedHosts: 'good.com' }).hostname).toBe('www.good.com');
    expect(() => assertPublicUrl('https://bad.good.com', { ...policy, blockedHosts: 'bad.good.com' })).toThrow(SsrfBlockedError);
  });
});
