import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @opvaryn/contracts ships TypeScript sources (no build step) so generated
  // contract types cannot drift from the OpenAPI document.
  transpilePackages: ['@opvaryn/contracts'],
};

export default nextConfig;
