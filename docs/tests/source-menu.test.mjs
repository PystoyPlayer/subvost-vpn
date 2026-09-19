import test from 'node:test';
import assert from 'node:assert/strict';
import { nextMenuIndex } from '../lib/source-menu.mjs';

test('source menu arrow navigation wraps in both directions', () => {
  assert.equal(nextMenuIndex('ArrowDown', 0, 2), 1);
  assert.equal(nextMenuIndex('ArrowDown', 1, 2), 0);
  assert.equal(nextMenuIndex('ArrowUp', 0, 2), 1);
  assert.equal(nextMenuIndex('ArrowUp', 1, 2), 0);
});
test('source menu Home, End and unrelated keys preserve predictable focus', () => {
  assert.equal(nextMenuIndex('Home', 1, 2), 0);
  assert.equal(nextMenuIndex('End', 0, 2), 1);
  assert.equal(nextMenuIndex('a', 1, 2), 1);
  assert.equal(nextMenuIndex('ArrowDown', -1, 2), 0);
  assert.equal(nextMenuIndex('ArrowDown', -1, 0), -1);
});
