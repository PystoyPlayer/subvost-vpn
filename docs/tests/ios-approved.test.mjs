import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('approved iOS download has no review warning or dangling accessibility reference', () => {
  for (const name of ['index.html', 'app.mjs', 'style.css']) {
    const source = readFileSync(new URL('../' + name, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /ios-release-warning|проходить проверку Apple|TestFlight может показывать старую версию/);
  }
  const script = readFileSync(new URL('../app.mjs', import.meta.url), 'utf8');
  assert.match(script, /https:\/\/testflight\.apple\.com\/join\/XPHxBArP/);
  assert.match(script, /if \(!supportedIOS\)/);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /https:\/\/apps\.apple\.com\/app\/testflight\/id899247664/);
  assert.match(html, /app\.mjs\?v=20261015-helper75/);
});
