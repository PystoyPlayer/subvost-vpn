import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('mirror', Path(__file__).with_name('sync-mirror.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class MirrorTests(unittest.TestCase):
    def test_windows_rollback_ceiling_does_not_affect_other_platforms(self):
        def release(tag,names):
            return dict(tag_name=tag,assets=[dict(name=name) for name in names])
        windows=[release(f'windows-v0.1.0-preview.{n}',[
            f'SubVost-VPN-0.1.0-preview.{n}-Windows-{arch}-Setup.exe' for arch in ('x64','arm64','x86')]) for n in (27,28,29,30)]
        others=[release('v0.4.20',['SubVost-VPN-macOS-arm64-0.4.20.dmg']),
                release('linux-v0.5.20',['SubVost-VPN-Linux-x86_64-0.5.20.deb']),
                release('android-v0.1.0-beta.99',['SubVost-VPN-Android-0.1.0-beta.99.apk'])]
        selected=m.choose_releases(windows+others)
        self.assertEqual({r['tag_name'] for r in selected},{r['tag_name'] for r in others}|{'windows-v0.1.0-preview.27'})

    def test_semver(self):
        self.assertGreater(m.compare('android-v0.1.0-beta.10', 'android-v0.1.0-beta.9'), 0)
        self.assertGreater(m.compare('v1.0.0', 'v1.0.0-rc.1'), 0)
        self.assertGreater(m.compare('v0.4.12', 'v0.4.5'), 0)
        self.assertIsNone(m.version('../bad'))

    def test_slots(self):
        for name, osname in [
            ('SubVost-VPN-macOS-Legacy-arm64-0.4.12.dmg', 'macos'),
            ('SubVost-VPN-Android-Legacy-0.1.0-beta.6.apk', 'android'),
            ('SubVost-VPN-0.1.0-preview.21-Windows-x86-Setup.exe', 'windows'),
            ('SubVost-VPN-Linux-x86_64-0.5.12.pkg.tar.zst', 'linux'),
        ]:
            self.assertEqual(m.slot({'name': name})[0][0], osname)
        self.assertIsNone(m.slot({'name': 'SubVost-VPN-macOS-arm64-0.4.12.dmg.exe'}))

    def test_incomplete_catalog_keeps_old_publication(self):
        with self.assertRaises(ValueError):
            m.choose_releases([])

    def test_source_and_integrity_required(self):
        a = dict(name='test.dmg', size=123, digest='sha256:' + 'a' * 64,
                 browser_download_url=m.SOURCE + 'v1.0.0/test.dmg')
        self.assertEqual(m.validate_asset('v1.0.0', a)[1:], (123, 'a' * 64))
        for changes in [dict(name='../test.dmg'), dict(size=True), dict(size=-1), dict(digest=None),
                        dict(digest=''), dict(browser_download_url='https://evil.test/test.dmg')]:
            with self.assertRaises((TypeError, ValueError)):
                m.validate_asset('v1.0.0', dict(a, **changes))

    def test_existing_bytes_not_silently_overwritten(self):
        with tempfile.TemporaryDirectory() as d, patch.object(m, 'ROOT', Path(d)):
            target = Path(d) / 'releases/v1.0.0/test.dmg'
            target.parent.mkdir(parents=True)
            target.write_bytes(b'bad')
            a = dict(name='test.dmg', size=3, digest='sha256:' + 'a' * 64,
                     browser_download_url=m.SOURCE + 'v1.0.0/test.dmg')
            with self.assertRaises(ValueError), patch.object(m.subprocess, 'run') as runner:
                m.download(('v1.0.0', a))
            runner.assert_not_called()
            self.assertEqual(target.read_bytes(), b'bad')

    def test_failed_download_never_becomes_public(self):
        with tempfile.TemporaryDirectory() as d, patch.object(m, 'ROOT', Path(d) / 'www'), patch.object(m, 'STATE', Path(d)):
            a = dict(name='test.dmg', size=3, digest='sha256:' + 'a' * 64,
                     browser_download_url=m.SOURCE + 'v1.0.0/test.dmg')
            with patch.object(m.subprocess, 'run', side_effect=RuntimeError('interrupted')):
                with self.assertRaises(RuntimeError):
                    m.download(('v1.0.0', a))
            self.assertFalse((m.ROOT / 'releases/v1.0.0/test.dmg').exists())
            self.assertEqual(list(m.ROOT.rglob('asset-*')), [])


if __name__ == '__main__':
    unittest.main()
