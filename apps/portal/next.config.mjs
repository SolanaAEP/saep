/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@saep/sdk', '@saep/sdk-ui', '@saep/ui'],
};

export default nextConfig;
