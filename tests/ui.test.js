'use strict';
/* Test interfejsu w jsdom: wpisywanie, sumy, edycja, dni zamknięte, cofanie, kopia na GitHub. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const Core = require('../js/core.js');

const ROOT = path.join(__dirname, '..');
const NB = '\u00A0';

function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }
function unb64(s) { return Buffer.from(s, 'base64').toString('utf8'); }

function fakeGithub(isPrivate = true) {
  const gh = { file: null, puts: 0, sha: 1 };
  gh.fetch = async (url, init) => {
    const u = new URL(url);
    const method = (init && init.method) || 'GET';
    const res = (code, body) => ({ status: code, headers: { get: () => null }, text: async () => JSON.stringify(body) });
    const p = u.pathname;
    if (p === '/repos/jan/utarg-dane') return res(200, { private: isPrivate, default_branch: 'main', permissions: { push: true } });
    if (p === '/repos/jan/utarg-dane/branches/main' || p === '/repos/jan/utarg-dane/branches/dane') return res(200, {});
    if (p === '/repos/jan/utarg-dane/contents/utarg-dane.json') {
      if (method === 'GET') return gh.file ? res(200, { sha: gh.file.sha, content: b64(gh.file.text) }) : res(404, {});
      const body = JSON.parse(init.body);
      if ((gh.file ? gh.file.sha : undefined) !== body.sha) return res(409, {});
      gh.file = { text: unb64(body.content), sha: 'sha' + (++gh.sha) };
      gh.puts++;
      return res(200, {});
    }
    return res(404, {});
  };
  return gh;
}

const windows = [];
test.after(() => { windows.forEach((w) => { try { w.close(); } catch (e) { /* ignoruj */ } }); });

function boot(opts = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://utarg.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  windows.push(w);
  w.TextEncoder = TextEncoder; // jsdom nie ma tych klas, prawdziwe przeglądarki mają
  w.TextDecoder = TextDecoder;
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.fetch = opts.fetch || (async () => { throw new TypeError('offline'); });
  if (opts.localStorage) for (const [k, v] of Object.entries(opts.localStorage)) w.localStorage.setItem(k, v);
  const errors = [];
  w.addEventListener('error', (e) => errors.push(e.message));
  for (const f of ['js/theme-init.js', 'js/core.js', 'js/store.js', 'js/sync.js', 'js/app.js']) {
    w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  }
  return { dom, w, doc: w.document, errors };
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
function click(w, el) { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }
function q(doc, sel) { return doc.querySelector(sel); }
function typeInto(w, input, text) {
  input.value = text;
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
}
function text(doc, sel) { return (q(doc, sel) || { textContent: '' }).textContent; }

const today = Core.todayKey();
const tp = Core.parseKey(today);

test('start: widok „Dziś”, nawigacja po polsku, brak błędów', async () => {
  const { doc, errors } = boot();
  await tick(60);
  assert.equal(doc.documentElement.lang, 'pl');
  assert.ok(q(doc, '#amount-input'), 'pole kwoty');
  const labels = [...doc.querySelectorAll('.tabbar .nav-btn')].map((b) => b.textContent.trim());
  assert.deepEqual(labels, ['Dziś', 'Miesiąc', 'Rok', 'Analiza', 'Ustawienia']);
  assert.equal(q(doc, '.tabbar [aria-current="page"]').textContent.trim(), 'Dziś');
  assert.match(text(doc, '#view'), /Zacznij od pierwszego wpisu/);
  assert.match(text(doc, '#view'), /Włącz kopię bezpieczeństwa/);
  assert.deepEqual(errors, []);
});

test('wpisanie utargu: podgląd, zapis, sumy, cofnięcie', async () => {
  const { w, doc, errors } = boot();
  await tick(60);
  const input = q(doc, '#amount-input');
  typeInto(w, input, '4280,5');
  assert.equal(text(doc, '#hint'), '= 4' + NB + '280,50' + NB + 'zł');
  click(w, q(doc, '[data-action="today-save"]'));
  await tick();
  const rec = w.__utarg.state.data.days[today];
  assert.equal(rec.a, 428050);
  assert.equal(rec.c, false);
  assert.match(text(doc, '#toasts'), /Zapisano 4.280,50.zł/);
  assert.match(text(doc, '#view'), /Zapisano \d\d:\d\d/);
  assert.equal(q(doc, '#amount-input').value, '4280,50');
  // metryki miesiąca i roku
  const metrics = [...doc.querySelectorAll('.metric .v')].map((e) => e.textContent);
  assert.deepEqual(metrics, ['4' + NB + '280,50' + NB + 'zł', '4' + NB + '280,50' + NB + 'zł']);
  // zapis w pamięci urządzenia
  const saved = Core.parseSerialized(w.localStorage.getItem('utarg.data.v1')).data;
  assert.equal(saved.days[today].a, 428050);
  assert.equal(w.localStorage.getItem('utarg.dirty'), '1');
  // poprawka kwoty i cofnięcie
  typeInto(w, q(doc, '#amount-input'), '5000');
  click(w, q(doc, '[data-action="today-save"]'));
  await tick();
  assert.equal(w.__utarg.state.data.days[today].a, 500000);
  assert.equal(doc.querySelectorAll('#toasts .toast').length, 1, 'jeden komunikat naraz');
  click(w, q(doc, '[data-action="toast-undo"]'));
  await tick();
  assert.equal(w.__utarg.state.data.days[today].a, 428050);
  assert.deepEqual(errors, []);
});

test('błędna kwota nie jest zapisywana i pokazuje komunikat', async () => {
  const { w, doc } = boot();
  await tick(60);
  for (const bad of ['abc', '-5', '1.234', '']) {
    typeInto(w, q(doc, '#amount-input'), bad);
    click(w, q(doc, '[data-action="today-save"]'));
    await tick();
    assert.equal(Object.keys(w.__utarg.state.data.days).length, 0, 'nie zapisano dla: ' + bad);
    assert.ok(q(doc, '#hint.err'), 'komunikat dla: ' + bad);
  }
});

test('dzień zamknięty i ponowne otwarcie', async () => {
  const { w, doc } = boot();
  await tick(60);
  click(w, q(doc, '[data-action="today-closed"]'));
  await tick();
  assert.deepEqual(w.__utarg.state.data.days[today].c, true);
  assert.equal(w.__utarg.state.data.days[today].a, 0);
  assert.match(text(doc, '.closed-state'), /Sklep zamknięty/);
  click(w, q(doc, '[data-action="today-reopen"]'));
  await tick();
  assert.equal(Core.getDay(w.__utarg.state.data, today), null);
  assert.ok(q(doc, '#amount-input'));
});

test('widok miesiąca: liczba dni, sumy i edycja dnia w oknie', async () => {
  const { w, doc, errors } = boot();
  await tick(60);
  const dim = Core.daysInMonth(tp.y, tp.m);
  const day1 = Core.dateKey(tp.y, tp.m, 1);
  w.__utarg.submitDay(day1, '1000', false, null);
  await tick();
  typeInto(w, q(doc, '#amount-input'), '250,25');
  click(w, q(doc, '[data-action="today-save"]'));
  await tick();
  click(w, q(doc, '.tabbar [data-view="month"]'));
  const rows = doc.querySelectorAll('.list .row');
  assert.equal(rows.length, dim + 1); // wszystkie dni + wiersz sumy
  assert.match(text(doc, '.hero-total'), /1.250,25.zł/);
  assert.match(text(doc, '.row.total'), /Suma/);
  assert.match(text(doc, '.row.total .amt'), /1.250,25.zł/);
  assert.equal(q(doc, '.row.today') ? true : false, true);
  // edycja dnia 1
  click(w, q(doc, '[data-action="open-editor"][data-key="' + day1 + '"]'));
  assert.ok(q(doc, '#ed-amount'));
  assert.equal(q(doc, '#ed-amount').value, '1000');
  typeInto(w, q(doc, '#ed-amount'), '2000,10');
  click(w, q(doc, '[data-action="editor-save"]'));
  await tick();
  assert.equal(q(doc, '#modal-root .sheet'), null);
  assert.match(text(doc, '.hero-total'), /2.250,35.zł/);
  // oznaczenie dnia jako zamkniętego w oknie nie zmienia sum pozostałych dni
  click(w, q(doc, '[data-action="open-editor"][data-key="' + day1 + '"]'));
  const sw = q(doc, '#ed-closed');
  sw.checked = true;
  sw.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(q(doc, '#ed-amount').disabled, true);
  click(w, q(doc, '[data-action="editor-save"]'));
  await tick();
  assert.match(text(doc, '.hero-total'), /250,25.zł/);
  // usunięcie wpisu
  click(w, q(doc, '[data-action="open-editor"][data-key="' + day1 + '"]'));
  click(w, q(doc, '[data-action="editor-delete"]'));
  await tick();
  assert.equal(Core.getDay(w.__utarg.state.data, day1), null);
  assert.deepEqual(errors, []);
});

test('nie da się wpisać utargu za przyszły dzień', async () => {
  const { w, doc } = boot();
  await tick(60);
  const future = Core.addDays(today, 1);
  const ok = await w.__utarg.submitDay(future, '100', false, null);
  assert.equal(ok, false);
  assert.equal(Object.keys(w.__utarg.state.data.days).length, 0);
  assert.equal(q(doc, '[data-action="today-next"]').disabled, true);
});

test('widok roku: tabela 12 miesięcy × dni, sumy miesięczne i roczna', async () => {
  const { w, doc, errors } = boot();
  await tick(60);
  // dwa dni w różnych miesiącach tego roku (bieżący i poprzedni, jeśli istnieje)
  w.__utarg.submitDay(today, '100,10', false, null);
  const jan1 = Core.dateKey(tp.y, 0, 1);
  await w.__utarg.submitDay(jan1, '900,90', false, null);
  w.__utarg.state.yearMode = 'table';
  click(w, q(doc, '.tabbar [data-view="year"]'));
  const heads = [...doc.querySelectorAll('.ytable thead th')].map((t) => t.textContent);
  assert.equal(heads.length, 13);
  assert.equal(heads[0], 'Dzień');
  assert.equal(heads[1], 'Sty');
  assert.equal(doc.querySelectorAll('.ytable tbody tr').length, 31);
  const sums = [...doc.querySelectorAll('.ytable tfoot tr.t1 td')].map((t) => t.textContent);
  assert.equal(sums.length, 12);
  const expectedJan = jan1 === today ? '1' + NB + '000,00' : '900,90';
  assert.equal(sums[0], tp.m === 0 ? '1' + NB + '001,00' : expectedJan);
  assert.match(text(doc, '.ytable tfoot .grand'), /1.001,00.zł/);
  assert.match(text(doc, '.hero-total'), /1.001,00.zł/);
  // 29–31 lutego to puste komórki (nie klikalne)
  const febCol = 2; // kolumna lutego (po kolumnie dni)
  const rows = doc.querySelectorAll('.ytable tbody tr');
  const cell30 = rows[29].children[febCol];
  assert.ok(cell30.classList.contains('na'));
  // przełączenie na widok miesięcy
  click(w, q(doc, '[data-action="year-mode"][data-mode="months"]'));
  assert.equal(doc.querySelectorAll('.list .row.mrow').length, 12);
  assert.match(text(doc, '.row.total'), /Razem — rok/);
  assert.ok(q(doc, 'svg.chart'));
  assert.deepEqual(errors, []);
});

test('rok przestępny w tabeli: 29 lutego jest dostępne tylko w roku przestępnym', async () => {
  const { w, doc } = boot();
  await tick(60);
  w.__utarg.state.year = 2028;
  w.__utarg.state.yearMode = 'table';
  click(w, q(doc, '.tabbar [data-view="year"]'));
  const rows = doc.querySelectorAll('.ytable tbody tr');
  assert.equal(rows[28].children[2].classList.contains('na'), false);
  click(w, q(doc, '[data-action="year-next"]')); // 2029
  const rows2 = doc.querySelectorAll('.ytable tbody tr');
  assert.equal(rows2[28].children[2].classList.contains('na'), true);
});

test('ostrzeżenie o brakujących dniach i rozwiązanie przez „zamknięte”', async () => {
  const since = Core.addDays(today, -4);
  const { w, doc } = boot({ localStorage: { 'utarg.since': since } });
  await tick(60);
  assert.match(text(doc, '#view'), /Brakuje wpisów: 4 dni/);
  const chips = doc.querySelectorAll('.banner.warn .chip');
  assert.equal(chips.length, 4);
  click(w, chips[0]);
  assert.ok(q(doc, '#ed-amount'));
  const sw = q(doc, '#ed-closed');
  sw.checked = true;
  sw.dispatchEvent(new w.Event('change', { bubbles: true }));
  click(w, q(doc, '[data-action="editor-save"]'));
  await tick();
  assert.match(text(doc, '#view'), /Brakuje wpisów: 3 dni/);
});

test('stałe dni wolne wyłączają ostrzeżenia', async () => {
  const since = Core.addDays(today, -6);
  const { w, doc } = boot({ localStorage: { 'utarg.since': since } });
  await tick(60);
  const before = doc.querySelectorAll('.banner.warn .chip').length;
  assert.equal(before, 6);
  click(w, q(doc, '.tabbar [data-view="settings"]'));
  for (let d = 0; d < 7; d++) click(w, q(doc, '[data-action="weekday"][data-d="' + d + '"]'));
  click(w, q(doc, '.tabbar [data-view="today"]'));
  assert.equal(doc.querySelectorAll('.banner.warn').length, 0);
  assert.deepEqual(JSON.parse(w.localStorage.getItem('utarg.settings.v1')).closedWeekdays.sort(), [0, 1, 2, 3, 4, 5, 6]);
});

test('zabezpieczenie przed literówką: dużo większa kwota wymaga potwierdzenia', async () => {
  const { w, doc } = boot();
  await tick(60);
  for (let i = 1; i <= 5; i++) await w.__utarg.submitDay(Core.addDays(today, -i), '1000', false, null);
  typeInto(w, q(doc, '#amount-input'), '50000');
  click(w, q(doc, '[data-action="today-save"]'));
  await tick();
  assert.ok(q(doc, '#confirm-root .sheet'), 'okno potwierdzenia');
  assert.match(text(doc, '#cf-text'), /najwyższy dotychczasowy/);
  assert.equal(Core.getDay(w.__utarg.state.data, today), null);
  click(w, q(doc, '[data-action="confirm-no"]'));
  await tick();
  assert.equal(Core.getDay(w.__utarg.state.data, today), null);
  click(w, q(doc, '[data-action="today-save"]'));
  await tick();
  click(w, q(doc, '[data-action="confirm-yes"]'));
  await tick();
  assert.equal(Core.getDay(w.__utarg.state.data, today).a, 5000000);
});

test('motyw: zapamiętywany i stosowany', async () => {
  const { w, doc } = boot();
  await tick(60);
  click(w, q(doc, '.tabbar [data-view="settings"]'));
  click(w, q(doc, '[data-action="theme"][data-theme="dark"]'));
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(JSON.parse(w.localStorage.getItem('utarg.settings.v1')).theme, 'dark');
  click(w, q(doc, '[data-action="theme"][data-theme="auto"]'));
  assert.equal(doc.documentElement.hasAttribute('data-theme'), false);
  // po ponownym uruchomieniu ustawienie zostaje
  const again = boot({ localStorage: { 'utarg.settings.v1': JSON.stringify({ theme: 'light', closedWeekdays: [0] }) } });
  await tick(60);
  assert.equal(again.doc.documentElement.getAttribute('data-theme'), 'light');
});

test('dane przetrwają ponowne uruchomienie aplikacji', async () => {
  const first = boot();
  await tick(60);
  await first.w.__utarg.submitDay(today, '777,77', false, null);
  const ls = {};
  for (let i = 0; i < first.w.localStorage.length; i++) { const k = first.w.localStorage.key(i); ls[k] = first.w.localStorage.getItem(k); }
  const second = boot({ localStorage: ls });
  await tick(60);
  assert.equal(second.w.__utarg.state.data.days[today].a, 77777);
  assert.equal(second.doc.querySelector('#amount-input').value, '777,77');
});

test('kopia na GitHub: połączenie, automatyczna wysyłka po wpisie, odłączenie', async () => {
  const gh = fakeGithub();
  const { w, doc, errors } = boot({ fetch: gh.fetch });
  await tick(60);
  await w.__utarg.submitDay(today, '1500', false, null);
  click(w, q(doc, '.tabbar [data-view="settings"]'));
  typeInto(w, q(doc, '#repo-input'), 'https://github.com/jan/utarg-dane');
  typeInto(w, q(doc, '#token-input'), 'tok');
  // fałszywy token → sprawdzenie nagłówka w atrapie
  const origFetch = w.fetch;
  w.fetch = (url, init) => { init.headers.Authorization === 'Bearer tok' || (() => { throw new Error('zły token'); })(); return origFetch(url, init); };
  click(w, q(doc, '[data-action="sync-connect"]'));
  await tick(200);
  assert.equal(gh.puts, 1);
  assert.equal(Core.getDay(Core.parseSerialized(gh.file.text).data, today).a, 150000);
  assert.match(text(doc, '#view'), /utarg-dane/);
  assert.match(text(doc, '#view'), /Kopia aktualna/);
  assert.match(text(doc, '.pill'), /Kopia zapisana/);
  assert.equal(w.localStorage.getItem('utarg.dirty'), '0');
  // kolejny wpis → automatyczna kopia
  click(w, q(doc, '.tabbar [data-view="today"]'));
  typeInto(w, q(doc, '#amount-input'), '1600');
  click(w, q(doc, '[data-action="today-save"]'));
  await tick(1500);
  assert.equal(gh.puts, 2);
  assert.equal(Core.getDay(Core.parseSerialized(gh.file.text).data, today).a, 160000);
  assert.equal(w.localStorage.getItem('utarg.dirty'), '0');
  assert.deepEqual(errors, []);
});

test('połączenie z błędnym repozytorium pokazuje czytelny błąd', async () => {
  const { w, doc } = boot({ fetch: async () => ({ status: 404, headers: { get: () => null }, text: async () => '{}' }) });
  await tick(60);
  click(w, q(doc, '.tabbar [data-view="settings"]'));
  typeInto(w, q(doc, '#repo-input'), 'zle');
  click(w, q(doc, '[data-action="sync-connect"]'));
  assert.match(text(doc, '#connect-error'), /login\/nazwa/);
  typeInto(w, q(doc, '#repo-input'), 'jan/utarg-dane');
  click(w, q(doc, '[data-action="sync-connect"]'));
  assert.match(text(doc, '#connect-error'), /token/i);
  typeInto(w, q(doc, '#token-input'), 'tok');
  click(w, q(doc, '[data-action="sync-connect"]'));
  await tick(100);
  assert.match(text(doc, '#connect-error'), /Nie znaleziono repozytorium/);
  assert.equal(w.localStorage.getItem('utarg.sync.v1'), null);
});

test('brak połączenia z internetem: dane zostają, kopia czeka', async () => {
  const gh = fakeGithub();
  const cfg = { owner: 'jan', repo: 'utarg-dane', branch: 'main', path: 'utarg-dane.json', token: 'tok', lastSync: 0 };
  const boxed = boot({ fetch: async () => { throw new TypeError('offline'); }, localStorage: { 'utarg.sync.v1': JSON.stringify(cfg) } });
  await tick(100);
  await boxed.w.__utarg.submitDay(today, '300', false, null);
  await tick(1200);
  assert.equal(boxed.w.__utarg.state.data.days[today].a, 30000);
  assert.equal(boxed.w.localStorage.getItem('utarg.dirty'), '1');
  assert.match(text(boxed.doc, '.pill'), /Kopia czeka na wysłanie/);
  assert.match(text(boxed.doc, '#view'), /Twoje dane są bezpieczne na tym urządzeniu/);
});

test('pliki: eksport zawiera dane, a zawartość strony nie ma atrybutów style (zgodność z CSP)', async () => {
  const { w, doc } = boot();
  await tick(60);
  await w.__utarg.submitDay(today, '10', false, null);
  for (const v of ['today', 'month', 'year', 'settings']) {
    click(w, q(doc, '.tabbar [data-view="' + v + '"]'));
    assert.equal(doc.querySelectorAll('#app [style]').length, 0, 'style w widoku ' + v);
    assert.equal(doc.querySelectorAll('#app script').length, 0);
  }
});

test('repozytorium publiczne: aplikacja pyta o zgodę, a po zgodzie łączy i ostrzega', async () => {
  const gh = fakeGithub(false);
  const { w, doc, errors } = boot({ fetch: gh.fetch });
  await tick(60);
  await w.__utarg.submitDay(today, '1500', false, null);
  click(w, q(doc, '.tabbar [data-view="settings"]'));
  typeInto(w, q(doc, '#repo-input'), 'jan/utarg-dane');
  typeInto(w, q(doc, '#token-input'), 'tok');
  typeInto(w, q(doc, '#branch-input'), 'dane');
  click(w, q(doc, '[data-action="sync-connect"]'));
  await tick(100);
  assert.ok(q(doc, '#confirm-root .sheet'), 'okno zgody');
  assert.match(text(doc, '#cf-title'), /publiczne/);
  assert.equal(gh.puts, 0);
  // odmowa nic nie łączy
  click(w, q(doc, '[data-action="confirm-no"]'));
  await tick(50);
  assert.equal(gh.puts, 0);
  assert.equal(w.localStorage.getItem('utarg.sync.v1'), null);
  // zgoda łączy
  click(w, q(doc, '[data-action="sync-connect"]'));
  await tick(100);
  click(w, q(doc, '[data-action="confirm-yes"]'));
  await tick(250);
  assert.equal(gh.puts, 1);
  assert.match(text(doc, '#view'), /Repozytorium jest publiczne/);
  assert.match(text(doc, '#view'), /Gałąź/);
  assert.equal(JSON.parse(w.localStorage.getItem('utarg.sync.v1')).branch, 'dane');
  assert.deepEqual(errors, []);
});

test('przeprowadzka: plik kopii z jednej instalacji wczytany w nowej, potem połączenie z nowym repozytorium przenosi całą historię', async () => {
  // stara instalacja (np. testy na koncie znajomego z Twoim repozytorium)
  const old = boot();
  await tick(60);
  const keys = [Core.addDays(today, -1), Core.addDays(today, -2), Core.addDays(today, -3)];
  await old.w.__utarg.submitDay(keys[0], '1000,50', false, null);
  await old.w.__utarg.submitDay(keys[1], '0', true, null);
  await old.w.__utarg.submitDay(keys[2], '2500', false, null);
  const exported = Core.serialize(old.w.__utarg.state.data); // dokładnie to, co daje „Pobierz kopię (JSON)”

  // nowa instalacja: inna domena, pusta pamięć
  const gh = fakeGithub();
  const fresh = boot({ fetch: gh.fetch });
  await tick(60);
  assert.equal(Core.countEntries(fresh.w.__utarg.state.data), 0);
  click(fresh.w, q(fresh.doc, '.tabbar [data-view="settings"]'));
  const input = q(fresh.doc, '#import-file');
  const file = new fresh.w.File([exported], 'utarg-kopia.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new fresh.w.Event('change', { bubbles: true }));
  await tick(100);
  assert.match(text(fresh.doc, '#cf-text'), /Nowych lub nowszych wpisów: 3/);
  click(fresh.w, q(fresh.doc, '[data-action="confirm-yes"]'));
  await tick(50);
  assert.equal(Core.countEntries(fresh.w.__utarg.state.data), 3);
  assert.equal(Core.getDay(fresh.w.__utarg.state.data, keys[0]).a, 100050);
  assert.equal(Core.getDay(fresh.w.__utarg.state.data, keys[1]).c, true);

  // połączenie z jego własnym, pustym repozytorium wysyła całą historię
  typeInto(fresh.w, q(fresh.doc, '#repo-input'), 'jan/utarg-dane');
  typeInto(fresh.w, q(fresh.doc, '#token-input'), 'tok');
  click(fresh.w, q(fresh.doc, '[data-action="sync-connect"]'));
  await tick(300);
  assert.equal(gh.puts, 1);
  const uploaded = Core.parseSerialized(gh.file.text).data;
  assert.equal(Core.countEntries(uploaded), 3);
  assert.equal(Core.getDay(uploaded, keys[2]).a, 250000);
  assert.deepEqual(fresh.errors, []);
});

async function seedDays(app, n) {
  // n dni wstecz od wczoraj: poniedziałki–niedziele, kwoty rosnące; co czwarty dzień z deszczem
  for (let i = 1; i <= n; i++) {
    const key = Core.addDays(today, -i);
    await app.w.__utarg.submitDay(key, String(1000 + i * 10), false, null, i % 4 === 0 ? 'deszcz' : '');
  }
}

test('notatka: dodanie w oknie dnia, chipy, zapis, widok w miesiącu, zachowanie przy zmianie kwoty', async () => {
  const app = boot();
  await tick(60);
  const { w, doc, errors } = app;
  typeInto(w, q(doc, '#amount-input'), '1500');
  click(w, q(doc, '[data-action="today-save"]'));
  await tick();
  // subtelny link do notatki pojawia się dopiero po zapisie
  click(w, q(doc, '.hero-link'));
  await tick();
  assert.ok(q(doc, '#ed-note'));
  click(w, q(doc, '[data-action="note-tag"][data-tag="rain"]'));
  assert.equal(q(doc, '#ed-note').value, 'deszcz');
  assert.equal(q(doc, '[data-tag="rain"]').getAttribute('aria-pressed'), 'true');
  click(w, q(doc, '[data-action="note-tag"][data-tag="promo"]'));
  assert.equal(q(doc, '#ed-note').value, 'deszcz, promocja');
  click(w, q(doc, '[data-action="note-tag"][data-tag="rain"]'));
  assert.equal(q(doc, '#ed-note').value, 'promocja');
  typeInto(w, q(doc, '#ed-note'), 'ulewa i wiatr');
  assert.equal(q(doc, '[data-tag="rain"]').getAttribute('aria-pressed'), 'true');
  click(w, q(doc, '[data-action="editor-save"]'));
  await tick();
  assert.equal(w.__utarg.state.data.days[today].n, 'ulewa i wiatr');
  assert.equal(w.__utarg.state.data.days[today].a, 150000);
  assert.match(text(doc, '.hero-note'), /ulewa i wiatr/);
  // zmiana kwoty na ekranie głównym nie kasuje notatki
  typeInto(w, q(doc, '#amount-input'), '1600');
  click(w, q(doc, '[data-action="today-save"]'));
  await tick();
  assert.equal(w.__utarg.state.data.days[today].n, 'ulewa i wiatr');
  // cofnięcie przywraca także notatkę
  click(w, q(doc, '[data-action="toast-undo"]'));
  await tick();
  assert.equal(w.__utarg.state.data.days[today].a, 150000);
  assert.equal(w.__utarg.state.data.days[today].n, 'ulewa i wiatr');
  // notatka widoczna w kopii i w widoku miesiąca
  assert.match(w.localStorage.getItem('utarg.data.v1'), /"n": "ulewa i wiatr"/);
  click(w, q(doc, '.tabbar [data-view="month"]'));
  assert.match(text(doc, '#view'), /ulewa i wiatr/);
  assert.deepEqual(errors, []);
});

test('notatka: tekst z HTML jest wyświetlany bezpiecznie', async () => {
  const app = boot();
  await tick(60);
  await app.w.__utarg.submitDay(today, '10', false, null, '<img src=x onerror=alert(1)>');
  assert.equal(app.doc.querySelectorAll('#view img[src="x"]').length, 0);
  assert.match(text(app.doc, '.hero-note'), /<img src=x/);
});

test('zakładka Analiza: puste dane, potem wnioski, okresy i wykresy', async () => {
  const app = boot();
  await tick(60);
  const { w, doc, errors } = app;
  click(w, q(doc, '.tabbar [data-view="analysis"]'));
  assert.equal(q(doc, '.tabbar [aria-current="page"]').textContent.trim(), 'Analiza');
  assert.match(text(doc, '#view'), /Brak danych w tym okresie/);

  await seedDays(app, 40);
  click(w, q(doc, '.tabbar [data-view="analysis"]'));
  const view = text(doc, '#view');
  assert.match(view, /Średnio dziennie/);
  assert.match(view, /Średni utarg według dnia tygodnia/);
  assert.match(view, /Najlepsze dni/);
  assert.match(view, /Najsłabsze dni/);
  assert.match(view, /Okoliczności z notatek/);
  assert.match(view, /Deszcz/);
  assert.equal(doc.querySelectorAll('svg.chart').length, 2);
  assert.equal(doc.querySelectorAll('.chart rect.bar').length >= 19, true);
  assert.equal(q(doc, '[data-action="analysis-period"][aria-pressed="true"]').textContent, '90 dni');
  click(w, q(doc, '[data-action="analysis-period"][data-period="d30"]'));
  assert.equal(q(doc, '[data-action="analysis-period"][aria-pressed="true"]').textContent, '30 dni');
  // liczby zgodne z logiką: 30 dni wstecz od wczoraj do dziś (okno 30 dni kończy się dziś)
  const an = Core.analyze(w.__utarg.state.data, { today, from: Core.addDays(today, -29) });
  assert.match(text(doc, '#view'), new RegExp(String(an.openDays) + ' (dzień|dni) z utargiem'));
  // pasek z propozycją kosztu otwarcia
  assert.match(text(doc, '#view'), /Czy otwarcie się opłaca/);
  assert.equal(doc.querySelectorAll('[style]').length, 0, 'brak atrybutów style');
  assert.deepEqual(errors, []);
});

test('koszt otwarcia: ustawienie, zapamiętanie, ostrzeżenia w analizie', async () => {
  const app = boot();
  await tick(60);
  const { w, doc, errors } = app;
  await seedDays(app, 30); // kwoty 1010–1300 zł
  click(w, q(doc, '.tabbar [data-view="settings"]'));
  const inp = q(doc, '#cost-input');
  inp.value = 'abc';
  inp.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.ok(q(doc, '#cost-hint').textContent.length > 0);
  assert.equal(w.__utarg.state.settings.openCost || 0, 0);
  q(doc, '#cost-input').value = '1 200,50';
  q(doc, '#cost-input').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(w.__utarg.state.settings.openCost, 120050);
  assert.match(w.localStorage.getItem('utarg.settings.v1'), /"openCost":120050/);
  click(w, q(doc, '.tabbar [data-view="analysis"]'));
  assert.match(text(doc, '#view'), /Dzienny koszt otwarcia: 1.200,50.zł/);
  assert.match(text(doc, '#view'), /niższy niż koszt otwarcia|poniżej kosztu otwarcia/);
  assert.ok(doc.querySelector('svg.chart .cost'), 'linia kosztu na wykresie');
  // wyłączenie
  click(w, q(doc, '.tabbar [data-view="settings"]'));
  q(doc, '#cost-input').value = '';
  q(doc, '#cost-input').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(w.__utarg.state.settings.openCost, 0);
  assert.deepEqual(errors, []);
});

test('import CSV: lista z Excela wczytana z potwierdzeniem, istniejące wpisy nietknięte', async () => {
  const app = boot();
  await tick(60);
  const { w, doc, errors } = app;
  const y = Core.addDays(today, -1), y2 = Core.addDays(today, -2), y3 = Core.addDays(today, -3);
  await w.__utarg.submitDay(y, '500', false, null);
  click(w, q(doc, '.tabbar [data-view="settings"]'));
  const dmy = (k) => { const p = Core.parseKey(k); return `${p.d}.${p.m + 1}.${p.y}`; };
  const csv = `Data;Utarg\n${dmy(y)};9999\n${dmy(y2)};1 234,50 zł\n${dmy(y3)};zamknięte\nzły wiersz;5\n`;
  const input = q(doc, '#import-file');
  Object.defineProperty(input, 'files', { value: [new w.File([csv], 'historia.csv', { type: 'text/csv' })], configurable: true });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
  await tick(100);
  assert.match(text(doc, '#cf-text'), /Nowych dni do dodania: 2/);
  assert.match(text(doc, '#cf-text'), /już mają wpis: 1/);
  assert.match(text(doc, '#cf-text'), /Nie wczytano wierszy: 1/);
  click(w, q(doc, '[data-action="confirm-yes"]'));
  await tick(50);
  const d = w.__utarg.state.data;
  assert.equal(Core.getDay(d, y).a, 50000);
  assert.equal(Core.getDay(d, y2).a, 123450);
  assert.equal(Core.getDay(d, y3).c, true);
  assert.deepEqual(errors, []);
});

test('import CSV: błędny plik daje komunikat zamiast zapisu', async () => {
  const app = boot();
  await tick(60);
  const { w, doc } = app;
  click(w, q(doc, '.tabbar [data-view="settings"]'));
  const input = q(doc, '#import-file');
  Object.defineProperty(input, 'files', { value: [new w.File(['coś zupełnie innego\nbez dat'], 'x.csv', { type: 'text/csv' })], configurable: true });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
  await tick(100);
  assert.match(text(doc, '#toasts'), /Nie znaleziono|nie wygląda/);
  assert.equal(Object.keys(w.__utarg.state.data.days).length, 0);
});

test('raporty: miesięczny i roczny przygotowują treść do druku z poprawnymi sumami', async () => {
  const app = boot();
  await tick(60);
  const { w, doc, errors } = app;
  await seedDays(app, 5);
  let printed = 0;
  w.print = () => { printed++; };
  click(w, q(doc, '.tabbar [data-view="month"]'));
  click(w, q(doc, '[data-action="print-month"]'));
  assert.equal(printed, 1);
  assert.ok(doc.body.classList.contains('printing'));
  const rep = text(doc, '#print-root');
  assert.match(rep, /Raport miesięczny/);
  const ms = Core.monthStats(w.__utarg.state.data, tp.y, tp.m, { today });
  assert.ok(rep.includes(Core.formatMoney(ms.total)), 'suma miesiąca w raporcie');
  assert.equal(doc.querySelectorAll('#print-root .rp-table tbody tr').length, Core.daysInMonth(tp.y, tp.m));
  w.dispatchEvent(new w.Event('afterprint'));
  assert.equal(doc.body.classList.contains('printing'), false);
  assert.equal(doc.getElementById('print-root').innerHTML, '');

  click(w, q(doc, '.tabbar [data-view="year"]'));
  click(w, q(doc, '[data-action="print-year"]'));
  const yr = text(doc, '#print-root');
  assert.match(yr, /Raport roczny/);
  const ys = Core.yearStats(w.__utarg.state.data, tp.y, { today });
  assert.ok(yr.includes(Core.formatMoney(ys.total)));
  assert.equal(doc.querySelectorAll('#print-root .rp-table tbody tr').length, 12);
  assert.deepEqual(errors, []);
});

function addExpense(app, amount, note, date) {
  const { w, doc } = app;
  click(w, q(doc, '[data-action="exp-add"]'));
  typeInto(w, q(doc, '#ex-amount'), amount);
  if (note !== undefined) typeInto(w, q(doc, '#ex-note'), note);
  if (date) q(doc, '#ex-date').value = date;
  click(w, q(doc, '[data-action="exp-save"]'));
}

test('wydatki: dodanie w widoku Dziś, wiele w jednym dniu, wynik w miesiącu, edycja, usuwanie i cofanie', async () => {
  const app = boot();
  await tick(60);
  const { w, doc, errors } = app;
  typeInto(w, q(doc, '#amount-input'), '2000');
  click(w, q(doc, '[data-action="today-save"]'));
  await tick();

  click(w, q(doc, '[data-action="exp-add"]'));
  assert.equal(q(doc, '#ex-date').value, today, 'domyślnie wybrany dzień');
  // błędne dane nie zapisują
  typeInto(w, q(doc, '#ex-amount'), '');
  click(w, q(doc, '[data-action="exp-save"]'));
  assert.ok(q(doc, '#ex-hint.err'));
  typeInto(w, q(doc, '#ex-amount'), '0');
  click(w, q(doc, '[data-action="exp-save"]'));
  assert.match(text(doc, '#ex-hint'), /większą od zera/);
  assert.equal(Core.countExpenses(w.__utarg.state.data), 0);
  typeInto(w, q(doc, '#ex-amount'), '5000');
  assert.equal(text(doc, '#ex-hint'), '= 5' + NB + '000,00' + NB + 'zł');
  click(w, q(doc, '[data-action="exp-tag"][data-tag="goods"]'));
  assert.equal(q(doc, '#ex-note').value, 'towar');
  typeInto(w, q(doc, '#ex-note'), 'Zatowarowanie - hurtownia');
  assert.equal(q(doc, '[data-tag="goods"]').getAttribute('aria-pressed'), 'true');
  click(w, q(doc, '[data-action="exp-save"]'));
  await tick();
  assert.equal(q(doc, '.sheet'), null, 'okno zamknięte');
  const list1 = Core.listExpenses(w.__utarg.state.data);
  assert.equal(list1.length, 1);
  assert.equal(list1[0].a, 500000);
  assert.equal(list1[0].d, today);
  assert.match(text(doc, '#view'), /Zatowarowanie - hurtownia/);
  // utarg nietknięty, w kafelku miesiąca wynik (strata 3000 zł)
  assert.equal(w.__utarg.state.data.days[today].a, 200000);
  assert.match(text(doc, '#view'), /Wydatki −5.000,00.zł · strata 3.000,00.zł/);

  // drugi wydatek tego samego dnia
  addExpense(app, '123,45', 'prąd');
  await tick();
  assert.equal(Core.listExpenses(w.__utarg.state.data, today, today).length, 2);
  assert.match(text(doc, '#view'), /Razem wydatki/);

  // edycja pierwszego
  click(w, doc.querySelectorAll('[data-action="exp-edit"]')[0]);
  assert.equal(q(doc, '#ex-amount').value, '5000');
  typeInto(w, q(doc, '#ex-amount'), '4500');
  click(w, q(doc, '[data-action="exp-save"]'));
  await tick();
  assert.equal(Core.expenseTotal(w.__utarg.state.data), 450000 + 12345);
  // cofnięcie edycji
  click(w, q(doc, '[data-action="toast-undo"]'));
  await tick();
  assert.equal(Core.expenseTotal(w.__utarg.state.data), 500000 + 12345);

  // usunięcie i cofnięcie
  click(w, doc.querySelectorAll('[data-action="exp-edit"]')[1]);
  click(w, q(doc, '[data-action="exp-delete"]'));
  await tick();
  assert.equal(Core.countExpenses(w.__utarg.state.data), 1);
  click(w, q(doc, '[data-action="toast-undo"]'));
  await tick();
  assert.equal(Core.countExpenses(w.__utarg.state.data), 2);

  // widok miesiąca: wiersz dnia z wydatkiem, podsumowanie i zysk/strata
  click(w, q(doc, '.tabbar [data-view="month"]'));
  const mv = text(doc, '#view');
  assert.match(mv, /Wydatki w miesiącu/);
  assert.match(mv, /Strata miesiąca/);
  assert.match(mv, /−5.123,45.zł/);
  assert.ok(q(doc, '.hero-fin'));
  // widok roku
  click(w, q(doc, '.tabbar [data-view="year"]'));
  assert.match(text(doc, '#view'), /Wydatki −5.123,45.zł.*Strata 3.123,45.zł/);
  click(w, q(doc, '[data-action="year-mode"][data-mode="months"]'));
  assert.match(text(doc, '#view'), /Strata roku/);
  assert.deepEqual(errors, []);
});

test('wydatki: data wsteczna i blokada daty z przyszłości; wydatek w dniu bez utargu', async () => {
  const app = boot();
  await tick(60);
  const { w, doc } = app;
  const past = Core.addDays(today, -3);
  addExpense(app, '300', 'czynsz', past);
  await tick();
  assert.equal(Core.listExpenses(w.__utarg.state.data)[0].d, past);
  // wydatek nie liczy się jako wpis dnia – dzień nadal „bez wpisu”
  assert.equal(Core.getDay(w.__utarg.state.data, past), null);
  click(w, q(doc, '[data-action="exp-add"]'));
  typeInto(w, q(doc, '#ex-amount'), '10');
  q(doc, '#ex-date').value = Core.addDays(today, 2);
  click(w, q(doc, '[data-action="exp-save"]'));
  assert.match(text(doc, '#ex-hint'), /poprawną datę/);
  assert.equal(Core.countExpenses(w.__utarg.state.data), 1);
});

test('ANALIZA w aplikacji: wydatki liczone osobno, dzień z zatowarowaniem nie jest „nieopłacalny”', async () => {
  const app = boot();
  await tick(60);
  const { w, doc, errors } = app;
  // 20 dni po ~1000 zł; koszt otwarcia 300 zł; jeden dzień z ogromnym wydatkiem na towar
  for (let i = 1; i <= 20; i++) await w.__utarg.submitDay(Core.addDays(today, -i), '1000', false, null);
  const st = w.__utarg.state;
  st.settings.openCost = 30000;
  addExpense(app, '9000', 'zatowarowanie', Core.addDays(today, -5));
  await tick();
  click(w, q(doc, '.tabbar [data-view="analysis"]'));
  const v = text(doc, '#view');
  assert.match(v, /Wydatki i wynik/);
  assert.match(v, /Towar/);
  assert.match(v, /nie wpływają na ocenę dni/);
  assert.match(v, /Wydatki w okresie/);
  // nic nie twierdzi, że otwarcie się nie opłaca
  assert.doesNotMatch(v, /niższy niż koszt otwarcia|poniżej kosztu otwarcia/);
  const an = Core.analyze(st.data, { today, from: Core.addDays(today, -89), openCost: 30000 });
  assert.equal(an.belowCost, 0);
  assert.equal(an.expTotal, 900000);
  assert.equal(doc.querySelectorAll('[style]').length, 0);
  assert.deepEqual(errors, []);
});

test('wydatki: kopia na GitHub zawiera wydatki i scala się z drugim urządzeniem', async () => {
  const gh = fakeGithub();
  // „drugie urządzenie” już wysłało utarg i wydatek
  let remote = Core.emptyData();
  remote = Core.setDay(remote, Core.addDays(today, -1), 150000, false, 1000);
  remote = Core.setExpense(remote, 'zdalny1', Core.addDays(today, -1), 70000, 'prąd', 1001);
  gh.file = { text: Core.serialize(remote), sha: 'sha0' };
  const app = boot({ fetch: gh.fetch });
  await tick(60);
  const { w, doc, errors } = app;
  addExpense(app, '200', 'lokalny');
  await tick();
  click(w, q(doc, '.tabbar [data-view="settings"]'));
  typeInto(w, q(doc, '#repo-input'), 'jan/utarg-dane');
  typeInto(w, q(doc, '#token-input'), 'tok');
  click(w, q(doc, '[data-action="sync-connect"]'));
  await tick(400);
  const uploaded = Core.parseSerialized(gh.file.text).data;
  assert.equal(Core.countExpenses(uploaded), 2);
  assert.ok(Core.getExpense(uploaded, 'zdalny1'));
  assert.equal(Core.countEntries(uploaded), 1);
  // i lokalnie widać wydatek z drugiego urządzenia
  assert.equal(Core.countExpenses(w.__utarg.state.data), 2);
  assert.match(w.localStorage.getItem('utarg.data.v1'), /"exp": \{/);
  assert.deepEqual(errors, []);
});

test('wydatki: plik kopii z wydatkami przy wczytywaniu i eksport CSV wydatków', async () => {
  const src = Core.setExpense(Core.setDay(Core.emptyData(), Core.addDays(today, -1), 100, false, 5), 'abc', Core.addDays(today, -1), 4200, 'ZUS', 6);
  const app = boot();
  await tick(60);
  const { w, doc } = app;
  click(w, q(doc, '.tabbar [data-view="settings"]'));
  const input = q(doc, '#import-file');
  Object.defineProperty(input, 'files', { value: [new w.File([Core.serialize(src)], 'kopia.json', { type: 'application/json' })], configurable: true });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
  await tick(100);
  assert.match(text(doc, '#cf-text'), /Nowych lub nowszych wpisów: 2/);
  click(w, q(doc, '[data-action="confirm-yes"]'));
  await tick(50);
  assert.equal(Core.countExpenses(w.__utarg.state.data), 1);
  assert.ok(q(doc, '[data-action="export-exp-csv"]'));
  assert.match(text(doc, '#view'), /wydatków: 1/);
});

test('raporty: miesięczny i roczny zawierają wydatki i wynik', async () => {
  const app = boot();
  await tick(60);
  const { w, doc } = app;
  await w.__utarg.submitDay(today, '1000', false, null);
  addExpense(app, '2500', 'czynsz');
  await tick();
  w.print = () => {};
  click(w, q(doc, '.tabbar [data-view="month"]'));
  click(w, q(doc, '[data-action="print-month"]'));
  const rep = text(doc, '#print-root');
  assert.match(rep, /Wydatki/);
  assert.match(rep, /Strata miesiąca/);
  assert.ok(rep.includes('−2' + NB + '500,00' + NB + 'zł'));
  w.dispatchEvent(new w.Event('afterprint'));
  click(w, q(doc, '.tabbar [data-view="year"]'));
  click(w, q(doc, '[data-action="print-year"]'));
  const yr = text(doc, '#print-root');
  assert.match(yr, /Wynik/);
  assert.ok(yr.includes('−1' + NB + '500,00' + NB + 'zł'));
});

test('kopia i import: pełny obieg przez plik JSON przenosi utarg, notatki, wydatki i ustawienia', async () => {
  const a = boot();
  await tick(60);
  await a.w.__utarg.submitDay(Core.addDays(today, -1), '1500', false, null, 'deszcz');
  await a.w.__utarg.submitDay(Core.addDays(today, -2), '0', true, null);
  addExpense(a, '5000', 'zatowarowanie', Core.addDays(today, -1));
  await tick();
  click(a.w, q(a.doc, '.tabbar [data-view="settings"]'));
  click(a.w, q(a.doc, '[data-action="weekday"][data-d="0"]'));
  q(a.doc, '#cost-input').value = '250';
  q(a.doc, '#cost-input').dispatchEvent(new a.w.Event('change', { bubbles: true }));
  const exported = Core.serialize(a.w.__utarg.state.data);
  assert.match(exported, /"exp": \{/);
  assert.match(exported, /"cfg": \{"w": \[0\], "c": 25000/);

  const b = boot();
  await tick(60);
  click(b.w, q(b.doc, '.tabbar [data-view="settings"]'));
  const input = q(b.doc, '#import-file');
  Object.defineProperty(input, 'files', { value: [new b.w.File([exported], 'kopia.json', { type: 'application/json' })], configurable: true });
  input.dispatchEvent(new b.w.Event('change', { bubbles: true }));
  await tick(100);
  const dlg = text(b.doc, '#cf-text');
  assert.match(dlg, /dni z utargiem: 2/);
  assert.match(dlg, /wydatki: 1/);
  assert.match(dlg, /ustawienia/);
  click(b.w, q(b.doc, '[data-action="confirm-yes"]'));
  await tick(60);
  const sb = b.w.__utarg.state;
  assert.equal(Core.sameData(sb.data, a.w.__utarg.state.data), true);
  assert.deepEqual(Array.from(sb.settings.closedWeekdays), [0]);
  assert.equal(sb.settings.openCost, 25000);
  assert.match(b.w.localStorage.getItem('utarg.settings.v1'), /"openCost":25000/);
  assert.deepEqual([...a.errors, ...b.errors], []);
});

test('ustawienia (dni wolne, koszt otwarcia) synchronizują się przez GitHub razem z danymi', async () => {
  const gh = fakeGithub();
  const a = boot({ fetch: gh.fetch });
  await tick(60);
  click(a.w, q(a.doc, '.tabbar [data-view="settings"]'));
  click(a.w, q(a.doc, '[data-action="weekday"][data-d="0"]'));
  q(a.doc, '#cost-input').value = '300';
  q(a.doc, '#cost-input').dispatchEvent(new a.w.Event('change', { bubbles: true }));
  typeInto(a.w, q(a.doc, '#repo-input'), 'jan/utarg-dane');
  typeInto(a.w, q(a.doc, '#token-input'), 'tok');
  click(a.w, q(a.doc, '[data-action="sync-connect"]'));
  await tick(300);
  assert.match(gh.file.text, /"cfg": \{"w": \[0\], "c": 30000/);

  // drugie urządzenie dostaje ustawienia po połączeniu
  const b = boot({ fetch: gh.fetch });
  await tick(60);
  assert.deepEqual(Array.from(b.w.__utarg.state.settings.closedWeekdays), []);
  click(b.w, q(b.doc, '.tabbar [data-view="settings"]'));
  typeInto(b.w, q(b.doc, '#repo-input'), 'jan/utarg-dane');
  typeInto(b.w, q(b.doc, '#token-input'), 'tok');
  click(b.w, q(b.doc, '[data-action="sync-connect"]'));
  await tick(300);
  assert.deepEqual(Array.from(b.w.__utarg.state.settings.closedWeekdays), [0]);
  assert.equal(b.w.__utarg.state.settings.openCost, 30000);
  // i pierwsze urządzenie widzi zmianę z drugiego po odświeżeniu w tle
  click(b.w, q(b.doc, '.tabbar [data-view="settings"]'));
  click(b.w, q(b.doc, '[data-action="weekday"][data-d="6"]'));
  await tick(1200);
  await a.w.UtargSync.poll();
  await tick(50);
  assert.deepEqual(Array.from(a.w.__utarg.state.settings.closedWeekdays).sort(), [0, 6]);
  assert.deepEqual([...a.errors, ...b.errors], []);
});

test('import CSV wydatków: wczytanie, ponowny import nie dubluje', async () => {
  const app = boot();
  await tick(60);
  const { w, doc, errors } = app;
  const d1 = Core.addDays(today, -1);
  const p = Core.parseKey(d1);
  const dmy = `${p.d}.${p.m + 1}.${p.y}`;
  const csv = `Data;Opis;Kwota\n${dmy};Zatowarowanie;5 000,00\n${dmy};prąd;123,45\nRazem rok;;5123,45\n`;
  click(w, q(doc, '.tabbar [data-view="settings"]'));
  for (let round = 1; round <= 2; round++) {
    const input = q(doc, '#import-file');
    Object.defineProperty(input, 'files', { value: [new w.File([csv], 'wydatki-2026.csv', { type: 'text/csv' })], configurable: true });
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
    await tick(100);
    if (round === 1) {
      assert.match(text(doc, '#cf-text'), /Wydatków do dodania: 2/);
      click(w, q(doc, '[data-action="confirm-yes"]'));
      await tick(60);
      assert.equal(Core.countExpenses(w.__utarg.state.data), 2);
      assert.equal(Core.expenseTotal(w.__utarg.state.data), 512345);
    } else {
      assert.match(text(doc, '#toasts'), /już są w aplikacji/);
      assert.equal(Core.countExpenses(w.__utarg.state.data), 2);
    }
  }
  assert.deepEqual(errors, []);
});
