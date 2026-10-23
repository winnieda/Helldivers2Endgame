# Helldivers 2 Endgame

An unofficial endgame mode for Helldivers 2: every stratagem, primary, secondary and throwable
costs Requisition. You start with 50,000, buy your loadout before each mission, and survive on what
you earn. Prices are set by a community-driven market that charges more for the meta and less for
the gear nobody uses, separately against each enemy faction.

This repository is the **offline, single-browser prototype**. It covers the full game loop (both
modes), the economic engine, a ship-terminal console for running price updates by hand, and a
simulation lab for testing whether the pricing equations behave.

## Run it

```bash
npm install          # once (workspace: frontend + engine)
npm run dev          # http://localhost:3000
```

`npm run build` produces a fully static site in `frontend/out/`. Serve it with any static file server,
e.g. `python3 -m http.server -d frontend/out`. Nothing calls the network at runtime: fonts are
self-hosted and all state lives in the browser's localStorage.

## What's in the prototype

| Page | What it does |
|---|---|
| **Deploy** (`/play`) | Start an **Operations** run (three-mission operations, 50k balance and cap, bankrupt = out) or a **Budget Blitz** (earn more than you spend each round or you're eliminated). One to four Helldivers share the device. The flow: briefing (front + difficulty) → armory (buy a loadout per diver) → deploy → debrief (outcome, Requisition earned, reinforcements) → summary. Deployed loadouts are queued, anonymously, for the market. |
| **Galactic Market** (`/market`) | Per-faction price boards for all 196 items, with change since the last cycle, sparklines, popularity, the price each item is heading toward, and per-item history charts. |
| **Ship terminal** (press <kbd>`</kbd> anywhere) | The market console. **Prices only change when you run `update` here**; there is no daily timer or per-purchase update. Also `status`, `prices bots strat`, `price railgun`, `sim squads 50`, `sim day 50`, `config set …`, `init <preset>`, `sim run <scenario>`, `export`/`import`. Type `help`. |
| **Market Lab** (`/lab`) | Runs months of simulated rule-based squads against a copy of the market, then grades the result with automated health checks and charts. Tune every pricing parameter and the player mix, and compare the new algorithm with the original prototype's. You can push tuned parameters, or a matured market, to the live game. |
| **Field Manual** (`/manual`) | Rules, how pricing works (with a live plot of the price curve), testing tools and command reference. |

Three items are always free: **R-2124 Constitution, P-2 Peacemaker and G-12 High Explosive**.
Each front also has four rotating free stratagems, so a zero-cost loadout is always possible.

## Command line

The shell CLI uses the same command set as the browser terminal, backed by `data/market.json`:

```bash
npm run market -- status
npm run market -- init equal                 # tiers | equal | tiers-inverted | random | flat
npm run market -- sim squads 200             # queue synthetic loadouts (like the prototype's "100 simulations")
npm run market -- update                     # run the price update
npm run market -- prices bots strat --sort share
npm run market -- config set anchored.elasticityUp 1.1
npm run market -- export-csv data/csv        # per-front, per-category price CSVs, one row per cycle

npm run sim                                  # the whole scenario suite (anchored algorithm)
npm run sim -- --compare                     # new algorithm vs the original prototype's, side by side
npm run sim -- balance-patch --days 180 --seeds 3
npm run sim -- baseline --set anchored.maxStep=0.1 --html report.html --csv data/sim
npm run sim -- --help

npm test                                     # engine unit tests
```

Move a market between the CLI and the browser with the terminal's `export` (download) and
`import` (file picker). The CLI reads both formats.

## How pricing works (short version)

Details, parameters and test results: **[docs/PRICING.md](docs/PRICING.md)**.

1. **Measure popularity.** Each category's picks become smoothed shares. Small batches count less,
   and less-owned Warbond/Superstore gear is corrected by ÷0.9. The free defaults stay in the
   count, and rotating free stratagems are frozen while free.
2. **Set a target.** `target = baseline × F(share / fairShare)`, where `F` is a power law that bends
   smoothly into a ceiling and a floor. Because `F` is bounded, prices can't run away or
   collapse no matter how people play.
3. **Step toward it.** At most ±20% per cycle, with ×1.1 / ×0.9 up/down nudges. Cheap items rise
   slower and expensive items react faster. A category whose spending runs hot rises slower and
   falls faster.

The simulation suite runs 12 scenarios: launch, blank-slate and inverted starts, meta-heavy,
frugal and niche-loving playerbases, a balance patch, a Major Order, low traffic, a traffic surge
and brigading. The anchored algorithm passes 9 and warns on 3. The original prototype's algorithm
fails 11 and warns on the 12th, mostly through steady deflation (25–40% a month) that pins gear at
the 10 Requisition floor. Under brigading, one of its items reaches the 50,000 hard cap.

## Repository layout

```
engine/                 Economic engine, pure TypeScript (no DOM). Used by the web app, the CLIs and later the price-update Lambda.
  src/catalog/          196-item catalog generated from u.gg tier lists + wiki stratagem codes
  src/market/           market state, anchored + legacy pricing, presets, free rotation, history
  src/game/             economy rules and the campaign state machine (Operations, Budget Blitz)
  src/sim/              rule-based squad agents, scenarios, simulator, health checks
  src/console/          the shared terminal command set
  src/cli/              `npm run market`, `npm run sim`, HTML reports
  src/test/             node:test unit tests (including exact parity with the Python prototype)
frontend/               Next.js 15 + React 19 + Tailwind 4, static export
tools/catalog/          fetch + build the catalog (u.gg via Wayback snapshots, wiki codes)
tools/legacy_fixture.py runs scratchpad/helper.py to produce the parity test fixture
docs/PRICING.md         the pricing reference
realtime_api/           earlier AppSync schema sketches (unchanged)
```

## Data

The catalog covers every item on the u.gg Helldivers 2 tier lists, captured on 2026-10-06, with
separate OP…D ratings against Automatons, Terminids and Illuminate. It has 93 stratagems, 55
primaries, 25 secondaries and 23 throwables. Stratagem input codes and cooldowns come from
helldivers.wiki.gg. u.gg blocks automated requests, so the fetcher reads the most recent Wayback
Machine snapshot instead. To use the live site, save the pages from your browser and run
`python3 tools/catalog/catalog.py fetch --html-dir <folder>`, then `… build`.

Initialization presets (`init <preset>`) support different kinds of testing:

- `tiers`: per-faction prices from the tier lists (the default launch state).
- `equal`: every item at its category baseline.
- `tiers-inverted`: meta cheap, junk expensive; a stress test.
- `random`: seeded random prices.
- `flat`: everything at one price, like the Python prototype's 3000.

## Decisions made for this prototype

- **Free items.** Only the three you named are permanently free. The older design summary also
  listed the Liberator, Frag and Smoke as free; here they are ordinary priced items. The four
  rotating free stratagems (from the summary and the prototype's `choose_free_stratagems`) are
  implemented and configurable.
- **Price updates** are the `update` command (browser terminal or CLI), per the brief. Deployed
  loadouts wait in a pending queue until then.
- **Mission results** are entered by the players. The debrief suggests earnings by difficulty
  (11,000 for a Helldive extraction, 12,000 for Super Helldive). Each reinforcement costs 250, about
  1,000 for a typical mission.
- **Bankruptcy** happens when a balance would go below zero after the reinforcement bill. Earnings
  above the 50,000 cap are lost.
- **Budget Blitz:** you survive a round with profit above zero (or an optional, escalating
  margin). The last diver standing wins. If the last divers fall in the same round, the higher
  total profit wins. Solo, the score is your streak.
- **Multiplayer** is hot-seat on one device for now. The campaign engine is a pure state machine,
  so a future AppSync/DynamoDB lobby can run the same transitions server-side.

Unofficial fan project, not affiliated with Arrowhead Game Studios or Sony Interactive
Entertainment.
