#!/usr/bin/env python3
"""
One-shot equipment sync from the Helldivers Fandom wiki (helldivers.fandom.com), via its
MediaWiki API. Replaces the Wayback-based path in tools/catalog for weapons and stratagems.

  python3 tools/sync/equipment.py

Reads the "Weapons (Helldivers 2)" and "Stratagems (Helldivers 2)" categories, parses each page's
WeaponTemplate infobox and stratagem input code, resolves the weapon image files, and writes:

  data/equipment/weapons.json        name, damage, penetration, traits, source, image file
  data/equipment/stratagems.json     name, input code, call-in time, cooldown, uses
  data/equipment/manifest.json       fetch time, counts, licence reminder
  frontend/public/game/fandom/<file> weapon images

The wiki's content licence isn't stated in its API output; check it before publishing images.
"""
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, 'data', 'equipment')
IMAGES = os.path.join(ROOT, 'frontend', 'public', 'game', 'fandom')
API = 'https://helldivers.fandom.com/api.php'
UA = 'helldivers2endgame/0.1 (+https://github.com/winnieda/Helldivers2Endgame; winnieda@umich.edu)'
PAUSE = 1.0  # seconds between requests; MediaWiki asks for politeness, not a hard limit


def api(params):
    q = urllib.parse.urlencode({**params, 'format': 'json', 'formatversion': '2'})
    req = urllib.request.Request(f'{API}?{q}', headers={'User-Agent': UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                time.sleep(PAUSE)
                return json.load(r)
        except OSError:
            time.sleep(4 * (attempt + 1))
    raise SystemExit(f'API failed: {params.get("action")} {params.get("list", "")}')


def category_pages(category):
    titles, cont = [], {}
    while True:
        d = api({'action': 'query', 'list': 'categorymembers', 'cmtitle': f'Category:{category}', 'cmtype': 'page', 'cmlimit': 500, **cont})
        titles += [m['title'] for m in d['query']['categorymembers']]
        if 'continue' not in d:
            return titles
        cont = {'cmcontinue': d['continue']['cmcontinue']}


def wikitext(titles):
    out = {}
    for i in range(0, len(titles), 25):
        d = api({'action': 'query', 'prop': 'revisions', 'rvprop': 'content', 'rvslots': 'main', 'titles': '|'.join(titles[i:i + 25])})
        for p in d.get('query', {}).get('pages', []):
            if 'revisions' in p:
                out[p['title']] = p['revisions'][0]['slots']['main']['content']
    return out


def template_fields(text, name):
    """Return the parameters of the first {{name ...}} block, as a dict of stripped strings."""
    m = re.search(r'\{\{' + re.escape(name) + r'\b', text)
    if not m:
        return None
    depth, i, start = 0, m.start(), m.start()
    while i < len(text):
        if text.startswith('{{', i):
            depth += 1
            i += 2
            continue
        if text.startswith('}}', i):
            depth -= 1
            i += 2
            if depth == 0:
                break
            continue
        i += 1
    body = text[start + 2:i - 2]
    # Split on '|' at the top level only: nested {{...}} and [[...]] may contain pipes too.
    parts, cur, depth, j = [], '', 0, 0
    while j < len(body):
        two = body[j:j + 2]
        if two in ('{{', '[['):
            depth += 1
            cur += two
            j += 2
            continue
        if two in ('}}', ']]'):
            depth -= 1
            cur += two
            j += 2
            continue
        if body[j] == '|' and depth == 0:
            parts.append(cur)
            cur = ''
        else:
            cur += body[j]
        j += 1
    parts.append(cur)
    fields = {}
    for p in parts[1:]:  # parts[0] is the template name
        if '=' in p:
            k, v = p.split('=', 1)
            fields[k.strip()] = v.strip()
    return fields


def plain(v):
    v = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]*)\]\]', r'\1', v or '')
    v = re.sub(r'<[^>]+>|\{\{[^}]*\}\}', '', v)
    return re.sub(r'\s+', ' ', v.replace('*', ' ')).strip()


def weapon_record(title, text):
    f = template_fields(text, 'WeaponTemplate')
    if f is None:
        return None
    traits = [plain(t) for t in re.split(r'\n\*', '\n' + f.get('traits', '')) if plain(t)]
    def num(k):
        # First number only: multi-stage values such as "260|150|150" keep the headline figure.
        m = re.search(r'[0-9]+(?:\.[0-9]+)?', f.get(k, ''))
        return float(m.group(0)) if m else None
    return {
        'name': title,
        'damage': num('damage'),
        'penetration': num('penetration_level'),
        'fireRate': num('fire_rate'),
        'traits': traits,
        'source': plain(f.get('sourced_from', '')),
        'price': plain(f.get('price', '')),
        'image': f.get('image1', '').strip() or None,
    }


CODE_ARROWS = {'U': 'U', 'D': 'D', 'L': 'L', 'R': 'R'}


def stratagem_record(title, text):
    code = ''.join(CODE_ARROWS[c] for c in re.findall(r'\{\{([UDLR])\}\}', text))
    if not code:
        return None
    def grab(pattern):
        m = re.search(pattern, text, re.I)
        return plain(m.group(1)) if m else None
    cooldown = grab(r"Cooldown Time\W*:?\W*'*\s*([0-9.]+\s*Seconds?)")
    calltime = grab(r"Call-in Time\W*:?\W*'*\s*([0-9.]+\s*Seconds?)")
    uses = grab(r"Uses\W*:?\W*'*\s*([^\n*]+)")
    def secs(s):
        m = re.search(r'[0-9.]+', s or '')
        return float(m.group(0)) if m else None
    return {'name': title, 'code': code, 'callInSeconds': secs(calltime), 'cooldownSeconds': secs(cooldown), 'uses': uses}


def image_urls(files):
    urls = {}
    for i in range(0, len(files), 15):  # small batches keep the GET URL short
        titles = [f'File:{f}' for f in files[i:i + 15]]
        d = api({'action': 'query', 'prop': 'imageinfo', 'iiprop': 'url|mime', 'titles': '|'.join(titles)})
        for p in d.get('query', {}).get('pages', []):
            info = (p.get('imageinfo') or [{}])[0]
            if info.get('url'):
                urls[p['title'].removeprefix('File:').replace(' ', '_')] = info['url']
    return urls


def download(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return True
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
    except OSError:
        return False
    with open(dest, 'wb') as f:
        f.write(body)
    time.sleep(PAUSE)
    return True


def main():
    os.makedirs(DATA, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')

    weapon_titles = category_pages('Weapons (Helldivers 2)')
    weapon_text = wikitext(weapon_titles)
    weapons = [r for t in weapon_titles if (r := weapon_record(t, weapon_text.get(t, ''))) is not None]
    print(f'weapons: {len(weapon_titles)} pages, {len(weapons)} with a WeaponTemplate', flush=True)

    strat_titles = category_pages('Stratagems (Helldivers 2)')
    strat_text = wikitext(strat_titles)
    strategems = [r for t in strat_titles if (r := stratagem_record(t, strat_text.get(t, ''))) is not None]
    print(f'stratagems: {len(strat_titles)} pages, {len(strategems)} with an input code', flush=True)

    files = sorted({w['image'] for w in weapons if w['image']})
    urls = image_urls(files)
    saved = 0
    os.makedirs(IMAGES, exist_ok=True)
    for w in weapons:
        key = (w['image'] or '').replace(' ', '_')
        if key in urls:
            ext = os.path.splitext(key)[1].lower() or '.png'
            name = re.sub(r'[^A-Za-z0-9._-]+', '_', w['name']) + ext
            if download(urls[key], os.path.join(IMAGES, name)):
                w['localImage'] = f'fandom/{name}'
                saved += 1
    print(f'images: {saved} of {len(files)} weapon images saved', flush=True)

    with open(os.path.join(DATA, 'weapons.json'), 'w', encoding='utf-8') as f:
        json.dump(weapons, f, indent=1, ensure_ascii=False)
    with open(os.path.join(DATA, 'stratagems.json'), 'w', encoding='utf-8') as f:
        json.dump(strategems, f, indent=1, ensure_ascii=False)
    with open(os.path.join(DATA, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump({
            'fetchedAt': now,
            'source': API,
            'weapons': len(weapons),
            'stratagems': len(strategems),
            'imagesSaved': saved,
            'licenceNote': 'Wiki licence not confirmed via API; check before publishing images.',
        }, f, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
