/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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

