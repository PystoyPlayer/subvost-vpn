import hashlib
import importlib.util
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
        digest = hashlib.sha1(b'blob ' + str(len(self.data)).encode() + b'\0' + self.data).hexdigest()
        self.entries = [dict(path='docs/' + name, type='blob', mode='100644', sha=digest)
                        for name in site.FILES]
        self.sha = 'a' * 40

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
        site.publish(self.root, self.sha, self.entries, lambda _: self.data)
        self.assertEqual((self.root / 'current/index.html').read_bytes(), self.data)
        self.assertEqual(len(list((self.root / 'current').rglob('*.*'))), len(site.FILES))
        self.assertFalse((self.root / 'current/manifest.json').exists())

    def test_failed_download_preserves_previous(self):
        site.publish(self.root, self.sha, self.entries, lambda _: self.data)
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
            site.publish(self.root, letter * 40, self.entries, lambda _: self.data)
        self.assertEqual(len(list((self.root / 'revisions').iterdir())), 3)
        self.assertEqual((self.root / 'current').readlink(), Path('revisions/' + 'd' * 40))


if __name__ == '__main__':
    unittest.main()
