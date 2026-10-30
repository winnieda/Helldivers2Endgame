# AWS deployment

The live site, https://hd2galacticmarket.com: one CDK stack (`H2E`) in account 675536972377, us-east-1, deployed from your machine
with the `h2e` CLI profile. There's no CI: deploys are `npm run aws:deploy`.

```
CloudFront ─┬─ /*      → S3 Site bucket: the static export (frontend/out)
            └─ /api/*  → Lambda Api (function URL; only CloudFront can call it)
                            → S3 Data bucket: market, history, feedback (versioned, 30 days)
                            → SNS Feedback topic → email to helldivers2endgame@gmail.com
                            → AppSync Events "LobbyEvents": "lobby changed" notices
EventBridge, daily 09:00 UTC → Lambda Jobs → market update (--min-hours 20)
Browsers ── WebSocket ──→ AppSync Events (subscribe only, with the public API key)
```

Online lobbies live in the Data bucket too (`lobbies/<id>`, `lobby-codes/<CODE>`; deleted after 14
days without use). After every change the Api Lambda publishes `{"v": version}` to
`/lobbies/<id>`, signed with its own role, and browsers refetch the lobby. The API key browsers use
can only subscribe; its expiry moves a year out on every deploy, and if it ever lapses, browsers
fall back to polling every couple of seconds.

## Commands

Run from the repo root under Node 20+ (`nvm use` picks 22 from `.nvmrc`).

```bash
npm run aws:deploy                          # the stack, then the site
npm run aws:site                            # just the site, after frontend-only changes
npm run aws:job -- daily                    # run the market update now
npm run aws:job -- console "prices bots strat"   # any ship-terminal market command, on the live market
npm run aws:job -- sync-live                # fetch live war data (no schedule for it yet: the site doesn't use it)
cd infrastructure && npx cdk diff           # what a deploy would change
```

The site's ship terminal works against the live market too: `token <value>` with the token from
`infrastructure/.admin-token` (created on the first synth, git-ignored), then `update`,
`config set ...` and the other admin commands.

To pause the daily update, set `"schedule": "off"` in `cdk.json` and deploy. Prices then only move
when an admin runs `update`.

## Settings in cdk.json

| | |
|---|---|
| `schedule` | `on`: the daily market update runs. `off`: prices only move when an admin runs `update`. |
| `waf` | `on` attaches the WAF web ACL (rate limits, AWS's bad-IP list). Keep it on only while the distribution is on the flat-rate Free plan, which covers it; on pay-as-you-go the ACL costs about $8 a month. |
| `domain`, `hostedZoneId` | The site's domain and its Route 53 hosted zone (see Domain below). Empty: the site is only at its cloudfront.net address. Set: a free ACM certificate, both names on CloudFront, alias records, and www redirecting to the bare domain. |

## One-time steps outside CDK

- **Budgets** (monitoring budgets are free):
  - `h2e-monthly`: $3 a month of *usage*, emailing helldivers2endgame@gmail.com when actual spend
    passes $1 and $3, or the forecast passes $3. It counts only usage charges and leaves out the
    domain registrar, so the yearly domain fee (and its sales tax) never trips it.
  - `h2e-domain`: $20 a year (Oct–Sep) of domain fees; alerts if registering or renewing ever
    costs more than that.
  - Both use filter expressions, which the CLI only supports from v2.28 or so: `aws budgets
    describe-budget --account-id 675536972377 --budget-name h2e-monthly`.
- **Feedback email:** SNS emails a confirmation link to helldivers2endgame@gmail.com on the first deploy.
  Nothing is delivered until it's clicked. In Gmail, filter on `subject:"[H2E Feedback Email]"` →
  label, never send to spam. The sender shows as "AWS Notifications".
- **CloudFront flat-rate Free plan:** $0 a month for 1M requests and 100 GB, never an overage
  charge (past the allowance AWS may slow delivery instead), and it covers the WAF web ACL and
  the Route 53 hosted zone. Subscribed with `aws pricing-plan-manager create-subscription
  --plan-family CloudFront --plan-tier FREE --resource-arns <DistributionArn> <FirewallArn>` (CLI
  v2.32+), or in the CloudFront console under the distribution's pricing plan. The hosted zone is
  attached with `associate-resources-to-subscription`.
- **Domain:** `hd2galacticmarket.com` is registered outside AWS (new AWS accounts couldn't register
  domains: Route 53 refused with "contact AWS Support"). DNS still lives in Route 53, in hosted zone
  `Z091804027MIKEOIBP968`, created by hand so it outlives the stack and attached to the Free plan.
  At the registrar, the domain's name servers are set to:
  `ns-1064.awsdns-05.org`, `ns-309.awsdns-38.com`, `ns-871.awsdns-44.net`, `ns-1689.awsdns-19.co.uk`.
  With `domain` and `hostedZoneId` set in `cdk.json`, the stack adds the certificate, both names on
  CloudFront, the alias records and the www redirect. Renewal happens at the registrar.

## Release check

`npm run aws:deploy` publishes the *release* build of the site and runs
`frontend/scripts/release-check.mjs` on it first; a failure stops the deploy before anything is
uploaded. See the main README ("Dev and release builds") and `frontend/release-check.json`.

## Cost

At a few hundred players this should stay within the always-free allowances: Lambda (1M requests),
CloudFront, SNS (1,000 emails), EventBridge, CloudWatch Logs (14-day retention). What's left is S3
storage and requests: cents a month. Nothing here bills by the hour. Don't add a VPC, NAT gateway,
load balancer, RDS, Secrets Manager secret or KMS key without checking the price first: each one
costs more per month than everything above together.

The account's Lambda concurrency limit is 10 (new accounts start there), which also caps how fast a
flood of requests could run up a bill.

## Taking it down

```bash
cd infrastructure && npx cdk destroy        # removes the site, the API and CloudFront
```

If the distribution is on a flat-rate plan, cancel the plan in the console first (the Free plan
cancels immediately). The Data bucket is kept on purpose. Empty and delete it by hand if you want
the market and feedback gone too.
