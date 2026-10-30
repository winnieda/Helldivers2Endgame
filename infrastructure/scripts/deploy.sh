#!/usr/bin/env bash
# Deploys to the H2E AWS account.
#   npm run aws:deploy          the stack (CDK), then the site
#   npm run aws:site            just the site, after frontend-only changes
set -euo pipefail
cd "$(dirname "$0")/../.."
export AWS_PROFILE="${AWS_PROFILE:-h2e}"
node -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)' || { echo "Needs Node 20+ (run: nvm use)" >&2; exit 1; }

if [ "${1:-all}" != site ]; then
  npx tsc -p engine
  (cd infrastructure && npx cdk deploy --require-approval never --outputs-file cdk-outputs.json)
fi

out() { node -e "console.log(require('./infrastructure/cdk-outputs.json').H2E['$1'])"; }
BUCKET=$(out SiteBucket)
DIST=$(out DistributionId)

# The release build (no dev tools; see frontend/next.config.ts). "/" = the API is on the same
# origin, under /api/. The release check stops the deploy if anything dev-only slipped through.
H2E_RELEASE=1 NEXT_PUBLIC_API_URL=/ npm run build -w frontend
node frontend/scripts/release-check.mjs

# Hashed build files never change: cached for a year, and old ones are kept so open tabs still load.
aws s3 sync frontend/out/_next/static "s3://$BUCKET/_next/static" --only-show-errors --cache-control 'public, max-age=31536000, immutable'
# Art, icons and fonts: a day. Pages and their RSC payloads (.txt): checked on every load.
aws s3 sync frontend/out "s3://$BUCKET" --only-show-errors --delete --exclude '_next/static/*' --exclude '*.html' --exclude '*.txt' --cache-control 'public, max-age=86400'
aws s3 sync frontend/out "s3://$BUCKET" --only-show-errors --delete --exclude '*' --include '*.html' --include '*.txt' --cache-control 'no-cache'
aws cloudfront create-invalidation --distribution-id "$DIST" --paths '/*' --query 'Invalidation.Id' --output text >/dev/null

echo "Live at $(out SiteUrl)"
