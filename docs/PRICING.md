# Pricing: how the Galactic Market sets prices

This is the reference for the economic engine in `engine/src/market/`. It explains the live
algorithm ("anchored popularity pricing") with every number it uses, why it was chosen over the
original prototype's algorithm, and how the simulation harness checks that prices behave. Nothing
here is secret; the same material, with live values, is on the site's Complete Manual page.

- Live algorithm: `engine/src/market/pricing-anchored.ts`
- Original Python prototype, ported 1:1 for comparison: `engine/src/market/pricing-legacy.ts`
  (an engine test checks it reproduces `scratchpad/helper.py` exactly)
- Parameters and defaults: `engine/src/market/config.ts`
- Launch prices: `engine/src/market/presets.ts`
- Free-stratagem rotation: `engine/src/market/free.ts`

## The market in one paragraph

Each enemy front (Terminids, Automatons, Illuminate) has its own market, and each market has four
categories: stratagems, primaries, secondaries and throwables (93 / 55 / 25 / 23 items against the
Terminids and Automatons; 92 stratagems against the Illuminate). When a squad that contributes to
the market deploys, each loadout is folded, anonymously, into its front's pending batch: the seven
items and the price paid for each slot. A cancelled deploy is taken back out. Once a day, at
09:00 UTC, a scheduled job runs the **market update** (skipped if the previous one was under 20
hours ago). Each update re-estimates popularity, moves prices toward new targets and rotates the
free stratagems. Operators can also run it by hand (`update` in the dev terminal,
`npm run market -- update`, or `npm run aws:job -- daily` against the live market).

## Anchored popularity pricing

For every front `f` and category `c` with `N` usable items:

### 1. Measure popularity

```
adjusted_i = picks_i / ownership_i
observed_i = (1 − frozenShare) · adjusted_i / Σ_j adjusted_j
M          = Σ_j picks_j                                   picks in this category today
w          = 0.35 · M / (M + 2 · N)
share_i   ← (1 − w) · share_i + w · observed_i              then shares are rescaled to sum to 1
```

- **Ownership correction.** Warbond, Superstore and limited items are owned by fewer players.
  Their observed picks are divided by `ownershipFactor` (base 1, warbond 0.9, superstore 0.9,
  special 0.9) so they aren't discounted just for being less common.
- **Confidence-weighted EMA.** `w` is how much today counts: up to `ema` = 0.35 on a busy day,
  less on a quiet one. `halfSamplePerItem` = 2 is the batch size (picks per item) that gets half
  the full weight. It is deliberately low so that a few squads visibly move prices by the next
  morning (with 8, the value before launch, a small community barely moved anything):

  | Loadouts on a front today | Stratagems | Primaries | Secondaries | Throwables |
  |---|---|---|---|---|
  | 12 (one squad, 3 missions) | 0.072 | 0.034 | 0.068 | 0.072 |
  | 36 | 0.153 | 0.086 | 0.147 | 0.154 |
  | 120 | 0.252 | 0.183 | 0.247 | 0.253 |
  | 720 | 0.329 | 0.304 | 0.327 | 0.329 |

- **Free defaults stay in.** The Constitution, Peacemaker and High Explosive are part of the shares.
  When lots of players lean on the free Peacemaker, every paid secondary's share drops, which
  lowers its price by a bounded amount. Paid alternatives keep their relative order.
- **Rotating free stratagems are frozen** while free. Their picks are excluded and their share is
  held (`frozenShare` is their combined share). Picks made *because* an item was free say nothing
  about demand at its real price. Counting them made items leave the free pool at near-ceiling
  prices, the worst distortion found in testing.
- A category with no picks today keeps its shares.

### 2. Compute a target

```
r_i      = share_i · N                       (1 = exactly a fair share)
target_i = baseline_c · F(r_i)

F(r) = exp( U · tanh(0.8 · ln r / U) )        for r ≥ 1,  U = ln(11,375 / baseline_c)
F(r) = exp(−D · tanh(1.5 · ln(1/r) / D))      for r < 1,  D = ln(baseline_c / 10)
```

`F` is a power law near `r = 1` (`F(r) ≈ r^0.8` above, `r^1.5` below) that bends smoothly into
a **soft ceiling of 11,375** and a **soft floor of 10**. Both are prices, the same for every
category, so:

- gear nobody uses keeps getting cheaper, toward 10, until someone decides it's worth a try;
- an outlier in a cheap slot can cost as much as a top stratagem. The Ultimatum is the motivating
  case: under the old per-category ceiling (3.5 × baseline) it stalled at about 4,900 even when
  80% of players took it, while comparably dominant stratagems reached 10,900. Now it reaches
  about 6,900 at 50% usage and 7,900 at 80%, while the other secondaries get *cheaper* as it
  takes over the slot (about 500 and 160).

Targets by category (rounded):

| Category | Baseline | U | D | 0.1× | 0.25× | 0.5× | 2× | 4× | 8× |
|---|---|---|---|---|---|---|---|---|---|
| Stratagem | 3,250 | 1.253 | 5.784 | 147 | 442 | 1,162 | 5,472 | 7,901 | 9,650 |
| Primary | 2,150 | 1.666 | 5.371 | 102 | 296 | 770 | 3,671 | 5,671 | 7,639 |
| Secondary | 1,450 | 2.060 | 4.977 | 73 | 203 | 520 | 2,492 | 3,993 | 5,744 |
| Throwable | 700 | 2.788 | 4.248 | 40 | 102 | 253 | 1,210 | 2,008 | 3,108 |

**This is the key design decision.** The prototype adjusted prices by an amount
proportional to `share − fair share` every batch. That is integral control: as long as an item
sits below fair share, its price keeps falling, forever. Junk items can never reach fair share,
and free items soak up share, so the whole market drifts down without limit (25–45% per month in
simulation, with 15–26% of items pinned at the 10 Requisition floor). Anchoring prices to a
*bounded function of popularity* makes drift impossible by construction: no pattern of play can
push a target outside `[10, 11,375]`, and because shares always add up to 1, at least one item
in every category sits at or above its baseline. Individual items can sink to the floor; the
market as a whole can't. It can be left alone.

### 3. Step toward the target

```
gap   = ln(target / price)
k     = 0.4 · (1.1 if rising, 0.9 if falling) · speed · pressure
step  = clamp( min(k, 1) · gap,  ln(1 − 0.2),  max(ln(1 + 0.2), ln(1 + 0.1 · baseline_c / price)) )
price ← clamp( price · e^step, 10, 50,000 )
```

- **Asymmetric nudges.** Rises close 44% of the (log) gap per day and falls 36% (`adjustRate`
  0.4 × `upBias` 1.1 / `downBias` 0.9). They are safe because targets are bounded.
- **Step limits.** A price falls at most 20% a day. It rises at most 20%, or by 10% of its category
  baseline (`minClimb`: 325 / 215 / 145 / 70) if that's more. Without that, gear sitting near
  10 would need a month to climb back at 20% a day; with it, an ignored item that suddenly gets
  popular is back at its old price in about 6 days.
- **Optional modifiers, off by default.**
  - `speed = max(minSpeed, 2q^γ / (1 + q^γ))` with `q = price / baseline`. With `speedExponent`
    γ = 0 it's always 1. It used to be 0.5, making cheap items rise slowly ("a bargain stays a
    bargain for a while"), which left floor-priced gear stuck there.
  - `pressure = 2 / (1 + e^(±spendPressure · heat))` (− for rises, + for falls), where `heat` is
    a smoothed `ln(spend per slot / baseline)` clamped to ±2 and updated with the same `w`. With
    `spendPressure` = 0 it's always 1. It used to be 0.6, which made prices rise *faster* when
    players spent little: the wrong direction for an economy where spending is capped by income.
- **Quotes.** What players pay is the price rounded to the nearest 10 (`quoteStep`), never below
  10 (`minPrice`). Hard bounds are `[minPrice, maxPrice]` = [10, 50,000]; the soft ceiling keeps
  every price far below the hard one.

### Launch prices

Day one starts from the u.gg tier lists, per front. Each item's starting price is its category
baseline times OP 2.2, S+ 1.75, S 1.35, A 1, B 0.72, C 0.5 or D 0.33 (`TIER_MULTIPLE`). Each
item is then given the popularity that would justify that price (`F⁻¹`), the popularities are
rescaled to add up to 1, and every starting price is replaced by the target of its rescaled
popularity. The last step matters: shares must sum to 1, and the tier list implies more than
that, so before this fix the launch prices sat 3–49% above their own targets and the market slid
down for weeks (−22% median over a month) with nobody playing. Now an update with no loadouts
changes nothing; prices only move when people play. (The `flat` test preset keeps its one price.)

### Calibration

Baselines are 3,250 / 2,150 / 1,450 / 700 (stratagem / primary / secondary / throwable). With
these, the **average loadout price** settles near the 16,000 design benchmark in simulation: about
two Super Helldive payouts (~8,000 each, as measured in play). That loadout is four stratagems and
three weapons at popularity-weighted *list* prices.

The algorithm deliberately does **not** force player spending back to 16,000. What players actually
spend is capped by what they earn, and any controller that targets realized spend gets the sign
wrong: broke players buy cheap gear, spend drops, and a spend controller would *raise* prices. A
playerbase that concentrates on the meta makes the average loadout pricier; one that spreads out
makes it cheaper. In a year-long simulation with mission pay cut to 30%, the median stratagem
stayed near 3,000, nothing sat at the floor and the average loadout price stayed near 16,000:
broke players reshuffle which gear is expensive rather than collapsing the market (and each
failed run restarts at 50,000).

## Free stratagems

Four stratagems per front are free at any time (`free.count`). Each stays free for `free.tenure`
days (4). Starts are staggered at launch so about one rotates per day. A stratagem then sits out a
`free.cooldown` (12 days) before it can be free again (if every candidate is cooling down, the
cooldown is ignored). Open slots are filled by `free.rule`: `cheapest` (default; ties go to the
least popular), `least-popular` or `random-bottom` (a random pick among the cheapest quarter).
While free, an item's price and share are frozen; it returns to sale at the price it had. The
Constitution, Peacemaker and High Explosive are always free regardless.

## Parameters

| Path | Default | What it does |
|---|---|---|
| `anchored.baseline.*` | 3250 / 2150 / 1450 / 700 | Price at exactly fair-share popularity |
| `anchored.ema` | 0.35 | Popularity EMA rate for a large batch |
| `anchored.halfSamplePerItem` | 2 | Batch size (picks per item) that gets half the EMA rate |
| `anchored.elasticityUp` | 0.8 | Power-law exponent above fair share |
| `anchored.elasticityDown` | 1.5 | Exponent below fair share (higher = niche gear gets cheaper) |
| `anchored.ceilingPrice` | 11,375 | Soft ceiling, in Requisition, every category |
| `anchored.floorPrice` | 10 | Soft floor, in Requisition, every category |
| `anchored.adjustRate` | 0.4 | Share of the (log) gap to target closed per day |
| `anchored.upBias` / `downBias` | 1.1 / 0.9 | Asymmetric nudges |
| `anchored.maxStep` | 0.2 | Max ±20% per day |
| `anchored.minClimb` | 0.1 | A rise may always be this fraction of the category baseline |
| `anchored.speedExponent` / `minSpeed` | 0 / 0.35 | Price-level speed (off at 0) |
| `anchored.spendPressure` | 0 | Category spend pressure (off at 0) |
| `anchored.ownershipFactor.*` | 1 / 0.9 / 0.9 / 0.9 | Base / Warbond / Superstore / limited ownership correction |
| `free.count` / `tenure` / `cooldown` / `rule` | 4 / 4 / 12 / cheapest | Free stratagem rotation |
| `minPrice` / `maxPrice` / `quoteStep` | 10 / 50,000 / 10 | Hard bounds and rounding |

Change any of them live with `config set <path> <value>` (dev terminal or CLI; `config reset`
restores the defaults), in the Market Lab's "Pricing equations" panel, or for a whole simulation
suite with `npm run sim -- --set anchored.elasticityDown=2`. The live market stores its settings
with its prices, so a new default only reaches it after `config reset` (or `config set`).

## How the algorithm is tested

`npm run sim` (and the Market Lab page) run months of simulated play. Squads of four rule-based
Helldivers (no LLMs) form each day, pick a front and difficulty, and play a three-mission
operation. They buy a fresh loadout every mission at the current prices, then earn Requisition or
fail. A failed mission ends that squad's Operations run, and its divers start a fresh run at 50,000
(reinforcements are free under the current rules). The market updates after every simulated day.

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
| No runaway prices | max ≤ 95% of the soft ceiling | above the soft ceiling |
| No price collapse | < 10% of items near the hard floor, every category median ≥ 12% of baseline | ≥ 30% at floor or median < 5% |
| No inflation/deflation | settled trend < 15% / month | ≥ 40% / month |
| Moves daily without thrashing | 1–8% avg daily move and < 35% zig-zag | > 12% or ≥ 50% (under 1% warns: asleep) |
| Meta gear is expensive | Spearman ρ(strength, price) ≥ 0.5 | < 0.25 |
| Niche gear is affordable | weakest quarter ≤ 50% of baseline and top/bottom ≥ 3× | > 90% or < 1.8× |
| Free defaults don't crush premium gear | strongest paid weapon above its category median on every front | 3+ exceptions |
| Average loadout near 16k | 10.5k–21.5k | outside 6.5k–26.5k |
| Pricing spreads usage | fewer meta picks *and* more niche picks than the same divers with no prices | meta > 1.1× or niche < 0.9× |
| Free stratagems rotate | enough distinct items, ≤ 2 swaps/day | (warn only) |
| Prices differ by faction | typical cross-front gap ≥ 12% | < 5% |
| Adapts to balance patches | buffed items above median and nerfed below within 21 days | never |
| Resists brigading | brigaded item peak ≤ 90% of the soft ceiling | above the ceiling |

The day-to-day check used to reward a calm market (pass under 3% average move). The goal changed
before launch: with a small community and maybe one weekend to make an impression, players should
see the market move every day, so the check now asks for movement without thrashing.

### Results (default parameters, 120 days, seed 1, current rules)

| Scenario | Anchored (live) | Prototype algorithm |
|---|---|---|
| **Launch** (tier-list start, mixed players) | ✓ PASS. Average loadout price 16.2k, max 6.5k, drift 1.7%/mo, 4.4% daily move, ρ = 0.95 | ✗ FAIL. Max 13.4k, deflates 37%/mo, 16% of items at the floor |
| **Blank Slate** (all equal) | ✓ PASS. Discovers the meta, ρ = 0.95 | ✗ FAIL. Max 15.4k, 16% at the floor |
| **Upside Down** (inverted tiers) | ✓ PASS. Ordering flips itself, ρ = 0.94 | ✗ FAIL. 28%/mo deflation, a category median at 6% of baseline |
| **Static Noise** (random start) | ✓ PASS | ✗ FAIL |
| **Meta Rush** (65% meta chasers) | ✓ PASS. Average loadout price 18.1k, max 7.9k | ✗ FAIL. Max 21.3k, a category median at 1% of baseline |
| **Penny-Pinchers** | ✓ PASS. Niche/meta spread 3.1× | ! WARN. 28%/mo deflation |
| **Off the Beaten Path** | ! WARN. Niche/meta spread 2.5× (flat demand) | ! WARN. 39%/mo deflation |
| **Balance Patch** (day 60) | ✓ PASS. Fully adapted in 9 days | ✗ FAIL. 44 days, and collapses meanwhile |
| **Major Order** (85% one front) | ✓ PASS | ✗ FAIL. 40%/mo deflation |
| **Quiet Week** (3 squads/day) | ✓ PASS. 3.2% daily move, ρ = 0.87 | ✗ FAIL. 25%/mo drift, ρ only 0.62 |
| **Warbond Surge** (6× traffic) | ✓ PASS | ✗ FAIL. A category median at 3% of baseline |
| **Brigading** (1/6 of traffic) | ✓ PASS. Brigaded item peaks at 9.9k (87% of the ceiling) | ✗ FAIL. Brigaded item reaches the 50,000 hard cap |

Across seeds 1–3 the anchored algorithm never failed a scenario. Its warnings:

- **Penny-Pinchers / Off the Beaten Path.** When demand is spread evenly, prices flatten and the
  niche-to-meta spread drops a little under 3×. That's the market correctly reporting that nobody
  is concentrating on a meta, not a malfunction.
- **Drift on some seeds** (Major Order, Quiet Week, Brigading: 16–22% per month over the last
  weeks of a run). A livelier market wanders more on small or lopsided batches; it's a trend over
  a few weeks, not a runaway, and it never reached the 40% failure line.

### Reactivity at launch scale

Controlled experiments on the Terminid market (players picking as the launch prices expect, plus
one deliberate change):

| | Before launch tuning | Live |
|---|---|---|
| Typical daily move, 1–3 squads/day | 1.2–1.9% | 4.6–5.6% |
| Stratagem everyone abandons (starts ~4,700), price after 7 days at one squad/day | 4,340 | 3,460 |
| Ignored item that becomes popular: days to regain its old price | 18 | 6 |
| Lowest price for gear nobody uses | 130 / 90 / 60 / 30 | 10 in every category |
| Ultimatum at 50% / 80% of loadouts | 4,610 / 4,810 | 6,870 / 7,870 |
| Prices with nobody playing | slide down ~22% a month | don't move |

The cost of a lively market: with only a few squads a day, prices also wander with whatever those
squads happen to pick (over a month with no real change in taste, 80% of stratagems end within
about −35% to +40% of where they started), and about a quarter of daily moves on popular items
reverse direction. As traffic grows, each day's sample gets larger and the wandering shrinks.

### Known limitations and open questions

- **The simulated economy is tight.** With about 8k per Super Helldive and a 16k average loadout
  price, simulated divers average around 20k balance and spend about 9.5k per loadout (runs restart
  at 50k after a failed mission). That is the designed "you can't afford your favourite kit every
  mission" pressure. Knobs: `anchored.baseline.*`, the earnings in the Lab, `free.count`.
- **Agent behaviour is a model.** Real players' price sensitivity is unknown. The suite
  intentionally spans very price-insensitive (Meta Rush) to very sensitive (Penny-Pinchers)
  populations, and the algorithm stays healthy across them.
- **Each front is its own market.** A weekend split across three fronts gives each a third of the
  data, so each moves a little less than the numbers above.
- **Brigading.** Damping can only do so much against fake submissions. The production backend
  should rate-limit submissions per lobby/session, as planned.
- **The rotating free list uses list price.** Frozen items keep their pre-free price, so the same
  cheap junk can return after its cooldown. That's arguably fine ("the free bin"). Use
  `random-bottom` for more variety.
