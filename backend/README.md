# Market API

The shared market behind the site. It serves the market and its price history, takes the
loadouts players deploy, runs the daily price update and keeps a copy of the live war data from
[api.helldivers2.dev](https://github.com/helldivers-2/api). Pricing is the same `engine/` code the
site and the CLIs use.

## Running it locally

```bash
npm run dev:all            # API on :8787 and the site on :3000 together
npm run dev:api            # just the API
npm run dev:api -- --schedule   # also run the jobs on a timer (see below)
```

`npm run dev` reads `frontend/.env.development`, which points the site at
`http://127.0.0.1:8787`. Set `NEXT_PUBLIC_API_URL=` (empty) there to go back to the offline
mode, where each browser keeps its own market. `npm run build` on its own is still the offline
site; `npm run aws:deploy` builds with `NEXT_PUBLIC_API_URL=/` (the API on the site's own origin).

Data is kept as JSON files in `data/server/` (git-ignored). Delete the folder to start over.

The nav shows where the market comes from: **Live** (synced with the server; click to sync now),
**Offline** (server unreachable: showing the last copy; deploys wait in an outbox and are sent
when it's back) or **Local** (offline mode).

## Jobs

```bash
npm run job -- daily                       # run a market update now
npm run job -- daily --min-hours 20        # only if the market is at least 20 h old
npm run job -- sync-live                   # fetch war, assignments, planets, ... now
npm run job -- console "sim day 360" --repeat 100   # 100 days of heavy synthetic traffic
```

`console` takes any ship-terminal market command. In the site's terminal, commands that change the
market (`update`, `sim day`, `init`, `config set`, ...) run on the server; read-only ones answer
from the synced copy.

Prices don't move on their own unless the server runs with `--schedule`, which updates the
market once it's `HD2E_UPDATE_HOURS` (24) old and syncs live data every `HD2E_LIVE_MINUTES` (30).

## API

| | |
|---|---|
| `GET /api/market`, `GET /api/history` | The shared documents, with an ETag. `Cache-Control: no-cache` makes every load revalidate, so a refresh can't show an old market day. |
| `GET /api/live/<name>` | `war`, `assignments`, `planet-events`, `dispatches`, `planets`, `steam`, `manifest` |
| `POST /api/loadouts` | `{ submissions }`: deployed loadouts, checked with the engine's loadout rules |
| `POST /api/loadouts/withdraw` | Cancelled deploys. Refused if an update already counted them. |
| `POST /api/feedback` | `{ kind, from, version?, payload }` from the debrief form (`version` is the site build, shown in the email). Saved as `feedback/<day>/<id>`; detailed and brief entries are also emailed (at most 50 a day), with subjects starting `[H2E Feedback Email]`. Locally the "email" is printed to the console. |
| `POST /api/admin/update` · `/console` · `/sync-live`, `PUT /api/admin/market` | Admin: need `X-Admin-Token: $HD2E_ADMIN_TOKEN` (the local server also takes `Authorization: Bearer`; CloudFront overwrites that header on AWS). With no token set, the local server leaves them open and only listens on 127.0.0.1. In the browser, `token <value>` in the terminal saves the token. |

Writes are read-modify-write with a conditional put on the market's ETag, retried on conflict, so
concurrent deploys and updates don't overwrite each other.

## On AWS

The live deployment is in [`infrastructure/`](../infrastructure/README.md). `src/lambda.ts` adapts
function URL events (payload format 2.0) to `src/api.ts`, and runs a job when invoked with
`{ "job": "daily", "args": ["--min-hours", "20"] }`, which is what the daily EventBridge rule
sends. Documents live in S3 (`src/s3-storage.ts`, conditional writes through `If-Match`), and
feedback email goes through SNS (`src/sns-notifier.ts`). Lambda's runtime provides the AWS SDK,
so neither file is loaded by the tests or the local server.

Settings: `HD2E_PORT`, `HD2E_HOST`, `HD2E_DATA_DIR`, `HD2E_ADMIN_TOKEN`, `HD2E_CORS_ORIGINS`,
`HD2E_CONTACT` (sent to api.helldivers2.dev as `X-Super-Contact`, as its maintainers ask),
`HD2E_STORAGE` (Lambda: `s3`, `file` or `memory`), `HD2E_BUCKET` and `HD2E_PREFIX` (S3),
`HD2E_FEEDBACK_TOPIC` (SNS topic ARN; unset: feedback emails are printed).
