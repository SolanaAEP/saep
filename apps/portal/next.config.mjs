// eslint-disable-next-line @typescript-eslint/no-require-imports
const withBundleAnalyzer =
  process.env.ANALYZE === 'true'
    ? (await import('@next/bundle-analyzer')).default({ enabled: true })
    : (/** @type {import('next').NextConfig} */ c) => c;

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
};

export default withBundleAnalyzer(nextConfig);
