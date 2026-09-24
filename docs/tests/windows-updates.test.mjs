import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Windows update feeds agree and provide a matching installer for every supported CPU', async () => {
  const feed = JSON.parse(await readFile(new URL('../updates/windows-testing.json', import.meta.url)));
  const root = JSON.parse(await readFile(new URL('../../updates/windows-testing.json', import.meta.url)));
  assert.deepEqual(feed, root);
  assert.equal(feed.schema, 1);
  assert.equal(feed.platform, 'windows');
  assert.equal(feed.channel, 'testing');
  assert.match(feed.version, /^\d+\.\d+\.\d+-preview\.\d+$/);
  assert.deepEqual(feed.assets.map(a => a.rid).sort(), ['win-arm64', 'win-x64', 'win-x86']);
  for (const asset of feed.assets) {
    assert.equal(asset.url, `https://github.com/PystoyPlayer/subvost-vpn/releases/download/windows-v${feed.version}/SubVost-VPN-${feed.version}-Windows-${asset.rid.slice(4)}-Setup.exe`);
    assert.ok(Number.isSafeInteger(asset.size) && asset.size > 1000000 && asset.size <= 300 * 1024 * 1024);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  }
  assert.ok(feed.notes.ru && feed.notes.en);
});
