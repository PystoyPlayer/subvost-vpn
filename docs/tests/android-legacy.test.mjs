import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyAsset, buildCatalog, selectBuild} from '../lib/catalog.mjs';
import {choose,initialSelection} from '../lib/selection.mjs';
import {readFileSync} from 'node:fs';
test('Android normal and Legacy are distinct, explicit downloads',()=>{
  const names=['SubVost-VPN-Android-0.1.0-beta.2.apk','SubVost-VPN-Android-Legacy-0.1.0-beta.2.apk'];
  const tag='android-v0.1.0-beta.2';
  const builds=buildCatalog([{tag_name:tag,prerelease:true,assets:names.map(name=>({name,size:100,browser_download_url:`https://github.com/PystoyPlayer/subvost-vpn/releases/download/${tag}/${name}`}))}]);
  assert.equal(builds.length,2);
  const pending=choose(initialSelection(),'os','android');
  assert.equal(selectBuild(builds,pending),null);
  const normal=choose(pending,'variant','mobile');
  assert.equal(selectBuild(builds,normal).name,names[0]);
  assert.equal(selectBuild(builds,choose(normal,'variant','legacy')).name,names[1]);
  assert.equal(selectBuild(builds.filter(b=>b.variant==='mobile'),choose(normal,'variant','legacy')),null);
  assert.equal(classifyAsset('SubVost-Android-Open-Source-0.1.0-beta.2.tar.gz'),null);
});
test('Android install help separates same-signer updates from conditional old-beta migration',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../app.mjs',import.meta.url),'utf8');
  const help=html.match(/<div id="android-install-conflict" hidden>([\s\S]*?)<\/div>/)?.[1];
  assert.ok(help);
  for(const text of ['не всегда означает проблему с подписью','версия 1.0.0 или новее','рассчитаны на обновление без удаления','не удаляйте приложение','сохраните ссылку подписки','новое место в лимите устройств','Удаление стирает локальные настройки','сначала обратитесь в поддержку']) assert.ok(help.includes(text),text);
  assert.match(app,/\$\('android-install-conflict'\)\.hidden = !\(build && state\.os === 'android'\)/);
  assert.doesNotMatch(app,/При обновлении не удаляйте приложение — подписка сохранится|удалите прежнее устройство/);
  assert.doesNotMatch(help,/завтра|утром|ошибка исправлена|удалите прежнее устройство/);
});
