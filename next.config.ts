import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This repo lives inside another checkout on the dev machine, and Next would
  // otherwise walk up to that parent's lockfile when tracing build output.
  outputFileTracingRoot: path.join(__dirname),
  // The dev overlay badge sits on top of the page and lands in every design
  // screenshot. It has no bearing on production, so it just gets in the way.
  devIndicators: false,
};

export default nextConfig;
