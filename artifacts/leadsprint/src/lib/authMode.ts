export type AuthMode = 'demo' | 'clerk' | 'unconfigured';

/**
 * Decides how the console authenticates, from build-time inputs only.
 *
 * - `demo`: the build was made with VITE_LEADSPRINT_DEMO_AUTH=true. The API
 *   server only honours this outside NODE_ENV=production.
 * - `clerk`: a Clerk publishable key was baked into the build.
 * - `unconfigured`: a production build with neither. The API answers 401 to
 *   every operator route in that state, so the console says so plainly
 *   instead of painting a demo banner over a broken workspace.
 *
 * Non-production builds (`vite dev`) without a key still fall back to demo,
 * so local development works out of the box.
 */
export function resolveAuthMode(input: {
  demoFlag: string | undefined;
  clerkKey: string | undefined;
  isProd: boolean;
}): AuthMode {
  if (input.demoFlag === 'true') return 'demo';
  if (input.clerkKey?.trim()) return 'clerk';
  return input.isProd ? 'unconfigured' : 'demo';
}
