import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This repo lives inside another checkout on the dev machine, and Next would
  // otherwise walk up to that parent's lockfile when tracing build output.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
