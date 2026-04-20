// eslint-disable-next-line @typescript-eslint/no-require-imports
const withBundleAnalyzer =
  process.env.ANALYZE === 'true'
    ? (await import('@next/bundle-analyzer')).default({ enabled: true })
    : (/** @type {import('next').NextConfig} */ c) => c;

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@saep/sdk', '@saep/sdk-ui', '@saep/ui'],
  experimental: {
    optimizePackageImports: [
      '@solana/web3.js',
      '@coral-xyz/anchor',
      'recharts',
    ],
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@solana/wallet-adapter-react': require.resolve('@solana/wallet-adapter-react'),
      '@tanstack/react-query': require.resolve('@tanstack/react-query'),
    };
    return config;
  },
};

export default withBundleAnalyzer(nextConfig);
