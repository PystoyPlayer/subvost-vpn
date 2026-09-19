import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadSource, MIRROR_ORIGIN } from '../lib/mirror.mjs';
const build = { url: 'https://github.com/PystoyPlayer/subvost-vpn/releases/download/v0.4.12/SubVost-VPN-macOS-arm64-0.4.12.dmg', size: 123, sha256: 'a'.repeat(64) };
const entry = { source: build.url, url: `${MIRROR_ORIGIN}/releases/v0.4.12/SubVost-VPN-macOS-arm64-0.4.12.dmg`, size: build.size, sha256: build.sha256 };
test('verified exact asset uses mirror, preserving the original build', () => {
  assert.deepEqual(downloadSource(build, { schema: 1, assets: [entry] }), { url: entry.url, mirrored: true });
  assert.ok(build.url.startsWith('https://github.com/'));
});
test('absent, incomplete and mismatched manifests fail back to GitHub', () => {
  for (const manifest of [null, {}, { schema: 1, assets: [] }, ...[
    { size: 124 }, { sha256: 'b'.repeat(64) }, { url: entry.url + '?redirect=1' },
    { url: entry.url.replace('download.subvost.fun', 'evil.test') }, { source: build.url + '.exe' },
  ].map(changes => ({ schema: 1, assets: [{ ...entry, ...changes }] }))]) {
    assert.deepEqual(downloadSource(build, manifest), { url: build.url, mirrored: false });
  }
});
test('traversal and lookalike sources cannot become mirror paths', () => {
  for (const url of [build.url.replace('/v0.4.12/', '/../'), build.url.replace('github.com/', 'github.com.evil/'), build.url + '#x']) {
    assert.equal(downloadSource({ ...build, url }, { schema: 1, assets: [{ ...entry, source: url }] }).mirrored, false);
  }
});
