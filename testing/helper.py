import csv
import json
import os
import math

# Constants
KAPPA = 3         # κ: Laplace pseudocount
BETA = 0.4        # β: EMA smoothing factor
MIN_PRICE = 10
MAX_PRICE = 50000
MAX_STEP = 0.2    # maximum price change fraction per batch (20%)

# Elasticity tuning knobs
ALPHA_BASE = 0.35  # base aggressiveness
ALPHA_MIN  = 0.15  # floor elasticity
ALPHA_MAX  = 0.80  # ceiling elasticity
K_LOGISTIC = 1.2   # steepness of demand_gain
GAMMA      = 0.6   # exponent for price_bias

# Category configs: number of slots and their price CSV file
CATEGORIES = {
    'stratagems': {'slots': 4, 'price_csv': 'stratagems_prices.csv'},
    'primaries':  {'slots': 1, 'price_csv': 'primaries_prices.csv'},
    'secondaries':{'slots': 1, 'price_csv': 'secondaries_prices.csv'},
    'grenades':    {'slots': 1, 'price_csv': 'grenades_prices.csv'},
}
EMA_SUFFIX = '_ema.json'

# Mapping item types to weights (for future use)
ITEM_TYPE_WEIGHT = {
    'equipment': 1.5,
    'sentry':    1.2,
    'strike':    1.0,
}
# For stratagems, assume all are 'strike' by default
ITEM_TYPE_DEFAULT = 'strike'


def load_prices(category):
    """
    Read the header (names) and the last row of prices for a category.
    """
    path = CATEGORIES[category]['price_csv']
    with open(path, newline='') as f:
        rows = list(csv.reader(f))
    if not rows:
        raise ValueError(f"{path} is empty or missing")
    names = rows[0]
    prices = [float(x) for x in rows[-1]]
    return names, prices


def save_prices(category, new_prices):
    """
    Append a new row of prices to the category CSV, ensuring it starts on a new line.
    """
    path = CATEGORIES[category]['price_csv']
    if os.path.exists(path):
        with open(path, 'rb+') as f:
            f.seek(0, os.SEEK_END)
            if f.tell() > 0:
                f.seek(-1, os.SEEK_END)
                if f.read(1) != b'\n':
                    f.write(b'\n')
    with open(path, 'a', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(new_prices)


def load_ema(category, length):
    """
    Load previous EMA values from JSON; or initialize uniform if missing.
    """
    path = category + EMA_SUFFIX
    if os.path.exists(path):
        with open(path) as f:
            data = json.load(f)
        return data['ema']
    # start with a flat EMA = 1/length
    return [1.0/length] * length


def save_ema(category, ema_list):
    """
    Persist EMA values for next batch.
    """
    path = category + EMA_SUFFIX
    with open(path, 'w') as f:
        json.dump({'ema': ema_list}, f)


def load_missions(mission_csv='missions.csv'):
    """
    Read all recorded missions (each row has 7 item indices).
    """
    if not os.path.exists(mission_csv):
        return []
    with open(mission_csv, newline='') as f:
        return [[int(x) for x in row] for row in csv.reader(f) if row]


def clear_missions(mission_csv='missions.csv'):
    """
    Empty the missions file to start fresh.
    """
    open(mission_csv, 'w').close()


# ---- Elasticity Functions ----

def demand_gain(r, k=K_LOGISTIC):
    """
    Smooth popularity component: logistic mapping of r = EMA/τ into (0,1).
    """
    return 1.0 / (1.0 + math.exp(-k * (r - 1)))


def price_bias(q, gamma=GAMMA):
    """
    Price-level bias: q = price/mean.   Expensive (q>1) → bias>1; cheap → bias<1.
    """
    return q ** gamma


def elasticity(ema, tau, price, mean_price, direction):
    """
    Compute per-item elasticity αᵢ.
    direction: +1 for price increase, -1 for decrease.
    """
    r = ema / tau
    q = price / mean_price if mean_price > 0 else 1.0
    # popularity component
    pop_factor = demand_gain(r)
    # price-level component
    if direction > 0:
        lvl_factor = price_bias(q)
    else:
        lvl_factor = 1.0 / price_bias(q)
    # base elasticity
    alpha = ALPHA_BASE * pop_factor * lvl_factor
    # clamp
    return max(ALPHA_MIN, min(ALPHA_MAX, alpha))


# ---- Price Update Logic ----

def update_prices_for_category(category, missions):
    """
    Run the 4-step dynamic pricing for one category,
    then print the new category average price.
    """
    names, old_prices = load_prices(category)
    V = len(names)

    # Step 1: count picks
    C = [0] * V
    total = 0
    mapping = {
        'stratagems': slice(0,4),
        'primaries':  slice(4,5),
        'secondaries':slice(5,6),
        'grenades':    slice(6,7),
    }
    sl = mapping[category]
    for m in missions:
        for idx in m[sl]:
            C[idx] += 1
            total += 1

    # Laplace smoothing
    p = [(C[i] + KAPPA) / (total + KAPPA * V) for i in range(V)]

    # Step 2: EMA smoothing
    old_ema = load_ema(category, V)
    ema = [BETA * p[i] + (1 - BETA) * old_ema[i] for i in range(V)]

    # Step 3: ideal share τ
    tau = 1.0 / V

    # preliminary: compute truncated mean of old_prices for price_bias reference
    mean_price = sum(old_prices) / V

    # Step 4: price nudge
    new_prices = []
    for i in range(V):
        if old_prices[i] == 0:
            new_prices.append(0)
            continue
        # demand delta
        delta = (ema[i] - tau) / tau
        if delta == 0:
            direction = 0
        else:
            direction = 1 if delta > 0 else -1
        # compute elasticity based on new formula
        alpha_i = elasticity(ema[i], tau, old_prices[i], mean_price, direction)
        raw_factor = 1 + alpha_i * delta
        # clamp factor
        factor = max(1 - MAX_STEP, min(1 + MAX_STEP, raw_factor))
        # apply
        price_new = round(old_prices[i] * factor)
        price_new = max(MIN_PRICE, min(MAX_PRICE, price_new))
        new_prices.append(price_new)

    # save and persist
    save_prices(category, new_prices)
    save_ema(category, ema)

    # new average
    avg_new = sum(new_prices) / V if V > 0 else 0
    print(f"The New Average Price of {category} is {avg_new:.2f}")
    return avg_new
    

def update_all_prices(mission_csv='missions.csv'):
    """
    Process all missions once: update each category, write average row, then clear.
    """
    missions = load_missions(mission_csv)
    if not missions:
        print("No missions recorded; nothing to update.")
        return

    avg_row = []
    for cat in ['stratagems', 'primaries', 'secondaries', 'grenades']:
        avg = update_prices_for_category(cat, missions)
        avg_row.append(round(avg, 2))  # round to 2 decimals for CSV

    # Append to average_prices.csv
    with open('average_prices.csv', 'a', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(avg_row)

    clear_missions(mission_csv)
    print("Prices updated and mission data cleared.")
