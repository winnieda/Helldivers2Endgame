#!/usr/bin/env python3
"""
Runs the original prototype's update_prices_for_category (scratchpad/helper.py, formerly
testing/helper.py) on random inputs and records the results, so the TypeScript port in
engine/src/market/pricing-legacy.ts can be checked for exact agreement.

  python3 tools/legacy_fixture.py [path/to/helper.py]
"""
import importlib.util
import json
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HELPER = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'scratchpad', 'helper.py')
OUT = os.path.join(ROOT, 'engine', 'test-fixtures', 'legacy.json')
V = 55  # primaries usable against Terminids in the current catalog

spec = importlib.util.spec_from_file_location('helper', HELPER)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

cases = []
rng = random.Random(2026)
for case in range(12):
    prices = [0] + [rng.choice([10, 250, 1200, 3000, 3000, 4471, 9000, 18000]) + rng.randint(0, 40) for _ in range(V - 1)]
    raw = [rng.random() for _ in range(V)]
    ema = [x / sum(raw) for x in raw]
    picks = [rng.choice([0, 0, 1, 2, 5, 13, 40]) for _ in range(V)]
    missions = [[0, 0, 0, 0, i, 0, 0] for i, n in enumerate(picks) for _ in range(n)]
    store = {}
    helper.load_prices = lambda category: ([f'item{i}' for i in range(V)], [float(p) for p in prices])
    helper.load_ema = lambda category, length: list(ema)
    helper.save_prices = lambda category, new_prices: store.__setitem__('prices', new_prices)
    helper.save_ema = lambda category, ema_list: store.__setitem__('ema', ema_list)
    helper.print = lambda *a, **k: None
    helper.update_prices_for_category('primaries', missions)
    cases.append({'prices': prices, 'ema': ema, 'picks': picks, 'expectedPrices': store['prices'], 'expectedEma': store['ema']})

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as f:
    json.dump({'source': os.path.relpath(HELPER, ROOT), 'items': V, 'cases': cases}, f)
print('wrote %d cases -> %s' % (len(cases), os.path.relpath(OUT, ROOT)))
