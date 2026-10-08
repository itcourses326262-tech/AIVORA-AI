import type { NextConfig } from 'next';
import { securityHeaders } from './src/server/security/headers';

const isProd = process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // Native / CommonJS-only packages must be required at runtime, not bundled.
  serverExternalPackages: ['better-sqlite3', 'sharp', 'gifenc'],
  // Migrations are read from `<cwd>/drizzle` at runtime, which file tracing cannot see.
  outputFileTracingIncludes: { '/**/*': ['./drizzle/**/*'] },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders(isProd) }];
  },
};

export default nextConfig;
