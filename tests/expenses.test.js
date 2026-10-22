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
