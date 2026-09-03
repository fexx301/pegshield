import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  webpack(config) {
    // WalletConnect's optional pretty logger is a Node-only convenience. The
    // browser bundle does not use it; resolving it as an empty module keeps
    // production builds warning-free without adding a runtime dependency.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "pino-pretty": false,
    };
    return config;
  },
};

export default nextConfig;
