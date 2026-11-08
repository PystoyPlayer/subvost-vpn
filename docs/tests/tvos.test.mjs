import test from 'node:test';
import assert from 'node:assert/strict';
import {initialSelection,choose,selectionComplete} from '../lib/selection.mjs';
test('Apple TV goes directly to system version, preserving independent iOS selection',()=>{
 let s=choose(initialSelection(),'os','tvos');
 assert.equal(s.arch,'universal');assert.equal(s.format,'testflight');assert.equal(selectionComplete(s),false);
 s=choose(s,'variant','mobile');assert.equal(selectionComplete(s),true);
 assert.deepEqual(choose(s,'os','tvos'),s);
 const ios=choose(s,'os','ios');assert.equal(ios.variant,null);
 const android=choose(s,'os','android');assert.equal(android.format,'apk');assert.equal(android.variant,null);
 assert.equal(selectionComplete(choose(s,'variant','unsupported')),true);
});
