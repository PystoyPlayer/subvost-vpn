import hashlib
import importlib.util
import json
import tempfile
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('site_sync', Path(__file__).with_name('sync-site.py'))
site = importlib.util.module_from_spec(spec)
spec.loader.exec_module(site)


class SiteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = b'checked static fixture'
        self.feed = dict(schema=1, platform='android', channel='stable', version='1.0.1', build=41,
                         minSdk=23, size=123, sha256='a'*64,
                         url='https://github.com/PystoyPlayer/subvost-vpn/releases/download/android-v1.0.1/SubVost-VPN-Android-1.0.1.apk')
        self.feed_data = json.dumps(self.feed).encode()
        def digest(data):return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
        self.entries = [dict(path='docs/' + name, type='blob', mode='100644', sha=digest(self.download(name)))
                        for name in site.FILES]
        self.sha = 'a' * 40

    def download(self, name):
        return self.feed_data if name == 'updates/android-testing.json' else self.data

    def test_exact_successful_main_push_required(self):
        run = dict(head_sha=self.sha, head_branch='main', event='push', status='completed',
                   conclusion='success', path='.github/workflows/site-checks.yml')
        self.assertTrue(site.checked([run], self.sha))
        for field, value in [('head_sha', 'b' * 40), ('head_branch', 'feature'),
                             ('event', 'pull_request'), ('status', 'in_progress'),
                             ('conclusion', 'failure'), ('path', 'other.yml')]:
            self.assertFalse(site.checked([dict(run, **{field: value})], self.sha))
        self.assertFalse(site.checked([], self.sha))

    def test_complete_atomic_publication(self):
        site.publish(self.root, self.sha, self.entries, self.download)
        self.assertEqual((self.root / 'current/index.html').read_bytes(), self.data)
        self.assertEqual(len(list((self.root / 'current').rglob('*.*'))), len(site.FILES))
        self.assertFalse((self.root / 'current/manifest.json').exists())
        self.assertEqual((self.root / 'current/updates/android-testing.json').read_bytes(), self.feed_data)
        self.assertFalse((self.root / 'current/updates/android-legacy-testing.json').exists())
        self.assertFalse((self.root / 'current/updates/windows-testing.json').exists())

    def test_failed_download_preserves_previous(self):
        site.publish(self.root, self.sha, self.entries, self.download)
        def fail(_):
            raise OSError('network unavailable')
        with self.assertRaises(OSError):
            site.publish(self.root, 'b' * 40, self.entries, fail)
        self.assertEqual((self.root / 'current').readlink(), Path('revisions/' + self.sha))
        self.assertFalse(list(self.root.glob('.staging-*')))

    def test_invalid_snapshot_never_published(self):
        for entries, data in [(self.entries[:-1], self.data),
                              ([dict(e, mode='120000') for e in self.entries], self.data),
                              (self.entries, b'bad'), (self.entries, b'x' * (site.LIMIT + 1))]:
            with self.assertRaises(ValueError):
                site.publish(self.root, self.sha, entries, lambda _: data)
            self.assertFalse((self.root / 'current').exists())

    def test_invalid_revision_rejected(self):
        with self.assertRaises(ValueError):
            site.publish(self.root, '../escape', self.entries, lambda _: self.data)

    def test_retains_three_snapshots(self):
        for letter in 'abcd':
            site.publish(self.root, letter * 40, self.entries, self.download)
        self.assertEqual(len(list((self.root / 'revisions').iterdir())), 3)
        self.assertEqual((self.root / 'current').readlink(), Path('revisions/' + 'd' * 40))

    def test_modern_feed_validation(self):
        site.validate_android_feed(self.feed_data)
        for key, value in [('platform','ios'),('schema',2),('channel','legacy'),('minSdk',22),
                           ('build',0),('build',True),('size',250000001),('sha256','wrong'),
                           ('url',self.feed['url']+'?unexpected=1'),('url',self.feed['url'].replace('github.com','evil.test'))]:
            with self.assertRaises(ValueError):site.validate_android_feed(json.dumps(dict(self.feed,**{key:value})).encode())
        with self.assertRaises(ValueError):site.validate_android_feed(b' '*65537)

    def test_invalid_feed_preserves_live_revision(self):
        site.publish(self.root,self.sha,self.entries,self.download)
        bad=json.dumps(dict(self.feed,minSdk=22)).encode()
        digest=hashlib.sha1(b'blob '+str(len(bad)).encode()+b'\0'+bad).hexdigest()
        entries=[dict(e,sha=digest) if e['path']=='docs/updates/android-testing.json' else e for e in self.entries]
        with self.assertRaises(ValueError):site.publish(self.root,'b'*40,entries,lambda n:bad if n=='updates/android-testing.json' else self.data)
        self.assertEqual((self.root/'current').readlink(),Path('revisions/'+self.sha))
        self.assertEqual((self.root/'current/updates/android-testing.json').read_bytes(),self.feed_data)
        self.assertFalse(list(self.root.glob('.staging-*')))

    def test_exact_modern_route_not_directory_exposure(self):
        config=Path(__file__).with_name('subvost-downloads.nginx.conf').read_text()
        self.assertEqual(config.count('location = /updates/android-testing.json {'),1)
        self.assertIn('location ^~ /updates/ { return 404; }',config)
        self.assertNotIn('location = /updates/android-legacy-testing.json',config)


if __name__ == '__main__':
    unittest.main()
