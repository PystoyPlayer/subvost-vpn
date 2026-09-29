import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCatalog, buildPublishedCatalog, selectBuild, WINDOWS_RELEASE_CEILING } from '../lib/catalog.mjs';
import { downloadSource } from '../lib/mirror.mjs';

test('verified x64 publication survives a stale or unavailable mirror catalog', () => {
  const builds = buildPublishedCatalog([]);
  assert.equal(builds.length, 1);
  const build = selectBuild(builds, { os: 'windows', arch: 'x64', variant: 'desktop' });
  assert.equal(build.version, '0.2.0-preview.3');
  assert.equal(build.size, 56807107);
  assert.equal(build.sha256, '245b42ba7bee2ff3c3937e25d4740e2c25138f38519da820a1d67676c270b238');
  assert.equal(downloadSource(build, null).mirrored, false);
  assert.equal(selectBuild(builds, { os: 'windows', arch: 'arm64', variant: 'desktop' }), null);
  assert.throws(() => buildPublishedCatalog(null));
});

test('publication ceiling cannot be bypassed by newer diagnostic releases', () => {
  assert.equal(WINDOWS_RELEASE_CEILING, '0.2.0-preview.3');
  const release = n => {
    const version=`0.2.0-preview.${n}`, tag=`windows-v${version}`;
    return {tag_name:tag,prerelease:true,assets:['x64','arm64','x86'].map(arch=>{
      const name=`SubVost-VPN-${version}-Windows-${arch}-Setup.exe`;
      return {name,size:1234,browser_download_url:`https://github.com/PystoyPlayer/subvost-vpn/releases/download/${tag}/${name}`};
    })};
  };
  for (const releases of [[release(4),release(3),release(2),release(1)], [release(3),release(4)]]) {
    const builds=buildCatalog(releases);
    assert.equal(builds.length,3);
    assert.ok(builds.every(b=>b.version===WINDOWS_RELEASE_CEILING));
  }
  assert.equal(buildCatalog([release(30)]).length,0);
  const x64 = release(3); x64.assets = x64.assets.filter(a => a.name.includes('-x64-'));
  const mixed = buildCatalog([release(4), x64, release(1)]);
  assert.equal(mixed.find(b => b.arch === 'x64').version, '0.2.0-preview.3');
  for (const arch of ['arm64', 'x86']) assert.equal(mixed.find(b => b.arch === arch).version, '0.2.0-preview.1');
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
