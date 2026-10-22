'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('wszystkie pliki z listy offline istnieją', () => {
  const sw = read('sw.js');
  const list = sw.match(/var ASSETS = \[([\s\S]*?)\];/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  assert.ok(list.length > 10);
  for (const f of list) {
    if (f === './') continue;
    assert.ok(fs.existsSync(path.join(root, f)), 'brak pliku: ' + f);
  }
});

test('wersja aplikacji zgadza się z wersją service workera', () => {
  const app = read('js/app.js').match(/APP_VERSION = '([^']+)'/)[1];
  const sw = read('sw.js').match(/VERSION = 'utarg-([^']+)'/)[1];
  assert.strictEqual(app, sw);
});

test('index.html nie ma atrybutów inline i ładuje skrypty z listy offline', () => {
  const html = read('index.html');
  assert.ok(!/\sstyle=/.test(html));
  assert.ok(!/<script(?![^>]*src=)/.test(html));
  assert.ok(!/id="app"[^>]*aria-live/.test(html));
});
