import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('mirror', Path(__file__).with_name('sync-mirror.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class MirrorTests(unittest.TestCase):
    def alias_assets(self):
        releases = json.loads((Path(__file__).parent.parent / 'docs' / 'catalog.json').read_text())['releases']
        assets = []
        for release in m.choose_releases(releases):
            for asset in release['assets']:
                if m.slot(asset):
                    payload = asset['name'].encode()
                    path = release['tag_name'] + '/' + asset['name']
                    assets.append(dict(url=m.ORIGIN + '/releases/' + path, source=m.SOURCE + path,
                                       size=len(payload), sha256=hashlib.sha256(payload).hexdigest()))
        return assets

    def seed_alias_assets(self, root, assets):
        for asset in assets:
            path = root / asset['url'][len(m.ORIGIN) + 1:]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(path.name.encode())

    def test_subscription_page_alias_contract_all_platforms(self):
        aliases = m.select_aliases(self.alias_assets())
        self.assertEqual(set(aliases), m.REQUIRED_ALIASES)
        self.assertEqual(len(aliases), 19)
        self.assertTrue(aliases['SubVost-VPN-Android.apk']['url'].endswith('SubVost-VPN-Android-1.0.19.apk'))
        self.assertTrue(aliases['SubVost-VPN-Android-Legacy.apk']['url'].endswith('SubVost-VPN-Android-Legacy-0.2.0-beta.9.apk'))
        self.assertTrue(aliases['SubVost-VPN-Windows-x64-Setup.exe']['url'].endswith('SubVost-VPN-1.0.4-Windows-x64-Setup.exe'))
        self.assertTrue(aliases['SubVost-VPN-macOS-arm64.dmg']['url'].endswith('-1.0.16.dmg'))
        self.assertTrue(aliases['SubVost-VPN-Linux-arm64.deb']['url'].endswith('-1.0.4.deb'))
        self.assertEqual(aliases, m.select_aliases(list(reversed(self.alias_assets()))))

    def test_alias_publication_resolves_exact_bytes_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as d:
            root, assets = Path(d), self.alias_assets()
            self.seed_alias_assets(root, assets)
            result = m.publish_aliases(root, assets)
            self.assertEqual(result['aliases'], 19)
            self.assertEqual(result, m.publish_aliases(root, assets))
            for name, asset in m.select_aliases(assets).items():
                self.assertEqual(m.digest(root / 'get' / name), asset['sha256'])
                self.assertEqual((root / 'get' / name).stat().st_size, asset['size'])

    def test_alias_failure_retains_previous_pointer_and_old_files(self):
        with tempfile.TemporaryDirectory() as d:
            root, assets = Path(d), self.alias_assets()
            self.seed_alias_assets(root, assets)
            m.publish_aliases(root, assets)
            before = (root / 'get').readlink()
            old_files = {str(p) for p in (root / 'releases').rglob('*') if p.is_file()}
            incomplete = [a for a in assets if not a['url'].endswith('.rpm')]
            with self.assertRaisesRegex(ValueError, 'Incomplete'):
                m.publish_aliases(root, incomplete)
            corrupt = dict(assets[0], sha256='a' * 64)
            with self.assertRaisesRegex(ValueError, 'unverified'):
                m.publish_aliases(root, [corrupt] + assets[1:])
            self.assertEqual((root / 'get').readlink(), before)
            self.assertEqual({str(p) for p in (root / 'releases').rglob('*') if p.is_file()}, old_files)

    def test_alias_targets_cannot_escape_mirror_or_change_origin(self):
        assets = self.alias_assets()
        for changes in (dict(url='https://other.invalid/file.apk'),
                        dict(source='https://other.invalid/file.apk'),
                        dict(url=m.ORIGIN + '/releases/../../etc/passwd'),
                        dict(sha256='invalid')):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                m.select_aliases([dict(assets[0], **changes)] + assets[1:])

    def test_alias_pointer_collision_does_not_remove_unrelated_state(self):
        with tempfile.TemporaryDirectory() as d:
            root, assets = Path(d), self.alias_assets()
            self.seed_alias_assets(root, assets)
            (root / '.get-next').write_text('retained')
            with self.assertRaisesRegex(ValueError, 'Reconcile'):
                m.publish_aliases(root, assets)
            self.assertEqual((root / '.get-next').read_text(), 'retained')
            self.assertFalse((root / 'get').exists())

    def test_android57_retains_old_releases_without_weakening_reserves(self):
        # Measured 2026-10-16 after the immutable Android57 assets were seeded.
        # The retained set crossed 19 GiB, not the independent free-space guard.
        self.assertEqual(m.LIMIT, 20 * 1024**3)
        self.assertEqual(m.FREE_RESERVE, 8 * 1024**3)
        self.assertEqual(m.CURRENT_SET_LIMIT, 4 * 1024**3)
        retained, free = 20472429275, 10231066624
        self.assertGreater(retained, 19 * 1024**3)
        m.check_disk_budget(m.CURRENT_SET_LIMIT, retained, 0, free)
        with self.assertRaisesRegex(ValueError, 'free-space reserve'):
            m.check_disk_budget(1, retained, 0, m.FREE_RESERVE - 1)

    def test_qualified_set_fits_without_removing_old_versions(self):
        # Measured RU mirror accounting on 2026-10-05: latest set 1.5 GiB,
        # retained immutable versions 11.86 GiB, free 18.89 GiB.
        m.check_disk_budget(1613917867, 12733729199, 1613917867, 18 * 1024**3)

    def test_disk_limits_are_independent_and_inclusive(self):
        m.check_disk_budget(m.CURRENT_SET_LIMIT, m.LIMIT - 10, 10, m.FREE_RESERVE + 10)
        for values in ((m.CURRENT_SET_LIMIT + 1, 0, 0, m.FREE_RESERVE),
                       (1, m.LIMIT, 1, m.FREE_RESERVE + 1),
                       (1, 0, 1, m.FREE_RESERVE),
                       (-1, 0, 0, m.FREE_RESERVE),
                       (True, 0, 0, m.FREE_RESERVE)):
            with self.subTest(values=values), self.assertRaises(ValueError):
                m.check_disk_budget(*values)

    def test_windows_ceiling_matches_published_update_feed(self):
        feed = Path(__file__).parent.parent / 'updates' / 'windows-testing.json'
        self.assertEqual(m.WINDOWS_RELEASE_CEILING, json.loads(feed.read_text())['version'])

    def test_windows_publication_ceiling_does_not_affect_other_platforms(self):
        def release(tag,names):
            return dict(tag_name=tag,assets=[dict(name=name) for name in names])
        windows=[release(f'windows-v{version}',[
            f'SubVost-VPN-{version}-Windows-{arch}-Setup.exe' for arch in ('x64','arm64','x86')])
            for version in ('0.2.0-preview.6','1.0.4','1.0.5','1.1.0-preview.1')]
        others=[release('v0.4.20',['SubVost-VPN-macOS-arm64-0.4.20.dmg']),
                release('linux-v0.5.20',['SubVost-VPN-Linux-x86_64-0.5.20.deb']),
                release('android-v0.1.0-beta.99',['SubVost-VPN-Android-0.1.0-beta.99.apk'])]
        selected=m.choose_releases(windows+others)
        self.assertEqual({r['tag_name'] for r in selected},{r['tag_name'] for r in others}|{'windows-v1.0.4'})
        windows[1]['assets'] = [a for a in windows[1]['assets'] if '-x64-' in a['name']]
        selected=m.choose_releases(windows+others)
        self.assertEqual({r['tag_name'] for r in selected},{r['tag_name'] for r in others}|{'windows-v0.2.0-preview.6','windows-v1.0.4'})

    def test_semver(self):
        self.assertGreater(m.compare('android-v0.1.0-beta.10', 'android-v0.1.0-beta.9'), 0)
        self.assertGreater(m.compare('v1.0.0', 'v1.0.0-rc.1'), 0)
        self.assertGreater(m.compare('v0.4.12', 'v0.4.5'), 0)
        self.assertIsNone(m.version('../bad'))

    def test_ne_releases_are_withdrawn_without_affecting_other_platforms(self):
        releases=json.loads((Path(__file__).parent.parent/'catalog.json').read_text())['releases']
        selected=m.choose_releases(releases)
        mac_assets=[a for r in selected for a in r['assets'] if (m.slot(a) or ((None,),))[0][0]=='macos']
        self.assertEqual(len({m.slot(a)[0] for a in mac_assets}),4)
        self.assertTrue(all(a['name'].endswith(('-0.4.26.dmg','-1.0.16.dmg')) for a in mac_assets))
        self.assertTrue(all(not any(a['name'].endswith('-'+v+'.dmg') for v in m.WITHDRAWN_MACOS_VERSIONS) for a in mac_assets))
        self.assertEqual(m.MACOS_RELEASE_CEILING,'1.0.16')

    def test_mac_ceiling_rejects_unqualified_future_without_changing_other_slots(self):
        releases=json.loads((Path(__file__).parent.parent/'catalog.json').read_text())['releases']
        before=m.choose_releases(releases)
        future=dict(tag_name='macos-v1.0.17',assets=[dict(name='SubVost-VPN-macOS-'+arch+'-1.0.17.dmg') for arch in ('arm64','x86_64')])
        selected=m.choose_releases(releases+[future])
        self.assertEqual({r['tag_name'] for r in selected},{r['tag_name'] for r in before})
        self.assertNotIn('macos-v1.0.17',{r['tag_name'] for r in selected})

    def test_helper_successor_and_missing_cpu_ne_fallback(self):
        releases=json.loads((Path(__file__).parent.parent/'catalog.json').read_text())['releases']
        releases=[r for r in releases if r['tag_name']!='macos-v1.0.16']
        releases += [dict(tag_name='macos-v1.0.16',assets=[dict(name='SubVost-VPN-macOS-arm64-1.0.16.dmg')])]
        selected=m.choose_releases(releases)
        self.assertIn('macos-v1.0.16',{r['tag_name'] for r in selected})
        self.assertIn('macos-v1.0.13',{r['tag_name'] for r in selected})
        self.assertFalse(any(r['tag_name'] in {'macos-v'+v for v in m.WITHDRAWN_MACOS_VERSIONS} for r in selected))
        self.assertIn('v0.4.26',{r['tag_name'] for r in selected})

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
