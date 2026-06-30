/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // rss-parser pulls in optional native-ish deps; keep them server-only.
  experimental: {
    serverComponentsExternalPackages: ["rss-parser"],
  },
};

module.exports = nextConfig;
