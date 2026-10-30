#!/usr/bin/env python3
"""Publish only checks-passing, immutable static UI snapshots. No upstream code execution."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import urllib.request

REPO = 'PystoyPlayer/subvost-vpn'
API = 'https://api.github.com/repos/' + REPO
ROOT = Path('/var/lib/subvost-download-site')
FILES = ('index.html', 'app.mjs', 'style.css', 'brand.png', 'icons/apple.svg',
         'icons/android.svg', 'icons/github.svg', 'icons/linux.svg', 'icons/NOTICE.txt',
         'lib/catalog.mjs', 'lib/selection.mjs', 'lib/mirror.mjs', 'lib/source-menu.mjs',
         'updates/android-testing.json', 'location-catalog-v2.json')
LIMIT = 8 * 1024 * 1024


def validate_android_feed(data):
    if len(data) > 65536:
        raise ValueError('Android feed exceeds client size limit')
    feed = json.loads(data)
    if (feed.get('schema') != 1 or feed.get('platform') != 'android'
            or feed.get('channel') not in ('stable', 'testing')
            or type(feed.get('build')) is not int or not 1 <= feed['build'] <= 2100000000
            or type(feed.get('minSdk')) is not int or not 23 <= feed['minSdk'] <= 1000
            or type(feed.get('size')) is not int or not 1 <= feed['size'] <= 250000000
            or not re.fullmatch(r'[0-9A-Za-z.+-]{1,60}', feed.get('version', ''))
            or not re.fullmatch(r'[0-9a-f]{64}', feed.get('sha256', ''))
            or not re.fullmatch(r'https://github\.com/PystoyPlayer/subvost-vpn/releases/download/android-[A-Za-z0-9.+-]+/SubVost-VPN-Android-[A-Za-z0-9.+-]+\.apk', feed.get('url', ''))):
        raise ValueError('Invalid modern Android feed')


def validate_location_catalog(data):
    """Match the public map-only v2 contract shipped in macOS 83."""
    import math
    import unicodedata
    if len(data) > 65536:
        raise ValueError('Location catalogue exceeds client size limit')
    def pairs(rows):
        result = {}
        for key, value in rows:
            if key in result:
                raise ValueError('Duplicate catalogue key')
            result[key] = value
        return result
    def keys(value, expected):
        if not isinstance(value, dict) or set(value) != set(expected):
            raise ValueError('Unexpected location catalogue fields')
    def text(value):
        if (not isinstance(value, str) or not value or value.strip() != value
                or len(value) > 80 or len(value.encode('utf-8')) > 256
                or any(unicodedata.category(c) in ('Cc', 'Cf') for c in value)):
            raise ValueError('Invalid catalogue label')
        return value
    def number(value):
        if type(value) not in (int, float) or not math.isfinite(value):
            raise ValueError('Invalid catalogue number')
        return value
    def depth(value, level=1):
        if level > 12:
            raise ValueError('Catalogue nesting exceeds client limit')
        if isinstance(value, dict):
            for child in value.values():
                if isinstance(child, (dict, list)):
                    depth(child, level + 1)
        elif isinstance(value, list):
            for child in value:
                if isinstance(child, (dict, list)):
                    depth(child, level + 1)
    root = json.loads(data, object_pairs_hook=pairs)
    depth(root)
    keys(root, ('format', 'schemaVersion', 'revision', 'countries'))
    if root['format'] != 'subvost-location-catalog' or number(root['schemaVersion']) != 2:
        raise ValueError('Unsupported location catalogue schema')
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,64}', text(root['revision'])):
        raise ValueError('Invalid catalogue revision')
    countries = root['countries']
    if not isinstance(countries, dict) or not 1 <= len(countries) <= 256:
        raise ValueError('Invalid catalogue countries')
    count = 0
    for flag, group in countries.items():
        if len(flag) != 2 or not all(0x1F1E6 <= ord(c) <= 0x1F1FF for c in flag):
            raise ValueError('Invalid country flag')
        keys(group, ('en', 'cities'))
        text(group['en'])
        rows = group['cities']
        if not isinstance(rows, dict) or not rows:
            raise ValueError('Empty country')
        names = set()
        for name, row in rows.items():
            normalized = unicodedata.normalize('NFC', text(name)).lower()
            if normalized in names:
                raise ValueError('Ambiguous source city')
            names.add(normalized)
            keys(row, ('en', 'point', 'aliases') if 'aliases' in row else ('en', 'point'))
            text(row['en'])
            aliases = row.get('aliases', [])
            if not isinstance(aliases, list) or len(aliases) > 16:
                raise ValueError('Invalid city aliases')
            for alias in aliases:
                text(alias)
            point = row['point']
            keys(point, ('latitude', 'longitude', 'precision'))
            if (not -90 <= number(point['latitude']) <= 90
                    or not -180 <= number(point['longitude']) <= 180
                    or text(point['precision']) not in ('city', 'region', 'country')):
                raise ValueError('Invalid location point')
            count += 1
            if count > 256:
                raise ValueError('Catalogue entry limit exceeded')


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'SubVost-site-sync',
                                              'Accept': 'application/vnd.github+json'})
    with urllib.request.urlopen(req, timeout=45) as response:
        body = response.read(LIMIT + 1)
    if len(body) > LIMIT:
        raise ValueError('Response exceeds size limit')
    return body


def api(path):
    return json.loads(fetch(API + path))


def checked(runs, sha):
    return any(r.get('head_sha') == sha and r.get('head_branch') == 'main'
               and r.get('event') == 'push' and r.get('status') == 'completed'
               and r.get('conclusion') == 'success'
               and r.get('path') == '.github/workflows/site-checks.yml'
               for r in runs)


def publish(root, sha, entries, download):
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('Invalid commit')
    blobs = {e['path']: e for e in entries if e.get('type') == 'blob'}
    for name in FILES:
        entry = blobs.get('docs/' + name, {})
        if entry.get('mode') != '100644' or not re.fullmatch(r'[0-9a-f]{40}', entry.get('sha', '')):
            raise ValueError('Missing or unsafe static file: ' + name)
    revisions = root / 'revisions'
    revisions.mkdir(exist_ok=True)
    target = revisions / sha
    stage = Path(tempfile.mkdtemp(prefix='.staging-', dir=root))
    try:
        total = 0
        for name in FILES:
            data = download(name)
            total += len(data)
            if total > LIMIT:
                raise ValueError('Snapshot exceeds size limit')
            digest = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
            if digest != blobs['docs/' + name]['sha']:
                raise ValueError('Static file checksum mismatch: ' + name)
            if name == 'updates/android-testing.json':
                validate_android_feed(data)
            if name == 'location-catalog-v2.json':
                validate_location_catalog(data)
            path = stage / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            path.chmod(0o644)
        stage.chmod(0o755)
        if target.exists():
            raise ValueError('Revision already exists without active pointer; inspect before retry')
        stage.rename(target)
        pointer = root / '.next'
        pointer.unlink(missing_ok=True)
        pointer.symlink_to('revisions/' + sha)
        pointer.replace(root / 'current')
        print('Published static website revision ' + sha, flush=True)
        # Only our validated revision directories; keep current + two previous snapshots.
        old = sorted((p for p in revisions.iterdir() if p != target and not p.is_symlink()
                      and p.is_dir() and re.fullmatch(r'[0-9a-f]{40}', p.name)),
                     key=lambda p: p.stat().st_mtime, reverse=True)
        for path in old[2:]:
            shutil.rmtree(path)
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def main():
    os.umask(0o022)
    ROOT.mkdir(parents=True, exist_ok=True)
    with (ROOT / '.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        sha = api('/commits/main')['sha']
        if not re.fullmatch(r'[0-9a-f]{40}', sha):
            raise ValueError('Invalid upstream commit')
        current = ROOT / 'current'
        if current.is_symlink() and os.readlink(current) == 'revisions/' + sha:
            print('Website already current: ' + sha)
            return
        runs = api('/actions/workflows/site-checks.yml/runs?event=push&head_sha=' + sha)['workflow_runs']
        if not checked(runs, sha):
            print('Keeping current website: checks not successful for ' + sha)
            return
        tree = api('/git/trees/' + sha + '?recursive=1')
        if tree.get('truncated'):
            raise ValueError('Incomplete upstream tree')
        publish(ROOT, sha, tree['tree'], lambda name: fetch(
            'https://raw.githubusercontent.com/' + REPO + '/' + sha + '/docs/' + name))


if __name__ == '__main__':
    main()
