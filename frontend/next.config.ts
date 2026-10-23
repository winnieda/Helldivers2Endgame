import path from 'path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Static export: the prototype is a single offline web page bundle (S3/CloudFront later).
  output: 'export',
  // The economic engine lives in ../engine and is compiled straight from source.
  experimental: { externalDir: true },
  // The engine imports ../market/... without extensions; keep the export URLs clean too.
  trailingSlash: true,
  images: { unoptimized: true },
  // The repo root holds the npm workspace lockfile.
  outputFileTracingRoot: path.join(__dirname, '..'),
};

export default nextConfig;
