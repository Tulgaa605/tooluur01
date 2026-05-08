const path = require('path')

/** @type {import('next').NextConfig} */
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true'

const nextConfig = {
  // Олон lockfile (жишээ нь Desktop болон эцэг хавтас) байхад Next.js буруу root сонгохоос сэргийлнэ
  outputFileTracingRoot: path.join(__dirname),
  reactStrictMode: true,
  // TS worker OOM (бага RAM сервер): NEXT_IGNORE_BUILD_ERRORS=1 + pnpm typecheck тусад нь
  typescript: {
    ignoreBuildErrors: process.env.NEXT_IGNORE_BUILD_ERRORS === '1',
  },
  // Windows/local дээр .next дотор permission/lock асуудал үүсдэг тул тусад нь салгасан.
  // Харин Vercel deploy дээр Next.js build output нь ".next" байх ёстой (Vercel үүнийг хайж шалгадаг).
  distDir: isVercel ? '.next' : '.next-build',
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = config.watchOptions || {};
      config.watchOptions.ignored = [
        ...(Array.isArray(config.watchOptions.ignored) ? config.watchOptions.ignored : [config.watchOptions.ignored].filter(Boolean)),
        '**/node_modules/**',
        '**/.next/**',
        '**/.next-build/**',
        'C:\\System Volume Information/**',
        'C:\\pagefile.sys',
      ].filter(Boolean);
    }
    return config;
  },
}

module.exports = nextConfig

