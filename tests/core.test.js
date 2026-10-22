'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');

/* deterministyczny generator losowy, żeby testy były powtarzalne */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('liczba dni w miesiącu, w tym lata przestępne', () => {
  assert.equal(C.daysInMonth(2024, 1), 29);
  assert.equal(C.daysInMonth(2026, 1), 28);
  assert.equal(C.daysInMonth(2000, 1), 29);
  assert.equal(C.daysInMonth(1900 + 200, 1), 28); // 2100 nie jest przestępny
  assert.equal(C.daysInMonth(2100, 1), 28);
  const expected = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  for (let m = 0; m < 12; m++) assert.equal(C.daysInMonth(2026, m), expected[m]);
  let sum = 0;
  for (let m = 0; m < 12; m++) sum += C.daysInMonth(2026, m);
  assert.equal(sum, 365);
  sum = 0;
  for (let m = 0; m < 12; m++) sum += C.daysInMonth(2028, m);
  assert.equal(sum, 366);
});

test('daty: klucze, dni tygodnia, przesuwanie', () => {
  assert.equal(C.dateKey(2026, 9, 22), '2026-10-22');
  assert.deepEqual(C.parseKey('2026-10-22'), { y: 2026, m: 9, d: 22 });
  assert.equal(C.parseKey('2026-02-29'), null);
  assert.deepEqual(C.parseKey('2028-02-29'), { y: 2028, m: 1, d: 29 });
  assert.equal(C.parseKey('2026-13-01'), null);
  assert.equal(C.parseKey('1999-01-01'), null);
  assert.equal(C.parseKey('abc'), null);
  assert.equal(C.weekdayOfKey('2026-10-22'), 4); // czwartek
  assert.equal(C.longDate('2026-10-22'), 'czwartek, 22 października 2026');
  assert.equal(C.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(C.addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(C.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(C.addDays('2026-02-28', 1), '2026-03-01');
  // zmiana czasu nie psuje dat
  assert.equal(C.addDays('2026-03-28', 1), '2026-03-29');
  assert.equal(C.addDays('2026-03-29', 1), '2026-03-30');
  assert.equal(C.addDays('2026-10-24', 1), '2026-10-25');
  assert.equal(C.addDays('2026-10-25', 1), '2026-10-26');
});

test('odmiana polska', () => {
  const f = (n) => C.plural(n, 'dzień', 'dni', 'dni');
  assert.equal(C.plural(1, 'wpis', 'wpisy', 'wpisów'), 'wpis');
  assert.equal(C.plural(2, 'wpis', 'wpisy', 'wpisów'), 'wpisy');
  assert.equal(C.plural(5, 'wpis', 'wpisy', 'wpisów'), 'wpisów');
  assert.equal(C.plural(12, 'wpis', 'wpisy', 'wpisów'), 'wpisów');
  assert.equal(C.plural(22, 'wpis', 'wpisy', 'wpisów'), 'wpisy');
  assert.equal(C.plural(0, 'wpis', 'wpisy', 'wpisów'), 'wpisów');
  assert.equal(f(1), 'dzień');
  assert.equal(f(3), 'dni');
});

test('parseAmount: poprawne zapisy', () => {
  const ok = (s, v) => {
    const r = C.parseAmount(s);
    assert.equal(r.ok, true, 'powinno być poprawne: ' + s);
    assert.equal(r.value, v, s);
  };
  ok('0', 0);
  ok('0,00', 0);
  ok('1', 100);
  ok('1250', 125000);
  ok('1250,5', 125050);
  ok('1250,50', 125050);
  ok('1250.5', 125050);
  ok('1 250,50', 125050);
  ok('1 250,50', 125050);
  ok('1.250,50', 125050);
  ok('1,250.50', 125050);
  ok('1.250.000', 125000000);
  ok('1,250,000', 125000000);
  ok(',5', 50);
  ok('12,', 1200);
  ok('4280,50 zł', 428050);
  ok('4280,50zł', 428050);
  ok('0,01', 1);
  ok('007', 700);
  ok('99999,99', 9999999);
  ok('  250  ', 25000);
});

test('parseAmount: odrzuca błędne i niejednoznaczne zapisy', () => {
  const bad = (s) => {
    const r = C.parseAmount(s);
    assert.equal(r.ok, false, 'powinno być odrzucone: ' + JSON.stringify(s));
    assert.ok(r.error && r.error.length > 0);
  };
  bad('');
  bad('   ');
  bad('abc');
  bad('-5');
  bad('12,345');
  bad('1.234');
  bad('1,234');
  bad('12,3456');
  bad('1..5');
  bad('1,2,3');
  bad('1.2.3');
  bad('.');
  bad(',');
  bad('1e5');
  bad('12 zł zł');
  bad('99999999999');
  bad('1.2345,50');
});

test('formatowanie kwot', () => {
  assert.equal(C.formatGrosze(0), '0,00');
  assert.equal(C.formatGrosze(5), '0,05');
  assert.equal(C.formatGrosze(100), '1,00');
  assert.equal(C.formatGrosze(428050), '4 280,50');
  assert.equal(C.formatGrosze(76190310), '761 903,10');
  assert.equal(C.formatGrosze(123456789), '1 234 567,89');
  assert.equal(C.formatMoney(100), '1,00 zł');
  assert.equal(C.toInputString(428050), '4280,50');
  assert.equal(C.toInputString(428000), '4280');
  assert.equal(C.toInputString(5), '0,05');
  // formatowanie i parsowanie są wzajemnie odwrotne
  const rand = rng(7);
  for (let i = 0; i < 2000; i++) {
    const g = Math.floor(rand() * 5e9);
    assert.equal(C.parseAmount(C.formatGrosze(g)).value, g);
    assert.equal(C.parseAmount(C.toInputString(g)).value, g);
  }
});

test('klasyczne błędy zmiennoprzecinkowe nie występują', () => {
  // 0,10 + 0,20 musi dać dokładnie 0,30
  let d = C.emptyData();
  d = C.setDay(d, '2026-01-01', C.parseAmount('0,10').value, false, 1);
  d = C.setDay(d, '2026-01-02', C.parseAmount('0,20').value, false, 2);
  const s = C.monthStats(d, 2026, 0, { today: '2026-12-31' });
  assert.equal(s.total, 30);
  assert.equal(C.formatGrosze(s.total), '0,30');
  // 1,15 * 100 w floatach to 114.99999999999999
  assert.equal(C.parseAmount('1,15').value, 115);
  assert.equal(C.parseAmount('4,35').value, 435);
  assert.equal(C.parseAmount('8,2').value, 820);
});

test('sumy miesięczne i roczne zgadzają się z niezależnym liczeniem (BigInt)', () => {
  const rand = rng(12345);
  for (const year of [2026, 2028]) {
    let d = C.emptyData();
    let expectedBig = 0n;
    const perMonth = new Array(12).fill(0n);
    let t = 1;
    for (let m = 0; m < 12; m++) {
      const n = C.daysInMonth(year, m);
      for (let day = 1; day <= n; day++) {
        if (rand() < 0.1) continue; // brak wpisu
        const closed = rand() < 0.1;
        const g = closed ? 0 : Math.floor(rand() * 20000000); // do 200 000 zł
        d = C.setDay(d, C.dateKey(year, m, day), g, closed, t++);
        expectedBig += BigInt(g);
        perMonth[m] += BigInt(g);
      }
    }
    const ys = C.yearStats(d, year, { today: '2999-12-31' });
    assert.equal(BigInt(ys.total), expectedBig);
    for (let m = 0; m < 12; m++) assert.equal(BigInt(ys.months[m].total), perMonth[m]);
    assert.equal(ys.total, C.yearTotalDirect(d, year));
    assert.equal(ys.months.reduce((a, s) => a + s.total, 0), ys.total);
  }
});

test('ostatni dzień miesiąca zamknięty – podsumowanie i tak działa', () => {
  // 31 października 2026 to sobota; sklep zamknięty, bez wpisu
  let d = C.emptyData();
  for (let day = 1; day <= 30; day++) {
    d = C.setDay(d, C.dateKey(2026, 9, day), 100000, false, day);
  }
  const today = '2026-11-02';
  let s = C.monthStats(d, 2026, 9, { today });
  assert.equal(s.total, 3000000); // 30 × 1000,00
  assert.equal(s.missing.length, 1);
  assert.equal(s.missing[0], '2026-10-31'); // aplikacja ostrzega o brakującym dniu
  assert.equal(s.finished, true);
  // oznaczenie dnia jako zamknięty usuwa ostrzeżenie i nie zmienia sumy
  d = C.setDay(d, '2026-10-31', 0, true, 100);
  s = C.monthStats(d, 2026, 9, { today });
  assert.equal(s.total, 3000000);
  assert.equal(s.missing.length, 0);
  assert.equal(s.closed, 1);
  assert.equal(s.open, 30);
  // suma miesiąca jest dostępna także zanim ktokolwiek wpisze ostatni dzień
  const partial = C.monthStats(C.setDay(C.emptyData(), '2026-10-05', 5000, false, 1), 2026, 9, { today: '2026-10-22' });
  assert.equal(partial.total, 5000);
});

test('stałe dni wolne (np. niedziele) nie są zgłaszane jako braki', () => {
  const d = C.emptyData();
  const s = C.monthStats(d, 2026, 9, { today: '2026-10-31', closedWeekdays: [0] });
  // październik 2026: niedziele to 4, 11, 18, 25
  assert.equal(s.standing, 4);
  assert.equal(s.missing.length, 27);
  assert.ok(!s.missing.includes('2026-10-04'));
  // wpisana kwota w niedzielę jest normalnie liczona
  const d2 = C.setDay(d, '2026-10-04', 12345, false, 1);
  const s2 = C.monthStats(d2, 2026, 9, { today: '2026-10-31', closedWeekdays: [0] });
  assert.equal(s2.total, 12345);
  assert.equal(s2.standing, 3);
});

test('przyszłe dni nie są brakami', () => {
  const s = C.monthStats(C.emptyData(), 2026, 9, { today: '2026-10-10' });
  assert.equal(s.missing.length, 10);
  const s2 = C.monthStats(C.emptyData(), 2026, 10, { today: '2026-10-10' });
  assert.equal(s2.missing.length, 0);
});

test('średnia dzienna liczona tylko z dni otwartych', () => {
  let d = C.emptyData();
  d = C.setDay(d, '2026-10-01', 100000, false, 1);
  d = C.setDay(d, '2026-10-02', 200000, false, 2);
  d = C.setDay(d, '2026-10-03', 0, true, 3);
  const s = C.monthStats(d, 2026, 9, { today: '2026-10-05' });
  assert.equal(s.avg, 150000);
  assert.equal(s.open, 2);
  assert.equal(s.closed, 1);
  assert.deepEqual(s.best, { key: '2026-10-02', a: 200000 });
});

test('usuwanie wpisu i ponowne wpisanie', () => {
  let d = C.emptyData();
  d = C.setDay(d, '2026-10-01', 5000, false, 10);
  d = C.setDay(d, '2026-10-01', null, false, 20);
  assert.equal(C.getDay(d, '2026-10-01'), null);
  assert.equal(C.countEntries(d), 0);
  d = C.setDay(d, '2026-10-01', 7000, false, 30);
  assert.equal(C.getDay(d, '2026-10-01').a, 7000);
  // znacznik czasu zawsze rośnie, nawet gdy zegar urządzenia się cofnie
  d = C.setDay(d, '2026-10-01', 8000, false, 5);
  assert.ok(d.days['2026-10-01'].t > 30);
});

test('zamknięty dzień zawsze ma kwotę 0', () => {
  const d = C.setDay(C.emptyData(), '2026-10-01', 99999, true, 1);
  assert.equal(d.days['2026-10-01'].a, 0);
  assert.equal(d.days['2026-10-01'].c, true);
});

test('setDay odrzuca niepoprawne dane', () => {
  assert.throws(() => C.setDay(C.emptyData(), '2026-02-30', 100, false, 1));
  assert.throws(() => C.setDay(C.emptyData(), '2026-02-01', -1, false, 1));
  assert.throws(() => C.setDay(C.emptyData(), '2026-02-01', 1.5, false, 1));
  assert.throws(() => C.setDay(C.emptyData(), '2026-02-01', NaN, false, 1));
});

test('setDay nie modyfikuje poprzednich danych', () => {
  const a = C.setDay(C.emptyData(), '2026-10-01', 100, false, 1);
  const b = C.setDay(a, '2026-10-02', 200, false, 2);
  assert.equal(Object.keys(a.days).length, 1);
  assert.equal(Object.keys(b.days).length, 2);
});

function randomData(rand, tBase) {
  let d = C.emptyData();
  const n = Math.floor(rand() * 25);
  for (let i = 0; i < n; i++) {
    const key = C.dateKey(2026, Math.floor(rand() * 3), 1 + Math.floor(rand() * 28));
    const roll = rand();
    const t = tBase + Math.floor(rand() * 10); // celowo dużo remisów czasu
    d = { v: 1, days: Object.assign({}, d.days) };
    if (roll < 0.15) d.days[key] = { a: null, c: false, t };
    else if (roll < 0.3) d.days[key] = { a: 0, c: true, t };
    else d.days[key] = { a: Math.floor(rand() * 100000), c: false, t };
  }
  return d;
}

test('scalanie jest przemienne, łączne i idempotentne (zbieżność urządzeń)', () => {
  const rand = rng(99);
  for (let i = 0; i < 300; i++) {
    const a = randomData(rand, 100);
    const b = randomData(rand, 100);
    const c = randomData(rand, 100);
    assert.ok(C.sameData(C.merge(a, b), C.merge(b, a)), 'przemienność');
    assert.ok(C.sameData(C.merge(a, a), a), 'idempotentność');
    assert.ok(C.sameData(C.merge(C.merge(a, b), c), C.merge(a, C.merge(b, c))), 'łączność');
  }
});

test('scalanie: nowszy wpis wygrywa, usunięcie też się synchronizuje', () => {
  const a = { v: 1, days: { '2026-10-01': { a: 100, c: false, t: 10 } } };
  const b = { v: 1, days: { '2026-10-01': { a: 200, c: false, t: 20 } } };
  assert.equal(C.merge(a, b).days['2026-10-01'].a, 200);
  assert.equal(C.merge(b, a).days['2026-10-01'].a, 200);
  const del = { v: 1, days: { '2026-10-01': { a: null, c: false, t: 30 } } };
  assert.equal(C.getDay(C.merge(a, del), '2026-10-01'), null);
  assert.equal(C.getDay(C.merge(del, b), '2026-10-01'), null);
  // dwa urządzenia dopisują różne dni – nic nie ginie
  const x = { v: 1, days: { '2026-10-01': { a: 1, c: false, t: 1 } } };
  const y = { v: 1, days: { '2026-10-02': { a: 2, c: false, t: 1 } } };
  const m = C.merge(x, y);
  assert.equal(C.countEntries(m), 2);
});

test('walidacja odrzuca uszkodzone dane, ale zachowuje poprawne', () => {
  const raw = {
    days: {
      '2026-10-01': { a: 1000, c: false, t: 5 },
      '2026-02-30': { a: 1000, c: false, t: 5 },
      '2026-10-02': { a: -5, c: false, t: 5 },
      '2026-10-03': { a: 1.5, c: false, t: 5 },
      '2026-10-04': { a: '100', c: false, t: 5 },
      '2026-10-05': { a: 500, c: true, t: 5 },
      '2026-10-06': { a: null, t: 9 },
      '2026-10-07': 'śmieci',
      '1850-01-01': { a: 1, c: false, t: 1 },
      '2026-10-08': { a: 100, c: false }
    }
  };
  const { data, dropped } = C.validate(raw);
  assert.equal(data.days['2026-10-01'].a, 1000);
  assert.equal(data.days['2026-10-05'].a, 0); // zamknięty → 0
  assert.equal(data.days['2026-10-06'].a, null);
  assert.equal(data.days['2026-10-08'].t, 0);
  assert.equal(Object.keys(data.days).length, 4);
  assert.equal(dropped, 6);
  assert.equal(C.validate(null).data.days && Object.keys(C.validate(null).data.days).length, 0);
  assert.equal(Object.keys(C.validate('x').data.days).length, 0);
  assert.equal(Object.keys(C.validate({ days: [] }).data.days).length, 0);
});

test('zapis i odczyt JSON są wzajemnie odwrotne', () => {
  const rand = rng(5);
  for (let i = 0; i < 100; i++) {
    const d = randomData(rand, 1000);
    const text = C.serialize(d);
    JSON.parse(text); // poprawny JSON
    const back = C.parseSerialized(text);
    assert.equal(back.dropped, 0);
    assert.ok(C.sameData(back.data, d));
    assert.equal(C.serialize(back.data), text); // stabilny zapis
  }
  assert.equal(C.parseSerialized('{{{').error, true);
  assert.equal(C.parseSerialized('').error, true);
});

test('zapis jest deterministyczny niezależnie od kolejności wstawiania', () => {
  const a = { v: 1, days: { '2026-10-02': { a: 2, c: false, t: 2 }, '2026-10-01': { a: 1, c: false, t: 1 } } };
  const b = { v: 1, days: { '2026-10-01': { a: 1, c: false, t: 1 }, '2026-10-02': { a: 2, c: false, t: 2 } } };
  assert.equal(C.serialize(a), C.serialize(b));
});

test('brakujące dni z ostatnich tygodni', () => {
  let d = C.emptyData();
  d = C.setDay(d, '2026-10-20', 1000, false, 1);
  d = C.setDay(d, '2026-10-18', 0, true, 2);
  const miss = C.missingRecent(d, '2026-10-22', 5, [0]); // 17–21 października
  assert.deepEqual(miss, ['2026-10-17', '2026-10-19', '2026-10-21']);
  const miss2 = C.missingRecent(d, '2026-10-22', 5, []);
  assert.deepEqual(miss2, ['2026-10-17', '2026-10-19', '2026-10-21']);
});

test('ostatnie wpisy i najwyższy utarg', () => {
  let d = C.emptyData();
  d = C.setDay(d, '2026-10-20', 1000, false, 1);
  d = C.setDay(d, '2026-10-21', 3000, false, 2);
  d = C.setDay(d, '2026-10-22', 2000, false, 3);
  d = C.setDay(d, '2026-10-25', 9999, false, 4); // przyszłość
  const r = C.recentEntries(d, '2026-10-22', 2);
  assert.deepEqual(r.map((x) => x.key), ['2026-10-22', '2026-10-21']);
  const m = C.maxOpenDay(d, '2026-10-22');
  assert.equal(m.max, 9999);
  assert.equal(m.count, 3);
});

test('eksport CSV roku', () => {
  let d = C.emptyData();
  d = C.setDay(d, '2026-01-01', 100050, false, 1);
  d = C.setDay(d, '2026-01-02', 50, false, 2);
  d = C.setDay(d, '2026-02-28', 0, true, 3);
  d = C.setDay(d, '2026-02-01', 123456789, false, 4);
  const csv = C.csvYear(d, 2026);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 1 + 31 + 2);
  assert.equal(lines[0].split(';').length, 13);
  assert.ok(lines[0].startsWith('Dzień;styczeń;luty;'));
  assert.equal(lines[1], '1;1000,50;1234567,89;;;;;;;;;;');
  assert.equal(lines[2], '2;0,50;;;;;;;;;;;');
  assert.equal(lines[28], '28;;0,00;;;;;;;;;;');
  assert.equal(lines[31].split(';')[2], ''); // 31 lutego nie istnieje
  assert.equal(lines[32].split(';')[1], '1001,00');
  assert.equal(lines[33], 'Razem rok 2026;1235568,89'); // 100050 + 50 + 123456789 groszy
  assert.equal(C.yearStats(d, 2026).total, 100050 + 50 + 123456789);
});

test('statystyki roku: najlepszy miesiąc i średnia', () => {
  let d = C.emptyData();
  d = C.setDay(d, '2026-03-01', 100000, false, 1);
  d = C.setDay(d, '2026-07-01', 300000, false, 2);
  d = C.setDay(d, '2026-07-02', 100000, false, 3);
  const ys = C.yearStats(d, 2026, { today: '2026-12-31' });
  assert.equal(ys.bestMonth, 6);
  assert.equal(ys.total, 500000);
  assert.equal(ys.open, 3);
  assert.equal(ys.avg, Math.round(500000 / 3));
  assert.equal(C.yearStats(C.emptyData(), 2026).bestMonth, -1);
});

test('rok przestępny: 29 lutego jest liczony, w innych latach odrzucany', () => {
  let d = C.setDay(C.emptyData(), '2028-02-29', 5000, false, 1);
  assert.equal(C.monthStats(d, 2028, 1, { today: '2028-12-31' }).total, 5000);
  assert.throws(() => C.setDay(C.emptyData(), '2027-02-29', 5000, false, 1));
});

test('dni sprzed pierwszego użycia aplikacji nie są brakami', () => {
  const s = C.monthStats(C.emptyData(), 2026, 9, { today: '2026-10-22', since: '2026-10-15' });
  assert.equal(s.missing.length, 8); // 15–22 października
  assert.equal(s.missing[0], '2026-10-15');
  const prev = C.monthStats(C.emptyData(), 2026, 8, { today: '2026-10-22', since: '2026-10-15' });
  assert.equal(prev.missing.length, 0);
  const miss = C.missingRecent(C.emptyData(), '2026-10-22', 45, [], '2026-10-20');
  assert.deepEqual(miss, ['2026-10-20', '2026-10-21']);
  // bez ograniczenia since zachowanie się nie zmienia
  assert.equal(C.monthStats(C.emptyData(), 2026, 9, { today: '2026-10-22' }).missing.length, 22);
});
