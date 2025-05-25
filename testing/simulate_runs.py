# simulate_runs.py
"""
Generate synthetic mission logs and append them to missions.csv.
Provides budget-aware, popularity+affordability sampling per slot.
"""
import random
import csv
from pathlib import Path
import statistics
from helper import load_prices, load_ema, CATEGORIES

# Simulation tuning constants
POP_BIAS       = 0.7    # weight between popularity and price (popularity^POP_BIAS * price^(1-POP_BIAS))
ALPHA_POP      = 1.0    # exponent for popularity weight
ALPHA_PRICE    = 1.5    # exponent for price/affordability weight
EPSILON        = 1e-4   # small offset to avoid zero-popularity
FREE_STRAT_CH  = 0.08   # 8% chance per strat slot to take free stratagem
FREE_WEAP_CH   = 0.20   # 20% chance per weapon slot to take free default

# ---- free-item selection -------------------------------------------

def choose_free_stratagems(names, prices):
    """Return indices of the four cheapest stratagems (tie-break by index)."""
    pairs = sorted((p, idx) for idx, p in enumerate(prices))
    free = []
    current_price = None
    for price, idx in pairs:
        if len(free) >= 4:
            break
        if current_price is None:
            current_price = price
        if price != current_price and len(free) >= 4:
            break
        if price != current_price and len(free) < 4:
            current_price = price
        free.append(idx)
    return set(free[:4])


def get_free_items_by_category():
    """Return dict mapping each category to its set of free indices."""
    free_map = {}
    # dynamic stratagem free pool
    strat_names, strat_prices = load_prices('stratagems')
    free_map['stratagems'] = choose_free_stratagems(strat_names, strat_prices)
    # static free for other categories
    def indices(category, free_names):
        names, _ = load_prices(category)
        return {names.index(n) for n in free_names if n in names}
    free_map['primaries']   = indices('primaries',   ['Liberator','Constitution'])
    free_map['secondaries'] = indices('secondaries', ['Peacemaker'])
    free_map['grenades']    = indices('grenades',    ['Frag','HE','Smoke'])
    return free_map

# ---- mission generation -------------------------------------------

def generate_single_mission(free_map):
    """Generate one mission row of 7 indices using budget-aware sampling."""
    # load names, prices, and ema per category
    names_cat = {}
    prices_cat = {}
    ema_cat = {}
    for cat in CATEGORIES:
        names, prices = load_prices(cat)
        names_cat[cat] = names
        prices_cat[cat] = prices
        ema_cat[cat] = load_ema(cat, len(names))

    # initial budget
    if random.random() < 0.5:
        running = random.randint(20000, 25000)
    else:
        running = random.randint(15000, 30000)

    # shuffled slot order (strats favored early)
    slots = list(range(7))
    random.shuffle(slots)
    slots.sort(key=lambda s: 0 if s < 4 else 1)

    chosen_strats = set()
    row = [0]*7

    for stage, slot in enumerate(slots):
        # determine category and free-chance
        if slot < 4:
            category = 'stratagems'; free_ch = FREE_STRAT_CH
        elif slot == 4:
            category = 'primaries';   free_ch = FREE_WEAP_CH
        elif slot == 5:
            category = 'secondaries'; free_ch = FREE_WEAP_CH
        else:
            category = 'grenades';    free_ch = FREE_WEAP_CH

        names = names_cat[category]
        prices = prices_cat[category]
        ema    = ema_cat[category]
        free_idxs = free_map.get(category, set())

        # forced free selection
        if free_idxs and random.random() < free_ch:
            if category == 'stratagems':
                choices = list(free_idxs - chosen_strats)
                idx = random.choice(choices) if choices else random.choice(list(free_idxs))
            else:
                idx = random.choice(list(free_idxs))
            cost = 0
        else:
            # build candidate pool
            candidates = []
            for i, price in enumerate(prices):
                if price > running and price > 0:
                    continue
                if category == 'stratagems' and i in chosen_strats:
                    continue
                candidates.append(i)
            if not candidates:
                candidates = list(range(len(names)))

            # compute weights
            # popularity component
            pop_vals = [(ema[i] + EPSILON)**ALPHA_POP for i in candidates]
            # affordability component
            paid_prices = [prices[i] for i in candidates if prices[i] > 0]
            med = statistics.median(paid_prices) if paid_prices else 1
            price_vals = [(med / max(prices[i],1))**ALPHA_PRICE for i in candidates]
            # combined
            weights = [(pv**(1-POP_BIAS))*(popv**POP_BIAS)
                       for pv, popv in zip(price_vals, pop_vals)]
            # sample one
            idx = random.choices(candidates, weights=weights, k=1)[0]
            cost = prices[idx]

        # record
        row[slot] = idx
        if category == 'stratagems':
            chosen_strats.add(idx)
        running = max(0, running - cost)

    return row

# ---- public API ------------------------------------------------------

def run_simulations(num_batches:int=1, missions_per_batch:int=100):
    """Append num_batches * missions_per_batch simulated missions to missions.csv"""
    out_file = Path('missions.csv')
    rows = []
    for _ in range(num_batches * missions_per_batch):
        free_map = get_free_items_by_category()
        rows.append(generate_single_mission(free_map))
    with out_file.open('a', newline='') as f:
        writer = csv.writer(f)
        writer.writerows(rows)
    print(f"Simulated {len(rows)} missions and appended to missions.csv")
