import { execSync } from 'child_process';
import path from 'path';
import type { NextConfig } from 'next';

/**
 * Two builds from one codebase:
 *   dev      `npm run dev`, `npm run build`: everything, including the Market Lab, the ship
 *            terminal and the sync/queue chips used to run and tune the market.
 *   release  H2E_RELEASE=1 (set by `npm run aws:deploy` and `npm run preview:release`): only
 *            what players should see.
 * `__DEV_TOOLS__` becomes a literal true/false at build time, so code behind it is removed from
 * release bundles, not just hidden. Dev-only pages are named page.dev.tsx, which release builds
 * don't treat as pages. scripts/release-check.mjs then checks the release output.
 */
const release = process.env.H2E_RELEASE === '1';

/** "2026-10-29.a1b2c3d", plus "-dirty" for uncommitted changes and "-dev" for dev builds. Sent with feedback. */
function buildId(): string {
  const git = (args: string) => execSync(`git ${args}`, { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  let rev = 'nogit';
  try {
    rev = git('rev-parse --short HEAD') + (git('status --porcelain') ? '-dirty' : '');
  } catch {
    // not a git checkout
  }
  return `${new Date().toISOString().slice(0, 10)}.${rev}${release ? '' : '-dev'}`;
}

const nextConfig: NextConfig = {
  // Static export: served from S3 behind CloudFront.
  output: 'export',
  // The economic engine lives in ../engine and is compiled straight from source.
  experimental: { externalDir: true },
  // The engine imports ../market/... without extensions; keep the export URLs clean too.
  trailingSlash: true,
  images: { unoptimized: true },
  // The repo root holds the npm workspace lockfile.
  outputFileTracingRoot: path.join(__dirname, '..'),
  pageExtensions: release ? ['tsx', 'ts', 'jsx', 'js'] : ['dev.tsx', 'dev.ts', 'tsx', 'ts', 'jsx', 'js'],
  compiler: {
    // Next JSON-stringifies these values itself, so pass the values, not code. Its type says
    // string, but a string "false" would be truthy: the boolean has to go in as a boolean.
    define: {
      __DEV_TOOLS__: !release as unknown as string,
      __BUILD_ID__: buildId(),
    },
  },
};

export default nextConfig;
