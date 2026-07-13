import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // Pin the tracing root to this app — a stray lockfile in a parent
  // directory otherwise makes Next.js guess (and warn) about the workspace root.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
