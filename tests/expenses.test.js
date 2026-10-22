'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../js/core.js');

function build(days, exps) {
  let d = C.emptyData();
  let t = 1;
  for (const [key, a, closed, note] of days || []) d = C.setDay(d, key, a, !!closed, t++, note);
  for (const [id, date, a, note] of exps || []) d = C.setExpense(d, id, date, a, note, t++);
  return d;
}

test('wydatek: zapis, wiele wydatków w jednym dniu, usunięcie znacznikiem', () => {
  let d = build([['2026-10-22', 200000]], [['e1', '2026-10-22', 500000, 'Zatowarowanie'], ['e2', '2026-10-22', 12345, 'prąd']]);
  assert.equal(C.countExpenses(d), 2);
  assert.equal(C.expenseTotal(d, '2026-10-22', '2026-10-22'), 512345);
  assert.equal(C.getDay(d, '2026-10-22').a, 200000); // utarg nietknięty
  d = C.setExpense(d, 'e1', null, null, '', 99);
  assert.equal(C.countExpenses(d), 1);
  assert.equal(C.getExpense(d, 'e1'), null);
  assert.equal(d.exp.e1.a, null); // znacznik usunięcia zostaje (potrzebny do synchronizacji)
  assert.equal(d.exp.e1.d, '2026-10-22');
});

test('wydatek: walidacja kwoty, daty i identyfikatora', () => {
  const d = C.emptyData();
  assert.throws(() => C.setExpense(d, 'e1', '2026-10-22', 0, '', 1));
  assert.throws(() => C.setExpense(d, 'e1', '2026-10-22', -5, '', 1));
  assert.throws(() => C.setExpense(d, 'e1', '2026-13-01', 100, '', 1));
  assert.throws(() => C.setExpense(d, 'zły id!', '2026-10-22', 100, '', 1));
  assert.throws(() => C.setExpense(d, 'e1', '2026-10-22', 1.5, '', 1));
});

test('wydatki: zapis i odczyt pliku, stary plik bez wydatków, niezmieniony format bez wydatków', () => {
  const d = build([['2026-10-22', 100]], [['e1', '2026-10-22', 5000, 'czynsz "październik"']]);
  const text = C.serialize(d);
  assert.match(text, /"exp": \{/);
  const back = C.parseSerialized(text).data;
  assert.deepEqual(back.exp, d.exp);
  assert.equal(C.sameData(d, back), true);
  const noExp = build([['2026-10-22', 100]]);
  assert.doesNotMatch(C.serialize(noExp), /exp/);
  const old = C.parseSerialized('{"app":"utarg","v":1,"days":{"2026-01-02":{"a":500,"c":false,"t":9}}}').data;
  assert.deepEqual(old.exp, {});
  // plik z samymi wydatkami też jest poprawny
  const onlyExp = C.parseSerialized('{"v":1,"exp":{"x1":{"d":"2026-01-02","a":700,"t":3}}}');
  assert.equal(onlyExp.dropped, 0);
  assert.equal(onlyExp.data.exp.x1.a, 700);
});

test('wydatki: uszkodzone rekordy są odrzucane', () => {
  const r = C.validate({
    days: {},
    exp: {
      ok: { d: '2026-01-02', a: 100, t: 1 },
      zlaData: { d: '2026-02-30', a: 100, t: 1 },
      zeroKwota: { d: '2026-01-02', a: 0, t: 1 },
      ulamek: { d: '2026-01-02', a: 1.5, t: 1 },
      'zły id': { d: '2026-01-02', a: 100, t: 1 }
    }
  });
  assert.deepEqual(Object.keys(r.data.exp), ['ok']);
  assert.equal(r.dropped, 4);
});

test('wydatki: scalanie z dwóch urządzeń – dodane osobno sumują się, edycja wygrywa nowszą, remis deterministyczny', () => {
  const base = build([], [['e1', '2026-10-01', 1000, 'towar']]);
  const a = C.setExpense(base, 'ea', '2026-10-02', 200, 'prąd', 50);   // urządzenie A dopisuje
  const b = C.setExpense(base, 'eb', '2026-10-03', 300, 'gaz', 51);    // urządzenie B dopisuje
  const m1 = C.merge(a, b), m2 = C.merge(b, a);
  assert.deepEqual(m1, m2);
  assert.equal(C.countExpenses(m1), 3);
  assert.equal(C.expenseTotal(m1), 1500);
  // edycja tego samego wydatku: wygrywa nowsza
  const e1 = C.setExpense(a, 'e1', '2026-10-01', 2000, 'towar', 60);
  assert.equal(C.merge(e1, b).exp.e1.a, 2000);
  // usunięcie na jednym urządzeniu nie wraca po scaleniu ze starą wersją
  const del = C.setExpense(a, 'e1', null, null, '', 70);
  assert.equal(C.getExpense(C.merge(del, base), 'e1'), null);
  // remis czasu
  const x = C.setExpense(base, 'e1', '2026-10-01', 111, '', 80), y = C.setExpense(base, 'e1', '2026-10-01', 222, '', 80);
  assert.deepEqual(C.merge(x, y), C.merge(y, x));
  // scalanie jest idempotentne
  assert.deepEqual(C.merge(m1, m1), m1);
});

test('kategorie wydatków z opisu', () => {
  assert.equal(C.expCategoryOf('Zatowarowanie - hurtownia'), 'goods');
  assert.equal(C.expCategoryOf('Rachunek za prąd'), 'power');
  assert.equal(C.expCategoryOf('gaz i ogrzewanie'), 'heat');
  assert.equal(C.expCategoryOf('Czynsz za lokal'), 'rent');
  assert.equal(C.expCategoryOf('ZUS'), 'tax');
  assert.equal(C.expCategoryOf('kapitał'), 'other'); // "cit/pit" tylko na początku słowa
  assert.equal(C.expCategoryOf(''), 'other');
  assert.deepEqual(C.expCatsOf('towar + prąd'), ['goods', 'power']);
});

test('podsumowania miesiąca i roku: wydatki i wynik (zysk/strata), przełom miesięcy', () => {
  const d = build(
    [['2026-10-05', 300000], ['2026-10-06', 200000], ['2026-11-01', 100000]],
    [['a', '2026-10-31', 400000, 'towar'], ['b', '2026-11-01', 150000, 'czynsz'], ['c', '2026-10-01', 50000, 'prąd']]
  );
  const oct = C.monthStats(d, 2026, 9, { today: '2026-12-31' });
  assert.equal(oct.total, 500000);
  assert.equal(oct.expenses, 450000);
  assert.equal(oct.profit, 50000);
  const nov = C.monthStats(d, 2026, 10, { today: '2026-12-31' });
  assert.equal(nov.expenses, 150000);
  assert.equal(nov.profit, -50000);
  assert.equal(C.formatMoney(nov.profit), '−500,00 zł');
  const ys = C.yearStats(d, 2026, { today: '2026-12-31' });
  assert.equal(ys.expenses, 600000);
  assert.equal(ys.profit, 600000 - 600000);
  assert.equal(ys.expenses, C.expenseTotal(d, '2026-01-01', '2026-12-31'));
  const tr = C.trendMonths(d, '2026-11-15', 3);
  assert.deepEqual(tr.map((x) => x.profit), [0, 50000, -50000]);
});

test('ANALIZA: dzień z zatowarowaniem NIE jest oceniany jako nieopłacalny', () => {
  // 10 zwykłych dni po 1000 zł; dzień z utargiem 200 zł, ale z ogromnym wydatkiem na towar 5000 zł
  const days = [];
  for (let i = 1; i <= 10; i++) days.push(['2026-09-' + String(i).padStart(2, '0'), 100000]);
  days.push(['2026-09-15', 20000, false, 'zatowarowanie']);
  days.push(['2026-09-16', 20000]); days.push(['2026-09-17', 20000]);
  const exps = [['t1', '2026-09-15', 500000, 'Zatowarowanie'], ['p1', '2026-09-16', 90000, 'prąd za 2 miesiące']];
  const withExp = build(days, exps);
  const withoutExp = build(days, []);
  const o = { today: '2026-09-30', openCost: 50000 };
  const a1 = C.analyze(withExp, o), a0 = C.analyze(withoutExp, o);
  // ocena dni jest identyczna z wydatkami i bez nich
  assert.deepEqual(a1.weekdays, a0.weekdays);
  assert.deepEqual(a1.tags, a0.tags);
  assert.equal(a1.belowCost, a0.belowCost);
  assert.deepEqual(a1.best, a0.best);
  assert.deepEqual(a1.worst, a0.worst);
  assert.equal(a1.avg, a0.avg);
  // a wynik finansowy uwzględnia wydatki
  assert.equal(a1.expTotal, 590000);
  assert.equal(a1.result, a1.total - 590000);
  assert.equal(a1.expCats.find((c) => c.id === 'goods').total, 500000);
  assert.equal(a1.expCats.find((c) => c.id === 'power').total, 90000);
  assert.equal(a1.breakEven, Math.ceil(590000 / 13));
  const text = C.insights(a1).join('\n');
  assert.match(text, /strata|zysk/);
  assert.match(text, /nie wpływają na ocenę poszczególnych dni/);
  assert.doesNotMatch(C.insights(a0).join('\n'), /Wydatki w okresie/);
});

test('analiza: wydatki w okresie liczone po dacie wydatku, także bez utargu tego dnia', () => {
  const d = build([['2026-09-10', 100000]], [['a', '2026-08-31', 7000, 'czynsz'], ['b', '2026-09-20', 3000, ''], ['c', '2026-10-05', 1000, '']]);
  const an = C.analyze(d, { today: '2026-09-30', from: '2026-09-01' });
  assert.equal(an.expTotal, 3000);
  assert.equal(an.expCats[0].id, 'other');
  const all = C.analyze(d, { today: '2026-09-30' });
  assert.equal(all.expTotal, 10000);
});

test('eksport wydatków do CSV', () => {
  const d = build([], [['a', '2026-03-05', 123456, 'Prąd; "marzec"'], ['b', '2026-01-02', 100, 'x'], ['c', '2025-12-31', 999, 'stary']]);
  const lines = C.csvExpenses(d, 2026).trim().split('\r\n');
  assert.equal(lines[0], 'Data;Opis;Kwota');
  assert.equal(lines[1], '02.01.2026;x;1,00');
  assert.equal(lines[2], '05.03.2026;"Prąd; ""marzec""";1234,56');
  assert.equal(lines[3], 'Razem rok 2026;;1235,56');
});

/* ---------- Kopie i importy: pełny obieg ---------- */

function fullData() {
  let d = C.emptyData();
  d = C.setDay(d, '2026-10-05', 123450, false, 10, 'deszcz');
  d = C.setDay(d, '2026-10-06', 0, true, 11, 'święto');
  d = C.setDay(d, '2026-10-07', 99900, false, 12);
  d = C.setExpense(d, 'e1', '2026-10-05', 500000, 'Zatowarowanie', 13);
  d = C.setExpense(d, 'e2', '2026-10-05', 12345, 'prąd', 14);
  d = C.setExpense(d, 'e3', '2026-09-30', 7000, 'Czynsz; "wrzesień"', 15);
  d = C.setCfg(d, [0, 6], 30000, 16);
  return d;
}

test('kopia JSON zawiera wszystko i wraca bez zmian (utarg, notatki, wydatki, ustawienia)', () => {
  const d = fullData();
  const back = C.parseSerialized(C.serialize(d));
  assert.equal(back.dropped, 0);
  assert.deepEqual(back.data, d);
  assert.equal(C.serialize(back.data), C.serialize(d));
  assert.deepEqual(back.data.cfg, { w: [0, 6], c: 30000, t: 16 });
});

test('ustawienia: scalanie – nowsze wygrywa, remis deterministyczny, brak ustawień nie kasuje', () => {
  const a = C.setCfg(C.emptyData(), [0], 100, 5);
  const b = C.setCfg(C.emptyData(), [1], 200, 9);
  assert.deepEqual(C.merge(a, b).cfg, b.cfg);
  assert.deepEqual(C.merge(b, a).cfg, b.cfg);
  assert.deepEqual(C.merge(a, C.emptyData()).cfg, a.cfg);
  const x = C.setCfg(C.emptyData(), [1], 100, 5), y = C.setCfg(C.emptyData(), [2], 100, 5);
  assert.deepEqual(C.merge(x, y), C.merge(y, x));
  // merge zachowuje wydatki i ustawienia przy zapisie dnia
  const z = C.setDay(fullData(), '2026-10-08', 1, false, 99);
  assert.ok(z.cfg && Object.keys(z.exp).length === 3);
  assert.ok(C.setExpense(fullData(), 'e9', '2026-10-01', 5, '', 99).cfg);
  assert.ok(C.addEntries(fullData(), [], 1).data.cfg);
});

test('ustawienia: uszkodzone ustawienia są odrzucane, poprawne czyszczone', () => {
  assert.equal(C.validate({ days: {}, cfg: { w: [1], c: -5, t: 1 } }).data.cfg, undefined);
  assert.equal(C.validate({ days: {}, cfg: { w: [1], c: 5 } }).data.cfg, undefined);
  assert.deepEqual(C.validate({ days: {}, cfg: { w: [6, 0, 6, 9, 'x'], c: 0, t: 3 } }).data.cfg, { w: [0, 6], c: 0, t: 3 });
});

test('lista dni CSV: zawiera notatki i dni zamknięte i wczytuje się z powrotem 1:1', () => {
  const d = fullData();
  const csv = C.csvDays(d, 2026);
  assert.match(csv, /05\.10\.2026;1234,50;deszcz/);
  assert.match(csv, /06\.10\.2026;zamknięte;święto/);
  assert.match(csv, /Razem rok 2026;2233,50;/);
  const r = C.parseCsvImport(csv, { today: '2026-12-31' });
  assert.deepEqual(r.skipped, []);
  const fresh = C.addEntries(C.emptyData(), r.entries, 1000).data;
  for (const k of ['2026-10-05', '2026-10-06', '2026-10-07']) {
    assert.equal(fresh.days[k].a, d.days[k].a);
    assert.equal(fresh.days[k].c, d.days[k].c);
    assert.equal(fresh.days[k].n, d.days[k].n);
  }
});

test('wydatki CSV: wyeksportowana lista wczytuje się z powrotem, ponowny import niczego nie dubluje', () => {
  const d = fullData();
  const csv = C.csvExpenses(d, 2026);
  const r = C.parseCsvImport(csv, { today: '2026-12-31' });
  assert.equal(r.layout, 'expenses');
  assert.deepEqual(r.skipped, []);
  assert.equal(r.expenses.length, 3);
  const fresh = C.addExpenseEntries(C.emptyData(), r.expenses, 1000);
  assert.equal(fresh.added, 3);
  assert.equal(C.expenseTotal(fresh.data), 500000 + 12345 + 7000);
  assert.deepEqual(C.listExpenses(fresh.data).map((e) => [e.d, e.a, e.n]), C.listExpenses(d).map((e) => [e.d, e.a, e.n]));
  // drugi raz to samo – nic nowego
  const again = C.addExpenseEntries(fresh.data, r.expenses, 2000);
  assert.equal(again.added, 0);
  assert.equal(again.existing, 3);
  // wydatki wpisane ręcznie też są rozpoznawane jako już istniejące
  const manual = C.addExpenseEntries(d, r.expenses, 3000);
  assert.equal(manual.added, 0);
  // dwa identyczne wydatki w jednym dniu to dwa wydatki
  const two = C.parseCsvImport('Data;Opis;Kwota\n05.10.2026;kawa;10\n05.10.2026;kawa;10\n', { today: '2026-12-31' });
  const twoRes = C.addExpenseEntries(C.emptyData(), two.expenses, 5);
  assert.equal(twoRes.added, 2);
  assert.equal(C.addExpenseEntries(twoRes.data, two.expenses, 6).added, 0);
  // ten sam plik na dwóch urządzeniach daje te same identyfikatory, więc po scaleniu nie ma duplikatów
  const dev1 = C.addExpenseEntries(C.emptyData(), r.expenses, 100).data;
  const dev2 = C.addExpenseEntries(C.emptyData(), r.expenses, 200).data;
  assert.equal(C.countExpenses(C.merge(dev1, dev2)), 3);
});

test('wydatki CSV: nagłówek „Wydatek”, kwota zero i data z przyszłości są odrzucane z powodem', () => {
  const r = C.parseCsvImport('Data;Wydatek\n2026-10-05;100\n2026-10-06;0\n2027-01-01;5\n', { today: '2026-10-22' });
  assert.equal(r.layout, 'expenses');
  assert.equal(r.expenses.length, 1);
  assert.equal(r.skipped.length, 2);
});

test('lista dni z kolumnami w innej kolejności i nagłówkiem (Excel)', () => {
  const r = C.parseCsvImport('Uwagi;Data;Utarg\nupał;05.10.2026;500\n;06.10.2026;600\n', { today: '2026-12-31' });
  assert.equal(r.layout, 'list');
  assert.deepEqual(r.entries.map((e) => [e.key, e.a, e.n]), [['2026-10-05', 50000, 'upał'], ['2026-10-06', 60000, '']]);
});
