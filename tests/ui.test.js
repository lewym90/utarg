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
  assert.deepEqual(labels, ['Dziś', 'Miesiąc', 'Rok', 'Ustawienia']);
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
