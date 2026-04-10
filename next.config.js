const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Олон lockfile (жишээ нь Desktop болон эцэг хавтас) байхад Next.js буруу root сонгохоос сэргийлнэ
  outputFileTracingRoot: path.join(__dirname),
  reactStrictMode: true,
  // TS worker OOM (бага RAM сервер): NEXT_IGNORE_BUILD_ERRORS=1 + pnpm typecheck тусад нь
  typescript: {
    ignoreBuildErrors: process.env.NEXT_IGNORE_BUILD_ERRORS === '1',
  },
  // Windows дээр .next дотор permission/lock асуудал үүсэж байвал distDir-ийг тусад нь салгаж өгнө
  distDir: '.next-build',
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

