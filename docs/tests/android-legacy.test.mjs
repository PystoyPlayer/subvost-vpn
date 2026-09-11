import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyAsset, buildCatalog, selectBuild} from '../lib/catalog.mjs';
import {choose,initialSelection} from '../lib/selection.mjs';
test('Android normal and Legacy are distinct, explicit downloads',()=>{
  const names=['SubVost-VPN-Android-0.1.0-beta.2.apk','SubVost-VPN-Android-Legacy-0.1.0-beta.2.apk'];
  const tag='android-v0.1.0-beta.2';
  const builds=buildCatalog([{tag_name:tag,prerelease:true,assets:names.map(name=>({name,size:100,browser_download_url:`https://github.com/PystoyPlayer/subvost-vpn/releases/download/${tag}/${name}`}))}]);
  assert.equal(builds.length,2);
  const normal=choose(initialSelection(),'os','android');
  assert.equal(selectBuild(builds,normal).name,names[0]);
  assert.equal(selectBuild(builds,choose(normal,'variant','legacy')).name,names[1]);
  assert.equal(selectBuild(builds.filter(b=>b.variant==='mobile'),choose(normal,'variant','legacy')),null);
  assert.equal(classifyAsset('SubVost-Android-Open-Source-0.1.0-beta.2.tar.gz'),null);
});
