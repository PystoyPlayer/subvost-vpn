import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, classifyAsset, compareVersions, RELEASES_URL, selectBuild, reconcileLinuxFormat } from '../lib/catalog.mjs';

function release(version, names, extra = {}) {
  return { tag_name: `v${version}`, draft: false, prerelease: false, assets: names.map(name => ({ name, size: 123, browser_download_url: `${RELEASES_URL}/download/v${version}/${name}` })), ...extra };
}
const mac = (version, arch = 'arm64', legacy = false) => `SubVost-VPN-macOS-${legacy ? 'Legacy-' : ''}${arch}-${version}.dmg`;
test('Android alpha APK is explicit; a stable unified tag can serve all platforms', () => {
  const tag = 'android-v0.1.0-alpha.1', name = 'SubVost-VPN-Android-0.1.0-alpha.1.apk';
  const input = { tag_name: tag, prerelease: true, assets: [{ name, size: 123, browser_download_url: `${RELEASES_URL}/download/${tag}/${name}` }] };
  const [apk] = buildCatalog([input]);
  assert.equal(apk.os, 'android'); assert.equal(apk.arch, 'universal'); assert.equal(apk.prerelease, true);
  assert.equal(classifyAsset(name + '.bak'), null);
  assert.equal(buildCatalog([{ ...input, draft: true }]).length, 0);
  const unified = buildCatalog([input, release('1.0.0', [mac('1.0.0'), 'SubVost-VPN-Linux-arm64-1.0.0.deb', 'SubVost-VPN-1.0.0-Windows-x64-Setup.exe', 'SubVost-VPN-Android-1.0.0.apk'])]);
  assert.equal(unified.length, 4);
  assert.ok(unified.every(b => b.version === '1.0.0' && !b.prerelease));
});
test('SemVer prerelease order and build metadata do not depend on tag prefixes', () => {
  const sequence = ['1.0.0-alpha.1', '1.0.0-alpha.2', '1.0.0-alpha.10', '1.0.0-beta.1', '1.0.0-rc.1', '1.0.0', '1.0.1'];
  for (let i = 1; i < sequence.length; i++) assert.ok(compareVersions(sequence[i], sequence[i - 1]) > 0);
  assert.equal(compareVersions('android-v1.0.0+2', 'v1.0.0+1'), 0);
  for (const bad of ['1.0.0-alpha.01', '01.0.0', '1.0.0-', '1.0.0.exe']) assert.throws(() => compareVersions(bad, '1.0.0'));
});
test('Windows chooses newest same-architecture EXE, with portable fallback only when needed', () => {
  const build = (version, format, arch = 'x64') => ({ os: 'windows', variant: 'desktop', arch, version, format });
  const state = { os: 'windows', variant: 'desktop', arch: 'x64', format: 'zip' };
  const exe = build('0.1.0-preview.12', 'exe'), zip = build('0.1.0-preview.12', 'zip');
  assert.equal(selectBuild([zip, exe], state), exe);
  assert.equal(selectBuild([exe, zip], state), exe);
  const newer = build('0.1.0-preview.13', 'zip');
  assert.equal(selectBuild([exe, newer], state), newer);
  assert.equal(selectBuild([exe], { ...state, arch: 'arm64' }), null);
  assert.equal(classifyAsset('SubVost-VPN-0.1.0-preview.12-Windows-x64-Setup.exe').format, 'exe');
  assert.equal(classifyAsset('SubVost-VPN-0.1.0-preview.12-Windows-x64-Setup.exe.bak'), null);
});
test('Windows previews are explicit, architecture-specific, and numerically ordered', () => {
  const preview = number => {
    const version = `0.1.0-preview.${number}`, tag = `windows-v${version}`;
    return { tag_name: tag, prerelease: true, assets: ['x64', 'arm64', 'x86'].map(arch => {
      const name = `SubVost-VPN-Windows-${version}-win-${arch}.zip`;
      return { name, size: 123, browser_download_url: `${RELEASES_URL}/download/${tag}/${name}` };
    }) };
  };
  const catalog = buildCatalog([preview(2), preview(10), preview(1)]);
  assert.equal(catalog.length, 3);
  assert.ok(catalog.every(b => b.version === '0.1.0-preview.10' && b.prerelease));
  assert.equal(buildCatalog([{ ...preview(1), draft: true }]).length, 0);
  assert.ok(compareVersions('0.1.0', '0.1.0-preview.10') > 0);
});
test('version comparison is numeric and allows 0.4', () => {
  assert.ok(compareVersions('0.4.10', '0.4.2') > 0);
  assert.equal(compareVersions('v0.4', '0.4.0'), 0);
});
test('platform tags coexist with old tags without mixing OS assets', () => {
  const name = 'SubVost-VPN-Linux-arm64-0.6.0.deb';
  const tagged = { tag_name: 'linux-v0.6.0', assets: [{ name, size: 123, browser_download_url: `${RELEASES_URL}/download/linux-v0.6.0/${name}` }] };
  const catalog = buildCatalog([tagged, release('0.4.4', [mac('0.4.4')])]);
  assert.equal(catalog.length, 2);
  assert.equal(catalog.find(b => b.os === 'linux').version, '0.6.0');
  assert.equal(buildCatalog([{...tagged, tag_name:'macos-v0.6.0'}]).length, 0);
});
test('four mac variants remain separate', () => {
  const catalog = buildCatalog([release('0.4.2', ['arm64', 'x86_64'].flatMap(arch => [mac('0.4.2', arch), mac('0.4.2', arch, true)]))]);
  assert.equal(catalog.length, 4);
  assert.ok(selectBuild(catalog, { os: 'macos', arch: 'x86_64', variant: 'legacy', format: 'dmg' }).name.includes('Legacy-x86_64'));
});
test('latest is selected per platform, not globally', () => {
  const catalog = buildCatalog([release('0.5.0', ['SubVost-VPN-Linux-arm64-0.5.0.tar.gz']), release('0.4.2', [mac('0.4.2')]), release('0.4.1', [mac('0.4.1')])]);
  assert.equal(catalog.length, 2);
  assert.equal(catalog.find(b => b.os === 'macos').version, '0.4.2');
});
test('draft, prerelease, wrong version and source archives never become downloads', () => {
  const catalog = buildCatalog([release('0.4.2', [mac('0.4.2')], { draft: true }), release('0.4.2', [mac('0.4.2')], { prerelease: true }), release('0.4.2', [mac('0.4.1'), 'source.zip', 'credentials.json'])]);
  assert.deepEqual(catalog, []);
});
test('external and lookalike repository URLs are rejected', () => {
  const input = release('0.4.2', [mac('0.4.2')]);
  input.assets[0].browser_download_url += '?redirect=https://evil.example';
  assert.deepEqual(buildCatalog([input]), []);
});
test('unsupported choices do not fall back to a different architecture', () => {
  const catalog = buildCatalog([release('0.4.2', [mac('0.4.2')])]);
  assert.equal(selectBuild(catalog, { os: 'linux', arch: 'x86_64', variant: 'glibc', format: 'AppImage' }), null);
});
test('Linux formats and libc families are explicit', () => {
  for (const format of ['AppImage', 'deb', 'rpm', 'tar.gz', 'tar.xz', 'pkg.tar.zst', 'flatpak', 'snap']) {
    assert.equal(classifyAsset(`SubVost-VPN-Linux-x86_64-0.5.0.${format}`).format, format);
  }
  assert.equal(classifyAsset('SubVost-VPN-Linux-arm64-0.5.0-musl.tar.gz').variant, 'musl');
  assert.equal(classifyAsset('SubVost-VPN-Linux-riscv64-0.5.0.tar.gz'), null);
});
test('late catalog with only DEB reconciles pending Linux choice', () => {
  const pending = { os: 'linux', arch: 'x86_64', variant: 'glibc', format: 'AppImage' };
  assert.equal(reconcileLinuxFormat([], pending), pending);
  const catalog = buildCatalog([release('0.5.0', ['SubVost-VPN-Linux-x86_64-0.5.0.deb'])]);
  const loaded = reconcileLinuxFormat(catalog, pending);
  assert.equal(loaded.format, 'deb');
  assert.ok(selectBuild(catalog, loaded));
});
