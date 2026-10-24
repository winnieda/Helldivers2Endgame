# Pricing: how the Galactic Market sets prices

This is the reference for the economic engine in `engine/src/market/`. It explains the live
algorithm ("anchored popularity pricing"), why it was chosen over the original prototype's
algorithm, every tunable parameter, and how the simulation harness checks that prices behave.

- Live algorithm: `engine/src/market/pricing-anchored.ts`
- Original Python prototype, ported 1:1 for comparison: `engine/src/market/pricing-legacy.ts`
  (an engine test checks it reproduces `scratchpad/helper.py` exactly)
- Parameters and defaults: `engine/src/market/config.ts`
- Free-stratagem rotation: `engine/src/market/free.ts`

## The market in one paragraph

Each enemy front (Terminids, Automatons, Illuminate) has its own market, and each market has four
categories: stratagems, primaries, secondaries and throwables. Every deployed loadout is folded,
anonymously, into a pending batch. Nothing moves until an operator runs a **market update** (the
`update` command in the browser terminal or `npm run market -- update`). In the live design, one
update is one day. Each update re-estimates popularity, moves prices toward new targets and
rotates the free stratagems.

## Anchored popularity pricing

For every front `f` and category `c` with `N` usable items:

### 1. Measure popularity

```
observed_i = (picks_i / ownership_i) / Σ_j (picks_j / ownership_j)
w          = ema · M / (M + halfSamplePerItem · N)        M = picks in this batch
share_i   ← (1 − w) · share_i + w · observed_i
```

- **Ownership correction.** Warbond, Superstore and limited items are owned by fewer players.
  Their observed picks are divided by `ownershipFactor` (0.9 by default) so they aren't
  discounted just for being less common.
- **Confidence-weighted EMA.** Small batches get a small weight. A quiet day with a handful of
  squads nudges popularity instead of whipsawing it. Large batches approach the full `ema` rate.
- **Free defaults stay in.** The Constitution, Peacemaker and High Explosive are part of the shares.
  When lots of players lean on the free Peacemaker, every paid secondary's share drops, which
  lowers its price by a *bounded* amount. Paid alternatives keep their relative order, so
  the Ultimatum stays the premium sidearm instead of collapsing.
- **Rotating free stratagems are frozen** while free. Their picks are excluded and their share is
  held. Picks made *because* an item was free say nothing about demand at its real price.
  Counting them made items leave the free pool at near-ceiling prices, the worst distortion
  found in testing.

### 2. Compute a target

```
r_i      = share_i · N                      (1 = exactly a fair share)
target_i = baseline_c · F(r_i)

F(r) = exp( U · tanh(εᵤ · ln r / U) )       for r ≥ 1,  U = ln(ceilingMultiple)
F(r) = exp(−D · tanh(ε_d · ln(1/r) / D))    for r < 1,  D = ln(1/floorMultiple)
```

`F` is a power law near `r = 1` (`F(r) ≈ r^ε`) that bends smoothly into a ceiling and a floor.
An item at exactly fair share is worth the baseline. The Complete Manual page plots `F` with the
live parameters.

**This is the key design decision.** The prototype adjusted prices by an amount
proportional to `share − fair share` every batch. That is integral control: as long as an item
sits below fair share, its price keeps falling, forever. Junk items can never reach fair share,
and free items soak up share, so prices drift down without limit (−40% per month in the Launch
scenario, with 15% of items pinned at the 10 Requisition floor). Anchoring prices to a *bounded
function of popularity* makes drift impossible by construction: no pattern of play can push a
target outside `[floor, ceiling] × baseline`. The market can be left alone.

### 3. Step toward the target

```
gap   = ln(target) − ln(price)
k     = adjustRate · (upBias | downBias) · speed(price/baseline) · pressure(heat)
price ← price · exp( clamp(min(k,1) · gap, ln(1 − maxStep), ln(1 + maxStep)) )
```

- **Asymmetric nudges.** Rises are multiplied by `upBias` (1.1) and falls by `downBias` (0.9),
  as agreed in the design discussions. They are safe here because targets are bounded.
- **Price-level speed.** `speed(q) = max(minSpeed, 2qᵞ / (1 + qᵞ))`. Cheap items rise slowly and
  expensive items react quickly. A niche pick that suddenly becomes popular stays a bargain for
  a while, which rewards early adopters. A nerfed meta item drops fast.
- **Spend pressure.** Each category tracks a smoothed `heat = ln(spend per slot / baseline)`. A
  category running hot rises slower and falls faster (logistic factors in (0, 2)). This is the
  "elasticity depends on category spending relative to target" idea. It only affects speed,
  never the target, so it can't fight the players' revealed preferences.
- **Hard bounds.** Non-free prices stay within `[minPrice, maxPrice]` = [10, 50,000]. With the
  defaults the soft ceiling (17,500 for stratagems) keeps every price under the 20,000
  "something's wrong" line.

### Calibration

Baselines are 5,000 / 3,300 / 2,200 / 1,100 (stratagem / primary / secondary / throwable). With
these, the **average loadout price** settles near the 24,000 design benchmark in simulation. That
loadout is four stratagems and three weapons at popularity-weighted *list* prices, about twice a
high-difficulty payout.

The algorithm deliberately does **not** force player spending back to 24,000. What players actually
spend is capped by what they earn, and any controller that targets realized spend gets the sign
wrong: broke players buy cheap gear, spend drops, and a spend controller would *raise* prices. A
playerbase that concentrates on the meta makes the average loadout pricier; one that spreads out
makes it cheaper.

## Free stratagems

Four stratagems per front are free at any time (`free.count`). Each stays free for `free.tenure`
days (4). Starts are staggered so about one rotates per day. A stratagem then sits out a
`free.cooldown` (12 days) before it can be free again. Open slots are filled by `free.rule`:
`cheapest` (default), `least-popular` or `random-bottom`. The Constitution, Peacemaker and
High Explosive are always free regardless.

## Parameters

| Path | Default | What it does |
|---|---|---|
| `anchored.baseline.*` | 5000 / 3300 / 2200 / 1100 | Price at exactly fair-share popularity |
| `anchored.ema` | 0.35 | Popularity EMA rate for a large batch |
| `anchored.halfSamplePerItem` | 8 | Batch size (picks per item) that gets half the EMA rate |
| `anchored.elasticityUp` | 0.8 | Power-law exponent above fair share |
| `anchored.elasticityDown` | 1.5 | Exponent below fair share (higher = niche gear gets cheaper) |
| `anchored.ceilingMultiple` | 3.5 | Soft cap, × baseline |
| `anchored.floorMultiple` | 0.04 | Soft floor, × baseline |
| `anchored.adjustRate` | 0.4 | Share of the (log) gap to target closed per day |
| `anchored.upBias` / `downBias` | 1.1 / 0.9 | Asymmetric nudges |
| `anchored.maxStep` | 0.2 | Max ±20% per day |
| `anchored.speedExponent` / `minSpeed` | 0.5 / 0.35 | Cheap items slower, expensive faster |
| `anchored.spendPressure` | 0.6 | Effect of hot/cold category spending on speed |
| `anchored.ownershipFactor.*` | 0.9 | Warbond / Superstore / limited ownership correction |
| `free.count` / `tenure` / `cooldown` / `rule` | 4 / 4 / 12 / cheapest | Free stratagem rotation |
| `minPrice` / `maxPrice` | 10 / 50,000 | Hard bounds |

Change any of them live with `config set <path> <value>` (browser terminal or CLI), in the Market
Lab's "Pricing equations" panel, or for a whole simulation suite with
`npm run sim -- --set anchored.elasticityDown=2`.

## How the algorithm is tested

`npm run sim` (and the Market Lab page) run months of simulated play. Squads of four rule-based
Helldivers (no LLMs) form each day, pick a front and difficulty, and play a three-mission
operation. They buy a fresh loadout every mission at the current prices, then earn Requisition or
fail. A failed mission ends that squad's Operations run, and its divers start a fresh run at 50,000
(reinforcements are free under the current rules). The market
updates after every simulated day.

Each diver has a personality: Regular, Meta Chaser, Penny-Pincher, Niche Enjoyer, Loyalist or
Chaos Diver. Each scores every affordable item by:

```
strengthWeight · trueStrength(item, faction) + taste + nicheAffinity · unpopularity
  + loyalty (favourites) − priceSensitivity · (25,000 / balance)^0.6 · price/1000
  − overlap penalties (second backpack / support weapon / vehicle) − squad duplicate penalty
```

The diver then samples a pick with a softmax, within a budget that grows with their balance.
"True strength" is the u.gg tier (OP = 7 … D = 1) plus hidden noise, because tier lists are
opinions. Scenarios can change it mid-run with a balance patch.

### Health checks

| Check | Pass | Fail |
|---|---|---|
| No runaway prices | max ≤ 15,000 | > 20,000 |
| No price collapse | < 10% of items near the hard floor, every category median ≥ 12% of baseline | ≥ 30% at floor or median < 5% |
| No inflation/deflation | settled trend < 15% / month | ≥ 40% / month |
| Stable day to day | < 3% avg move and < 20% zig-zag | ≥ 6% or ≥ 40% |
| Meta gear is expensive | Spearman ρ(strength, price) ≥ 0.5 | < 0.25 |
| Niche gear is affordable | weakest quarter ≤ 50% of baseline and top/bottom ≥ 3× | > 90% or < 1.8× |
| Free defaults don't crush premium gear | strongest paid weapon above its category median on every front | 3+ exceptions |
| Average loadout near 24k | 16k–32k | outside 10k–40k |
| Pricing spreads usage | fewer meta picks *and* more niche picks than the same divers with no prices | meta > 1.1× or niche < 0.9× |
| Free stratagems rotate | enough distinct items, ≤ 2 swaps/day | (warn only) |
| Prices differ by faction | typical cross-front gap ≥ 12% | < 5% |
| Adapts to balance patches | buffed items above median and nerfed below within 21 days | never |
| Resists brigading | brigaded item peak ≤ 0.9 × ceiling | > 1.2 × ceiling |

### Results (default parameters, 120 days, seed 1, current rules)

| Scenario | Anchored (live) | Prototype algorithm |
|---|---|---|
| **Launch** (tier-list start, mixed players) | ✓ PASS. Average loadout price 24.7k, max 9.7k, drift 2.6%/mo, ρ = 0.95 | ! WARN. Deflates 35%/mo, 13% of items at the 10 floor, average loadout price 11.9k |
| **Blank Slate** (all equal) | ✓ PASS. Discovers the meta, ρ = 0.96 | ✗ FAIL. One item hits 24.3k while 12% sit at the floor |
| **Upside Down** (inverted tiers) | ✓ PASS. Ordering flips itself, ρ = 0.95 | ! WARN. 30%/mo deflation |
| **Static Noise** (random start) | ✓ PASS | ! WARN |
| **Meta Rush** (65% meta chasers) | ✓ PASS. Max 10.9k | ✗ FAIL. Max 26k, a category median at 1% of baseline |
| **Penny-Pinchers** | ! WARN. Niche/meta spread 2.7× (flat demand) | ! WARN |
| **Off the Beaten Path** | ! WARN. Spread 2.4×, faction gap 12% | ! WARN |
| **Balance Patch** (day 60) | ✓ PASS. Fully adapted in 18 days | ✗ FAIL. 46 days, and collapses meanwhile |
| **Major Order** (85% one front) | ✓ PASS | ! WARN. 33%/mo deflation |
| **Quiet Week** (3 squads/day) | ✓ PASS | ! WARN. 37%/mo drift, ρ only 0.64 |
| **Warbond Surge** (6× traffic) | ✓ PASS | ✗ FAIL. A category median at 4% of baseline |
| **Brigading** (1/6 of traffic) | ! WARN. Brigaded item peaks at 15.2k, under the 17.5k soft ceiling | ✗ FAIL. Brigaded item reaches the 50,000 hard cap |

Across seeds 1–3 the anchored algorithm passed or warned on every scenario. It never failed.

What the warnings mean:

- **Penny-Pinchers / Off the Beaten Path.** When demand is spread evenly, prices flatten. The
  niche-to-meta spread drops a little under 3× and the gap between fronts narrows. That's the
  market correctly reporting that nobody is concentrating on a meta, not a malfunction.
- **Brigading.** A coordinated group submitting a sixth of all traffic gets its items close to the
  soft ceiling (~16k). They never pass it, and they come back down when the spam stops.
  Algorithmic damping can only do so much against fake submissions. The production backend should
  rate-limit submissions per lobby/session, as planned.

### Known limitations and open questions

- **The simulated economy is tight.** With 10–12k per mission and a 24k average loadout price, simulated
  divers average around 26k balance (runs restart at 50k after a failed mission, median run about 8
  missions). Over half of their stratagem picks are free ones. That is the designed "you can't afford
  your favourite kit every mission" pressure, but the free rotation carries a lot of weight, which is
  worth watching with real players. Knobs:
  `anchored.baseline.stratagem`, the earnings in the Lab, `free.count`.
- **Agent behaviour is a model.** Real players' price sensitivity is unknown. The suite
  intentionally spans very price-insensitive (Meta Rush) to very sensitive (Penny-Pinchers)
  populations, and the algorithm stays healthy across them.
- **The rotating free list uses list price.** Frozen items keep their pre-free price, so the same
  cheap junk can return after its cooldown. That's arguably fine ("the free bin"). Use
  `random-bottom` for more variety.
