import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPublicKey, verify } from 'node:crypto';
import { buildCatalog, buildPublishedCatalog, selectBuild, WINDOWS_RELEASE_CEILING } from '../lib/catalog.mjs';
import { downloadSource } from '../lib/mirror.mjs';

test('verified publication survives a stale or unavailable mirror catalog for every CPU', async () => {
  const feed = JSON.parse(await readFile(new URL('../updates/windows-testing.json', import.meta.url)));
  const builds = buildPublishedCatalog([]);
  assert.equal(builds.length, 3);
  for (const asset of feed.assets) {
    const build = selectBuild(builds, { os: 'windows', arch: asset.rid.slice(4), variant: 'desktop' });
    assert.equal(build.version, feed.version);
    assert.equal(build.size, asset.size);
    assert.equal(build.sha256, asset.sha256);
    assert.equal(downloadSource(build, null).mirrored, false);
  }
  assert.throws(() => buildPublishedCatalog(null));
});

test('publication ceiling cannot be bypassed by newer diagnostic releases', () => {
  const ceiling = Number(WINDOWS_RELEASE_CEILING.split('.').at(-1));
  assert.ok(ceiling >= 4);
  const release = n => {
    const version=`0.2.0-preview.${n}`, tag=`windows-v${version}`;
    return {tag_name:tag,prerelease:true,assets:['x64','arm64','x86'].map(arch=>{
      const name=`SubVost-VPN-${version}-Windows-${arch}-Setup.exe`;
      return {name,size:1234,browser_download_url:`https://github.com/PystoyPlayer/subvost-vpn/releases/download/${tag}/${name}`};
    })};
  };
  for (const releases of [[release(ceiling+1),release(ceiling),release(2),release(1)], [release(ceiling),release(ceiling+1)]]) {
    const builds=buildCatalog(releases);
    assert.equal(builds.length,3);
    assert.ok(builds.every(b=>b.version===WINDOWS_RELEASE_CEILING));
  }
  assert.equal(buildCatalog([release(ceiling+10)]).length,0);
  const x64 = release(ceiling); x64.assets = x64.assets.filter(a => a.name.includes('-x64-'));
  const mixed = buildCatalog([release(ceiling+1), x64, release(1)]);
  assert.equal(mixed.find(b => b.arch === 'x64').version, WINDOWS_RELEASE_CEILING);
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

test('the application feed and website advertise identical Windows releases and bytes', async () => {
  const feed = JSON.parse(await readFile(new URL('../updates/windows-testing.json', import.meta.url)));
  const catalog = JSON.parse(await readFile(new URL('../catalog.json', import.meta.url)));
  assert.equal(feed.version, WINDOWS_RELEASE_CEILING, 'Do not publish only the website: old clients read this feed');
  const builds = buildPublishedCatalog(catalog.releases);
  for (const asset of feed.assets) {
    const build = selectBuild(builds, { os: 'windows', arch: asset.rid.slice(4), variant: 'desktop' });
    assert.equal(build?.version, feed.version);
    assert.equal(build?.url, asset.url);
    assert.equal(build?.size, asset.size);
    assert.equal(build?.sha256, asset.sha256);
  }
});

test('publisher signature authenticates every installer and its version, CPU, URL, size and digest', async () => {
  const feed = JSON.parse(await readFile(new URL('../updates/windows-testing.json', import.meta.url)));
  assert.equal(feed.keyId, 'subvost-p256-20261005');
  const key = createPublicKey({key: Buffer.from('MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEtrAwWwfbMv+3D28Bt06M0n8Nm1WNceTPrG+GYLdcALJbiCCFhVkIQlczhtE+LEyNetUJ7QMgFh6P9qq6o/aQ2Q==', 'base64'), format:'der', type:'spki'});
  const valid = (a, version=feed.version) => verify('sha256', Buffer.from(`subvost-release-v1\nwindows\n${version}\n${a.rid}\n${a.url}\n${a.size}\n${a.sha256}\n`, 'ascii'), key, Buffer.from(a.signature, 'base64'));
  for (const a of feed.assets) {
    assert.match(a.signature, /^[A-Za-z0-9+/]{80,110}={0,2}$/);
    assert.equal(valid(a), true);
    assert.equal(valid(a, '0.2.0-preview.999'), false);
    for (const change of [{rid:'win-other'}, {url:a.url+'-changed'}, {size:a.size+1}, {sha256:'0'.repeat(64)}]) assert.equal(valid({...a,...change}),false);
  }
});
