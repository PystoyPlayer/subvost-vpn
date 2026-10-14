import test from 'node:test';
import assert from 'node:assert/strict';
import { initialSelection, choose, selectionComplete } from '../lib/selection.mjs';

test('Android requires an explicit system version, without asking for a CPU', () => {
  const state = choose(initialSelection(), 'os', 'android');
  assert.equal(selectionComplete(state), false);
  assert.deepEqual(state, { os: 'android', arch: 'universal', variant: null, format: 'apk' });
  assert.equal(selectionComplete(choose(state, 'variant', 'mobile')), true);
  assert.equal(selectionComplete(choose(state, 'variant', 'legacy')), true);
  assert.equal(choose(state, 'os', 'windows').arch, null);
  assert.equal(choose(state, 'os', 'linux').format, null);
});

test('Android preserves explicit choices within the same OS but resets after switching away', () => {
  for (const variant of ['mobile', 'legacy']) {
    const explicit = choose(choose(initialSelection(), 'os', 'android'), 'variant', variant);
    assert.deepEqual(choose(explicit, 'os', 'android'), explicit);
    assert.equal(choose(choose(explicit, 'os', 'ios'), 'os', 'android').variant, null);
  }
});

test('first visit has no implicit OS or CPU choice', () => {
  assert.deepEqual(initialSelection(), { os: null, arch: null, variant: null, format: null });
  assert.equal(selectionComplete(initialSelection()), false);
});
test('iOS explicitly chooses compatibility and never defaults older phones to TestFlight', () => {
  const initial = choose(initialSelection(), 'os', 'ios');
  assert.deepEqual(initial, { os: 'ios', arch: 'universal', variant: null, format: 'testflight' });
  assert.equal(selectionComplete(initial), false);
  for (const variant of ['mobile', 'unsupported']) {
    const selected = choose(initial, 'variant', variant);
    assert.equal(selectionComplete(selected), true);
    assert.deepEqual(choose(selected, 'os', 'ios'), selected);
    assert.equal(choose(choose(selected, 'os', 'android'), 'os', 'ios').variant, null);
  }
  assert.equal(selectionComplete(choose(initial, 'variant', 'legacy')), false);
  assert.equal(selectionComplete({ ...initial, variant: 'mobile', arch: null }), false);
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
