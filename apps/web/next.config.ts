import path from "node:path";
import type { NextConfig } from "next";

// next dev/build run from apps/web
const repoRoot = path.resolve(process.cwd(), "..", "..");

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript sources.
  transpilePackages: [
    "@pwps/core",
    "@seqseal/contracts",
    "@seqseal/engine-core",
    "@seqseal/action-policy-core",
    "@seqseal/evidence-model",
    "@seqseal/ring-adapter",
    "@seqseal/pipeline",
  ],
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
