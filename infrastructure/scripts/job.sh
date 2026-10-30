#!/usr/bin/env bash
# Runs a backend job (backend/src/jobs.ts) on AWS against the live market.
#   npm run aws:job -- daily                       run the market update now
#   npm run aws:job -- console "prices bots strat"  any ship-terminal market command
#   npm run aws:job -- sync-live                   fetch live war data
set -euo pipefail
cd "$(dirname "$0")/../.."
export AWS_PROFILE="${AWS_PROFILE:-h2e}"
FN=$(node -e "console.log(require('./infrastructure/cdk-outputs.json').H2E.JobsFunction)")
PAYLOAD=$(node -e 'const [job, ...args] = process.argv.slice(1); console.log(JSON.stringify({ job, args }))' "$@")
RES=$(mktemp)
trap 'rm -f "$RES"' EXIT
aws lambda invoke --function-name "$FN" --cli-binary-format raw-in-base64-out --cli-read-timeout 310 --payload "$PAYLOAD" "$RES" >/dev/null
node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(r.message ?? `Failed: ${r.errorMessage ?? JSON.stringify(r)}`); process.exit(r.message ? 0 : 1)' "$RES"
