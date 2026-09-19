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
         'lib/catalog.mjs', 'lib/selection.mjs', 'lib/mirror.mjs', 'lib/source-menu.mjs')
LIMIT = 8 * 1024 * 1024


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
