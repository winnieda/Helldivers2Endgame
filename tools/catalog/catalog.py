#!/usr/bin/env python3
"""
Equipment catalog tooling for Helldivers 2 Endgame.

  python3 tools/catalog/catalog.py fetch      # download latest archived u.gg tier lists + wiki codes
  python3 tools/catalog/catalog.py fetch --html-dir ~/Downloads/ugg   # parse pages you saved yourself
  python3 tools/catalog/catalog.py build      # sources/*.json -> engine/src/catalog/catalog.data.ts

u.gg sits behind a Cloudflare challenge, so `fetch` pulls the most recent Wayback Machine
snapshot of each tier-list page. If you'd rather use the live site, open each page in your
browser, "Save Page As..." into a folder (keep the default file names), and pass --html-dir.

Only the stdlib is used so this runs anywhere python3 does.
"""
import argparse
import datetime as dt
import gzip
import html
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = os.path.join(HERE, 'sources')
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT_TS = os.path.join(ROOT, 'engine', 'src', 'catalog', 'catalog.data.ts')

UGG_PAGES = {
    'primary': 'helldivers-2-primary-weapons-tier-list',
    'secondary': 'helldivers-2-secondary-weapons-tier-list',
    'throwable': 'helldivers-2-throwables-tier-list',
    'orbital': 'orbital-stratagem-tier-list',
    'eagle': 'eagle-stratagem-tier-list',
    'support': 'support-weapon-stratagem-tier-list',
    'backpack': 'helldivers-2-backpack-stratagem-tier-list',
    'defensive': 'sentry-stratagem-tier-list',
    'vehicle': 'helldivers-2-vehicle-tier-list',
}
WIKI_PAGE = 'helldivers.wiki.gg/wiki/Stratagems'

# These three are permanently free no matter what the market does.
ALWAYS_FREE = {'R-2124 Constitution', 'P-2 Peacemaker', 'G-12 High Explosive'}
# u.gg spellings that differ from the in-game names. Item ids still derive from the u.gg name so
# saved markets keep working.
NAME_OVERRIDES = {
    'CB-9 Explosive Crossbow': 'CB-9 Exploding Crossbow',
    'G-89 Smokecreen': 'G-89 Smokescreen',
    'SG-225SP Breaker SPRAY & PRAY': 'SG-225SP Breaker Spray & Pray',
    'M6C-SOCOM': 'M6C/SOCOM Pistol',
}
# Plain titles that need help: generic class words keep their designation ("M90A Shotgun"), and
# names where the designation and title are fused get an explicit title.
GENERIC_TITLES = {'Shotgun', 'SMG', 'Assault Rifle', 'Pistol', 'Rifle'}
PLAIN_OVERRIDES = {'M6C/SOCOM Pistol': 'SOCOM Pistol'}
# Fallbacks for codes an older wiki capture may lack (verified against the 2026-10-11 capture).
MANUAL_CODES = {'TD-110 Maelstrom': {'code': 'LDRDLDULR', 'cooldown': 780}}
BASE_SOURCES = {'Patriotic Administration Center', 'Starter Weapon', 'Starter Grenade', 'Helldivers Mobilize'}

# --------------------------------------------------------------------------------------------
# Minimal DOM builder (u.gg renders two different table layouts, regexes alone are fragile)
# --------------------------------------------------------------------------------------------
VOID = {'img', 'br', 'hr', 'meta', 'link', 'input', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr'}


class Node:
    def __init__(self, tag, attrs, parent):
        self.tag, self.attrs, self.parent, self.children = tag, dict(attrs), parent, []

    def cls(self):
        return (self.attrs.get('class') or '').split()

    def text(self):
        return ''.join(c if isinstance(c, str) else c.text() for c in self.children)

    def find_all(self, pred):
        res = []
        for c in self.children:
            if isinstance(c, Node):
                if pred(c):
                    res.append(c)
                res.extend(c.find_all(pred))
        return res


class TreeBuilder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node('root', {}, None)
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        n = Node(tag, attrs, self.cur)
        self.cur.children.append(n)
        if tag not in VOID:
            self.cur = n

    def handle_startendtag(self, tag, attrs):
        self.cur.children.append(Node(tag, attrs, self.cur))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not None and n.tag != tag:
            n = n.parent
        if n is not None and n.parent is not None:
            self.cur = n.parent

    def handle_data(self, d):
        self.cur.children.append(d)


def _cell_value(c):
    t = ' '.join(x.text().strip() for x in c.find_all(lambda n: 't-cell-text' in n.cls()))
    if not t:
        imgs = c.find_all(lambda n: n.tag == 'img')
        t = imgs[0].attrs.get('alt', '') if imgs else c.text().strip()
    return re.sub(r'\s+', ' ', t).strip()


def parse_ugg_html(text):
    b = TreeBuilder()
    b.feed(text)
    tables = b.root.find_all(lambda n: 'ugg-tier-table' in n.cls())
    for t in tables:
        hdr = t.find_all(lambda n: 't-hdr' in n.cls())
        if not hdr:
            continue
        hcells = [c for c in hdr[0].children if isinstance(c, Node) and 't-cell' in c.cls()]
        cols = [c.attrs.get('title') or _cell_value(c) for c in hcells]
        rows = []
        for r in t.find_all(lambda n: 't-row' in n.cls() and 't-hdr' not in n.cls()):
            cells = [c for c in r.children if isinstance(c, Node) and 't-cell' in c.cls()]
            if len(cells) != len(cols):
                continue
            row = {cols[i]: _cell_value(cells[i]) for i in range(len(cols))}
            det = r.parent
            while det is not None and det.tag != 'details':
                det = det.parent
            if det is not None and 'Source' not in row:
                flat = re.sub(r'\s+', ' ', det.text())
                m = re.search(r'Source\s*(.+?)\s*(Armor Pen|Reload|DPS|$)', flat)
                if m:
                    row['Source'] = m.group(1).strip()
            rows.append(row)
        if rows:
            return {'cols': cols, 'rows': rows}
    return {'cols': [], 'rows': []}


def parse_wiki_codes(text):
    text = re.sub(r'<script.*?</script>', '', text, flags=re.S)
    out = {}
    for row in re.findall(r'<tr>(.*?)</tr>', text, flags=re.S):
        tds = re.findall(r'<td[^>]*>(.*?)</td>', row, flags=re.S)
        arrows = re.findall(r'Stratagem Arrow (Up|Down|Left|Right)\.svg', row)
        if len(tds) < 3 or not arrows:
            continue
        name = None
        for td in tds:
            m = re.search(r'<a [^>]*title="([^"]+)"[^>]*>([^<]+)</a>', td)
            if m and 'File:' not in m.group(0) and 'Arrow' not in td:
                name = html.unescape(m.group(2)).strip()
                break
        if not name:
            continue
        plain = [re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', html.unescape(td))).strip() for td in tds]
        plain = [p for p in plain if p]
        cooldown = next((p for p in plain if re.fullmatch(r'\d+s', p)), None)
        out[name] = {
            'code': ''.join({'Up': 'U', 'Down': 'D', 'Left': 'L', 'Right': 'R'}[a] for a in arrows),
            'cooldown': int(cooldown[:-1]) if cooldown else None,
        }
    return out


# --------------------------------------------------------------------------------------------
# fetch
# --------------------------------------------------------------------------------------------
def _get(url, retries=4):
    req = urllib.request.Request(url, headers={'User-Agent': 'hd2-endgame-catalog/1.0', 'Accept-Encoding': 'gzip'})
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            break
        except OSError:  # the Wayback Machine rate-limits bursts with refused connections
            if attempt == retries:
                raise
            time.sleep(5 * 2 ** attempt)
    if data[:2] == b'\x1f\x8b':
        data = gzip.decompress(data)
    elif data[:4] == b'\x28\xb5\x2f\xfd':
        # Some archived pages were stored zstd-encoded; the stdlib can't decode that before 3.14.
        data = _zstd_decompress(data, url)
    return data.decode('utf-8', errors='replace')


def _zstd_decompress(data, url):
    try:
        from compression import zstd  # Python 3.14+
        return zstd.decompress(data)
    except ImportError:
        pass
    for cmd in (['zstd', '-dc'], None):
        try:
            if cmd:
                return subprocess.run(cmd, input=data, capture_output=True, check=True).stdout
            return subprocess.run(['curl', '-sL', '--compressed', url], capture_output=True, check=True).stdout
        except (OSError, subprocess.CalledProcessError):
            continue
    return b''


def _snapshots(url):
    """Newest-first Wayback captures of url (skipping tiny captured challenge pages)."""
    cdx = _get('https://web.archive.org/cdx/search/cdx?url=%s&output=json&filter=statuscode:200&limit=-40' % url)
    rows = json.loads(cdx)[1:] if cdx.strip() else []
    rows = sorted((r for r in rows if int(r[6]) > 8000), key=lambda r: r[1], reverse=True)
    return ['https://web.archive.org/web/%sid_/https://%s' % (r[1], url) for r in rows]


def _fetch_parsed(url, parse, attempts=6):
    """Walk back through snapshots until one actually parses (some captures are bot-check pages)."""
    for origin in _snapshots(url)[:attempts]:
        text = _get(origin)
        parsed = parse(text)
        if parsed:
            return origin, parsed
        print('  . skipping unusable capture (%d chars: %r) %s' % (len(text), text[:40], origin), file=sys.stderr)
    raise RuntimeError('no usable snapshot for ' + url)


def cmd_fetch(args):
    os.makedirs(SOURCES, exist_ok=True)
    ugg = {'fetched': dt.date.today().isoformat(), 'pages': {}}
    for key, slug in UGG_PAGES.items():
        if args.html_dir:
            path = next((os.path.join(args.html_dir, f) for f in os.listdir(args.html_dir) if slug in f and f.endswith('.html')), None)
            if not path:
                print('  ! no saved page for', slug, file=sys.stderr)
                continue
            origin, table = path, parse_ugg_html(open(path, encoding='utf-8', errors='replace').read())
        else:
            origin, table = _fetch_parsed('u.gg/hd2/tier-list/' + slug, lambda t: (lambda p: p if p['rows'] else None)(parse_ugg_html(t)))
        print('  u.gg %-10s %3d rows  <- %s' % (key, len(table['rows']), origin))
        ugg['pages'][key] = {'origin': origin, **table}
    with open(os.path.join(SOURCES, 'ugg-tiers.json'), 'w', encoding='utf-8') as f:
        json.dump(ugg, f, indent=1, ensure_ascii=False)

    origin, codes = _fetch_parsed(WIKI_PAGE, parse_wiki_codes)
    print('  wiki codes   %3d rows  <- %s' % (len(codes), origin))
    with open(os.path.join(SOURCES, 'wiki-stratagems.json'), 'w', encoding='utf-8') as f:
        json.dump({'fetched': dt.date.today().isoformat(), 'origin': origin, 'codes': codes}, f, indent=1, ensure_ascii=False)
    print('Sources written. Now run: python3 tools/catalog/catalog.py build')


# --------------------------------------------------------------------------------------------
# build
# --------------------------------------------------------------------------------------------
TIER_MAP = {'OP': 'OP', 'S+': 'S+', 'S': 'S', 'A': 'A', 'B': 'B', 'C': 'C', 'D': 'D'}


def slug(name):
    s = name.lower().replace('&', 'and').replace('’', '').replace("'", '')
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def split_designation(name):
    first, _, rest = name.partition(' ')
    if rest and (re.fullmatch(r'[A-Za-z0-9]+(?:[/-][A-Za-z0-9]+)+', first) or re.fullmatch(r'[A-Z]+\d+[A-Z]*', first)):
        return first, rest
    return None, name


def ownership(source):
    if source in BASE_SOURCES:
        return 'base'
    if source == 'Superstore':
        return 'superstore'
    if 'Campaign Reward' in source or 'Super Citizen' in source:
        return 'special'
    return 'warbond'


def ap_value(s):
    m = re.match(r'\s*(\d+)', s or '')
    return int(m.group(1)) if m else None


def classify(item, row, key):
    n = item['fullName'].lower()
    if key == 'primary':
        wt = (row.get('Weapon Type') or '').lower()
        if 'flam' in n or 'torcher' in n:
            return 'flame'
        return {'assault rifle': 'rifle', 'energy-based': 'energy', 'shotgun': 'shotgun', 'smg': 'smg',
                'marksman rifle': 'marksman', 'explosive': 'explosive', 'special': 'special'}.get(wt, 'rifle')
    if key == 'secondary':
        d = (item.get('designation') or '').upper()
        if d.startswith('CQC'):
            return 'melee'
        if d.startswith('GP') or 'missile' in n:
            return 'explosive'
        if d.startswith(('LAS', 'PLAS')) or 'crisper' in n:
            return 'energy'
        if d.startswith('SG'):
            return 'shotgun'
        return 'pistol'
    if key == 'throwable':
        if any(k in n for k in ('incendiary', 'immolation', 'pyrotech', 'thermite')):
            return 'fire'
        if any(k in n for k in ('gas', 'smoke', 'stun', 'arc')):
            return 'cloud'
        if any(k in n for k in ('knife', 'shield', 'lure', 'melta', 'urchin', 'seeker')):
            return 'special'
        return 'frag'
    return None


GLYPH_RULES = [
    ('orbital', ['laser'], 'o-laser'),
    ('orbital', ['gas', 'ems', 'smoke'], 'o-cloud'),
    ('orbital', ['precision', 'railcannon'], 'o-strike'),
    ('orbital', [''], 'o-barrage'),
    ('eagle', ['strafing', 'rocket'], 'e-strafe'),
    ('eagle', ['napalm', 'smoke', 'gas'], 'e-cloud'),
    ('eagle', [''], 'e-bomb'),
    ('support', ['flame', 'cremator', 'sterilizer', 'melta'], 's-flame'),
    ('support', ['grenade launcher', 'de-escalator'], 's-grenade'),
    ('support', ['hammer', 'defoliation', 'flag'], 's-melee'),
    ('support', ['c4'], 's-explosive'),
    ('support', ['laser cannon', 'arc thrower', 'epoch', 'quasar'], 's-energy'),
    ('support', ['expendable', 'recoilless', 'spear', 'commando', 'airburst', 'leveller', 'silo', 'w.a.s.p', 'speargun'], 's-launcher'),
    ('support', [''], 's-gun'),
    ('backpack', ['supply'], 'b-supply'),
    ('backpack', ['jump', 'hover', 'warp'], 'b-jet'),
    ('backpack', ['shield'], 'b-shield'),
    ('backpack', ['hellbomb'], 'b-bomb'),
    ('backpack', [''], 'b-drone'),
    ('defensive', ['mines', 'minefield'], 'd-mines'),
    ('defensive', ['mortar'], 'd-mortar'),
    ('defensive', ['tesla'], 'd-tesla'),
    ('defensive', ['relay'], 'd-relay'),
    ('defensive', ['emplacement', 'battlement'], 'd-emplacement'),
    ('defensive', [''], 'd-sentry'),
    ('vehicle', ['exosuit'], 'v-mech'),
    ('vehicle', ['frv'], 'v-car'),
    ('vehicle', [''], 'v-tank'),
]


def glyph_for(item):
    if item['category'] != 'stratagem':
        return {'primary': 'p-', 'secondary': 'x-', 'throwable': 'g-'}[item['category']] + item['weaponClass']
    n = item['fullName'].lower()
    for t, keys, g in GLYPH_RULES:
        if t == item['type'] and any(k in n for k in keys):
            return g
    return 'o-barrage'


def damage_type(item):
    """
    Headline damage type for weapons (drives the damage icon). A weapon that adds anything to
    ballistic damage shows the extra type instead: incendiary shotguns are fire, plasma and
    explosive rounds are explosion, and so on.
    """
    n = item['fullName'].lower()
    d = (item.get('designation') or '').upper()
    if any(k in n for k in ('stim', 'smoke', 'shield', 'lure')):
        return None
    if any(k in n for k in ('incendiary', 'cookout', 'torcher', 'crisper', 'stoker', 'coyote', 'immolation', 'pyrotech', 'thermite', 'flam')):
        return 'fire'
    if 'gas' in n:
        return 'gas'
    if d.startswith('LAS') or 'hot-shot' in n:
        return 'laser'
    if d.startswith('ARC') or 'arc' in n.split() or 'stun' in n:
        return 'arc'
    if d.startswith('CQC') or 'knife' in n:
        return 'melee'
    if d.startswith('PLAS') or 'plasma' in n or item.get('weaponClass') in ('explosive', 'frag') or 'urchin' in n or 'seeker' in n or 'melta' in n:
        return 'explosion'
    return 'ballistic'


def cmd_build(args):
    ugg = json.load(open(os.path.join(SOURCES, 'ugg-tiers.json'), encoding='utf-8'))
    wiki = json.load(open(os.path.join(SOURCES, 'wiki-stratagems.json'), encoding='utf-8'))['codes']
    manifest_path = os.path.join(SOURCES, 'art-manifest.json')
    art = json.load(open(manifest_path, encoding='utf-8')) if os.path.exists(manifest_path) else {}
    items, seen, missing_codes = [], set(), []
    for key, page in ugg['pages'].items():
        name_col = page['cols'][0]
        for row in page['rows']:
            ugg_name = row[name_col].strip()
            full = NAME_OVERRIDES.get(ugg_name, ugg_name)
            designation, plain = split_designation(full)
            plain = PLAIN_OVERRIDES.get(full, full if plain in GENERIC_TITLES else plain)
            category = key if key in ('primary', 'secondary', 'throwable') else 'stratagem'
            tiers = {}
            for faction, col in (('automatons', 'vs Automatons'), ('terminids', 'vs Terminids'), ('illuminate', 'vs Illuminate')):
                tiers[faction] = TIER_MAP.get((row.get(col) or '').strip())
            source = (row.get('Source') or '').strip() or 'Unknown'
            iid = slug(ugg_name)
            item = {
                'id': iid, 'name': plain, 'fullName': full, 'designation': designation,
                'category': category, 'source': source, 'ownership': ownership(source), 'tiers': tiers,
            }
            if category == 'stratagem':
                item['type'] = key
                w = wiki.get(ugg_name) or wiki.get(full) or MANUAL_CODES.get(ugg_name)
                if w:
                    item['code'] = w['code']
                    if w.get('cooldown'):
                        item['cooldown'] = w['cooldown']
                else:
                    missing_codes.append(full)
                item['backpack'] = key == 'backpack' or (key == 'support' and (row.get('Backpack') or '').lower() == 'yes')
                if f'stratagems/{iid}.svg' in art:
                    item['art'] = f'stratagems/{iid}.svg'
            else:
                item['weaponClass'] = classify(item, row, key)
                dmg = damage_type(item)
                if dmg:
                    item['damage'] = dmg
                if f'weapons/{iid}.png' in art:
                    item['art'] = f'weapons/{iid}.png'
            ap = ap_value(row.get('AP') or row.get('Armor Pen'))
            if ap is not None:
                item['ap'] = ap
            if ugg_name in ALWAYS_FREE:
                item['alwaysFree'] = True
            item['glyph'] = glyph_for(item)
            if item['id'] in seen:
                raise SystemExit('duplicate id ' + item['id'])
            seen.add(item['id'])
            items.append(item)
    # Plain titles must stay unique; the few true duplicates keep their designation.
    counts = {}
    for i in items:
        counts[i['name']] = counts.get(i['name'], 0) + 1
    for i in items:
        if counts[i['name']] > 1:
            i['name'] = i['fullName']
    free = [i['fullName'] for i in items if i.get('alwaysFree')]
    if len(free) != len(ALWAYS_FREE):
        raise SystemExit('could not find all always-free items, found: %s' % free)

    origins = {k: p['origin'] for k, p in ugg['pages'].items()}
    body = json.dumps(items, indent=1, ensure_ascii=False)
    ts = (
        '// AUTO-GENERATED by tools/catalog/catalog.py build -- do not edit by hand.\n'
        '// Tier ratings: u.gg Helldivers 2 tier lists (vs Automatons / Terminids / Illuminate).\n'
        '// Stratagem codes, cooldowns and game art: helldivers.wiki.gg. Game art (c) Arrowhead Game Studios / Sony.\n'
        '// u.gg data fetched %s\n' % ugg.get('fetched', '?') +
        "import type { RawItem } from './types';\n\n"
        'export const CATALOG_SOURCES = %s as const;\n\n' % json.dumps({'fetched': ugg.get('fetched'), 'pages': origins}, indent=1) +
        'export const RAW_ITEMS: RawItem[] = %s;\n' % body
    )
    with open(OUT_TS, 'w', encoding='utf-8') as f:
        f.write(ts)
    by_cat = {}
    for i in items:
        by_cat[i['category']] = by_cat.get(i['category'], 0) + 1
    print('Wrote %d items %s -> %s (%d with game art)' % (len(items), by_cat, os.path.relpath(OUT_TS, ROOT), sum(1 for i in items if i.get('art'))))
    if missing_codes:
        print('  ! stratagems without wiki codes:', missing_codes)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    f = sub.add_parser('fetch')
    f.add_argument('--html-dir', help='parse u.gg pages saved from your browser instead of the Wayback Machine')
    sub.add_parser('build')
    args = ap.parse_args()
    {'fetch': cmd_fetch, 'build': cmd_build}[args.cmd](args)


if __name__ == '__main__':
    main()
