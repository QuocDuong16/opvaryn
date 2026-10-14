import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @opvaryn/contracts ships TypeScript sources (no build step) so generated
  // contract types cannot drift from the OpenAPI document.
  transpilePackages: ['@opvaryn/contracts'],
  // The deployment image runs the standalone server: only the files it actually
  // needs, no pnpm install in the runtime layer. `pnpm dev`/`pnpm start` on the
  // host are unaffected (the standalone tree is extra output, not a replacement).
  output: 'standalone',
};

export default nextConfig;
