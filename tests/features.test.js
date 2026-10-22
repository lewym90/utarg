'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../js/core.js');

function build(entries) {
  let d = C.emptyData();
  let t = 1;
  for (const [key, a, closed, note] of entries) d = C.setDay(d, key, a, !!closed, t++, note);
  return d;
}

test('notatka: zapis, normalizacja, odczyt po serializacji', () => {
  let d = C.setDay(C.emptyData(), '2026-10-05', 12345, false, 5, '  Deszcz \n  ulewa\t ');
  assert.equal(d.days['2026-10-05'].n, 'Deszcz ulewa');
  const back = C.parseSerialized(C.serialize(d)).data;
  assert.deepEqual(back.days['2026-10-05'], d.days['2026-10-05']);
  assert.equal(C.sameData(d, back), true);
  // za długa notatka jest przycinana, pusta znika
  d = C.setDay(d, '2026-10-06', 100, false, 6, 'x'.repeat(200));
  assert.equal(d.days['2026-10-06'].n.length, C.NOTE_MAX);
  d = C.setDay(d, '2026-10-06', 100, false, 7, '   ');
  assert.equal('n' in d.days['2026-10-06'], false);
  // usunięcie wpisu usuwa notatkę
  d = C.setDay(d, '2026-10-05', null, false, 8, 'deszcz');
  assert.equal('n' in d.days['2026-10-05'], false);
});

test('notatka: stary plik bez notatek nadal się wczytuje, a śmieci są odrzucane', () => {
  const old = '{"app":"utarg","v":1,"days":{"2026-01-02":{"a":500,"c":false,"t":9}}}';
  assert.equal(C.parseSerialized(old).data.days['2026-01-02'].a, 500);
  const bad = C.validate({ days: { '2026-01-02': { a: 500, c: false, t: 9, n: 12345 } } });
  assert.equal('n' in bad.data.days['2026-01-02'], false);
  const html = C.validate({ days: { '2026-01-02': { a: 500, c: false, t: 9, n: '<b>deszcz</b>' } } });
  assert.equal(html.data.days['2026-01-02'].n, '<b>deszcz</b>'); // tekst, wyświetlany zawsze z escapowaniem
});

test('notatka: scalanie – nowszy wpis wygrywa razem z notatką, remis rozstrzygany deterministycznie', () => {
  const a = C.setDay(C.emptyData(), '2026-10-05', 100, false, 10, 'deszcz');
  const b = C.setDay(C.emptyData(), '2026-10-05', 100, false, 10, 'upał');
  assert.deepEqual(C.merge(a, b), C.merge(b, a));
  const newer = C.setDay(a, '2026-10-05', 100, false, 11, '');
  assert.equal('n' in C.merge(a, newer).days['2026-10-05'], false);
});

test('rozpoznawanie okoliczności w notatkach', () => {
  assert.deepEqual(C.tagsOf('Deszcz i wiatr'), ['rain']);
  assert.deepEqual(C.tagsOf('ulewa'), ['rain']);
  assert.deepEqual(C.tagsOf('upał, promocja'), ['heat', 'promo']);
  assert.deepEqual(C.tagsOf('długi weekend'), ['holiday']);
  assert.deepEqual(C.tagsOf(''), []);
  assert.deepEqual(C.tagsOf('inwentaryzacja'), []);
});

test('analiza: średnie dni tygodnia, najlepsze i najsłabsze dni liczone dokładnie', () => {
  // 5 października 2026 to poniedziałek
  const d = build([
    ['2026-10-05', 100000], ['2026-10-12', 200000],      // poniedziałki: śr. 1500,00
    ['2026-10-06', 50001], ['2026-10-13', 50000],        // wtorki: śr. 500,005 → 50001 (zaokr.)
    ['2026-10-07', 0, true],                              // środa zamknięta
    ['2026-10-08', 300000]
  ]);
  const an = C.analyze(d, { today: '2026-10-20' });
  assert.equal(an.openDays, 5);
  assert.equal(an.closedDays, 1);
  assert.equal(an.total, 100000 + 200000 + 50001 + 50000 + 300000);
  assert.equal(an.avg, Math.round(an.total / 5));
  assert.equal(an.weekdays[1].avg, 150000);
  assert.equal(an.weekdays[1].n, 2);
  assert.equal(an.weekdays[2].avg, 50001); // (50001+50000)/2 = 50000,5 → 50001
  assert.equal(an.weekdays[3].closed, 1);
  assert.equal(an.weekdays[3].n, 0);
  assert.deepEqual(an.best.map((x) => x.a), [300000, 200000, 100000]);
  assert.deepEqual(an.worst.map((x) => x.a), [50000, 50001]);
});

test('analiza: zakres dat i brak przyszłych dni', () => {
  const d = build([['2026-01-05', 100], ['2026-10-05', 200], ['2026-12-05', 300]]);
  assert.equal(C.analyze(d, { today: '2026-10-22', from: '2026-10-01' }).total, 200);
  assert.equal(C.analyze(d, { today: '2026-10-22' }).total, 300); // grudzień jest w przyszłości
});

test('analiza: wpływ deszczu – średnia z deszczem kontra reszta, dni zamknięte osobno', () => {
  const rows = [];
  for (let i = 1; i <= 6; i++) rows.push(['2026-09-' + String(i).padStart(2, '0'), 100000]); // 6 zwykłych dni po 1000 zł
  rows.push(['2026-09-10', 20000, false, 'deszcz'], ['2026-09-11', 30000, false, 'Ulewa'], ['2026-09-12', 40000, false, 'deszcz']);
  rows.push(['2026-09-13', 0, true, 'deszcz']);
  const an = C.analyze(build(rows), { today: '2026-09-30' });
  const rain = an.tags.find((t) => t.id === 'rain');
  assert.equal(rain.n, 3);
  assert.equal(rain.closed, 1);
  assert.equal(rain.avg, 30000);
  assert.equal(rain.restAvg, 100000);
  assert.equal(rain.diffPct, -70);
  const text = C.insights(an).join(' ');
  assert.match(text, /deszcz/);
  assert.match(text, /70% mniej/);
});

test('analiza: koszt otwarcia – ostrzega o dniach i okolicznościach poniżej kosztu', () => {
  const rows = [];
  for (let i = 1; i <= 7; i++) rows.push(['2026-09-' + String(i).padStart(2, '0'), 90000]);
  for (const day of ['10', '11', '12']) rows.push(['2026-09-' + day, 15000, false, 'deszcz']);
  const an = C.analyze(build(rows), { today: '2026-09-30', openCost: 30000 });
  assert.equal(an.belowCost, 3);
  const text = C.insights(an).join('\n');
  assert.match(text, /niższy niż koszt otwarcia/);
  assert.match(text, /3 z 10 dni \(30%\)/);
  // bez ustawionego kosztu nie ma takich zdań
  const none = C.insights(C.analyze(build(rows), { today: '2026-09-30' })).join('\n');
  assert.doesNotMatch(none, /koszt otwarcia/);
});

test('analiza: za mało danych → brak pochopnych wniosków', () => {
  const an = C.analyze(build([['2026-09-01', 100], ['2026-09-02', 200]]), { today: '2026-09-30' });
  assert.deepEqual(C.insights(an), []);
});

test('porównanie miesięcy: do tego samego dnia miesiąca, także na przełomie roku', () => {
  const d = build([
    ['2026-01-02', 100], ['2026-01-20', 900],          // styczeń – dziś 10-go: liczy się tylko 2-go
    ['2025-12-05', 200], ['2025-12-25', 700],          // poprzedni miesiąc
    ['2025-01-09', 400]
  ]);
  const c = C.compareMonths(d, '2026-01-10');
  assert.equal(c.cur.total, 100);
  assert.equal(c.prev.total, 200);
  assert.equal(c.prev.y, 2025);
  assert.equal(c.prev.m, 11);
  assert.equal(c.lastYear.total, 400);
  assert.equal(C.pctChange(150, 100), 50);
  assert.equal(C.pctChange(50, 0), null);
});

test('trend: 12 miesięcy wstecz z przejściem przez rok', () => {
  const d = build([['2026-02-10', 1000], ['2025-03-01', 500], ['2025-02-01', 999]]);
  const t = C.trendMonths(d, '2026-02-15', 12);
  assert.equal(t.length, 12);
  assert.deepEqual([t[0].y, t[0].m], [2025, 2]);   // marzec 2025
  assert.deepEqual([t[11].y, t[11].m], [2026, 1]); // luty 2026
  assert.equal(t[0].total, 500);
  assert.equal(t[11].total, 1000);
  assert.equal(t.reduce((s, x) => s + x.total, 0), 1500); // luty 2025 poza oknem
});

test('import CSV: lista z Excela (daty różnych formatów, zł, zamknięte, notatka)', () => {
  const csv = '﻿Data;Utarg;Uwagi\r\n05.10.2026;1 234,50 zł;deszcz\r\n2026-10-06;"2 000";\r\n7/10/2026;zamknięte\r\n08-10-2026;99,9\r\n';
  const r = C.parseCsvImport(csv, { today: '2026-10-22' });
  assert.equal(r.layout, 'list');
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(r.entries.map((e) => [e.key, e.a, e.c, e.n]), [
    ['2026-10-05', 123450, false, 'deszcz'],
    ['2026-10-06', 200000, false, ''],
    ['2026-10-07', 0, true, ''],
    ['2026-10-08', 9990, false, '']
  ]);
});

test('import CSV: niejednoznaczne kwoty, złe daty i przyszłość są pomijane z powodem', () => {
  const csv = '2026-10-05;1.234\n2026-13-40;100\nabc;100\n2027-01-01;100\n2026-10-09;100\n';
  const r = C.parseCsvImport(csv, { today: '2026-10-22' });
  assert.deepEqual(r.entries.map((e) => e.key), ['2026-10-09']);
  assert.equal(r.skipped.length, 4);
  assert.ok(r.skipped.some((s) => /1\.234/.test(s.reason)));
});

test('import CSV: tabela roczna wyeksportowana z aplikacji wraca bez zmian (także dni zamknięte)', () => {
  let d = build([['2026-03-04', 10050], ['2026-03-05', 0, true], ['2026-02-28', 123456789], ['2026-12-31', 1]]);
  const csv = C.csvYear(d, 2026);
  const r = C.parseCsvImport(csv, { today: '2026-12-31' });
  assert.equal(r.layout, 'year');
  assert.deepEqual(r.skipped, []);
  const added = C.addEntries(C.emptyData(), r.entries, 1000);
  assert.equal(added.added, 4);
  assert.equal(C.yearTotalDirect(added.data, 2026), C.yearTotalDirect(d, 2026));
  assert.equal(added.data.days['2026-03-05'].c, true);
});

test('import CSV: nie nadpisuje istniejących wpisów', () => {
  const d = build([['2026-10-05', 500]]);
  const r = C.parseCsvImport('2026-10-05;9999\n2026-10-06;100\n', { today: '2026-10-22' });
  const out = C.addEntries(d, r.entries, 100);
  assert.equal(out.added, 1);
  assert.equal(out.existing, 1);
  assert.equal(out.data.days['2026-10-05'].a, 500);
  assert.equal(out.data.days['2026-10-06'].a, 10000);
});

test('import CSV: dzień po usunięciu (znacznik) można uzupełnić importem i wygrywa z usunięciem', () => {
  let d = build([['2026-10-05', 500]]);
  d = C.setDay(d, '2026-10-05', null, false, 50);
  const out = C.addEntries(d, [{ key: '2026-10-05', a: 700, c: false, n: '' }], 10);
  assert.equal(out.data.days['2026-10-05'].a, 700);
  assert.ok(out.data.days['2026-10-05'].t > 50);
});
