#!/usr/bin/env python3
"""
Game art for the web app: stratagem icons, weapon renders, faction icons, the Super Earth
emblem and the damage-type / armor-penetration icons, all from helldivers.wiki.gg.

  python3 tools/catalog/assets.py discover   # read the wiki's Stratagems + Primary Weapons pages
  python3 tools/catalog/assets.py download   # fetch every file into frontend/public/game/
  python3 tools/catalog/assets.py download --from-dir ~/Downloads/wiki   # use files you saved yourself

The wiki sits behind a bot check, so files come from their latest Wayback Machine capture.
`download` writes tools/catalog/sources/art-manifest.json, which `catalog.py build` reads to give
each item an `art` path. Items the wiki has no art for fall back to the in-app pictograms.

All of this artwork belongs to Arrowhead Game Studios / Sony Interactive Entertainment (weapon
renders were prepared by wiki contributors). See the Credits & Legal page in the app.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SOURCES = os.path.join(HERE, 'sources')
PUBLIC = os.path.join(ROOT, 'frontend', 'public', 'game')
WIKI = 'helldivers.wiki.gg'

STATIC = {
    'factions/terminids.svg': 'Terminid_Icon.svg',
    'factions/automatons.svg': 'Automaton_Icon.svg',
    'factions/illuminate.svg': 'Illuminate_Icon.svg',
    'super-earth.svg': 'Super_Earth_Icon.svg',
    **{f'damage/{d.lower()}.svg': f'Damage_{d}_Icon.svg' for d in ('Ballistic', 'Explosion', 'Fire', 'Laser', 'Arc', 'Gas', 'Energy', 'Melee')},
    **{f'ap/{n}.png': f'Armor_AP{n}_Icon.png' for n in range(0, 11)},
}


def curl(url, timeout=60):
    r = subprocess.run(['curl', '-sL', '--compressed', '--max-time', str(timeout), '-w', '\n%{http_code}', url], capture_output=True)
    if r.returncode != 0 or b'\n' not in r.stdout:
        return None, 0
    body, code = r.stdout.rsplit(b'\n', 1)
    return body, int(code or 0)


def get(url, tries=6):
    for k in range(tries):
        body, code = curl(url)
        if code == 200 and body and b'504 Gateway' not in body[:400]:
            return body
        time.sleep(3 * (k + 1))
    return None


def captures(path):
    """Latest-first Wayback captures (any query-string variant) of a wiki path."""
    body = get('https://web.archive.org/cdx/search/cdx?url=%s/%s*&fl=original,timestamp,statuscode&output=json&limit=-20' % (WIKI, urllib.parse.quote(path)))
    try:
        rows = json.loads(body)[1:] if body else []
    except ValueError:
        rows = []
    rows = [r for r in rows if r[2] == '200' and r[0].split('?')[0].endswith(path)]
    return sorted(rows, key=lambda r: r[1], reverse=True)


def hashed(filename):
    """MediaWiki stores uploads under images/<md5[0]>/<md5[:2]>/<name>."""
    h = hashlib.md5(filename.encode('utf-8')).hexdigest()
    return f'images/{h[0]}/{h[:2]}/{filename}'


def wayback_file(filename):
    for path in (f'images/{filename}', hashed(filename)):
        for original, ts, _ in captures(path)[:3]:
            body = get(f'https://web.archive.org/web/{ts}id_/{original}')
            if body and not body.lstrip().startswith(b'<!DOCTYPE html') and not body.lstrip().startswith(b'<html'):
                return body
    return None


def wayback_page(title):
    rows = captures(f'wiki/{title}')[:4]
    if not rows:  # the CDX index is flaky; the availability API is a lighter fallback
        meta = get(f'https://archive.org/wayback/available?url={WIKI}/wiki/{title}')
        try:
            c = json.loads(meta)['archived_snapshots'].get('closest') if meta else None
            rows = [(f'https://{WIKI}/wiki/{title}', c['timestamp'], '200')] if c else []
        except ValueError:
            rows = []
    for original, ts, _ in rows:
        body = get(f'https://web.archive.org/web/{ts}id_/{original}')
        if body and len(body) > 20000:
            return body.decode('utf-8', errors='replace')
    return None


# --------------------------------------------------------------------------------------------
def cmd_discover(args):
    def page(title):
        if args.html_dir:
            path = next((os.path.join(args.html_dir, f) for f in os.listdir(args.html_dir) if f.startswith(title)), None)
            if path:
                return open(path, encoding='utf-8', errors='replace').read()
        return wayback_page(title)

    strat = page('Stratagems')
    weapons = page('Primary_Weapons')  # its navbox lists renders for every weapon type
    if not strat or not weapons:
        raise SystemExit('could not fetch the wiki pages; try again later or save them and pass --html-dir')
    icons = {}
    for row in re.findall(r'<tr>(.*?)</tr>', strat, flags=re.S):
        tds = re.findall(r'<td[^>]*>(.*?)</td>', row, flags=re.S)
        if len(tds) < 3:
            continue
        m = re.search(r'src="[^"]*/([^"/?]*Stratagem_Icon[^"/?]*)', tds[0])
        n = re.search(r'<a [^>]*title="([^"]+)"[^>]*>([^<]+)</a>', tds[1])
        if m and n:
            icons[n.group(2).strip()] = urllib.parse.unquote(m.group(1)).replace('_Background', '')
    renders = sorted({urllib.parse.unquote(x) for x in re.findall(r'src="[^"]*/([^"/?]*_Render\.png)', weapons)})
    with open(os.path.join(SOURCES, 'wiki-art.json'), 'w', encoding='utf-8') as f:
        json.dump({'stratagemIcons': icons, 'renders': renders}, f, indent=1, ensure_ascii=False)
    print('stratagem icons: %d · weapon renders: %d' % (len(icons), len(renders)))


def norm_designation(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())


def render_for(name, renders):
    """Weapon render matched on the designation (e.g. SG-8 vs SG-8S vs SG-8P)."""
    designation = name.split(' ')[0]
    key = norm_designation(designation)
    for r in renders:
        if norm_designation(r.split('_')[0]) == key:
            return r
    # A few renders have no designation token split the same way (e.g. "B_MD_C4_Pack").
    flat = norm_designation(name)
    for r in renders:
        if norm_designation(re.sub(r'_(Primary|Secondary|Throwable|Support)_Render\.png$', '', r)) == flat:
            return r
    return None


RENDER_MAX = 400  # longest side; renders are published at 4K and shown under 100px wide


def shrink_png(path):
    """Trim transparent margins and downscale a render (needs Pillow; skipped if missing)."""
    try:
        from PIL import Image
    except ImportError:
        print('  (install Pillow to shrink renders: pip install pillow)', file=sys.stderr)
        return False
    im = Image.open(path).convert('RGBA')
    box = im.getchannel('A').getbbox()
    if box:
        im = im.crop(box)
    scale = RENDER_MAX / max(im.width, im.height)
    if scale < 1:
        im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    im.save(path, optimize=True)
    return True


def cmd_shrink(args):
    n = 0
    for root, _, files in os.walk(PUBLIC):
        for f in files:
            if f.endswith('.png') and shrink_png(os.path.join(root, f)):
                n += 1
    print('shrunk %d PNGs' % n)


def cmd_download(args):
    sys.path.insert(0, HERE)
    import catalog as cat  # noqa: E402  (reuses slug())

    art = json.load(open(os.path.join(SOURCES, 'wiki-art.json'), encoding='utf-8'))
    ugg = json.load(open(os.path.join(SOURCES, 'ugg-tiers.json'), encoding='utf-8'))
    wanted = dict(STATIC)
    for key, page in ugg['pages'].items():
        col = page['cols'][0]
        for row in page['rows']:
            name = cat.NAME_OVERRIDES.get(row[col].strip(), row[col].strip())
            iid = cat.slug(row[col].strip())
            if key in ('primary', 'secondary', 'throwable'):
                r = render_for(name, art['renders'])
                if r:
                    wanted[f'weapons/{iid}.png'] = r
                    continue
            icon = art['stratagemIcons'].get(row[col].strip()) or art['stratagemIcons'].get(name)
            if icon:
                wanted[f'stratagems/{iid}.svg'] = icon
    os.makedirs(PUBLIC, exist_ok=True)
    manifest_path = os.path.join(SOURCES, 'art-manifest.json')
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    missing = []
    for dest, filename in sorted(wanted.items()):
        out = os.path.join(PUBLIC, dest)
        if os.path.exists(out) and os.path.getsize(out) > 0 and not args.force:
            manifest[dest] = filename
            continue
        body = None
        if args.from_dir and os.path.exists(os.path.join(args.from_dir, filename)):
            body = open(os.path.join(args.from_dir, filename), 'rb').read()
        if body is None and not args.offline:
            body = wayback_file(filename)
            time.sleep(0.7)
        if not body:
            missing.append(filename)
            print('  ! missing', filename, flush=True)
            continue
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, 'wb') as f:
            f.write(body)
        if out.endswith('.png'):
            shrink_png(out)
        manifest[dest] = filename
        print('  ok', dest, '<-', filename, flush=True)
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(dict(sorted(manifest.items())), f, indent=1)
    print('%d files in frontend/public/game, %d missing. Now run: python3 tools/catalog/catalog.py build' % (len(manifest), len(missing)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    disc = sub.add_parser('discover')
    disc.add_argument('--html-dir', help='folder with the Stratagems and Primary_Weapons wiki pages saved from a browser')
    d = sub.add_parser('download')
    d.add_argument('--from-dir', help='look for wiki files (by their wiki file name) here first')
    d.add_argument('--force', action='store_true', help='re-download files that already exist')
    d.add_argument('--offline', action='store_true', help='only use --from-dir, never the network')
    sub.add_parser('shrink', help='trim and downscale the PNGs already in frontend/public/game')
    args = ap.parse_args()
    {'discover': cmd_discover, 'download': cmd_download, 'shrink': cmd_shrink}[args.cmd](args)


if __name__ == '__main__':
    main()
