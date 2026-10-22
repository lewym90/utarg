/*
 * Utarg – rdzeń logiki (bez DOM-u, działa w przeglądarce i w Node.js).
 *
 * Zasady, które gwarantują bezbłędne liczenie:
 *  1. Wszystkie kwoty są liczbami CAŁKOWITYMI w groszach (nigdy ułamki).
 *  2. Sumy są zawsze wyliczane z wpisów, nigdy wpisywane ręcznie.
 *  3. Każdy dzień ma znacznik czasu `t`; przy scalaniu danych z kilku urządzeń
 *     wygrywa nowszy wpis (scalanie jest przemienne i idempotentne).
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.UtargCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_YEAR = 2000;
  var MAX_YEAR = 2100;
  var MAX_GROSZE = 100000000000; // 1 mld zł – górny bezpiecznik

  var MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec',
    'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
  var MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
    'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  var MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze',
    'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
  var WEEKDAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
  var WEEKDAYS_SHORT = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb'];

  /* ---------- Daty ---------- */

  function isLeap(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }

  function daysInMonth(y, m) {
    return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m];
  }

  function pad(n, len) {
    var s = String(n);
    while (s.length < (len || 2)) s = '0' + s;
    return s;
  }

  /** m: 0–11, d: 1–31 → "RRRR-MM-DD" */
  function dateKey(y, m, d) {
    return pad(y, 4) + '-' + pad(m + 1) + '-' + pad(d);
  }

  /** "RRRR-MM-DD" → {y, m (0–11), d} albo null, gdy to nie jest poprawna data kalendarzowa */
  function parseKey(key) {
    var r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!r) return null;
    var y = +r[1], m = +r[2] - 1, d = +r[3];
    if (y < MIN_YEAR || y > MAX_YEAR) return null;
    if (m < 0 || m > 11) return null;
    if (d < 1 || d > daysInMonth(y, m)) return null;
    return { y: y, m: m, d: d };
  }

  /** 0 = niedziela … 6 = sobota (liczone w UTC, więc odporne na zmianę czasu) */
  function weekday(y, m, d) {
    return new Date(Date.UTC(y, m, d)).getUTCDay();
  }

  function weekdayOfKey(key) {
    var p = parseKey(key);
    return p ? weekday(p.y, p.m, p.d) : -1;
  }

  /** Dzisiejsza data w lokalnej strefie czasowej urządzenia. */
  function todayKey(now) {
    var d = now instanceof Date ? now : (now != null ? new Date(now) : new Date());
    return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function addDays(key, delta) {
    var p = parseKey(key);
    if (!p) return key;
    var t = new Date(Date.UTC(p.y, p.m, p.d + delta));
    return dateKey(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
  }

  function longDate(key) {
    var p = parseKey(key);
    if (!p) return '';
    return WEEKDAYS[weekday(p.y, p.m, p.d)] + ', ' + p.d + ' ' + MONTHS_GEN[p.m] + ' ' + p.y;
  }

  function shortDay(key) {
    var p = parseKey(key);
    if (!p) return '';
    return WEEKDAYS_SHORT[weekday(p.y, p.m, p.d)] + ' ' + p.d;
  }

  /** Polska odmiana liczebników: plural(1,'wpis','wpisy','wpisów') */
  function plural(n, one, few, many) {
    n = Math.abs(n);
    if (n === 1) return one;
    var last = n % 10, last2 = n % 100;
    if (last >= 2 && last <= 4 && !(last2 >= 12 && last2 <= 14)) return few;
    return many;
  }

  /* ---------- Kwoty ---------- */

  /**
   * Zamienia tekst wpisany przez człowieka na grosze (liczba całkowita).
   * Akceptuje: "1250", "1250,5", "1 250,50", "1.250,50", "1,250.50", "1250 zł".
   * Odrzuca wszystko niejednoznaczne (np. "1.234") zamiast zgadywać.
   * Zwraca {ok:true, value} albo {ok:false, error}.
   */
  function parseAmount(input) {
    var s = String(input == null ? '' : input)
      .replace(/[\s  ]/g, '')
      .replace(/(zł|zl|pln)$/i, '');
    if (s === '') return { ok: false, error: 'Wpisz kwotę.' };
    if (s.indexOf('-') >= 0) return { ok: false, error: 'Kwota nie może być ujemna.' };
    if (!/^[0-9.,]+$/.test(s)) return { ok: false, error: 'Użyj tylko cyfr i przecinka, np. 1250,50.' };

    var hasComma = s.indexOf(',') >= 0;
    var hasDot = s.indexOf('.') >= 0;
    var intPart, fracPart = '';
    var ambiguous = { ok: false, error: 'Niejednoznaczna kwota. Grosze oddziel przecinkiem, np. 1234,00.' };
    var badFormat = { ok: false, error: 'Nieprawidłowy zapis kwoty. Przykład: 1250,50.' };
    var m;

    if (hasComma && hasDot) {
      var dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
      var thou = dec === ',' ? '.' : ',';
      var idx = s.lastIndexOf(dec);
      var left = s.slice(0, idx), right = s.slice(idx + 1);
      if (left.indexOf(dec) >= 0) return badFormat;
      if (!new RegExp('^\\d{1,3}(\\' + thou + '\\d{3})+$').test(left)) return badFormat;
      if (!/^\d{0,2}$/.test(right)) return { ok: false, error: 'Maksymalnie 2 cyfry po przecinku.' };
      intPart = left.split(thou).join('');
      fracPart = right;
    } else if (hasComma || hasDot) {
      var sep = hasComma ? ',' : '.';
      var count = s.split(sep).length - 1;
      if (count > 1) {
        // kilka takich samych separatorów = separatory tysięcy (np. 1.234.567)
        if (!new RegExp('^\\d{1,3}(\\' + sep + '\\d{3})+$').test(s)) return badFormat;
        intPart = s.split(sep).join('');
      } else {
        var i = s.indexOf(sep);
        intPart = s.slice(0, i);
        fracPart = s.slice(i + 1);
        if (fracPart.length === 3) return ambiguous;
        if (fracPart.length > 3) return { ok: false, error: 'Maksymalnie 2 cyfry po przecinku.' };
        if (intPart === '' && fracPart === '') return badFormat;
      }
    } else {
      intPart = s;
    }

    m = /^\d*$/.exec(intPart);
    if (!m || !/^\d*$/.test(fracPart)) return badFormat;
    intPart = intPart.replace(/^0+(?=\d)/, '');
    if (intPart === '') intPart = '0';
    if (intPart.length > 10) return { ok: false, error: 'Kwota jest zbyt duża.' };
    while (fracPart.length < 2) fracPart += '0';
    var value = parseInt(intPart, 10) * 100 + parseInt(fracPart, 10);
    if (!(value >= 0 && value <= MAX_GROSZE)) return { ok: false, error: 'Kwota jest zbyt duża.' };
    return { ok: true, value: value };
  }

  function groupThousands(intStr) {
    var out = '';
    for (var i = 0; i < intStr.length; i++) {
      if (i > 0 && (intStr.length - i) % 3 === 0) out += ' ';
      out += intStr[i];
    }
    return out;
  }

  /** 428050 → "4 280,50" (spacja niełamliwa jako separator tysięcy) */
  function formatGrosze(g) {
    var neg = g < 0;
    if (neg) g = -g;
    var zl = Math.floor(g / 100);
    var gr = g % 100;
    return (neg ? '−' : '') + groupThousands(String(zl)) + ',' + pad(gr);
  }

  /** 428050 → "4 280,50 zł" */
  function formatMoney(g) {
    return formatGrosze(g) + ' zł';
  }

  /** Wartość do pola edycji: 428050 → "4280,5"? Nie – zawsze pełna: "4280,50"; pełne złote: "4280". */
  function toInputString(g) {
    var zl = Math.floor(g / 100);
    var gr = g % 100;
    return gr === 0 ? String(zl) : zl + ',' + pad(gr);
  }

  /* ---------- Model danych ---------- */
  /*
   * data = { v: 1, days: { "RRRR-MM-DD": { a: grosze|null, c: bool, t: ms } } }
   *  a = kwota w groszach; null = wpis usunięty (znacznik usunięcia, potrzebny do synchronizacji)
   *  c = true → dzień oznaczony jako „sklep zamknięty” (a wynosi wtedy 0)
   *  t = czas ostatniej zmiany (ms)
   *  n = opcjonalna krótka notatka (np. „deszcz”), tylko przy aktywnym wpisie
   */

  function emptyData() {
    return { v: 1, days: {} };
  }

  var NOTE_MAX = 60;

  /** Notatka do dnia: przycięta, bez znaków sterujących i podwójnych spacji. */
  function normalizeNote(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX).trim();
  }

  function recString(r) {
    return (r.a === null ? 'n' : r.a) + '|' + (r.c ? 1 : 0) + '|' + r.t + '|' + (r.n || '');
  }

  /** Zwraca aktywny wpis dnia albo null. */
  function getDay(data, key) {
    var r = data.days[key];
    return r && r.a !== null ? r : null;
  }

  /** Nowy obiekt danych z zapisanym dniem. amount: grosze albo null (usuń). */
  function setDay(data, key, amount, closed, now, note) {
    if (!parseKey(key)) throw new Error('Niepoprawna data: ' + key);
    var rec;
    if (amount === null) {
      rec = { a: null, c: false, t: now };
    } else {
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_GROSZE) throw new Error('Niepoprawna kwota');
      rec = { a: closed ? 0 : amount, c: !!closed, t: now };
      var nn = normalizeNote(note);
      if (nn) rec.n = nn;
    }
    // znacznik czasu zawsze rośnie, żeby ta zmiana wygrała ze starszą wersją
    var prev = data.days[key];
    if (prev && rec.t <= prev.t) rec.t = prev.t + 1;
    var days = {};
    Object.keys(data.days).forEach(function (k) { days[k] = data.days[k]; });
    days[key] = rec;
    return { v: 1, days: days };
  }

  /** Scala dwa zbiory danych. Dla każdego dnia wygrywa nowszy wpis. */
  function merge(a, b) {
    var days = {};
    var keys = {};
    Object.keys(a.days).forEach(function (k) { keys[k] = 1; });
    Object.keys(b.days).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var x = a.days[k], y = b.days[k];
      if (!x) days[k] = y;
      else if (!y) days[k] = x;
      else if (x.t !== y.t) days[k] = x.t > y.t ? x : y;
      else days[k] = recString(x) >= recString(y) ? x : y;
    });
    return { v: 1, days: days };
  }

  /**
   * Sprawdza dane z zewnątrz (plik, GitHub, pamięć). Nigdy nie rzuca wyjątku.
   * Zwraca { data, dropped } – niepoprawne wpisy są pomijane i zliczane.
   */
  function validate(raw) {
    var out = emptyData();
    var dropped = 0;
    if (!raw || typeof raw !== 'object' || !raw.days || typeof raw.days !== 'object') {
      return { data: out, dropped: raw ? 1 : 0 };
    }
    Object.keys(raw.days).forEach(function (k) {
      var r = raw.days[k];
      if (!parseKey(k) || !r || typeof r !== 'object') { dropped++; return; }
      var t = Number.isFinite(r.t) && r.t >= 0 ? Math.floor(r.t) : 0;
      if (r.a === null) { out.days[k] = { a: null, c: false, t: t }; return; }
      if (!Number.isSafeInteger(r.a) || r.a < 0 || r.a > MAX_GROSZE) { dropped++; return; }
      var c = r.c === true;
      out.days[k] = { a: c ? 0 : r.a, c: c, t: t };
      var nn = normalizeNote(r.n);
      if (nn) out.days[k].n = nn;
    });
    return { data: out, dropped: dropped };
  }

  /** Stały, czytelny zapis JSON (posortowane dni, jedna linia na dzień – ładne różnice w git). */
  function serialize(data) {
    var keys = Object.keys(data.days).sort();
    var lines = keys.map(function (k) {
      var r = data.days[k];
      return '    "' + k + '": {"a": ' + (r.a === null ? 'null' : r.a) +
        ', "c": ' + (r.c ? 'true' : 'false') + ', "t": ' + r.t + (r.n ? ', "n": ' + JSON.stringify(r.n) : '') + '}';
    });
    return '{\n  "app": "utarg",\n  "v": 1,\n  "days": {\n' + lines.join(',\n') + (lines.length ? '\n' : '') + '  }\n}\n';
  }

  function parseSerialized(text) {
    try {
      return validate(JSON.parse(text));
    } catch (e) {
      return { data: emptyData(), dropped: 1, error: true };
    }
  }

  function sameData(a, b) {
    return serialize(a) === serialize(b);
  }

  /** Liczba aktywnych wpisów. */
  function countEntries(data) {
    var n = 0;
    Object.keys(data.days).forEach(function (k) { if (data.days[k].a !== null) n++; });
    return n;
  }

  /* ---------- Podsumowania ---------- */

  function isStandingClosed(key, closedWeekdays) {
    return !!closedWeekdays && closedWeekdays.indexOf(weekdayOfKey(key)) >= 0;
  }

  /**
   * Podsumowanie miesiąca.
   *  total    – suma utargu (grosze)
   *  open     – liczba dni z wpisaną kwotą (sklep otwarty)
   *  closed   – liczba dni oznaczonych jako zamknięte
   *  missing  – dni do dziś włącznie bez wpisu (bez dni stałego wolnego i bez dni sprzed opts.since)
   *  opts: { today, closedWeekdays, since } – since to data pierwszego użycia aplikacji;
   *        wcześniejsze dni bez wpisu nie są traktowane jako braki.
   */
  function monthStats(data, y, m, opts) {
    opts = opts || {};
    var today = opts.today || todayKey();
    var cw = opts.closedWeekdays || [];
    var since = opts.since || null;
    var n = daysInMonth(y, m);
    var total = 0, open = 0, closed = 0, standing = 0, best = null;
    var missing = [];
    for (var d = 1; d <= n; d++) {
      var key = dateKey(y, m, d);
      var r = getDay(data, key);
      if (r) {
        total += r.a;
        if (r.c) closed++;
        else {
          open++;
          if (best === null || r.a > best.a) best = { key: key, a: r.a };
        }
      } else if (key <= today && !(since && key < since)) {
        if (isStandingClosed(key, cw)) standing++;
        else missing.push(key);
      }
    }
    return {
      y: y, m: m, days: n, total: total, open: open, closed: closed, standing: standing,
      missing: missing, best: best,
      avg: open > 0 ? Math.round(total / open) : 0,
      finished: dateKey(y, m, n) < today
    };
  }

  /** Podsumowanie roku: 12 miesięcy + suma ze wszystkich miesięcy. */
  function yearStats(data, y, opts) {
    var months = [];
    var total = 0, open = 0, closed = 0, missing = 0;
    var bestIdx = -1;
    for (var m = 0; m < 12; m++) {
      var s = monthStats(data, y, m, opts);
      months.push(s);
      total += s.total;
      open += s.open;
      closed += s.closed;
      missing += s.missing.length;
      if (s.total > 0 && (bestIdx < 0 || s.total > months[bestIdx].total)) bestIdx = m;
    }
    return {
      y: y, months: months, total: total, open: open, closed: closed, missing: missing,
      bestMonth: bestIdx,
      avg: open > 0 ? Math.round(total / open) : 0
    };
  }

  /** Kontrolna suma liczona inną drogą (po kluczach) – do testów i weryfikacji. */
  function yearTotalDirect(data, y) {
    var prefix = pad(y, 4) + '-';
    var t = 0;
    Object.keys(data.days).forEach(function (k) {
      if (k.indexOf(prefix) === 0 && data.days[k].a !== null) t += data.days[k].a;
    });
    return t;
  }

  /** Dni z brakującym wpisem (przed dzisiejszym dniem) w ostatnich `back` dniach. */
  function missingRecent(data, today, back, closedWeekdays, since) {
    var out = [];
    for (var i = 1; i <= back; i++) {
      var key = addDays(today, -i);
      var p = parseKey(key);
      if (!p) break;
      if (since && key < since) break;
      if (!getDay(data, key) && !isStandingClosed(key, closedWeekdays)) out.push(key);
    }
    return out.reverse();
  }

  /** Najnowsze wpisy (do dziś włącznie), od najnowszego. */
  function recentEntries(data, today, limit) {
    var keys = Object.keys(data.days).filter(function (k) {
      return data.days[k].a !== null && k <= today;
    }).sort().reverse().slice(0, limit);
    return keys.map(function (k) { return { key: k, rec: data.days[k] }; });
  }

  /** Największy dotychczasowy dzienny utarg (do ostrzeżenia o literówce). */
  function maxOpenDay(data, exceptKey) {
    var max = 0, n = 0;
    Object.keys(data.days).forEach(function (k) {
      var r = data.days[k];
      if (k !== exceptKey && r.a !== null && !r.c) { n++; if (r.a > max) max = r.a; }
    });
    return { max: max, count: n };
  }

  /* ---------- Notatki i analiza ---------- */

  /** Znane okoliczności rozpoznawane w notatkach (po fragmencie słowa, bez rozróżniania wielkości liter). */
  var TAGS = [
    { id: 'rain', label: 'Deszcz', stems: ['desz', 'ulew', 'burz'] },
    { id: 'heat', label: 'Upał', stems: ['upał', 'upal', 'gorąc', 'gorac'] },
    { id: 'snow', label: 'Śnieg', stems: ['śnie', 'snie', 'mróz', 'mroz', 'gołoled', 'gololed'] },
    { id: 'promo', label: 'Promocja', stems: ['promo', 'wyprzed', 'rabat'] },
    { id: 'holiday', label: 'Święto', stems: ['święt', 'swiet', 'majówk', 'majowk', 'długi weekend', 'dlugi weekend'] }
  ];

  var WEEKDAYS_ACC = ['niedziele', 'poniedziałki', 'wtorki', 'środy', 'czwartki', 'piątki', 'soboty'];

  function tagsOf(note) {
    var low = String(note || '').toLowerCase();
    if (!low) return [];
    return TAGS.filter(function (t) {
      return t.stems.some(function (st) { return low.indexOf(st) >= 0; });
    }).map(function (t) { return t.id; });
  }

  function tagLabel(id) {
    for (var i = 0; i < TAGS.length; i++) if (TAGS[i].id === id) return TAGS[i].label;
    return id;
  }

  /**
   * Analiza dni z zakresu [from, to] (klucze dat; to domyślnie dziś).
   * Dni „otwarte” to wpisy z kwotą (bez oznaczenia „zamknięte”). Dni zamknięte liczone osobno.
   * Wszystkie kwoty w groszach, średnie zaokrąglone do grosza.
   */
  function analyze(data, opts) {
    opts = opts || {};
    var today = opts.today || todayKey();
    var from = opts.from || '0000-01-01';
    var to = opts.to && opts.to < today ? opts.to : today;
    var openCost = opts.openCost > 0 ? opts.openCost : 0;

    var wd = [];
    for (var i = 0; i < 7; i++) wd.push({ wd: i, n: 0, total: 0, avg: 0, closed: 0 });
    var tagStats = {};
    TAGS.forEach(function (t) { tagStats[t.id] = { id: t.id, label: t.label, n: 0, total: 0, avg: 0, closed: 0 }; });

    var list = [];
    var total = 0, closedDays = 0, belowCost = 0;
    Object.keys(data.days).sort().forEach(function (k) {
      var r = data.days[k];
      if (r.a === null || k < from || k > to) return;
      var w = weekdayOfKey(k);
      var tg = tagsOf(r.n);
      if (r.c) {
        closedDays++;
        wd[w].closed++;
        tg.forEach(function (id) { tagStats[id].closed++; });
        return;
      }
      list.push({ key: k, a: r.a, n: r.n || '', wd: w, tags: tg });
      total += r.a;
      wd[w].n++; wd[w].total += r.a;
      tg.forEach(function (id) { tagStats[id].n++; tagStats[id].total += r.a; });
      if (openCost && r.a < openCost) belowCost++;
    });

    wd.forEach(function (x) { x.avg = x.n ? Math.round(x.total / x.n) : 0; });
    var openDays = list.length;
    var avg = openDays ? Math.round(total / openDays) : 0;

    var tags = [];
    TAGS.forEach(function (t) {
      var x = tagStats[t.id];
      if (!x.n && !x.closed) return;
      x.avg = x.n ? Math.round(x.total / x.n) : 0;
      var restN = openDays - x.n, restTotal = total - x.total;
      x.restAvg = restN > 0 ? Math.round(restTotal / restN) : 0;
      x.restN = restN;
      x.diffPct = x.n && restN > 0 && x.restAvg > 0 ? Math.round((x.avg - x.restAvg) / x.restAvg * 100) : null;
      tags.push(x);
    });

    var sorted = list.slice().sort(function (a, b) { return b.a - a.a || (a.key < b.key ? 1 : -1); });
    var best = sorted.slice(0, 3);
    // najsłabsze dni nie powtarzają się z najlepszymi
    var worst = sorted.slice(best.length).slice(-3).reverse();
    return {
      from: from, to: to, openDays: openDays, closedDays: closedDays, total: total, avg: avg,
      weekdays: wd, tags: tags, openCost: openCost, belowCost: belowCost,
      best: best, worst: worst
    };
  }

  /** Suma i liczba dni z utargiem w miesiącu, ale tylko do dnia `upTo` włącznie (uczciwe porównanie). */
  function monthToDay(data, y, m, upTo) {
    var n = Math.min(upTo, daysInMonth(y, m));
    var total = 0, open = 0;
    for (var d = 1; d <= n; d++) {
      var r = getDay(data, dateKey(y, m, d));
      if (r) { total += r.a; if (!r.c) open++; }
    }
    return { y: y, m: m, upTo: n, total: total, open: open };
  }

  /** Bieżący miesiąc kontra poprzedni miesiąc i ten sam miesiąc rok temu – do tego samego dnia miesiąca. */
  function compareMonths(data, today) {
    var p = parseKey(today);
    var pm = p.m === 0 ? { y: p.y - 1, m: 11 } : { y: p.y, m: p.m - 1 };
    return {
      day: p.d,
      cur: monthToDay(data, p.y, p.m, p.d),
      prev: monthToDay(data, pm.y, pm.m, p.d),
      lastYear: monthToDay(data, p.y - 1, p.m, p.d)
    };
  }

  /** Ostatnie `count` miesięcy (łącznie z bieżącym), od najstarszego. */
  function trendMonths(data, today, count) {
    var p = parseKey(today);
    var out = [];
    for (var i = count - 1; i >= 0; i--) {
      var idx = p.y * 12 + p.m - i;
      var y = Math.floor(idx / 12), m = idx - y * 12;
      var s = monthToDay(data, y, m, 31);
      out.push({ y: y, m: m, total: s.total, open: s.open });
    }
    return out;
  }

  /** Zmiana procentowa (całkowita) albo null, gdy nie ma punktu odniesienia. */
  function pctChange(now, before) {
    if (!(before > 0)) return null;
    return Math.round((now - before) / before * 100);
  }

  /** Gotowe zdania z wnioskami. Wymaga minimum danych, żeby nie wyciągać pochopnych wniosków. */
  function insights(an) {
    var out = [];
    if (an.openDays < 7) return out;
    var money = formatMoney;

    var wds = an.weekdays.filter(function (x) { return x.n >= 2; });
    if (wds.length >= 3) {
      var hi = wds.reduce(function (a, b) { return b.avg > a.avg ? b : a; });
      var lo = wds.reduce(function (a, b) { return b.avg < a.avg ? b : a; });
      if (hi.wd !== lo.wd && hi.avg > lo.avg) {
        out.push('Najlepszy dzień tygodnia: ' + WEEKDAYS[hi.wd] + ' (średnio ' + money(hi.avg) + '). Najsłabszy: ' + WEEKDAYS[lo.wd] + ' (średnio ' + money(lo.avg) + ').');
      }
    }
    an.tags.forEach(function (t) {
      if (t.n >= 3 && t.diffPct !== null && Math.abs(t.diffPct) >= 10) {
        out.push('W dni z notatką „' + t.label.toLowerCase() + '” (' + t.n + ' ' + plural(t.n, 'dzień', 'dni', 'dni') + ') średni utarg to ' + money(t.avg) +
          ', czyli o ' + Math.abs(t.diffPct) + '% ' + (t.diffPct < 0 ? 'mniej' : 'więcej') + ' niż w pozostałe dni.');
      }
    });
    if (an.openCost > 0) {
      an.weekdays.forEach(function (x) {
        if (x.n >= 3 && x.avg < an.openCost) {
          out.push('W ' + WEEKDAYS_ACC[x.wd] + ' średni utarg (' + money(x.avg) + ') jest niższy niż koszt otwarcia (' + money(an.openCost) + '). Rozważ zamknięcie w ten dzień.');
        }
      });
      an.tags.forEach(function (t) {
        if (t.n >= 3 && t.avg < an.openCost) {
          out.push('W dni z notatką „' + t.label.toLowerCase() + '” średni utarg (' + money(t.avg) + ') jest niższy niż koszt otwarcia (' + money(an.openCost) + ').');
        }
      });
      if (an.belowCost > 0) {
        var pct = Math.round(an.belowCost / an.openDays * 100);
        out.push(an.belowCost + ' z ' + an.openDays + ' dni (' + pct + '%) miało utarg poniżej kosztu otwarcia.');
      }
    }
    return out;
  }

  /* ---------- Import CSV ---------- */

  function splitCsvLine(line, delim) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (q) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
        } else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  /** Data w formacie RRRR-MM-DD, DD.MM.RRRR, DD-MM-RRRR lub DD/MM/RRRR → klucz albo null. */
  function parseDateCell(s) {
    s = String(s).trim();
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    var y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else {
      m = /^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})$/.exec(s);
      if (!m) return null;
      d = +m[1]; mo = +m[2]; y = +m[3];
    }
    if (mo < 1 || mo > 12 || y < MIN_YEAR || y > MAX_YEAR || d < 1 || d > daysInMonth(y, mo - 1)) return null;
    return dateKey(y, mo - 1, d);
  }

  var CLOSED_WORD = /^(zamk|wolne|nieczynne)/i;

  function parseAmountCell(s) {
    var t = String(s).replace(/[\s ]/g, '').replace(/zł|pln/ig, '');
    if (CLOSED_WORD.test(t)) return { ok: true, closed: true, value: 0 };
    if (t === '') return { ok: false, empty: true };
    var r = parseAmount(t);
    return r.ok ? { ok: true, closed: false, value: r.value } : { ok: false, error: r.error };
  }

  /**
   * Czyta plik CSV z historią. Rozpoznaje dwa układy:
   *  1) tabela roczna z Utarg (nagłówek „Dzień;styczeń;…”, ostatni wiersz „Razem rok RRRR”),
   *  2) lista: data;kwota[;notatka] (np. z Excela).
   * opts: { today, year (rok z nazwy pliku, gdy tabela nie podaje roku) }.
   * Zwraca { entries: [{key, a, c, n}], skipped: [{line, reason}], layout }.
   * Niejednoznaczne kwoty (np. „1.234”) są pomijane z komunikatem – nic nie jest zgadywane.
   */
  function parseCsvImport(text, opts) {
    opts = opts || {};
    var today = opts.today || todayKey();
    text = String(text).replace(/^﻿/, '');
    var lines = text.split(/\r\n|\n|\r/);
    var firstLine = '';
    for (var li = 0; li < lines.length; li++) { if (lines[li].trim() !== '') { firstLine = lines[li]; break; } }
    var delim = firstLine.indexOf(';') >= 0 ? ';' : (firstLine.indexOf('\t') >= 0 ? '\t' : ',');
    var entries = {};
    var skipped = [];
    var layout = 'list';

    var rows = lines.map(function (l) { return splitCsvLine(l, delim); });
    var head = null;
    for (var ri = 0; ri < rows.length; ri++) { if (rows[ri].join('').trim() !== '') { head = rows[ri]; break; } }
    var isYear = !!head && /^dzie[nń]$/i.test((head[0] || '').trim()) && /^styczeń$/i.test((head[1] || '').trim());

    if (isYear) {
      layout = 'year';
      var year = null;
      rows.forEach(function (r) {
        var m = /^razem rok (\d{4})$/i.exec((r[0] || '').trim());
        if (m) year = +m[1];
      });
      if (year === null) year = opts.year || null;
      if (year === null || year < MIN_YEAR || year > MAX_YEAR) {
        return { entries: [], skipped: [{ line: 0, reason: 'Nie udało się ustalić roku tabeli.' }], layout: layout, error: 'year' };
      }
      rows.forEach(function (r, idx) {
        var d = /^\d{1,2}$/.test((r[0] || '').trim()) ? +r[0].trim() : 0;
        if (d < 1 || d > 31) return;
        for (var m = 0; m < 12; m++) {
          var cell = (r[m + 1] || '').trim();
          if (cell === '') continue;
          if (d > daysInMonth(year, m)) { skipped.push({ line: idx + 1, reason: 'Taki dzień nie istnieje' }); continue; }
          var key = dateKey(year, m, d);
          var a = parseAmountCell(cell);
          if (!a.ok) { skipped.push({ line: idx + 1, reason: 'Nierozpoznana kwota „' + cell + '”' }); continue; }
          entries[key] = { key: key, a: a.value, c: a.closed, n: '' };
        }
      });
    } else {
      var seenData = false;
      rows.forEach(function (r, idx) {
        if (r.join('').trim() === '') return;
        var key = parseDateCell(r[0] || '');
        if (!key) {
          // pierwszy niepusty wiersz bez daty to nagłówek kolumn
          if (!seenData && r === head) return;
          skipped.push({ line: idx + 1, reason: 'Nierozpoznana data „' + (r[0] || '').trim() + '”' });
          return;
        }
        seenData = true;
        var a = parseAmountCell(r[1] || '');
        if (!a.ok) {
          if (a.empty) return;
          skipped.push({ line: idx + 1, reason: 'Nierozpoznana kwota „' + (r[1] || '').trim() + '”' + (a.error ? ' – ' + a.error : '') });
          return;
        }
        entries[key] = { key: key, a: a.value, c: a.closed, n: normalizeNote(r.slice(2).join(' ')) };
      });
    }

    var kept = [];
    Object.keys(entries).sort().forEach(function (k) {
      if (k > today) skipped.push({ line: 0, reason: 'Data z przyszłości: ' + k });
      else kept.push(entries[k]);
    });
    return { entries: kept, skipped: skipped, layout: layout };
  }

  /**
   * Dopisuje wpisy z importu. Dni, które już mają wpis, są pomijane (nic nie jest nadpisywane).
   * Zwraca { data, added, existing }.
   */
  function addEntries(data, entries, now) {
    var days = {};
    Object.keys(data.days).forEach(function (k) { days[k] = data.days[k]; });
    var added = 0, existing = 0;
    entries.forEach(function (e) {
      if (getDay(data, e.key)) { existing++; return; }
      var prev = data.days[e.key];
      var t = prev && now <= prev.t ? prev.t + 1 : now;
      var rec = { a: e.c ? 0 : e.a, c: !!e.c, t: t };
      var nn = normalizeNote(e.n);
      if (nn) rec.n = nn;
      days[e.key] = rec;
      added++;
    });
    return { data: { v: 1, days: days }, added: added, existing: existing };
  }

  /* ---------- Eksport ---------- */

  function csvCell(v) {
    var s = String(v);
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** Tabela roczna jako CSV (średniki, przecinek dziesiętny – otwiera się w polskim Excelu). */
  function csvYear(data, y) {
    var rows = [];
    rows.push(['Dzień'].concat(MONTHS).map(csvCell).join(';'));
    for (var d = 1; d <= 31; d++) {
      var row = [d];
      for (var m = 0; m < 12; m++) {
        var r = d <= daysInMonth(y, m) ? getDay(data, dateKey(y, m, d)) : null;
        row.push(r ? (r.c ? 'zamknięte' : formatGrosze(r.a).replace(/ /g, '')) : '');
      }
      rows.push(row.map(csvCell).join(';'));
    }
    var ys = yearStats(data, y, { today: '9999-12-31' });
    rows.push(['Suma'].concat(ys.months.map(function (s) { return formatGrosze(s.total).replace(/ /g, ''); })).map(csvCell).join(';'));
    rows.push(['Razem rok ' + y, formatGrosze(ys.total).replace(/ /g, '')].map(csvCell).join(';'));
    return rows.join('\r\n') + '\r\n';
  }

  return {
    MONTHS: MONTHS, MONTHS_GEN: MONTHS_GEN, MONTHS_SHORT: MONTHS_SHORT,
    WEEKDAYS: WEEKDAYS, WEEKDAYS_SHORT: WEEKDAYS_SHORT,
    MIN_YEAR: MIN_YEAR, MAX_YEAR: MAX_YEAR, MAX_GROSZE: MAX_GROSZE,
    isLeap: isLeap, daysInMonth: daysInMonth, dateKey: dateKey, parseKey: parseKey,
    weekday: weekday, weekdayOfKey: weekdayOfKey, todayKey: todayKey, addDays: addDays,
    longDate: longDate, shortDay: shortDay, plural: plural,
    parseAmount: parseAmount, formatGrosze: formatGrosze, formatMoney: formatMoney, toInputString: toInputString,
    emptyData: emptyData, getDay: getDay, setDay: setDay, merge: merge, validate: validate,
    serialize: serialize, parseSerialized: parseSerialized, sameData: sameData, countEntries: countEntries,
    isStandingClosed: isStandingClosed, monthStats: monthStats, yearStats: yearStats,
    yearTotalDirect: yearTotalDirect, missingRecent: missingRecent, recentEntries: recentEntries,
    maxOpenDay: maxOpenDay, csvYear: csvYear,
    NOTE_MAX: NOTE_MAX, TAGS: TAGS, normalizeNote: normalizeNote, tagsOf: tagsOf, tagLabel: tagLabel,
    analyze: analyze, monthToDay: monthToDay, compareMonths: compareMonths, trendMonths: trendMonths,
    pctChange: pctChange, insights: insights, parseCsvImport: parseCsvImport, parseDateCell: parseDateCell, addEntries: addEntries
  };
});
