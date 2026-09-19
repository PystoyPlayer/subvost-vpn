#!/usr/bin/env python3
"""Mirror public release bytes only; never execute downloaded release content.

An interrupted/failed sync leaves the previous manifest/catalog intact. Public
files are renamed atomically after size and GitHub SHA-256 verification. Old
versions are retained, never silently replaced. No GitHub credentials needed.
"""
import concurrent.futures
import datetime
import fcntl
import functools
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.request

REPO = 'PystoyPlayer/subvost-vpn'
SOURCE = f'https://github.com/{REPO}/releases/download/'
ORIGIN = 'https://download.subvost.fun'
ROOT = Path(os.environ.get('MIRROR_ROOT', '/var/www/subvost-downloads'))
STATE = Path(os.environ.get('MIRROR_STATE', '/var/lib/subvost-download-mirror'))
LIMIT = 12 * 1024**3
NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9._+-]{0,180}\Z')


def version(value):
    m = re.fullmatch(r'(?:(?:windows|macos|linux|android)-)?v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([A-Za-z0-9.-]+))?', value)
    if not m:
        return None
    return tuple(map(int, m.group(1, 2, 3))), m[4]


def compare(a, b):
    ac, ap = version(a)
    bc, bp = version(b)
    if ac != bc:
        return (ac > bc) - (ac < bc)
    if ap is None or bp is None:
        return (ap is None) - (bp is None)
    for x, y in zip(ap.split('.'), bp.split('.')):
        if x == y:
            continue
        if x.isdigit() and y.isdigit():
            return (int(x) > int(y)) - (int(x) < int(y))
        if x.isdigit() != y.isdigit():
            return -1 if x.isdigit() else 1
        return (x > y) - (x < y)
    return (len(ap.split('.')) > len(bp.split('.'))) - (len(ap.split('.')) < len(bp.split('.')))


def slot(asset):
    name = asset['name']
    patterns = [
        (r'SubVost-VPN-macOS-(Legacy-)?(arm64|x86_64)-(\d+\.\d+\.\d+)\.dmg', 'macos'),
        (r'SubVost-VPN-Android-(Legacy-)?(\d+\.\d+\.\d+(?:-(?:alpha|beta|rc|preview)\.\d+)?)\.apk', 'android'),
        (r'SubVost-VPN-(\d+\.\d+\.\d+(?:-(?:alpha|beta|rc|preview)\.\d+)?)-Windows-(x64|arm64|x86)-Setup\.exe', 'windows'),
        (r'SubVost-VPN-Linux-(x86_64|arm64|armv7)-(\d+\.\d+\.\d+)(?:-(glibc|musl))?\.(AppImage|deb|rpm|tar\.gz|tar\.xz|pkg\.tar\.zst|flatpak|snap)', 'linux'),
    ]
    for pattern, platform in patterns:
        m = re.fullmatch(pattern, name)
        if not m:
            continue
        if platform == 'macos':
            return (platform, m[1] or 'modern', m[2]), m[3]
        if platform == 'android':
            return (platform, m[1] or 'mobile'), m[2]
        if platform == 'windows':
            return (platform, m[2]), m[1]
        return (platform, m[1], m[3] or 'glibc', m[4]), m[2]
    return None


def choose_releases(releases):
    selected = {}
    for release in releases:
        tag = release.get('tag_name', '')
        ver = version(tag)
        if release.get('draft') or not ver:
            continue
        platform = re.match(r'(windows|macos|linux|android)-v', tag)
        platform = platform[1] if platform else None
        if (release.get('prerelease') or ver[1]) and platform not in ('windows', 'android'):
            continue
        for asset in release.get('assets', []):
            info = slot(asset)
            if not info:
                continue
            key, asset_version = info
            if compare(tag, asset_version) != 0 or (platform and key[0] != platform):
                continue
            if key not in selected or compare(tag, selected[key]['tag_name']) > 0:
                selected[key] = release
    if not {'macos', 'linux', 'windows', 'android'}.issubset({key[0] for key in selected}):
        raise ValueError('Incomplete release response; retain the previous mirror')
    return list({r['tag_name']: r for r in selected.values()}.values())


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def validate_asset(tag, asset):
    name, size, sha = asset['name'], asset['size'], asset.get('digest', '')
    if not NAME.fullmatch(tag) or not NAME.fullmatch(name) or '..' in (tag, name):
        raise ValueError('Unsafe release path')
    if type(size) is not int or not 0 < size <= 1024**3:
        raise ValueError('Invalid asset size')
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', sha):
        raise ValueError(f'Missing upstream SHA-256: {name}')
    source = SOURCE + tag + '/' + name
    if asset['browser_download_url'] != source:
        raise ValueError('Untrusted asset URL')
    return source, size, sha[7:]


def download(item):
    tag, asset = item
    source, size, sha = validate_asset(tag, asset)
    target = ROOT / 'releases' / tag / asset['name']
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if target.stat().st_size != size or digest(target) != sha:
            raise ValueError(f'Existing immutable asset differs: {target.name}')
    else:
        # ProtectSystem/ReadWritePaths can put STATE and ROOT on distinct bind
        # mounts even on one disk. Stage on the destination mount for rename.
        staging = ROOT / '.staging'
        staging.mkdir(mode=0o700, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix='asset-', dir=staging)
        os.close(fd)
        try:
            subprocess.run(['curl', '--fail', '--location', '--silent', '--show-error',
                            '--proto', '=https', '--proto-redir', '=https', '--retry', '3',
                            '--connect-timeout', '15', '--max-time', '1800', '--max-filesize', str(size),
                            '--limit-rate', '12M', '--output', tmp, source], check=True)
            if Path(tmp).stat().st_size != size or digest(Path(tmp)) != sha:
                raise ValueError(f'Integrity failure: {target.name}')
            os.chmod(tmp, 0o644)
            os.replace(tmp, target)
        finally:
            Path(tmp).unlink(missing_ok=True)
    print('VERIFIED', tag, target.name, size, flush=True)
    return dict(source=source, url=ORIGIN + '/releases/' + tag + '/' + target.name, size=size, sha256=sha)


def atomic(path, content):
    fd, tmp = tempfile.mkstemp(prefix='.metadata-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as f:
            f.write(content)
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    finally:
        Path(tmp).unlink(missing_ok=True)


def run():
    ROOT.mkdir(parents=True, exist_ok=True)
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / 'sync.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        request = urllib.request.Request(f'https://api.github.com/repos/{REPO}/releases?per_page=100', headers={
            'User-Agent': 'SubVost-public-download-mirror', 'Accept': 'application/vnd.github+json'})
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read(8 * 1024 * 1024 + 1)
        if len(body) > 8 * 1024 * 1024:
            raise ValueError('Oversized release metadata')
        releases = choose_releases(json.loads(body))
        items = [(r['tag_name'], a) for r in releases for a in r['assets']]
        # Include checksums and corresponding-source/license archives, not just installers.
        for tag, asset in items:
            validate_asset(tag, asset)
        total = sum(a['size'] for _, a in items)
        existing = sum(p.stat().st_size for p in (ROOT / 'releases').rglob('*') if p.is_file())
        needed = sum(a['size'] for tag, a in items if not (ROOT / 'releases' / tag / a['name']).exists())
        if total > 4 * 1024**3 or existing + needed > LIMIT or shutil.disk_usage(ROOT).free < needed + 8 * 1024**3:
            raise ValueError('Mirror disk safety limit reached; no publication')
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            assets = list(pool.map(download, items))
        stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
        manifest = dict(schema=1, generatedAt=stamp, assets=assets)
        # Publish manifest first: a newly published catalogue must never point
        # to not-yet-verified bytes. Retained URLs remain valid for old pages.
        atomic(ROOT / 'manifest.json', json.dumps(manifest, indent=2) + '\n')
        safe_releases = [{k: r[k] for k in ('tag_name', 'draft', 'prerelease', 'published_at', 'assets')} for r in releases]
        atomic(ROOT / 'catalog.json', json.dumps(dict(releases=safe_releases), indent=2) + '\n')
        lines = ['<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Файлы SubVost VPN</title><link rel="stylesheet" href="/style.css"><main><h1>Файлы SubVost VPN</h1><p><a href="/">Выбрать сборку</a></p><p>Официальные файлы, скопированные без изменений. Размеры и SHA-256: <a href="/manifest.json">манифест</a>.</p>']
        for release in releases:
            lines.append('<h2>' + html.escape(release['tag_name']) + '</h2><ul>')
            for asset in assets:
                if asset['source'].startswith(SOURCE + release['tag_name'] + '/'):
                    lines.append('<li><a href="' + html.escape(asset['url'], quote=True) + '">' + html.escape(asset['url'].rsplit('/', 1)[-1]) + '</a></li>')
            lines.append('</ul>')
        lines.append('</main></html>')
        atomic(ROOT / 'files.html', '\n'.join(lines))
        atomic(STATE / 'last-success.json', json.dumps(dict(at=stamp, files=len(assets), bytes=total, tags=[r['tag_name'] for r in releases]), indent=2) + '\n')
        print('PUBLISHED', len(assets), 'assets,', total, 'bytes', flush=True)


if __name__ == '__main__':
    run()
