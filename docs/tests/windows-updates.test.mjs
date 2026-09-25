import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCatalog, WINDOWS_RELEASE_CEILING } from '../lib/catalog.mjs';

test('rollback cannot be undone by newer live releases or cached catalogs', () => {
  assert.equal(WINDOWS_RELEASE_CEILING, '0.1.0-preview.27');
  const release = n => {
    const version=`0.1.0-preview.${n}`, tag=`windows-v${version}`;
    return {tag_name:tag,prerelease:true,assets:['x64','arm64','x86'].map(arch=>{
      const name=`SubVost-VPN-${version}-Windows-${arch}-Setup.exe`;
      return {name,size:1234,browser_download_url:`https://github.com/PystoyPlayer/subvost-vpn/releases/download/${tag}/${name}`};
    })};
  };
  for (const releases of [[release(30),release(29),release(28),release(27)], [release(27),release(30)]]) {
    const builds=buildCatalog(releases);
    assert.equal(builds.length,3);
    assert.ok(builds.every(b=>b.version===WINDOWS_RELEASE_CEILING));
  }
  assert.equal(buildCatalog([release(30)]).length,0);
});

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
