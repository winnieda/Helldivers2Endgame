#!/usr/bin/env python3
"""
One-shot sync of Helldivers 2 live state from the community API (api.helldivers2.dev).

  python3 tools/sync/sync.py            # fetch everything once, write data/live/ and assets

Writes:
  data/live/<endpoint>.json             the raw response for each endpoint
  data/live/manifest.json               when it was fetched, status, and asset list
  frontend/public/game/live/<file>      any images the responses link to

Upstream: https://github.com/helldivers-2/api (OpenAPI spec:
https://helldivers-2.github.io/api/openapi/Helldivers-2-API.json). The API documents a limit of
5 requests per 10 seconds, so requests are spaced 2.2 s apart and 429 responses are retried after
Retry-After. Equipment data (stratagems, weapons) is not covered by this API; see tools/catalog.
"""
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, 'data', 'live')
ASSETS = os.path.join(ROOT, 'frontend', 'public', 'game', 'live')
BASE = 'https://api.helldivers2.dev'
HEADERS = {
    'X-Super-Client': 'helldivers2endgame',
    'X-Super-Contact': 'winnieda@umich.edu',
    'User-Agent': 'helldivers2endgame/0.1 (+https://github.com/winnieda/Helldivers2Endgame)',
    'Accept': 'application/json',
}
ENDPOINTS = ['/api/v1/war', '/api/v1/assignments', '/api/v1/planet-events', '/api/v1/dispatches', '/api/v1/planets', '/api/v1/steam']
SPACING = 2.2  # seconds between requests (5 per 10 s)
IMG = re.compile(r'https?://[^"\s]+?\.(?:png|jpe?g|webp|svg)(?=["\s,\]}]|$)', re.I)


def fetch(path, tries=4):
    req = urllib.request.Request(BASE + path, headers=HEADERS)
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < tries - 1:
                wait = float(e.headers.get('Retry-After') or 10)
                print(f'  429 on {path}, waiting {wait:.0f}s', flush=True)
                time.sleep(wait)
                continue
            return e.code, e.read()
        except OSError as e:
            if attempt == tries - 1:
                return 0, str(e).encode()
            time.sleep(3)
    return 0, b''


def download_image(url):
    name = re.sub(r'[^A-Za-z0-9._-]+', '_', urllib.parse.urlparse(url).path.rsplit('/', 1)[-1]) or 'image'
    dest = os.path.join(ASSETS, name)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return name
    req = urllib.request.Request(url, headers={'User-Agent': HEADERS['User-Agent']})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
    except OSError:
        return None
    os.makedirs(ASSETS, exist_ok=True)
    with open(dest, 'wb') as f:
        f.write(body)
    return name


def main():
    os.makedirs(DATA, exist_ok=True)
    manifest = {'fetchedAt': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'), 'source': BASE, 'endpoints': {}, 'assets': []}
    seen_images = set()
    for i, path in enumerate(ENDPOINTS):
        if i:
            time.sleep(SPACING)
        status, body = fetch(path)
        name = path.rsplit('/', 1)[-1] + '.json'
        entry = {'status': status, 'bytes': len(body)}
        if status == 200:
            try:
                parsed = json.loads(body)
            except ValueError:
                parsed = None
                entry['note'] = 'response was not JSON'
            if parsed is not None:
                with open(os.path.join(DATA, name), 'w', encoding='utf-8') as f:
                    json.dump(parsed, f, indent=1, ensure_ascii=False)
                entry['file'] = f'data/live/{name}'
                seen_images.update(IMG.findall(body.decode('utf-8', errors='replace')))
        else:
            entry['note'] = body[:200].decode('utf-8', errors='replace')
        manifest['endpoints'][path] = entry
        print(f'  {status} {path} ({len(body)} bytes)', flush=True)

    for url in sorted(seen_images)[:60]:
        name = download_image(url)
        if name:
            manifest['assets'].append({'url': url, 'file': f'game/live/{name}'})
    print(f'  {len(manifest["assets"])} of {len(seen_images)} linked images saved', flush=True)

    with open(os.path.join(DATA, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=1, ensure_ascii=False)
    ok = sum(1 for e in manifest['endpoints'].values() if e['status'] == 200)
    print(f'{ok}/{len(ENDPOINTS)} endpoints fetched. Manifest: data/live/manifest.json')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
