import { describe, expect, it } from 'vitest';
import { resolveAuthMode } from './authMode';

describe('resolveAuthMode', () => {
  it('is demo when the build flag is explicitly "true", even with a Clerk key', () => {
    expect(resolveAuthMode({ demoFlag: 'true', clerkKey: 'pk_test_abc', isProd: true })).toBe('demo');
  });

  it('is clerk when a publishable key is present and demo is not requested', () => {
    expect(resolveAuthMode({ demoFlag: 'false', clerkKey: 'pk_live_abc', isProd: true })).toBe('clerk');
    expect(resolveAuthMode({ demoFlag: undefined, clerkKey: 'pk_live_abc', isProd: true })).toBe('clerk');
  });

  it('is unconfigured in a production build with no Clerk key and no demo flag', () => {
    // Without this, the console paints a demo banner over an API that answers
    // 401 to everything (the server refuses demo auth when NODE_ENV=production).
    expect(resolveAuthMode({ demoFlag: undefined, clerkKey: '', isProd: true })).toBe('unconfigured');
    expect(resolveAuthMode({ demoFlag: 'false', clerkKey: undefined, isProd: true })).toBe('unconfigured');
  });

  it('treats a whitespace-only key as no key', () => {
    expect(resolveAuthMode({ demoFlag: undefined, clerkKey: '   ', isProd: true })).toBe('unconfigured');
  });

  it('falls back to demo for local development builds with no Clerk key', () => {
    expect(resolveAuthMode({ demoFlag: undefined, clerkKey: '', isProd: false })).toBe('demo');
  });

  it('only the exact string "true" enables demo', () => {
    expect(resolveAuthMode({ demoFlag: 'TRUE', clerkKey: 'pk_test_abc', isProd: true })).toBe('clerk');
    expect(resolveAuthMode({ demoFlag: '1', clerkKey: 'pk_test_abc', isProd: true })).toBe('clerk');
  });
});
