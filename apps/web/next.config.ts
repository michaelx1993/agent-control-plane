import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@agent-control-plane/core", "@agent-control-plane/db"],
};

export default nextConfig;
