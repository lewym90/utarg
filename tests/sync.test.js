'use strict';
/* Test synchronizacji z GitHubem na atrapie API (bez prawdziwej sieci). */
const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.self = globalThis;
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); }
};
globalThis.addEventListener = () => {};
globalThis.document = { addEventListener: () => {}, visibilityState: 'visible' };
globalThis.UtargCore = require('../js/core.js');
require('../js/store.js');
require('../js/sync.js');
const C = globalThis.UtargCore;
const Sync = globalThis.UtargSync;

function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }
function unb64(s) { return Buffer.from(s, 'base64').toString('utf8'); }

function fakeGithub(opts = {}) {
  const gh = {
    isPrivate: opts.isPrivate !== false,
    file: opts.file || null, // {text, sha}
    puts: 0,
    conflictOnce: opts.conflictOnce || 0,
    status: opts.status || 0, // wymuszony kod błędu
    branches: opts.branches || ['main'],
    lastPut: null,
    lastGetUrl: '',
    offline: false,
    shaCounter: 1
  };
  globalThis.fetch = async (url, init) => {
    if (gh.offline) throw new TypeError('network');
    const u = new URL(url);
    const method = (init && init.method) || 'GET';
    const json = (code, body) => ({
      status: code,
      headers: { get: () => null },
      text: async () => (body === undefined ? '' : JSON.stringify(body))
    });
    if (gh.status) return json(gh.status, { message: 'forced' });
    assert.equal(init.headers.Authorization, 'Bearer tok');
    assert.equal(u.host, 'api.github.com');
    const p = u.pathname;
    if (p === '/repos/jan/sklep-dane' && method === 'GET') {
      return json(200, { private: gh.isPrivate, default_branch: 'main', permissions: { push: true } });
    }
    const bm = /^\/repos\/jan\/sklep-dane\/branches\/(.+)$/.exec(p);
    if (bm) return gh.branches.includes(decodeURIComponent(bm[1])) ? json(200, { name: bm[1] }) : json(404, { message: 'Branch not found' });
    if (p === '/repos/jan/sklep-dane/contents/utarg-dane.json') {
      if (method === 'GET') {
        gh.lastGetUrl = url;
        if (!gh.file) return json(404, { message: 'Not Found' });
        return json(200, { sha: gh.file.sha, content: b64(gh.file.text) });
      }
      if (method === 'PUT') {
        const body = JSON.parse(init.body);
        gh.lastPut = body;
        if (gh.conflictOnce > 0) {
          gh.conflictOnce--;
          // ktoś inny w międzyczasie zmienił plik
          const other = C.setDay(gh.file ? C.parseSerialized(gh.file.text).data : C.emptyData(), '2026-10-09', 777, false, 5000);
          gh.file = { text: C.serialize(other), sha: 'sha' + (++gh.shaCounter) };
          return json(409, { message: 'conflict' });
        }
        if ((gh.file ? gh.file.sha : undefined) !== body.sha) return json(409, { message: 'sha mismatch' });
        gh.file = { text: unb64(body.content), sha: 'sha' + (++gh.shaCounter) };
        gh.puts++;
        assert.ok(/^Utarg: kopia \d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(body.message));
        return json(gh.file ? 200 : 201, { content: { sha: gh.file.sha } });
      }
    }
    return json(404, { message: 'Not Found ' + p });
  };
  return gh;
}

const cfg = { owner: 'jan', repo: 'sklep-dane', branch: 'main', path: 'utarg-dane.json', token: 'tok' };

test('pierwsza kopia tworzy plik w repozytorium', async () => {
  const gh = fakeGithub();
  let d = C.setDay(C.emptyData(), '2026-10-22', 428050, false, 100);
  const r = await Sync._pullPush(cfg, d, 1);
  assert.equal(r.pushed, true);
  assert.equal(gh.puts, 1);
  const saved = C.parseSerialized(gh.file.text).data;
  assert.equal(saved.days['2026-10-22'].a, 428050);
});

test('bez zmian nie powstaje pusty commit', async () => {
  const gh = fakeGithub();
  let d = C.setDay(C.emptyData(), '2026-10-22', 428050, false, 100);
  await Sync._pullPush(cfg, d, 1);
  const r = await Sync._pullPush(cfg, d, 1);
  assert.equal(r.pushed, false);
  assert.equal(gh.puts, 1);
});

test('dane z kilku urządzeń są scalane i nic nie ginie', async () => {
  const remote = C.setDay(C.emptyData(), '2026-10-20', 1000, false, 50);
  const gh = fakeGithub({ file: { text: C.serialize(remote), sha: 'sha1' } });
  const local = C.setDay(C.emptyData(), '2026-10-21', 2000, false, 60);
  const r = await Sync._pullPush(cfg, local, 1);
  assert.equal(C.countEntries(r.data), 2);
  assert.equal(r.changedLocal, true);
  assert.equal(r.pushed, true);
  assert.equal(C.countEntries(C.parseSerialized(gh.file.text).data), 2);
});

test('konflikt zapisu (409) kończy się ponowieniem i scaleniem', async () => {
  const gh = fakeGithub({ file: { text: C.serialize(C.emptyData()), sha: 'sha1' }, conflictOnce: 1 });
  const local = C.setDay(C.emptyData(), '2026-10-21', 2000, false, 60);
  const r = await Sync._pullPush(cfg, local, 1);
  const saved = C.parseSerialized(gh.file.text).data;
  assert.equal(saved.days['2026-10-21'].a, 2000);
  assert.equal(saved.days['2026-10-09'].a, 777); // wpis z drugiego urządzenia też został
  assert.equal(r.pushed, true);
});

test('uszkodzony plik na GitHubie nie jest nadpisywany', async () => {
  const gh = fakeGithub({ file: { text: '{to nie jest json', sha: 'sha1' } });
  const local = C.setDay(C.emptyData(), '2026-10-21', 2000, false, 60);
  await assert.rejects(() => Sync._pullPush(cfg, local, 1), (e) => e.code === 'corrupt');
  assert.equal(gh.file.text, '{to nie jest json');
  assert.equal(gh.puts, 0);
});

test('błędy HTTP są tłumaczone na polskie komunikaty', async () => {
  const local = C.emptyData();
  for (const [status, code] of [[401, 'auth'], [403, 'perm'], [404, 'notfound'], [500, 'server']]) {
    fakeGithub({ status });
    await assert.rejects(() => Sync._pullPush(cfg, local, 1), (e) => e.code === code && /[ąęłśćżźó ]/.test(e.message), 'kod ' + status);
  }
  const gh = fakeGithub();
  gh.offline = true;
  await assert.rejects(() => Sync._pullPush(cfg, local, 1), (e) => e.code === 'offline');
});

test('base64 zachowuje polskie znaki', () => {
  const s = 'zażółć gęślą jaźń ✓';
  assert.equal(Sync._fromB64(Sync._toB64(s)), s);
});

test('rozpoznawanie adresu repozytorium', () => {
  assert.deepEqual(Sync.parseRepo('jan/sklep-dane'), { owner: 'jan', repo: 'sklep-dane' });
  assert.deepEqual(Sync.parseRepo(' https://github.com/jan/sklep-dane.git '), { owner: 'jan', repo: 'sklep-dane' });
  assert.deepEqual(Sync.parseRepo('https://github.com/jan/sklep-dane/'), { owner: 'jan', repo: 'sklep-dane' });
  assert.equal(Sync.parseRepo('sklep'), null);
  assert.equal(Sync.parseRepo('a/b/c'), null);
  assert.equal(Sync.parseRepo(''), null);
});

test('połączenie z repozytorium publicznym jest odrzucane', async () => {
  fakeGithub({ isPrivate: false });
  let hooksData = C.emptyData();
  Sync.init({
    getData: () => hooksData, getVersion: () => 0, applyRemote: (d) => { hooksData = d; }, onStatus: () => {}
  });
  await assert.rejects(() => Sync.connect('jan', 'sklep-dane', 'tok'), (e) => e.code === 'public');
  assert.equal(Sync.getConfig(), null); // nic nie zostało zapisane
});

test('pełne połączenie: konfiguracja zapisana, kopia wysłana, status „synced”', async () => {
  const gh = fakeGithub();
  let data = C.setDay(C.emptyData(), '2026-10-22', 428050, false, 100);
  const statuses = [];
  Sync.init({
    getData: () => data, getVersion: () => 1, applyRemote: (d) => { data = d; },
    onStatus: (s) => statuses.push(s.state)
  });
  await Sync.connect('jan', 'sklep-dane', 'tok');
  assert.equal(gh.puts, 1);
  assert.deepEqual(Sync.getConfig(), { owner: 'jan', repo: 'sklep-dane', branch: 'main', path: 'utarg-dane.json', public: false });
  assert.equal(Sync.getStatus().state, 'synced');
  assert.ok(statuses.includes('syncing'));
  Sync.disconnect();
  assert.equal(Sync.getStatus().state, 'off');
  assert.equal(Sync.getConfig(), null);
});

test('repozytorium publiczne: dopiero po wyraźnej zgodzie, z oznaczeniem w konfiguracji', async () => {
  const gh = fakeGithub({ isPrivate: false });
  let data = C.setDay(C.emptyData(), '2026-10-22', 100, false, 1);
  Sync.init({ getData: () => data, getVersion: () => 1, applyRemote: (d) => { data = d; }, onStatus: () => {} });
  await assert.rejects(() => Sync.connect('jan', 'sklep-dane', 'tok'), (e) => e.code === 'public');
  assert.equal(gh.puts, 0);
  await Sync.connect('jan', 'sklep-dane', 'tok', { allowPublic: true });
  assert.equal(gh.puts, 1);
  assert.equal(Sync.getConfig().public, true);
  Sync.disconnect();
});

test('osobna gałąź na dane: kopia trafia na wskazaną gałąź, brak gałęzi daje czytelny błąd', async () => {
  const gh = fakeGithub({ branches: ['main', 'dane'] });
  let data = C.setDay(C.emptyData(), '2026-10-22', 100, false, 1);
  Sync.init({ getData: () => data, getVersion: () => 1, applyRemote: (d) => { data = d; }, onStatus: () => {} });
  await assert.rejects(() => Sync.connect('jan', 'sklep-dane', 'tok', { branch: 'nie-ma' }), (e) => e.code === 'nobranch' && /nie ma gałęzi/.test(e.message));
  assert.equal(Sync.getConfig(), null);
  await Sync.connect('jan', 'sklep-dane', 'tok', { branch: 'dane' });
  assert.equal(gh.lastPut.branch, 'dane');
  assert.match(gh.lastGetUrl, /ref=dane/);
  assert.equal(Sync.getConfig().branch, 'dane');
  Sync.disconnect();
});
