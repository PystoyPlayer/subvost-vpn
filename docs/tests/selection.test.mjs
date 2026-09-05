import test from 'node:test';
import assert from 'node:assert/strict';
import { initialSelection, choose, selectionComplete } from '../lib/selection.mjs';

test('first visit has no implicit OS or CPU choice', () => {
  assert.deepEqual(initialSelection(), { os: null, arch: null, variant: null, format: null });
  assert.equal(selectionComplete(initialSelection()), false);
});
test('Mac requires explicit CPU and OS compatibility confirmation', () => {
  let state = choose(initialSelection(), 'os', 'macos');
  assert.equal(selectionComplete(state), false);
  state = choose(state, 'arch', 'x86_64');
  assert.equal(selectionComplete(state), false);
  state = choose(state, 'variant', 'legacy');
  assert.equal(selectionComplete(state), true);
  assert.equal(choose(state, 'arch', 'arm64').variant, null);
});
test('changing OS clears the old download selection', () => {
  const state = choose({ os: 'macos', arch: 'arm64', variant: 'legacy', format: 'dmg' }, 'os', 'linux');
  assert.deepEqual(state, { os: 'linux', arch: null, variant: 'glibc', format: null });
  assert.equal(selectionComplete(state), false);
});
test('Linux requires explicit format and resets it when CPU changes', () => {
  let state = choose(choose(initialSelection(), 'os', 'linux'), 'arch', 'arm64');
  assert.equal(selectionComplete(state), false);
  state = choose(state, 'format', 'deb');
  assert.equal(selectionComplete(state), true);
  assert.equal(choose(state, 'arch', 'x86_64').format, null);
});
