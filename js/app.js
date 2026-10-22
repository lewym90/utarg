/* Utarg – interfejs aplikacji. */
(function () {
  'use strict';

  var C = window.UtargCore;
  var Store = window.UtargStore;
  var Sync = window.UtargSync;
  var APP_VERSION = '1.2.0';

  /* ---------- Narzędzia ---------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  var ICONS = {
    wallet: '<rect x="3.5" y="6" width="17" height="13" rx="3.2"/><path d="M3.5 10h17"/><circle cx="16.5" cy="14.5" r="1" fill="currentColor"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    bars: '<path d="M5.5 20V11M12 20V4.5M18.5 20v-6.5"/>',
    sliders: '<path d="M4.5 7h8M17 7h2.5M4.5 17h2.5M11.5 17h8"/><circle cx="14.8" cy="7" r="2.2"/><circle cx="9.2" cy="17" r="2.2"/>',
    chevL: '<path d="M15 5l-7 7 7 7"/>',
    chevR: '<path d="M9 5l7 7-7 7"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    moon: '<path d="M20 14.6A8 8 0 0 1 9.4 4a8 8 0 1 0 10.6 10.6z"/>',
    alert: '<path d="M12 4.2l9 15.6H3z"/><path d="M12 10v4.4M12 17.2h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    download: '<path d="M12 4v11M7.5 10.8L12 15.3l4.5-4.5M5 19.5h14"/>',
    upload: '<path d="M12 15.5v-11M7.5 9L12 4.5 16.5 9M5 19.5h14"/>',
    trash: '<path d="M5 7h14M9.8 7V4.8h4.4V7M7 7l.9 12.2h8.2L17 7M10.5 11v5M13.5 11v5"/>',
    list: '<path d="M8.5 7h11M8.5 12h11M8.5 17h11M4.6 7h.01M4.6 12h.01M4.6 17h.01"/>',
    table: '<rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="M3.5 10h17M9.5 5v14"/>',
    shield: '<path d="M12 3.5l7 2.6v5.4c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6.1z"/><path d="M9 12.2l2.2 2.2 3.8-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
    trend: '<path d="M4 17l5-5.5 3.5 3.5L20 7M15 7h5v5"/>',
    note: '<path d="M6 4.5h12a1.5 1.5 0 0 1 1.5 1.5v9.5L14.5 20.5H6A1.5 1.5 0 0 1 4.5 19V6A1.5 1.5 0 0 1 6 4.5zM14.5 20.5v-4a1 1 0 0 1 1-1h4M8 9h8M8 12.5h5"/>',
    print: '<path d="M7 9V4.5h10V9M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 9h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-2M7 14h10v6H7z"/>'
  };

  function icon(name) {
    return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + ICONS[name] + '</svg>';
  }

  /* ---------- Stan ---------- */

  var p0 = C.parseKey(C.todayKey());
  var state = {
    data: C.emptyData(),
    settings: Store.loadSettings(),
    view: 'today',
    today: C.todayKey(),
    sel: C.todayKey(),
    selFollowsToday: true,
    month: { y: p0.y, m: p0.m },
    year: p0.y,
    yearMode: window.innerWidth >= 900 ? 'table' : 'months',
    analysisPeriod: 'd90',
    version: 0,
    sync: { state: 'off', lastSync: 0, error: '', code: '' },
    storageOk: true,
    editor: null,
    typing: false,
    deferred: false,
    installPrompt: null,
    connecting: false,
    connectError: ''
  };

  var SINCE_KEY = 'utarg.since';

  /** Data pierwszego użycia – wcześniejsze dni bez wpisu nie są ostrzeżeniem o braku. */
  function getSince() {
    var first = Store.lsGet(SINCE_KEY);
    if (!first || !C.parseKey(first)) {
      first = C.todayKey();
      Store.lsSet(SINCE_KEY, first);
    }
    var earliest = null;
    Object.keys(state.data.days).forEach(function (k) {
      if (state.data.days[k].a !== null && (earliest === null || k < earliest)) earliest = k;
    });
    return earliest !== null && earliest < first ? earliest : first;
  }

  function statOpts() {
    return { today: state.today, closedWeekdays: state.settings.closedWeekdays, since: getSince() };
  }

  /* ---------- Zapis danych ---------- */

  function commit(newData) {
    state.data = newData;
    state.version++;
    state.storageOk = Store.save(newData);
    Store.setDirty(true);
    Sync.schedule();
  }

  function typoGuard(key, amount) {
    var info = C.maxOpenDay(state.data, key);
    if (info.count >= 5 && amount >= 100000 && amount > info.max * 3) {
      return confirmDialog({
        title: 'Sprawdź kwotę',
        text: 'Wpisujesz ' + C.formatMoney(amount) + ', a najwyższy dotychczasowy dzienny utarg to ' +
          C.formatMoney(info.max) + '. Czy to na pewno poprawna kwota?',
        ok: 'Tak, zapisz',
        cancel: 'Popraw'
      });
    }
    return Promise.resolve(true);
  }

  function setHint(el, text, isError) {
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('err', !!isError);
  }

  /**
   * Zapisuje dzień (kwota albo „zamknięte”). Zwraca Promise<boolean> – czy zapisano.
   * ui.hintEl – element, w którym pokazać błąd walidacji.
   */
  function submitDay(key, text, closed, ui, note) {
    var today = C.todayKey();
    if (!C.parseKey(key) || key > today) {
      showToast('Nie można wpisać utargu za przyszły dzień.', { kind: 'error' });
      return Promise.resolve(false);
    }
    var amount = 0;
    if (!closed) {
      var r = C.parseAmount(text);
      if (!r.ok) {
        setHint(ui && ui.hintEl, r.error, true);
        if (ui && ui.inputEl) ui.inputEl.focus();
        return Promise.resolve(false);
      }
      amount = r.value;
    }
    var guard = closed ? Promise.resolve(true) : typoGuard(key, amount);
    return guard.then(function (go) {
      if (!go) return false;
      var prev = C.getDay(state.data, key);
      var before = prev ? { a: prev.a, c: prev.c, n: prev.n || '' } : null;
      var noteVal = note === undefined ? (prev && prev.n ? prev.n : '') : note;
      try {
        commit(C.setDay(state.data, key, amount, closed, Date.now(), noteVal));
      } catch (e) {
        showToast('Nie udało się zapisać. Spróbuj ponownie.', { kind: 'error' });
        return false;
      }
      showToast(closed ? 'Dzień oznaczony jako zamknięty' : 'Zapisano ' + C.formatMoney(amount), {
        undo: function () { restoreDay(key, before); }
      });
      refresh(true);
      return true;
    });
  }

  function restoreDay(key, before) {
    commit(C.setDay(state.data, key, before ? before.a : null, before ? before.c : false, Date.now(), before ? before.n : ''));
    showToast('Cofnięto zmianę');
    refresh(true);
  }

  function clearDay(key) {
    var prev = C.getDay(state.data, key);
    if (!prev) return;
    var before = { a: prev.a, c: prev.c, n: prev.n || '' };
    commit(C.setDay(state.data, key, null, false, Date.now()));
    showToast('Wpis usunięty', { undo: function () { restoreDay(key, before); } });
    refresh(true);
  }

  /* ---------- Wydatki ---------- */

  function newExpenseId() {
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function minus(g) { return '−' + C.formatMoney(g); }

  /** Podpis „Wydatki … · wynik …” (pusty, gdy nie ma wydatków). */
  function finLine(expenses, profit) {
    if (!expenses) return '';
    return '<div class="s">Wydatki ' + minus(expenses) + ' · ' + (profit >= 0 ? 'zysk ' : 'strata ') + C.formatMoney(Math.abs(profit)) + '</div>';
  }

  function openExpense(id, key) {
    var rec = id ? C.getExpense(state.data, id) : null;
    if (id && !rec) return;
    var k = rec ? rec.d : key;
    if (!C.parseKey(k) || k > C.todayKey()) k = C.todayKey();
    lastFocus = document.activeElement;
    state.editor = { kind: 'exp', id: id || null, key: k };
    try { history.pushState({ utargModal: true }, ''); } catch (e) { /* ignoruj */ }
    renderModal();
    var inp = $('ex-amount');
    if (inp) { inp.focus(); inp.select(); }
  }

  function expChips(note) {
    var active = C.expCatsOf(note);
    return C.EXP_CATS.map(function (t) {
      return '<button type="button" class="chip tiny" data-action="exp-tag" data-tag="' + t.id + '" aria-pressed="' + (active.indexOf(t.id) >= 0) + '">' + t.label + '</button>';
    }).join('');
  }

  function expModalHtml(e) {
    var rec = e.id ? C.getExpense(state.data, e.id) : null;
    return '<div class="backdrop" id="ed-backdrop"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="ed-title">' +
      '<div class="grab"></div><h2 id="ed-title">' + (rec ? 'Wydatek' : 'Nowy wydatek') + '</h2>' +
      '<p class="sub">' + (rec ? 'Popraw albo usuń wydatek.' : 'Wpisz kwotę i krótki opis, np. zatowarowanie albo prąd.') + '</p>' +
      '<div class="amount-field"><input id="ex-amount" class="amount-input" type="text" inputmode="decimal" autocomplete="off" autocapitalize="off" spellcheck="false" ' +
      'enterkeyhint="done" placeholder="0,00" aria-label="Kwota wydatku w złotych" value="' + (rec ? esc(C.toInputString(rec.a)) : '') + '">' +
      '<span class="amount-cur" aria-hidden="true">zł</span></div>' +
      '<p class="hero-hint" id="ex-hint"></p>' +
      '<div class="note-field"><label for="ex-note">Opis (opcjonalnie)</label>' +
      '<input id="ex-note" class="input" type="text" maxlength="' + C.NOTE_MAX + '" autocomplete="off" placeholder="np. zatowarowanie, prąd, czynsz" value="' + esc(rec ? rec.n || '' : '') + '">' +
      '<div class="chips" id="ex-tags">' + expChips(rec ? rec.n || '' : '') + '</div></div>' +
      '<div class="note-field"><label for="ex-date">Data wydatku</label>' +
      '<input id="ex-date" class="input" type="date" min="' + C.MIN_YEAR + '-01-01" max="' + C.todayKey() + '" value="' + e.key + '"></div>' +
      '<div class="actions"><button class="btn primary block" data-action="exp-save">' + icon('check') + 'Zapisz wydatek</button>' +
      '<div class="row2"><button class="btn ghost" data-action="editor-cancel">Anuluj</button>' +
      (rec ? '<button class="btn danger" data-action="exp-delete">' + icon('trash') + 'Usuń</button>' : '<span></span>') + '</div></div>' +
      '</div></div>';
  }

  function syncExpChips() {
    var inp = $('ex-note'), box = $('ex-tags');
    if (inp && box) box.innerHTML = expChips(inp.value);
  }

  function toggleExpTag(id) {
    var inp = $('ex-note');
    if (!inp) return;
    var cat = C.EXP_CATS.filter(function (t) { return t.id === id; })[0];
    if (!cat) return;
    var parts = inp.value.split(/[,;]/).map(function (p) { return p.trim(); }).filter(Boolean);
    if (C.expCatsOf(inp.value).indexOf(id) >= 0) {
      parts = parts.filter(function (p) { return C.expCatsOf(p).indexOf(id) < 0; });
    } else {
      parts.push(cat.label.toLowerCase());
    }
    inp.value = C.normalizeNote(parts.join(', '));
    syncExpChips();
  }

  function restoreExpense(id, before) {
    var cur = state.data.exp && state.data.exp[id];
    if (before) commit(C.setExpense(state.data, id, before.d, before.a, before.n, Date.now()));
    else if (cur) commit(C.setExpense(state.data, id, cur.d, null, '', Date.now()));
    showToast('Cofnięto zmianę');
    refresh(true);
  }

  function expenseSave() {
    var e = state.editor;
    if (!e || e.kind !== 'exp') return;
    var hint = $('ex-hint');
    var r = C.parseAmount($('ex-amount').value);
    if (!r.ok) { setHint(hint, r.error, true); $('ex-amount').focus(); return; }
    if (r.value < 1) { setHint(hint, 'Wpisz kwotę wydatku większą od zera.', true); $('ex-amount').focus(); return; }
    var date = $('ex-date').value;
    if (!C.parseKey(date) || date > C.todayKey()) { setHint(hint, 'Wybierz poprawną datę (nie z przyszłości).', true); return; }
    var id = e.id || newExpenseId();
    var prev = C.getExpense(state.data, id);
    var before = prev ? { d: prev.d, a: prev.a, n: prev.n || '' } : null;
    try {
      commit(C.setExpense(state.data, id, date, r.value, $('ex-note').value, Date.now()));
    } catch (err) {
      showToast('Nie udało się zapisać wydatku. Spróbuj ponownie.', { kind: 'error' });
      return;
    }
    closeEditor();
    showToast('Zapisano wydatek ' + C.formatMoney(r.value), { undo: function () { restoreExpense(id, before); } });
    refresh(true);
  }

  function deleteExpense() {
    var e = state.editor;
    if (!e || e.kind !== 'exp' || !e.id) return;
    var prev = C.getExpense(state.data, e.id);
    if (!prev) return;
    var id = e.id;
    var before = { d: prev.d, a: prev.a, n: prev.n || '' };
    closeEditor();
    commit(C.setExpense(state.data, id, prev.d, null, '', Date.now()));
    showToast('Wydatek usunięty', { undo: function () { restoreExpense(id, before); } });
    refresh(true);
  }

  function expRow(e) {
    var cat = C.expCategoryOf(e.n);
    return '<button class="row" data-action="exp-edit" data-id="' + esc(e.id) + '"><div class="mid"><b>' + esc(e.n || C.expCatLabel(cat)) + '</b>' +
      '<span class="note">' + esc(e.n ? C.expCatLabel(cat) + ' · ' : '') + esc(dayLabel(e.d)) + '</span></div><div class="amt num neg">' + minus(e.a) + '</div></button>';
  }

  /** Lista wydatków z przyciskiem dodawania. */
  function expensesBlock(title, list, addKey) {
    var h = '<div><div class="section-head"><h2 class="section-title">' + esc(title) + '</h2>' +
      '<button class="btn small" data-action="exp-add" data-key="' + addKey + '">' + icon('plus') + 'Dodaj wydatek</button></div>';
    if (!list.length) return h + '<p class="help">Brak wydatków.</p></div>';
    var sum = list.reduce(function (s2, e) { return s2 + e.a; }, 0);
    h += '<div class="list">' + list.map(expRow).join('');
    if (list.length > 1) h += '<div class="row total"><div class="mid">Razem wydatki</div><div class="amt num neg">' + minus(sum) + '</div></div>';
    return h + '</div></div>';
  }

  /* ---------- Teksty pomocnicze ---------- */

  function greeting() {
    var h = new Date().getHours();
    return h >= 18 || h < 5 ? 'Dobry wieczór' : 'Dzień dobry';
  }

  function timeOf(ms) {
    try {
      return new Date(ms).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  function dayLabel(key) {
    if (key === state.today) return 'Dzisiaj';
    if (key === C.addDays(state.today, -1)) return 'Wczoraj';
    var p = C.parseKey(key);
    return cap(C.WEEKDAYS[C.weekday(p.y, p.m, p.d)]) + ', ' + p.d + ' ' + C.MONTHS_GEN[p.m];
  }

  function chipDay(key) {
    var p = C.parseKey(key);
    return C.WEEKDAYS_SHORT[C.weekday(p.y, p.m, p.d)] + ' ' + p.d + ' ' + C.MONTHS_SHORT[p.m];
  }

  function daysWord(n) { return C.plural(n, 'dzień', 'dni', 'dni'); }

  /* ---------- Szkielet ---------- */

  var NAV = [
    { view: 'today', label: 'Dziś', icon: 'wallet' },
    { view: 'month', label: 'Miesiąc', icon: 'calendar' },
    { view: 'year', label: 'Rok', icon: 'bars' },
    { view: 'analysis', label: 'Analiza', icon: 'trend' },
    { view: 'settings', label: 'Ustawienia', icon: 'sliders' }
  ];

  function navButtons() {
    return NAV.map(function (n) {
      return '<button class="nav-btn" data-action="nav" data-view="' + n.view + '">' + icon(n.icon) + '<span>' + n.label + '</span></button>';
    }).join('');
  }

  function brandHtml() {
    return '<div class="brand"><img src="icons/icon-192.png" alt="" width="34" height="34"><span>Utarg</span></div>';
  }

  function buildShell() {
    $('app').innerHTML =
      '<div class="shell">' +
        '<aside class="side" aria-label="Menu">' + brandHtml() + navButtons() + '<div class="spacer"></div><div id="pill-side"></div></aside>' +
        '<div class="main">' +
          '<header class="top">' + brandHtml() + '<div id="pill-top"></div></header>' +
          '<main id="view" class="view" tabindex="-1"></main>' +
        '</div>' +
        '<nav class="tabbar" aria-label="Główna nawigacja">' + navButtons() + '</nav>' +
        '<div id="toasts" class="toasts" role="status" aria-live="polite"></div>' +
        '<div id="modal-root"></div>' +
        '<div id="confirm-root"></div>' +
      '</div>';
  }

  function renderNav() {
    var btns = document.querySelectorAll('[data-action="nav"]');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute('data-view') === state.view) btns[i].setAttribute('aria-current', 'page');
      else btns[i].removeAttribute('aria-current');
    }
  }

  function pillInfo() {
    var s = state.sync;
    if (!state.storageOk) return { cls: 'error', text: 'Błąd zapisu na urządzeniu' };
    if (s.state === 'off') return { cls: 'off', text: 'Kopia wyłączona' };
    if (s.state === 'syncing') return { cls: 'pending syncing', text: 'Wysyłam kopię…' };
    if (s.state === 'pending') return { cls: 'pending', text: 'Kopia czeka na wysłanie' };
    if (s.state === 'error') return { cls: 'error', text: 'Kopia: wymaga uwagi' };
    return { cls: 'ok', text: 'Kopia zapisana' + (s.lastSync ? ' · ' + timeOf(s.lastSync) : '') };
  }

  function renderPill() {
    var i = pillInfo();
    var html = '<button class="pill ' + i.cls + '" data-action="goto-backup"><span class="dot"></span>' + esc(i.text) + '</button>';
    if ($('pill-top')) $('pill-top').innerHTML = html;
    if ($('pill-side')) $('pill-side').innerHTML = html;
  }

  function applyTheme() {
    var t = state.settings.theme;
    var root = document.documentElement;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
    else root.removeAttribute('data-theme');
    var meta = $('theme-color');
    if (meta) {
      var bg = getComputedStyle(root).getPropertyValue('--bg').trim();
      if (bg) meta.setAttribute('content', bg);
    }
  }

  /* ---------- Widoki ---------- */

  function statusBanners() {
    var h = '';
    var s = state.sync;
    if (!state.storageOk) {
      h += '<div class="banner error">' + icon('alert') + '<div class="grow"><strong>Dane nie zapisują się na tym urządzeniu</strong>' +
        'Przeglądarka blokuje zapis (np. tryb prywatny). Pobierz kopię w Ustawieniach i nie zamykaj aplikacji.</div></div>';
    }
    if (s.state === 'error') {
      h += '<div class="banner error">' + icon('alert') + '<div class="grow"><strong>Kopia na GitHubie nie działa</strong>' + esc(s.error) +
        '<div class="btn-row"><button class="btn small" data-action="sync-now">Spróbuj ponownie</button>' +
        '<button class="btn small ghost" data-action="goto-backup">Ustawienia kopii</button></div></div></div>';
    } else if (s.state === 'pending' && s.error) {
      h += '<div class="banner warn">' + icon('info') + '<div class="grow"><strong>Kopia czeka na wysłanie</strong>' + esc(s.error) +
        ' Twoje dane są bezpieczne na tym urządzeniu.</div></div>';
    } else if (s.state === 'off') {
      h += '<div class="banner info">' + icon('shield') + '<div class="grow"><strong>Włącz kopię bezpieczeństwa</strong>' +
        'Połącz prywatne repozytorium GitHub, a dane będą zabezpieczone i dostępne na każdym urządzeniu.' +
        '<div class="btn-row"><button class="btn small" data-action="goto-backup">Skonfiguruj kopię</button></div></div></div>';
    }
    return h;
  }

  function missingBanner(keys) {
    if (!keys.length) return '';
    var shown = keys.slice(-6).reverse();
    var chips = shown.map(function (k) {
      return '<button class="chip warn" data-action="open-editor" data-key="' + k + '">' + chipDay(k) + '</button>';
    }).join('');
    if (keys.length > shown.length) {
      var f = C.parseKey(keys[0]);
      chips += '<button class="chip" data-action="goto-month" data-y="' + f.y + '" data-m="' + f.m + '">+' + (keys.length - shown.length) + ' więcej</button>';
    }
    return '<div class="banner warn">' + icon('alert') + '<div class="grow"><strong>Brakuje wpisów: ' + keys.length + ' ' + daysWord(keys.length) + '</strong>' +
      'Wpisz kwotę albo oznacz dzień jako zamknięty, żeby sumy były kompletne.<div class="chips">' + chips + '</div></div></div>';
  }

  /** Subtelna notatka pod kwotą: pojawia się dopiero, gdy dzień jest zapisany. */
  function heroNote(rec, key) {
    if (!rec) return '';
    return '<div class="hero-extra">' + (rec.n ? '<span class="hero-note">' + esc(rec.n) + '</span>' : '') +
      '<button class="hero-link" data-action="open-editor" data-key="' + key + '">' + icon('note') + (rec.n ? 'Zmień notatkę' : 'Dodaj notatkę') + '</button></div>';
  }

  function todayView() {
    var key = state.sel;
    var today = state.today;
    var rec = C.getDay(state.data, key);
    var isToday = key === today;
    var p = C.parseKey(key);
    var o = statOpts();
    var ms = C.monthStats(state.data, p.y, p.m, o);
    var ys = C.yearStats(state.data, p.y, o);

    var h = '<div class="page-head"><div><h1>' + (isToday ? greeting() : 'Wcześniejszy dzień') + '</h1><p>' +
      cap(C.longDate(key)) + '</p></div></div>';

    h += '<div class="day-switch">' +
      '<button class="icon-btn" data-action="today-prev" aria-label="Poprzedni dzień"' + (key <= C.dateKey(C.MIN_YEAR, 0, 1) ? ' disabled' : '') + '>' + icon('chevL') + '</button>' +
      '<div class="label">' + esc(dayLabel(key)) + '</div>' +
      '<button class="icon-btn" data-action="today-next" aria-label="Następny dzień"' + (key >= today ? ' disabled' : '') + '>' + icon('chevR') + '</button>' +
      '</div>';

    h += '<div class="stack" id="today-stack">';
    h += '<section class="hero" aria-label="Wpis utargu">';
    h += '<div class="hero-label">Utarg za ' + (isToday ? 'dziś' : 'ten dzień');
    if (rec) h += '<span class="hero-saved">' + icon('check') + 'Zapisano ' + timeOf(rec.t) + '</span>';
    h += '</div>';

    if (rec && rec.c) {
      h += '<div class="closed-state">' + icon('moon') + 'Sklep zamknięty</div>';
      h += '<p class="hero-hint">Ten dzień liczy się jako 0,00 zł.</p>';
      h += '<div class="hero-actions"><button class="btn primary" data-action="today-reopen">Wpisz utarg</button></div>';
      h += heroNote(rec, key);
    } else {
      h += '<div class="amount-row"><input id="amount-input" class="amount-input" type="text" inputmode="decimal" autocomplete="off" ' +
        'autocapitalize="off" spellcheck="false" enterkeyhint="done" placeholder="0,00" aria-label="Kwota utargu w złotych" ' +
        'value="' + (rec ? esc(C.toInputString(rec.a)) : '') + '"><span class="amount-cur" aria-hidden="true">zł</span></div>';
      h += '<p class="hero-hint" id="hint">' + (rec ? 'Zapisano: ' + C.formatMoney(rec.a) : 'Wpisz kwotę po zamknięciu sklepu.') + '</p>';
      h += '<div class="hero-actions"><button class="btn primary" data-action="today-save">' + icon('check') + (rec ? 'Zapisz zmianę' : 'Zapisz utarg') + '</button>' +
        '<button class="btn glass" data-action="today-closed">' + icon('moon') + 'Zamknięte</button></div>';
      h += heroNote(rec, key);
    }
    h += '</section>';

    h += statusBanners();

    var missing = C.missingRecent(state.data, today, 60, state.settings.closedWeekdays, o.since);
    h += missingBanner(missing);

    h += '<div class="grid2">' +
      '<button class="metric" data-action="goto-month" data-y="' + p.y + '" data-m="' + p.m + '"><div class="k">' + cap(C.MONTHS[p.m]) + ', razem</div>' +
      '<div class="v num">' + C.formatMoney(ms.total) + '</div><div class="s">' + ms.open + ' ' + daysWord(ms.open) + ' z utargiem</div>' + finLine(ms.expenses, ms.profit) + '</button>' +
      '<button class="metric gold" data-action="goto-year" data-y="' + p.y + '"><div class="k">Rok ' + p.y + ', razem</div>' +
      '<div class="v num">' + C.formatMoney(ys.total) + '</div><div class="s">' + ys.open + ' ' + daysWord(ys.open) + ' z utargiem</div>' + finLine(ys.expenses, ys.profit) + '</button>' +
      '</div>';

    h += expensesBlock('Wydatki · ' + dayLabel(key), C.listExpenses(state.data, key, key), key);

    var recent = C.recentEntries(state.data, today, 5);
    h += '<div><h2 class="section-title">Ostatnie wpisy</h2>';
    if (!recent.length) {
      h += '<div class="list"><div class="empty"><b>Zacznij od pierwszego wpisu</b>Wpisz dzisiejszy utarg powyżej. Sumy miesięczne i roczne policzą się same.</div></div>';
    } else {
      h += '<div class="list">' + recent.map(function (e) {
        return '<button class="row" data-action="open-editor" data-key="' + e.key + '"><div class="mid"><b>' + esc(dayLabel(e.key)) + '</b>' + (e.rec.n ? '<span class="note">' + esc(e.rec.n) + '</span>' : '') + '</div>' +
          (e.rec.c ? '<span class="tag closed">' + icon('moon') + 'Zamknięte</span>' : '<div class="amt num">' + C.formatMoney(e.rec.a) + '</div>') + '</button>';
      }).join('') + '</div>';
    }
    h += '</div></div>';
    return h;
  }

  function navHead(label, prevAction, nextAction, prevLabel, nextLabel) {
    return '<div class="day-switch">' +
      '<button class="icon-btn" data-action="' + prevAction + '" aria-label="' + prevLabel + '">' + icon('chevL') + '</button>' +
      '<h1 class="label big">' + label + '</h1>' +
      '<button class="icon-btn" data-action="' + nextAction + '" aria-label="' + nextLabel + '">' + icon('chevR') + '</button></div>';
  }

  /** Wydatki i wynik w karcie głównej (miesiąc / rok). */
  function heroFin(expenses, profit) {
    if (!expenses) return '';
    return '<div class="hero-fin"><span>Wydatki <b>' + minus(expenses) + '</b></span><span>' + (profit >= 0 ? 'Zysk' : 'Strata') + ' <b>' + C.formatMoney(Math.abs(profit)) + '</b></span></div>';
  }

  function monthView() {
    var y = state.month.y, m = state.month.m;
    var o = statOpts();
    var ms = C.monthStats(state.data, y, m, o);
    var today = state.today;
    var cur = C.parseKey(today);
    var isCurrent = cur.y === y && cur.m === m;
    var pastMissing = ms.missing.filter(function (k) { return k < today; });

    var h = '<div class="stack">';
    h += navHead(cap(C.MONTHS[m]) + ' ' + y, 'month-prev', 'month-next', 'Poprzedni miesiąc', 'Następny miesiąc');
    if (!isCurrent) h += '<div><button class="btn small" data-action="goto-current">Wróć do bieżącego miesiąca</button></div>';

    var status;
    if (ms.finished && !ms.missing.length) status = '<span class="hero-saved">' + icon('check') + 'Miesiąc kompletny</span>';
    else if (ms.finished) status = '<span class="hero-saved">' + icon('alert') + 'Brakuje ' + ms.missing.length + ' ' + C.plural(ms.missing.length, 'wpisu', 'wpisów', 'wpisów') + '</span>';
    else if (C.dateKey(y, m, 1) > today) status = '';
    else status = '<span class="hero-saved">Miesiąc trwa</span>';

    h += '<section class="hero" aria-label="Suma miesiąca"><div class="hero-label">Suma miesiąca ' + status + '</div>' +
      '<div class="hero-total num">' + C.formatMoney(ms.total) + '</div>' +
      '<div class="hero-stats">' +
        '<div><b class="num">' + ms.open + '</b><span>' + daysWord(ms.open) + ' z utargiem</span></div>' +
        '<div><b class="num">' + ms.closed + '</b><span>' + C.plural(ms.closed, 'dzień zamknięty', 'dni zamknięte', 'dni zamkniętych') + '</span></div>' +
        '<div><b class="num">' + C.formatGrosze(ms.avg) + '</b><span>średnio dziennie, zł</span></div>' +
      '</div>' + heroFin(ms.expenses, ms.profit) + '</section>';

    h += missingBanner(pastMissing);

    var monthExp = C.listExpenses(state.data, C.dateKey(y, m, 1), C.dateKey(y, m, ms.days));
    var expByDay = {};
    monthExp.forEach(function (e) { (expByDay[e.d] = expByDay[e.d] || []).push(e); });
    h += '<div class="list">';
    for (var d = 1; d <= ms.days; d++) {
      var key = C.dateKey(y, m, d);
      var rec = C.getDay(state.data, key);
      var wd = C.weekday(y, m, d);
      var dh = '<div class="d"><b>' + d + '</b><span>' + C.WEEKDAYS_SHORT[wd] + '</span></div>';
      if (key > today) {
        h += '<div class="row future">' + dh + '<div class="mid"></div></div>';
        continue;
      }
      var cls = 'row' + (key === today ? ' today' : '');
      var mid = '<div class="mid"></div>';
      var right = '';
      if (rec) {
        if (rec.n) mid = '<div class="mid"><span class="note">' + esc(rec.n) + '</span></div>';
        if (rec.c) right = '<span class="tag closed">' + icon('moon') + 'Zamknięte</span>';
        else right = '<div class="amt num">' + C.formatMoney(rec.a) + '</div>';
      } else if (key >= o.since && C.isStandingClosed(key, state.settings.closedWeekdays)) {
        cls += ' standing';
        mid = '<div class="mid">Dzień wolny</div>';
      } else if (key >= o.since) {
        cls += ' missing';
        mid = '<div class="mid">' + (key === today ? 'Czeka na wpis' : 'Brak wpisu') + '</div>';
        right = '<span class="tag gold">' + (key === today ? 'Wpisz' : 'Uzupełnij') + '</span>';
      } else {
        mid = '<div class="mid">—</div>';
      }
      var dayExp = expByDay[key];
      if (dayExp) {
        var dsum = dayExp.reduce(function (acc, e) { return acc + e.a; }, 0);
        var ddesc = dayExp.map(function (e) { return e.n || C.expCatLabel(C.expCategoryOf(e.n)); }).join(', ');
        mid = mid.replace(/<\/div>$/, '<span class="exp-line">' + minus(dsum) + ' · ' + esc(ddesc) + '</span></div>');
      }
      h += '<button class="' + cls + '" data-action="open-editor" data-key="' + key + '" aria-label="' + esc(cap(C.longDate(key))) + '">' + dh + mid + right + '</button>';
    }
    h += '<div class="row total"><div class="d"></div><div class="mid">Suma — ' + C.MONTHS[m] + '</div><div class="amt num">' + C.formatMoney(ms.total) + '</div></div>';
    if (ms.expenses) {
      h += '<div class="row total"><div class="d"></div><div class="mid">Wydatki</div><div class="amt num neg">' + minus(ms.expenses) + '</div></div>';
      h += '<div class="row total"><div class="d"></div><div class="mid">' + (ms.profit >= 0 ? 'Zysk' : 'Strata') + ' miesiąca</div><div class="amt num ' + (ms.profit >= 0 ? 'pos' : 'neg') + '">' + C.formatMoney(ms.profit) + '</div></div>';
    }
    h += '</div>';
    var addKey = cur.y === y && cur.m === m ? today : (C.dateKey(y, m, ms.days) < today ? C.dateKey(y, m, ms.days) : today);
    h += expensesBlock('Wydatki w miesiącu', monthExp, addKey);
    h += printButton('print-month') + '</div>';
    return h;
  }

  function compactStatus(ms) {
    return ms.missing.length && ms.finished ? '<span class="tag gold">brak: ' + ms.missing.length + '</span>' : '';
  }

  function chartSvg(ys) {
    var max = 0;
    ys.months.forEach(function (s) { if (s.total > max) max = s.total; });
    var cur = C.parseKey(state.today);
    var svg = '<svg class="chart" viewBox="0 0 360 180" role="img" aria-label="Wykres utargu w kolejnych miesiącach roku ' + ys.y + '">';
    svg += '<line class="base" x1="6" y1="150" x2="354" y2="150"/>';
    ys.months.forEach(function (s, i) {
      var x = 11 + i * 28;
      var hgt = s.total > 0 ? Math.max(6, Math.round(s.total / max * 120)) : 0;
      var cls = 'bar on';
      if (i === ys.bestMonth) cls = 'bar best';
      else if (cur.y === ys.y && cur.m === i) cls = 'bar now';
      else if (s.total === 0) cls = 'bar';
      if (s.total === 0) {
        svg += '<rect class="bar" data-action="goto-month" data-y="' + ys.y + '" data-m="' + i + '" x="' + x + '" y="146" width="18" height="4" rx="2"/>';
      } else {
        svg += '<rect class="' + cls + '" data-action="goto-month" data-y="' + ys.y + '" data-m="' + i + '" x="' + x + '" y="' + (150 - hgt) + '" width="18" height="' + hgt + '" rx="5"/>';
      }
      svg += '<text x="' + (x + 9) + '" y="170" text-anchor="middle">' + C.MONTHS_SHORT[i] + '</text>';
    });
    return svg + '</svg>';
  }

  function yearTable(ys, o) {
    var y = ys.y;
    var today = state.today;
    var t = '<div class="table-wrap"><table class="ytable"><thead><tr><th class="corner" scope="col">Dzień</th>';
    for (var m = 0; m < 12; m++) t += '<th scope="col">' + cap(C.MONTHS_SHORT[m]) + '</th>';
    t += '</tr></thead><tbody>';
    for (var d = 1; d <= 31; d++) {
      t += '<tr><th class="dayhead" scope="row">' + d + '</th>';
      for (var mm = 0; mm < 12; mm++) {
        if (d > C.daysInMonth(y, mm)) { t += '<td class="na" aria-hidden="true"></td>'; continue; }
        var key = C.dateKey(y, mm, d);
        if (key > today) { t += '<td class="future"><span class="cell"></span></td>'; continue; }
        var rec = C.getDay(state.data, key);
        var cls = key === today ? 'today' : '';
        var text = '';
        var label = cap(C.longDate(key)) + ': ';
        if (rec) {
          if (rec.c) { cls += ' closed'; text = 'zamk.'; label += 'sklep zamknięty'; }
          else { text = C.formatGrosze(rec.a); label += C.formatMoney(rec.a); }
        } else if (key >= o.since && C.isStandingClosed(key, state.settings.closedWeekdays)) {
          cls += ' closed'; text = 'wolne'; label += 'dzień wolny';
        } else if (key >= o.since) {
          if (key < today) cls += ' miss';
          text = '—'; label += 'brak wpisu';
        } else {
          label += 'brak wpisu';
        }
        t += '<td class="' + cls.trim() + '"><button class="cell num" data-action="open-editor" data-key="' + key + '" aria-label="' + esc(label) + '">' + text + '</button></td>';
      }
      t += '</tr>';
    }
    t += '</tbody><tfoot><tr class="t1"><th scope="row">Suma</th>';
    ys.months.forEach(function (s) { t += '<td class="num">' + C.formatGrosze(s.total) + '</td>'; });
    t += '</tr><tr class="t2"><th scope="row">Razem</th><td colspan="12" class="grand num"><span>Rok ' + y + ': ' + C.formatMoney(ys.total) + '</span></td></tr></tfoot></table></div>';
    return t;
  }

  function yearView() {
    var y = state.year;
    var o = statOpts();
    var ys = C.yearStats(state.data, y, o);
    var h = '<div class="stack">';
    h += navHead('Rok ' + y, 'year-prev', 'year-next', 'Poprzedni rok', 'Następny rok');
    h += '<div class="seg full" role="group" aria-label="Widok roku">' +
      '<button data-action="year-mode" data-mode="months" aria-pressed="' + (state.yearMode === 'months') + '">' + icon('list') + ' Miesiące</button>' +
      '<button data-action="year-mode" data-mode="table" aria-pressed="' + (state.yearMode === 'table') + '">' + icon('table') + ' Tabela</button></div>';

    var best = ys.bestMonth >= 0 ? ys.months[ys.bestMonth] : null;
    h += '<section class="hero" aria-label="Suma roczna"><div class="hero-label">Utarg roczny ' + y + '</div>' +
      '<div class="hero-total num">' + C.formatMoney(ys.total) + '</div>' +
      '<div class="hero-stats">' +
        '<div><b class="num">' + ys.open + '</b><span>' + daysWord(ys.open) + ' z utargiem</span></div>' +
        '<div><b class="num">' + C.formatGrosze(ys.avg) + '</b><span>średnio dziennie, zł</span></div>' +
        '<div><b>' + (best ? cap(C.MONTHS_SHORT[best.m]) : '—') + '</b><span>najlepszy miesiąc</span></div>' +
      '</div>' + heroFin(ys.expenses, ys.profit) + '</section>';

    if (state.yearMode === 'table') {
      h += '<p class="help">Dotknij dowolnej komórki, żeby wpisać lub poprawić kwotę. Przesuń w bok, aby zobaczyć kolejne miesiące.</p>';
      h += yearTable(ys, o);
    } else {
      h += '<div class="card"><div class="chart-box">' + chartSvg(ys) + '</div></div>';
      var max = 0;
      ys.months.forEach(function (s) { if (s.total > max) max = s.total; });
      h += '<div class="list">';
      ys.months.forEach(function (s, i) {
        var pct = max > 0 ? Math.round(s.total / max * 100) : 0;
        h += '<button class="row mrow" data-action="goto-month" data-y="' + y + '" data-m="' + i + '"><div class="mid"><b>' + C.MONTHS[i] + '</b>' +
          '<svg class="mini" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect class="track" width="100" height="6" rx="3"/><rect class="fill" width="' + pct + '" height="6" rx="3"/></svg>' +
          (s.expenses ? '<span class="note">Wydatki ' + minus(s.expenses) + ' · ' + (s.profit >= 0 ? 'zysk ' : 'strata ') + C.formatMoney(Math.abs(s.profit)) + '</span>' : '') + '</div>' +
          compactStatus(s) + '<div class="amt num">' + C.formatMoney(s.total) + '</div></button>';
      });
      h += '<div class="row total"><div class="mid">Razem — rok ' + y + '</div><div class="amt num">' + C.formatMoney(ys.total) + '</div></div>';
      if (ys.expenses) {
        h += '<div class="row total"><div class="mid">Wydatki</div><div class="amt num neg">' + minus(ys.expenses) + '</div></div>';
        h += '<div class="row total"><div class="mid">' + (ys.profit >= 0 ? 'Zysk' : 'Strata') + ' roku</div><div class="amt num ' + (ys.profit >= 0 ? 'pos' : 'neg') + '">' + C.formatMoney(ys.profit) + '</div></div>';
      }
      h += '</div>';
    }
    h += printButton('print-year') + '</div>';
    return h;
  }

  function installCard() {
    var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    var h = '<div class="card"><h2>Instalacja na tym urządzeniu</h2>';
    if (standalone) {
      h += '<p class="help">Aplikacja jest zainstalowana i działa bez internetu.</p>';
    } else if (state.installPrompt) {
      h += '<p class="help">Zainstaluj Utarg jak zwykłą aplikację – z ikoną na pulpicie i pełnym ekranem.</p><div class="btn-row"><button class="btn primary" data-action="install">Zainstaluj aplikację</button></div>';
    } else {
      var ua = navigator.userAgent || '';
      var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (ios) {
        h += '<p class="help">Na iPhonie i iPadzie otwórz tę stronę w Safari, dotknij przycisku Udostępnij, a potem „Do ekranu początkowego”.</p>';
      } else {
        h += '<p class="help">W menu przeglądarki wybierz „Zainstaluj aplikację” (komputer) albo „Dodaj do ekranu głównego” (Android).</p>';
      }
    }
    return h + '</div>';
  }

  function backupCard() {
    var s = state.sync;
    var cfg = Sync.getConfig();
    var h = '<div class="card" id="backup"><h2>Kopia bezpieczeństwa w GitHub</h2>';
    if (!cfg) {
      h += '<p class="help">Po każdym wpisie aplikacja wyśle kopię danych do Twojego prywatnego repozytorium. Dzięki temu dane są bezpieczne i takie same na telefonie oraz komputerze.</p>';
      h += '<div class="stack" id="connect-form">' +
        '<div class="field"><label for="repo-input">Repozytorium (login/nazwa)</label><input id="repo-input" class="input" type="text" placeholder="jan-kowalski/utarg-dane" autocomplete="off" autocapitalize="none" spellcheck="false"></div>' +
        '<div class="field"><label for="token-input">Token dostępu</label><input id="token-input" class="input" type="password" placeholder="github_pat_…" autocomplete="off" autocapitalize="none" spellcheck="false"></div>' +
        '<div class="field"><label for="branch-input">Gałąź na dane (opcjonalnie)</label><input id="branch-input" class="input" type="text" placeholder="dane" autocomplete="off" autocapitalize="none" spellcheck="false">' +
        '<p class="help">Zostaw puste, jeśli repozytorium służy tylko do danych. Gdy trzymasz tu też kod aplikacji, wpisz np. „dane”, żeby kopie nie uruchamiały odświeżania strony.</p></div>' +
        '<p class="hero-hint err" id="connect-error" role="alert"></p>' +
        '<div class="btn-row"><button class="btn primary" data-action="sync-connect">' + icon('shield') + 'Połącz i wyślij kopię</button></div></div>';
      h += '<details class="how"><summary>Jak to ustawić (5 minut)</summary><ol>' +
        '<li>Na <a href="https://github.com/new" target="_blank" rel="noopener noreferrer">github.com/new</a> utwórz repozytorium, np. „utarg-dane”. Wybierz <b>Private</b> i zaznacz „Add a README file”.</li>' +
        '<li>Otwórz <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">tworzenie tokenu</a>. W „Repository access” wybierz „Only select repositories” i wskaż to jedno repozytorium.</li>' +
        '<li>W „Permissions” → „Repository permissions” ustaw <b>Contents: Read and write</b>. Ustaw długi czas ważności tokenu.</li>' +
        '<li>Wygenerowany token wklej powyżej razem z nazwą repozytorium. Na drugim urządzeniu zrób to samo.</li></ol></details>';
    } else {
      var stateText = { synced: 'Kopia aktualna', pending: 'Czeka na wysłanie', syncing: 'Wysyłanie…', error: 'Wymaga uwagi', off: 'Wyłączona' }[s.state] || '';
      if (cfg.public) {
        h += '<div class="banner warn">' + icon('alert') + '<div class="grow"><strong>Repozytorium jest publiczne</strong>' +
          'Każdy w internecie widzi Twoje dane i historię zmian. Przed użyciem w prawdziwej firmie przenieś dane do repozytorium prywatnego.</div></div>';
      }
      h += '<div class="kv"><div><span>Repozytorium</span><b>' + esc(cfg.owner + '/' + cfg.repo) + '</b></div>' +
        '<div><span>Gałąź</span><b>' + esc(cfg.branch || 'domyślna') + '</b></div>' +
        '<div><span>Stan</span><b>' + stateText + '</b></div>' +
        '<div><span>Ostatnia kopia</span><b>' + (s.lastSync ? esc(new Date(s.lastSync).toLocaleString('pl-PL')) : '—') + '</b></div></div>';
      if (s.error) h += '<div class="banner ' + (s.state === 'error' ? 'error' : 'warn') + '">' + icon('alert') + '<div class="grow">' + esc(s.error) + '</div></div>';
      h += '<p class="help">Każda zmiana to osobny zapis w historii repozytorium, więc można wrócić do dowolnej wcześniejszej wersji.</p>';
      h += '<div class="btn-row"><button class="btn primary" data-action="sync-now">' + icon('refresh') + 'Wyślij kopię teraz</button>' +
        '<button class="btn danger" data-action="sync-disconnect">Odłącz</button></div>';
    }
    return h + '</div>';
  }

  function dataCard() {
    var years = {};
    Object.keys(state.data.days).forEach(function (k) {
      if (state.data.days[k].a !== null) years[k.slice(0, 4)] = 1;
    });
    var expYears = {};
    C.listExpenses(state.data).forEach(function (e) { expYears[e.d.slice(0, 4)] = 1; });
    var list = Object.keys(years).sort().reverse().slice(0, 4);
    if (!list.length) list = [String(state.today.slice(0, 4))];
    var n = C.countEntries(state.data);
    var h = '<div class="card"><h2>Twoje dane</h2><p class="help">Zapisanych wpisów: <b>' + n + '</b>, wydatków: <b>' + C.countExpenses(state.data) + '</b>. Plik kopii możesz przechowywać dodatkowo na dysku lub w poczcie. „Wczytaj z pliku” przyjmuje kopię (JSON) oraz historię z CSV: tabelę wyeksportowaną stąd albo listę „data;kwota” (np. z Excela). Istniejące wpisy nie są nadpisywane.</p>' +
      '<div class="btn-row"><button class="btn" data-action="export-json">' + icon('download') + 'Pobierz kopię (JSON)</button>' +
      '<button class="btn" data-action="import-pick">' + icon('upload') + 'Wczytaj z pliku</button></div>' +
      '<div class="btn-row">' + list.map(function (y) {
        return '<button class="btn small" data-action="export-csv" data-y="' + y + '">' + icon('download') + 'Tabela ' + y + ' (CSV)</button>';
      }).join('') + Object.keys(expYears).sort().reverse().slice(0, 4).map(function (y) {
        return '<button class="btn small" data-action="export-exp-csv" data-y="' + y + '">' + icon('download') + 'Wydatki ' + y + ' (CSV)</button>';
      }).join('') + '</div>' +
      '<input id="import-file" class="hidden-file" type="file" accept=".json,.csv,application/json,text/csv,text/plain" tabindex="-1" aria-hidden="true"></div>';
    return h;
  }

  function settingsView() {
    var st = state.settings;
    var order = [1, 2, 3, 4, 5, 6, 0];
    var h = '<div class="page-head"><div><h1>Ustawienia</h1><p>Wygląd, dni wolne i kopia bezpieczeństwa.</p></div></div><div class="stack">';
    h += backupCard();
    h += '<div class="card"><h2>Wygląd</h2><p class="help">Automatycznie dopasowuje się do ustawień telefonu lub komputera.</p>' +
      '<div class="seg full" role="radiogroup" aria-label="Motyw">' +
      [['auto', 'Automatyczny'], ['light', 'Jasny'], ['dark', 'Ciemny']].map(function (t) {
        return '<button role="radio" aria-checked="' + (st.theme === t[0]) + '" data-action="theme" data-theme="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div></div>';
    h += '<div class="card"><h2>Stałe dni wolne</h2><p class="help">Zaznacz dni tygodnia, w które sklep jest zawsze zamknięty (np. niedziela). Aplikacja nie będzie wtedy przypominać o wpisie.</p>' +
      '<div class="chips">' + order.map(function (d) {
        return '<button class="chip" data-action="weekday" data-d="' + d + '" aria-pressed="' + (st.closedWeekdays.indexOf(d) >= 0) + '">' + cap(C.WEEKDAYS[d]) + '</button>';
      }).join('') + '</div></div>';
    h += '<div class="card" id="cost-card"><h2>Koszt otwarcia sklepu</h2><p class="help">Opcjonalnie. Dzienny koszt, poniżej którego otwarcie się nie opłaca (np. pensja pracownika, opłata za dzień). Wpisuj tu tylko koszty codzienne. Towar, prąd, czynsz i inne jednorazowe rachunki dodawaj jako wydatki – nie wpływają one na ocenę dni. Analiza pokaże dni i okoliczności z utargiem niższym niż ten koszt.</p>' +
      '<div class="amount-field plain"><input id="cost-input" class="input" type="text" inputmode="decimal" autocomplete="off" placeholder="np. 300 (puste = wyłączone)" aria-label="Dzienny koszt otwarcia w złotych" value="' + (st.openCost ? esc(C.toInputString(st.openCost)) : '') + '"><span class="amount-cur" aria-hidden="true">zł</span></div>' +
      '<p class="hero-hint err" id="cost-hint" role="alert"></p></div>';
    h += dataCard();
    h += installCard();
    h += '<div class="card"><h2>O aplikacji</h2><div class="kv"><div><span>Wersja</span><b>' + APP_VERSION + '</b></div>' +
      '<div><span>Dane</span><b>Na tym urządzeniu i w Twoim repozytorium</b></div></div></div>';
    h += '</div>';
    return h;
  }

  /* ---------- Analiza ---------- */

  var PERIODS = [
    { id: 'd30', label: '30 dni' },
    { id: 'd90', label: '90 dni' },
    { id: 'y', label: 'Ten rok' },
    { id: 'all', label: 'Wszystko' }
  ];

  function analysisFrom() {
    var t = state.today;
    switch (state.analysisPeriod) {
      case 'd30': return C.addDays(t, -29);
      case 'd90': return C.addDays(t, -89);
      case 'y': return t.slice(0, 4) + '-01-01';
      default: return null;
    }
  }

  /** Złote bez groszy do podpisów na wykresach: 123450 → "1 235". */
  function zlShort(g) { return C.formatGrosze(Math.round(g / 100) * 100).split(',')[0]; }

  /**
   * Wykres słupkowy w SVG (bez stylów inline – tylko klasy i atrybuty prezentacyjne).
   * items: [{ label, value, cls }], o: { cost, values }.
   */
  function barsSvg(items, o) {
    o = o || {};
    var W = 360, base = 150, maxH = 118;
    var max = 0;
    items.forEach(function (it) { if (it.value > max) max = it.value; });
    if (o.cost > max) max = o.cost;
    var n = items.length;
    var slot = (W - 12) / n;
    var bw = Math.min(30, Math.round(slot * 0.62));
    var svg = '<svg class="chart static" viewBox="0 0 360 180" role="img" aria-label="' + esc(o.aria || 'Wykres') + '">';
    svg += '<line class="base" x1="6" y1="' + base + '" x2="354" y2="' + base + '"/>';
    items.forEach(function (it, i) {
      var x = Math.round(6 + i * slot + (slot - bw) / 2);
      var hgt = it.value > 0 && max > 0 ? Math.max(4, Math.round(it.value / max * maxH)) : 0;
      if (hgt === 0) svg += '<rect class="bar" x="' + x + '" y="147" width="' + bw + '" height="3" rx="1.5"/>';
      else svg += '<rect class="' + (it.cls || 'bar on') + '" x="' + x + '" y="' + (base - hgt) + '" width="' + bw + '" height="' + hgt + '" rx="5"/>';
      if (o.values && it.value > 0) svg += '<text class="val" x="' + (x + bw / 2) + '" y="' + (base - hgt - 5) + '" text-anchor="middle">' + zlShort(it.value) + '</text>';
      svg += '<text x="' + (x + bw / 2) + '" y="170" text-anchor="middle">' + esc(it.label) + '</text>';
    });
    if (o.cost > 0 && max > 0) {
      var cy = base - Math.round(o.cost / max * maxH);
      svg += '<line class="cost" x1="6" y1="' + cy + '" x2="354" y2="' + cy + '"/>';
    }
    return svg + '</svg>';
  }

  /** Wykres wyniku (zysk w górę, strata w dół). items: [{ label, value }]. */
  function resultSvg(items, aria) {
    var W = 360, top = 16, bottom = 150;
    var maxPos = 0, maxNeg = 0;
    items.forEach(function (it) { if (it.value > maxPos) maxPos = it.value; if (-it.value > maxNeg) maxNeg = -it.value; });
    var span = maxPos + maxNeg;
    var zero = span === 0 ? bottom : Math.round(top + (maxPos / span) * (bottom - top));
    var scale = span === 0 ? 0 : (bottom - top) / span;
    var n = items.length, slot = (W - 12) / n, bw = Math.min(30, Math.round(slot * 0.62));
    var svg = '<svg class="chart static" viewBox="0 0 360 180" role="img" aria-label="' + esc(aria) + '">';
    svg += '<line class="base" x1="6" y1="' + zero + '" x2="354" y2="' + zero + '"/>';
    items.forEach(function (it, i) {
      var x = Math.round(6 + i * slot + (slot - bw) / 2);
      var hgt = it.value === 0 ? 0 : Math.max(3, Math.round(Math.abs(it.value) * scale));
      if (it.value > 0) svg += '<rect class="bar on" x="' + x + '" y="' + (zero - hgt) + '" width="' + bw + '" height="' + hgt + '" rx="4"/>';
      else if (it.value < 0) svg += '<rect class="bar low" x="' + x + '" y="' + zero + '" width="' + bw + '" height="' + hgt + '" rx="4"/>';
      svg += '<text x="' + (x + bw / 2) + '" y="172" text-anchor="middle">' + esc(it.label) + '</text>';
    });
    return svg + '</svg>';
  }

  function deltaHtml(now, before) {
    var p = C.pctChange(now, before);
    if (p === null) return '';
    if (p === 0) return '<span class="delta">bez zmian</span>';
    return '<span class="delta ' + (p > 0 ? 'up' : 'down') + '">' + (p > 0 ? '+' : '−') + Math.abs(p) + '%</span>';
  }

  function dayRow(e) {
    return '<button class="row" data-action="open-editor" data-key="' + e.key + '"><div class="mid"><b>' + esc(dayLabel(e.key)) + '</b>' +
      (e.n ? '<span class="note">' + esc(e.n) + '</span>' : '') + '</div><div class="amt num">' + C.formatMoney(e.a) + '</div></button>';
  }

  function analysisView() {
    var today = state.today;
    var cost = state.settings.openCost || 0;
    var an = C.analyze(state.data, { today: today, from: analysisFrom(), openCost: cost });
    var h = '<div class="page-head"><div><h1>Analiza</h1><p>Wnioski z Twoich wpisów.</p></div></div><div class="stack">';

    h += '<div class="seg full" role="group" aria-label="Okres analizy">' + PERIODS.map(function (p) {
      return '<button data-action="analysis-period" data-period="' + p.id + '" aria-pressed="' + (state.analysisPeriod === p.id) + '">' + p.label + '</button>';
    }).join('') + '</div>';

    if (!an.openDays) {
      h += '<div class="card"><div class="empty"><b>Brak danych w tym okresie</b>Wpisz utarg za kilka dni albo wybierz dłuższy okres. Wnioski pojawią się po co najmniej 7 dniach z utargiem.</div></div></div>';
      return h;
    }

    h += '<div class="grid2">' +
      '<div class="metric"><div class="k">Średnio dziennie</div><div class="v num">' + C.formatMoney(an.avg) + '</div><div class="s">' + an.openDays + ' ' + daysWord(an.openDays) + ' z utargiem</div></div>' +
      '<div class="metric gold"><div class="k">Suma w okresie</div><div class="v num">' + C.formatMoney(an.total) + '</div><div class="s">' + an.closedDays + ' ' + C.plural(an.closedDays, 'dzień zamknięty', 'dni zamknięte', 'dni zamkniętych') + '</div></div></div>';

    // Wnioski
    var ins = C.insights(an);
    h += '<div class="card"><h2>Wnioski</h2>';
    if (an.openDays < 7) {
      h += '<p class="help">Wnioski pojawią się po wpisaniu co najmniej 7 dni z utargiem (masz ' + an.openDays + '). Do tego czasu liczby poniżej są tylko poglądowe.</p>';
    } else if (!ins.length) {
      h += '<p class="help">Na razie nie widać wyraźnych zależności. Dodawaj krótkie notatki do dni (np. „deszcz”), a pokażę ich wpływ na utarg.</p>';
    } else {
      h += '<ul class="insights">' + ins.map(function (t) { return '<li>' + icon('info') + '<span>' + esc(t) + '</span></li>'; }).join('') + '</ul>';
    }
    h += '</div>';

    // Dni tygodnia
    var order = [1, 2, 3, 4, 5, 6, 0];
    var maxAvg = 0;
    an.weekdays.forEach(function (x) { if (x.avg > maxAvg) maxAvg = x.avg; });
    var items = order.map(function (d) {
      var x = an.weekdays[d];
      var cls = 'bar on';
      if (x.n && cost && x.avg < cost) cls = 'bar low';
      else if (x.n && x.avg === maxAvg) cls = 'bar best';
      return { label: cap(C.WEEKDAYS_SHORT[d]), value: x.avg, cls: cls };
    });
    h += '<div class="card"><h2>Średni utarg według dnia tygodnia</h2><div class="chart-box">' +
      barsSvg(items, { cost: cost, values: true, aria: 'Średni utarg w kolejne dni tygodnia' }) + '</div>';
    h += '<p class="help">Liczone z dni z utargiem. ' + (cost ? 'Przerywana linia to koszt otwarcia, czerwone słupki są poniżej niego.' : '') + '</p>';
    var closedByDay = order.filter(function (d) { return an.weekdays[d].closed > 0; }).map(function (d) {
      return cap(C.WEEKDAYS_SHORT[d]) + ': ' + an.weekdays[d].closed;
    });
    if (closedByDay.length) h += '<p class="help">Dni zamknięte według dnia tygodnia – ' + esc(closedByDay.join(', ')) + '.</p>';
    h += '</div>';

    // Najlepsze i najsłabsze
    if (an.best.length) {
      h += '<div><h2 class="section-title">Najlepsze dni</h2><div class="list">' + an.best.map(dayRow).join('') + '</div></div>';
    }
    if (an.worst.length) {
      h += '<div><h2 class="section-title">Najsłabsze dni</h2><div class="list">' + an.worst.map(dayRow).join('') + '</div></div>';
    }

    // Porównanie
    var cmp = C.compareMonths(state.data, today);
    h += '<div class="card"><h2>Ten miesiąc na tle poprzednich</h2><p class="help">Porównanie do tego samego dnia miesiąca (1–' + cmp.day + '), żeby było uczciwe.</p>';
    h += '<div class="cmp-row"><span>' + cap(C.MONTHS[cmp.cur.m]) + ' ' + cmp.cur.y + '</span><b class="num">' + C.formatMoney(cmp.cur.total) + '</b></div>';
    h += '<div class="cmp-row"><span>' + cap(C.MONTHS[cmp.prev.m]) + ' ' + cmp.prev.y + '</span><span><b class="num">' + C.formatMoney(cmp.prev.total) + '</b> ' + deltaHtml(cmp.cur.total, cmp.prev.total) + '</span></div>';
    h += '<div class="cmp-row"><span>' + cap(C.MONTHS[cmp.lastYear.m]) + ' ' + cmp.lastYear.y + '</span><span><b class="num">' + C.formatMoney(cmp.lastYear.total) + '</b> ' + deltaHtml(cmp.cur.total, cmp.lastYear.total) + '</span></div>';
    h += '<p class="help">Zmiana dotyczy bieżącego miesiąca względem wiersza.</p></div>';

    // Trend
    var tr = C.trendMonths(state.data, today, 12);
    var trMax = 0;
    tr.forEach(function (x) { if (x.total > trMax) trMax = x.total; });
    h += '<div class="card"><h2>Ostatnie 12 miesięcy</h2><div class="chart-box">' + barsSvg(tr.map(function (x, i) {
      return { label: C.MONTHS_SHORT[x.m], value: x.total, cls: x.total === trMax && trMax > 0 ? 'bar best' : (i === tr.length - 1 ? 'bar now' : 'bar on') };
    }), { aria: 'Utarg w ostatnich 12 miesiącach' }) + '</div></div>';

    // Okoliczności
    h += '<div class="card"><h2>Okoliczności z notatek</h2>';
    if (!an.tags.length) {
      h += '<p class="help">Dodawaj do dni krótkie notatki (np. „deszcz”, „upał”, „promocja”, „święto”). Tutaj zobaczysz, jak wpływają na utarg i czy w takie dni opłaca się otwierać.</p>';
    } else {
      h += '<table class="mini-table"><thead><tr><th scope="col">Okoliczność</th><th scope="col">Dni</th><th scope="col">Średnio</th><th scope="col">Względem reszty</th></tr></thead><tbody>';
      an.tags.forEach(function (t) {
        var d = t.diffPct === null ? '—' : (t.diffPct > 0 ? '+' : (t.diffPct < 0 ? '−' : '')) + Math.abs(t.diffPct) + '%';
        var cls = t.diffPct === null || t.diffPct === 0 ? '' : (t.diffPct > 0 ? 'delta up' : 'delta down');
        var low = cost && t.n && t.avg < cost ? ' low' : '';
        h += '<tr><th scope="row">' + esc(t.label) + (t.closed ? '<span class="sub-note">zamknięte: ' + t.closed + '</span>' : '') + '</th><td class="num">' + t.n + '</td><td class="num' + low + '">' + (t.n ? C.formatMoney(t.avg) : '—') + '</td><td class="num ' + cls + '">' + d + '</td></tr>';
      });
      h += '</tbody></table><p class="help">Porównanie średniego utargu w dni z daną notatką do pozostałych dni z utargiem. Przy małej liczbie dni to tylko wskazówka.</p>';
    }
    h += '</div>';

    // Wydatki i wynik
    h += '<div class="card"><h2>Wydatki i wynik</h2>';
    var anyExp = an.expTotal > 0 || tr.some(function (x) { return x.expenses > 0; });
    if (!anyExp) {
      h += '<p class="help">Wpisuj wydatki (towar, prąd, czynsz…) przyciskiem „Dodaj wydatek” w widoku Dziś lub Miesiąc. Tutaj zobaczysz zysk lub stratę oraz na co idą pieniądze.</p>';
    } else {
      h += '<div class="grid2 tight"><div class="metric"><div class="k">Wydatki w okresie</div><div class="v num">' + minus(an.expTotal) + '</div><div class="s">' + an.expCount + ' ' + C.plural(an.expCount, 'wydatek', 'wydatki', 'wydatków') + '</div></div>' +
        '<div class="metric ' + (an.result >= 0 ? 'ok' : 'bad') + '"><div class="k">' + (an.result >= 0 ? 'Zysk' : 'Strata') + ' w okresie</div><div class="v num">' + C.formatMoney(Math.abs(an.result)) + '</div><div class="s">utarg minus wydatki</div></div></div>';
      if (an.expCats.length) {
        h += '<table class="mini-table"><thead><tr><th scope="col">Rodzaj wydatku</th><th scope="col">Suma</th><th scope="col">Udział</th></tr></thead><tbody>';
        an.expCats.forEach(function (c) {
          h += '<tr><th scope="row">' + esc(c.label) + '<span class="sub-note">' + c.n + ' ' + C.plural(c.n, 'wydatek', 'wydatki', 'wydatków') + '</span></th><td class="num">' + C.formatMoney(c.total) + '</td><td class="num">' + Math.round(c.total / an.expTotal * 100) + '%</td></tr>';
        });
        h += '</tbody></table>';
      }
      if (an.breakEven > 0 && an.openDays >= 7) {
        h += '<p class="help">Aby przy wydatkach z tego okresu wyjść na zero, potrzeba średnio ok. <b>' + C.formatMoney(an.breakEven) + '</b> utargu na dzień z utargiem (teraz: ' + C.formatMoney(an.avg) + '). Im dłuższy okres, tym dokładniejszy wynik, bo rachunki płacone raz na kilka miesięcy rozkładają się w czasie.</p>';
      }
      h += '<h3 class="sub-title">Wynik miesięczny (ostatnie 12 miesięcy)</h3><div class="chart-box">' +
        resultSvg(tr.map(function (x) { return { label: C.MONTHS_SHORT[x.m], value: x.profit }; }), 'Zysk lub strata w ostatnich 12 miesiącach') + '</div>';
    }
    h += '<p class="help">Wydatki są liczone osobno i nie wpływają na ocenę dni tygodnia, okoliczności ani kosztu otwarcia. Dzień z zatowarowaniem lub rachunkiem za prąd nie jest uznawany za nieopłacalny.</p></div>';

    // Koszt otwarcia
    if (!cost) {
      h += '<div class="banner info">' + icon('info') + '<div class="grow"><strong>Czy otwarcie się opłaca?</strong>Podaj dzienny koszt otwarcia sklepu (tylko koszty codzienne, np. pensja), a pokażę dni i okoliczności, w których utarg jest niższy. Towar i rachunki wpisuj jako wydatki – nie wpływają na tę ocenę.' +
        '<div class="btn-row"><button class="btn small" data-action="goto-cost">Ustaw koszt otwarcia</button></div></div></div>';
    } else {
      h += '<p class="help center">Dzienny koszt otwarcia: <b>' + C.formatMoney(cost) + '</b>. <button class="linkish" data-action="goto-cost">Zmień</button></p>';
    }
    return h + '</div>';
  }

  /* ---------- Raporty do druku ---------- */

  function todayPl() {
    var p = C.parseKey(state.today);
    return p.d + '.' + ('0' + (p.m + 1)).slice(-2) + '.' + p.y;
  }

  function reportHead(title, sub) {
    return '<header class="rp-head"><div class="rp-brand">Utarg</div><div><h1>' + esc(title) + '</h1><p>' + esc(sub) + '</p></div></header>';
  }

  function monthReport(y, m) {
    var o = statOpts();
    var ms = C.monthStats(state.data, y, m, o);
    var today = state.today;
    var h = '<div class="report">' + reportHead('Raport miesięczny – ' + cap(C.MONTHS[m]) + ' ' + y, 'Wygenerowano ' + todayPl());
    h += '<div class="rp-sum"><div><span>Suma miesiąca</span><b>' + C.formatMoney(ms.total) + '</b></div>' +
      '<div><span>Dni z utargiem</span><b>' + ms.open + '</b></div>' +
      '<div><span>Dni zamknięte</span><b>' + ms.closed + '</b></div>' +
      '<div><span>Średnio dziennie</span><b>' + C.formatMoney(ms.avg) + '</b></div>' +
      '<div><span>Najlepszy dzień</span><b>' + (ms.best ? ms.best.key.slice(8).replace(/^0/, '') + '. – ' + C.formatMoney(ms.best.a) : '—') + '</b></div>' +
      (ms.expenses ? '<div><span>Wydatki</span><b>' + minus(ms.expenses) + '</b></div><div><span>' + (ms.profit >= 0 ? 'Zysk' : 'Strata') + '</span><b>' + C.formatMoney(Math.abs(ms.profit)) + '</b></div>' : '') + '</div>';
    h += '<table class="rp-table"><thead><tr><th>Dzień</th><th></th><th class="r">Utarg</th><th>Notatka</th></tr></thead><tbody>';
    for (var d = 1; d <= ms.days; d++) {
      var key = C.dateKey(y, m, d);
      var rec = C.getDay(state.data, key);
      var wd = C.weekday(y, m, d);
      var amt = '', note = rec && rec.n ? esc(rec.n) : '', cls = '';
      if (key > today) { amt = ''; }
      else if (rec) amt = rec.c ? 'zamknięte' : C.formatMoney(rec.a);
      else if (key >= o.since && C.isStandingClosed(key, state.settings.closedWeekdays)) { amt = 'dzień wolny'; cls = 'muted'; }
      else if (key >= o.since) { amt = 'brak wpisu'; cls = 'miss'; }
      else amt = '—';
      h += '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + d + '</td><td>' + C.WEEKDAYS_SHORT[wd] + '</td><td class="r">' + amt + '</td><td>' + note + '</td></tr>';
    }
    h += '</tbody><tfoot><tr><td colspan="2">Suma</td><td class="r">' + C.formatMoney(ms.total) + '</td><td></td></tr></tfoot></table>';
    var rexp = C.listExpenses(state.data, C.dateKey(y, m, 1), C.dateKey(y, m, ms.days));
    if (rexp.length) {
      h += '<h2 class="rp-sub">Wydatki</h2><table class="rp-table"><thead><tr><th>Data</th><th>Opis</th><th class="r">Kwota</th></tr></thead><tbody>';
      rexp.forEach(function (e) {
        h += '<tr><td>' + e.d.slice(8).replace(/^0/, '') + '.</td><td>' + esc(e.n || C.expCatLabel(C.expCategoryOf(e.n))) + '</td><td class="r">' + minus(e.a) + '</td></tr>';
      });
      h += '</tbody><tfoot><tr><td colspan="2">Razem wydatki</td><td class="r">' + minus(ms.expenses) + '</td></tr>' +
        '<tr><td colspan="2">' + (ms.profit >= 0 ? 'Zysk' : 'Strata') + ' miesiąca (utarg minus wydatki)</td><td class="r">' + C.formatMoney(ms.profit) + '</td></tr></tfoot></table>';
    }
    return h + '</div>';
  }

  function yearReport(y) {
    var o = statOpts();
    var ys = C.yearStats(state.data, y, o);
    var h = '<div class="report">' + reportHead('Raport roczny – ' + y, 'Wygenerowano ' + todayPl());
    var best = ys.bestMonth >= 0 ? ys.months[ys.bestMonth] : null;
    h += '<div class="rp-sum"><div><span>Suma roczna</span><b>' + C.formatMoney(ys.total) + '</b></div>' +
      '<div><span>Dni z utargiem</span><b>' + ys.open + '</b></div>' +
      '<div><span>Dni zamknięte</span><b>' + ys.closed + '</b></div>' +
      '<div><span>Średnio dziennie</span><b>' + C.formatMoney(ys.avg) + '</b></div>' +
      '<div><span>Najlepszy miesiąc</span><b>' + (best ? cap(C.MONTHS[best.m]) + ' – ' + C.formatMoney(best.total) : '—') + '</b></div>' +
      (ys.expenses ? '<div><span>Wydatki</span><b>' + minus(ys.expenses) + '</b></div><div><span>' + (ys.profit >= 0 ? 'Zysk' : 'Strata') + '</span><b>' + C.formatMoney(Math.abs(ys.profit)) + '</b></div>' : '') + '</div>';
    h += '<table class="rp-table"><thead><tr><th>Miesiąc</th><th class="r">Dni z utargiem</th><th class="r">Zamknięte</th><th class="r">Brak wpisu</th><th class="r">Średnio dziennie</th><th class="r">Utarg</th><th class="r">Wydatki</th><th class="r">Wynik</th></tr></thead><tbody>';
    ys.months.forEach(function (s) {
      h += '<tr><td>' + cap(C.MONTHS[s.m]) + '</td><td class="r">' + s.open + '</td><td class="r">' + s.closed + '</td><td class="r">' + (s.missing.length || '') + '</td><td class="r">' + (s.open ? C.formatMoney(s.avg) : '') + '</td><td class="r">' + C.formatMoney(s.total) + '</td><td class="r">' + (s.expenses ? minus(s.expenses) : '') + '</td><td class="r">' + C.formatMoney(s.profit) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td>Razem</td><td class="r">' + ys.open + '</td><td class="r">' + ys.closed + '</td><td class="r">' + (ys.missing || '') + '</td><td class="r">' + (ys.open ? C.formatMoney(ys.avg) : '') + '</td><td class="r">' + C.formatMoney(ys.total) + '</td><td class="r">' + (ys.expenses ? minus(ys.expenses) : '') + '</td><td class="r">' + C.formatMoney(ys.profit) + '</td></tr></tfoot></table></div>';
    return h;
  }

  function isIosStandalone() {
    return window.navigator.standalone === true;
  }

  /** Drukuje raport (z niego można zapisać PDF). Na iPhonie w trybie aplikacji druk nie działa, więc pobierany jest plik. */
  function printReport(html, title) {
    if (isIosStandalone()) {
      fetch('css/report.css').then(function (r) { return r.text(); }).then(function (css) {
        var doc = '<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
          '<title>' + esc(title) + '</title><style>' + css + '</style></head><body class="doc">' + html +
          '<p class="noprint">Aby zapisać PDF lub wydrukować: dotknij Udostępnij w Safari i wybierz Drukuj.</p></body></html>';
        download(title.replace(/[^\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ\-]+/g, '-') + '.html', doc, 'text/html');
      }, function () { showToast('Nie udało się przygotować raportu.', { kind: 'error' }); });
      return;
    }
    var root = $('print-root');
    if (!root) return;
    root.innerHTML = html;
    document.body.classList.add('printing');
    var prevTitle = document.title;
    document.title = title;
    var done = function () {
      document.body.classList.remove('printing');
      document.title = prevTitle;
      root.innerHTML = '';
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    try { window.print(); } catch (e) { done(); showToast('Drukowanie nie jest dostępne w tej przeglądarce.', { kind: 'error' }); }
  }

  function printButton(action) {
    return '<div class="btn-row center"><button class="btn small" data-action="' + action + '">' + icon('print') + 'Drukuj / zapisz jako PDF</button></div>';
  }

  var VIEWS = { today: todayView, month: monthView, year: yearView, analysis: analysisView, settings: settingsView };

  /* ---------- Rysowanie ---------- */

  function renderView() {
    var v = $('view');
    if (!v) return;
    v.className = 'view' + (state.view === 'year' && state.yearMode === 'table' ? ' wide' : '');
    v.innerHTML = VIEWS[state.view]();
    state.typing = false;
    state.deferred = false;
    renderNav();
    renderPill();
  }

  /**
   * Odświeża widok. Gdy użytkownik właśnie pisze kwotę, odświeżenie jest odroczone,
   * żeby nie skasować wpisywanego tekstu (force = true wymusza odświeżenie po zapisie).
   */
  function refresh(force) {
    if (!force && state.typing) {
      state.deferred = true;
      renderPill();
      return;
    }
    renderView();
  }

  /** Na komputerze (mysz) od razu ustawia kursor w polu kwoty. */
  function focusAmount() {
    var inp = $('amount-input');
    var fine = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
    if (inp && fine && !state.editor && !$('confirm-root').firstChild) inp.focus();
  }

  function go(view) {
    state.view = view;
    renderView();
    window.scrollTo(0, 0);
    if (view === 'today') focusAmount();
  }

  /* ---------- Okno edycji dnia ---------- */

  var ignorePop = 0;
  var lastFocus = null;

  function openEditor(key) {
    if (!C.parseKey(key) || key > C.todayKey()) return;
    var rec = C.getDay(state.data, key);
    lastFocus = document.activeElement;
    state.editor = { kind: 'day', key: key, closed: !!(rec && rec.c) };
    try { history.pushState({ utargModal: true }, ''); } catch (e) { /* ignoruj */ }
    renderModal();
    var inp = $('ed-amount');
    if (inp && !inp.disabled) { inp.focus(); inp.select(); }
  }

  function closeEditor() {
    if (!state.editor) return;
    state.editor = null;
    if (history.state && history.state.utargModal) {
      ignorePop++;
      history.back();
    }
    renderModal();
    if (lastFocus && document.body.contains(lastFocus)) { try { lastFocus.focus(); } catch (e) { /* ignoruj */ } }
  }

  function noteChips(note) {
    var active = C.tagsOf(note);
    return C.TAGS.map(function (t) {
      return '<button type="button" class="chip tiny" data-action="note-tag" data-tag="' + t.id + '" aria-pressed="' + (active.indexOf(t.id) >= 0) + '">' + t.label + '</button>';
    }).join('');
  }

  function noteField(note) {
    return '<div class="note-field"><label for="ed-note">Notatka (opcjonalnie)</label>' +
      '<input id="ed-note" class="input" type="text" maxlength="' + C.NOTE_MAX + '" autocomplete="off" placeholder="np. deszcz, promocja" value="' + esc(note) + '">' +
      '<div class="chips" id="ed-tags">' + noteChips(note) + '</div></div>';
  }

  /** Dodaje albo usuwa z notatki wybraną okoliczność (np. „Deszcz”). */
  function toggleNoteTag(id) {
    var inp = $('ed-note');
    if (!inp) return;
    var tag = C.TAGS.filter(function (t) { return t.id === id; })[0];
    if (!tag) return;
    var parts = inp.value.split(/[,;]/).map(function (p) { return p.trim(); }).filter(Boolean);
    if (C.tagsOf(inp.value).indexOf(id) >= 0) {
      parts = parts.filter(function (p) { return C.tagsOf(p).indexOf(id) < 0; });
    } else {
      parts.push(tag.label.toLowerCase());
    }
    inp.value = C.normalizeNote(parts.join(', '));
    syncNoteChips();
  }

  function syncNoteChips() {
    var inp = $('ed-note'), box = $('ed-tags');
    if (inp && box) box.innerHTML = noteChips(inp.value);
  }

  function renderModal() {
    var root = $('modal-root');
    if (!state.editor) { root.innerHTML = ''; return; }
    var e = state.editor;
    if (e.kind === 'exp') { root.innerHTML = expModalHtml(e); return; }
    var rec = C.getDay(state.data, e.key);
    root.innerHTML =
      '<div class="backdrop" id="ed-backdrop"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="ed-title">' +
      '<div class="grab"></div><h2 id="ed-title">' + esc(cap(C.longDate(e.key))) + '</h2>' +
      '<p class="sub">' + (rec ? 'Popraw albo usuń wpis z tego dnia.' : 'Wpisz utarg z tego dnia.') + '</p>' +
      '<div class="amount-field"><input id="ed-amount" class="amount-input" type="text" inputmode="decimal" autocomplete="off" autocapitalize="off" spellcheck="false" ' +
      'enterkeyhint="done" placeholder="0,00" aria-label="Kwota utargu w złotych" value="' + (rec && !rec.c ? esc(C.toInputString(rec.a)) : '') + '"' + (e.closed ? ' disabled' : '') + '>' +
      '<span class="amount-cur" aria-hidden="true">zł</span></div>' +
      '<p class="hero-hint" id="ed-hint">' + (e.closed ? 'Ten dzień będzie liczył się jako 0,00 zł.' : '') + '</p>' +
      noteField(rec ? rec.n || '' : '') +
      '<div class="switch-row"><div><b>Sklep zamknięty</b><span>Dzień liczy się jako 0,00 zł i nie ma braku wpisu.</span></div>' +
      '<label class="switch"><input id="ed-closed" type="checkbox" role="switch" aria-label="Sklep zamknięty"' + (e.closed ? ' checked' : '') + '><i></i></label></div>' +
      '<div class="actions"><button class="btn primary block" data-action="editor-save">' + icon('check') + 'Zapisz</button>' +
      '<div class="row2"><button class="btn ghost" data-action="editor-cancel">Anuluj</button>' +
      (rec ? '<button class="btn danger" data-action="editor-delete">' + icon('trash') + 'Usuń wpis</button>' : '<span></span>') + '</div></div>' +
      '</div></div>';
  }

  function editorSave() {
    var e = state.editor;
    if (!e) return;
    if (e.kind === 'exp') { expenseSave(); return; }
    var closed = $('ed-closed').checked;
    submitDay(e.key, $('ed-amount').value, closed, { hintEl: $('ed-hint'), inputEl: $('ed-amount') }, $('ed-note') ? $('ed-note').value : undefined).then(function (ok) {
      if (ok) closeEditor();
    });
  }

  /* ---------- Okno potwierdzenia ---------- */

  var confirmResolve = null;

  function confirmDialog(o) {
    return new Promise(function (resolve) {
      if (confirmResolve) confirmResolve(false);
      confirmResolve = resolve;
      var root = $('confirm-root');
      root.innerHTML =
        '<div class="backdrop" id="cf-backdrop"><div class="sheet" role="alertdialog" aria-modal="true" aria-labelledby="cf-title" aria-describedby="cf-text">' +
        '<div class="grab"></div><h2 id="cf-title">' + esc(o.title) + '</h2><p class="sub" id="cf-text">' + esc(o.text) + '</p>' +
        '<div class="actions"><button class="btn ' + (o.danger ? 'danger' : 'primary') + ' block" data-action="confirm-yes">' + esc(o.ok) + '</button>' +
        '<button class="btn ghost block" data-action="confirm-no">' + esc(o.cancel || 'Anuluj') + '</button></div></div></div>';
      var first = root.querySelector('[data-action="confirm-no"]');
      if (first) first.focus();
    });
  }

  function closeConfirm(result) {
    $('confirm-root').innerHTML = '';
    var r = confirmResolve;
    confirmResolve = null;
    if (r) r(result);
  }

  /* ---------- Komunikaty ---------- */

  var toastSeq = 0;
  var toastActions = {};

  function showToast(msg, o) {
    o = o || {};
    var root = $('toasts');
    if (!root) return;
    // jeden komunikat naraz: przycisk „Cofnij” zawsze dotyczy ostatniej zmiany
    for (var i = root.children.length - 1; i >= 0; i--) {
      if (root.children[i].id !== 'update-toast') root.removeChild(root.children[i]);
    }
    var id = 't' + (++toastSeq);
    var el = document.createElement('div');
    el.className = 'toast' + (o.kind === 'error' ? ' error' : '');
    el.id = id;
    var html = '<span class="msg">' + esc(msg) + '</span>';
    if (o.undo) {
      toastActions[id] = o.undo;
      html += '<button data-action="toast-undo" data-id="' + id + '">Cofnij</button>';
    }
    el.innerHTML = html;
    root.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
      delete toastActions[id];
    }, o.undo ? 7000 : (o.kind === 'error' ? 9000 : 3800));
  }

  /* ---------- Pliki ---------- */

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime });
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (coarse && navigator.canShare && typeof File !== 'undefined') {
      try {
        var f = new File([blob], filename, { type: mime });
        if (navigator.canShare({ files: [f] })) {
          navigator.share({ files: [f], title: filename }).catch(function () { /* anulowano */ });
          return;
        }
      } catch (e) { /* użyj zwykłego pobrania */ }
    }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  /** Wczytuje historię z pliku CSV. Istniejące wpisy nie są nadpisywane. */
  function importCsv(text, name) {
    var ym = /(20\d{2}|19\d{2})/.exec(name);
    var r = C.parseCsvImport(text, { today: C.todayKey(), year: ym ? +ym[1] : null });
    if (r.error === 'year') {
      showToast('Nie udało się ustalić roku tabeli. Dopisz rok do nazwy pliku, np. utarg-2025.csv.', { kind: 'error' });
      return;
    }
    if (!r.entries.length) {
      showToast(r.skipped.length ? 'Nie znaleziono poprawnych wpisów. ' + r.skipped[0].reason : 'To nie wygląda na plik z historią utargu.', { kind: 'error' });
      return;
    }
    var out = C.addEntries(state.data, r.entries, Date.now());
    if (!out.added) { showToast('Wszystkie dni z pliku już mają wpis.'); return; }
    var info = 'Nowych dni do dodania: ' + out.added + '.';
    if (out.existing) info += ' Pominięto dni, które już mają wpis: ' + out.existing + '.';
    if (r.skipped.length) {
      info += ' Nie wczytano wierszy: ' + r.skipped.length + ' (' + r.skipped.slice(0, 2).map(function (x) { return (x.line ? 'wiersz ' + x.line + ': ' : '') + x.reason; }).join('; ') + (r.skipped.length > 2 ? '…' : '') + ').';
    }
    confirmDialog({ title: 'Wczytać historię z CSV?', text: info, ok: 'Wczytaj', cancel: 'Anuluj' }).then(function (yes) {
      if (!yes) return;
      var again = C.addEntries(state.data, r.entries, Date.now());
      commit(again.data);
      showToast('Wczytano ' + again.added + ' ' + C.plural(again.added, 'dzień', 'dni', 'dni'));
      refresh(true);
    });
  }

  function importFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () { showToast('Nie udało się odczytać pliku.', { kind: 'error' }); };
    reader.onload = function () {
      var raw = String(reader.result);
      if (/\.csv$/i.test(file.name || '') || !/^\s*\{/.test(raw.replace(/^\ufeff/, ''))) { importCsv(raw, file.name || ''); return; }
      var parsed = C.parseSerialized(raw);
      if (parsed.error || C.countEntries(parsed.data) + Object.keys(parsed.data.days).length + Object.keys(parsed.data.exp).length === 0) {
        showToast('To nie jest plik kopii Utarg.', { kind: 'error' });
        return;
      }
      var merged = C.merge(state.data, parsed.data);
      var changed = 0;
      Object.keys(merged.days).forEach(function (k) {
        var a = merged.days[k], b = state.data.days[k];
        if (!b || a.t !== b.t || a.a !== b.a || a.c !== b.c) changed++;
      });
      Object.keys(merged.exp).forEach(function (k) {
        var a = merged.exp[k], b = state.data.exp[k];
        if (!b || a.t !== b.t || a.a !== b.a || a.d !== b.d) changed++;
      });
      if (!changed) { showToast('Wszystkie dane z pliku już są w aplikacji.'); return; }
      confirmDialog({
        title: 'Wczytać dane z pliku?',
        text: 'Nowych lub nowszych wpisów: ' + changed + '. Istniejące wpisy nie zostaną usunięte.' +
          (parsed.dropped ? ' Pominięto uszkodzonych wpisów: ' + parsed.dropped + '.' : ''),
        ok: 'Wczytaj',
        cancel: 'Anuluj'
      }).then(function (yes) {
        if (!yes) return;
        commit(merged);
        showToast('Wczytano ' + changed + ' ' + C.plural(changed, 'wpis', 'wpisy', 'wpisów'));
        refresh(true);
      });
    };
    reader.readAsText(file);
  }

  /* ---------- Obsługa zdarzeń ---------- */

  function amountPreview(input) {
    var hint = input.id === 'ed-amount' ? $('ed-hint') : (input.id === 'ex-amount' ? $('ex-hint') : $('hint'));
    if (!hint) return;
    var txt = input.value;
    if (!txt.trim()) { setHint(hint, input.id === 'ed-amount' ? '' : 'Wpisz kwotę po zamknięciu sklepu.', false); return; }
    var r = C.parseAmount(txt);
    setHint(hint, r.ok ? '= ' + C.formatMoney(r.value) : '', false);
  }

  function finishConnect(promise, btn) {
    return promise.then(function () {
      state.connecting = false;
      showToast('Kopia połączona i wysłana');
      refresh(true);
    }, function (e) {
      state.connecting = false;
      if (btn) btn.disabled = false;
      var el = $('connect-error');
      if (el) setHint(el, e && e.message ? e.message : 'Nie udało się połączyć.', true);
      return e;
    });
  }

  function connect() {
    if (state.connecting) return;
    var repoText = $('repo-input').value;
    var token = $('token-input').value;
    var branch = $('branch-input') ? $('branch-input').value.trim() : '';
    var err = $('connect-error');
    var repo = Sync.parseRepo(repoText);
    if (!repo) { setHint(err, 'Wpisz repozytorium w formie login/nazwa, np. jan-kowalski/utarg-dane.', true); return; }
    if (!token.trim()) { setHint(err, 'Wklej token dostępu.', true); return; }
    if (branch && !/^[A-Za-z0-9._\/-]{1,100}$/.test(branch)) { setHint(err, 'Nazwa gałęzi może zawierać litery, cyfry oraz znaki . _ - /', true); return; }
    state.connecting = true;
    setHint(err, 'Łączę z GitHubem…', false);
    var btn = document.querySelector('[data-action="sync-connect"]');
    if (btn) btn.disabled = true;
    var opts = { branch: branch };
    Sync.connect(repo.owner, repo.repo, token, opts).then(function () {
      state.connecting = false;
      showToast('Kopia połączona i wysłana');
      refresh(true);
    }, function (e) {
      if (e && e.code === 'public') {
        state.connecting = false;
        if (btn) btn.disabled = false;
        setHint($('connect-error'), '', false);
        confirmDialog({
          title: 'To repozytorium jest publiczne',
          text: 'Każdy w internecie zobaczy kwoty utargu i całą historię zmian. Używaj tego tylko do testów albo dla danych, które nie są poufne. Połączyć mimo to?',
          ok: 'Tak, połącz', cancel: 'Anuluj', danger: true
        }).then(function (yes) {
          if (!yes) return;
          state.connecting = true;
          setHint($('connect-error'), 'Łączę z GitHubem…', false);
          var b2 = document.querySelector('[data-action="sync-connect"]');
          if (b2) b2.disabled = true;
          finishConnect(Sync.connect(repo.owner, repo.repo, token, { branch: branch, allowPublic: true }), b2);
        });
        return;
      }
      state.connecting = false;
      if (btn) btn.disabled = false;
      var el = $('connect-error');
      if (el) setHint(el, e && e.message ? e.message : 'Nie udało się połączyć.', true);
    });
  }

  function handleAction(el, ev) {
    var a = el.getAttribute('data-action');
    switch (a) {
      case 'nav': go(el.getAttribute('data-view')); break;
      case 'goto-backup':
        go('settings');
        var b = $('backup');
        if (b && b.scrollIntoView) b.scrollIntoView({ block: 'start' });
        break;
      case 'goto-month':
        state.month = { y: +el.getAttribute('data-y'), m: +el.getAttribute('data-m') };
        go('month');
        break;
      case 'goto-year':
        state.year = +el.getAttribute('data-y');
        go('year');
        break;
      case 'goto-current': {
        var c = C.parseKey(state.today);
        state.month = { y: c.y, m: c.m };
        refresh(true);
        break;
      }
      case 'month-prev':
      case 'month-next': {
        var delta = a === 'month-next' ? 1 : -1;
        var mm = state.month.m + delta, yy = state.month.y;
        if (mm < 0) { mm = 11; yy--; } else if (mm > 11) { mm = 0; yy++; }
        if (yy < C.MIN_YEAR || yy > C.MAX_YEAR) break;
        state.month = { y: yy, m: mm };
        refresh(true);
        break;
      }
      case 'year-prev':
      case 'year-next': {
        var ny = state.year + (a === 'year-next' ? 1 : -1);
        if (ny < C.MIN_YEAR || ny > C.MAX_YEAR) break;
        state.year = ny;
        refresh(true);
        break;
      }
      case 'year-mode': state.yearMode = el.getAttribute('data-mode'); refresh(true); break;
      case 'today-prev': {
        var pk = C.addDays(state.sel, -1);
        if (!C.parseKey(pk)) break;
        state.sel = pk; state.selFollowsToday = pk === state.today; refresh(true);
        break;
      }
      case 'today-next': {
        var nk = C.addDays(state.sel, 1);
        if (nk > state.today) nk = state.today;
        state.sel = nk; state.selFollowsToday = nk === state.today; refresh(true);
        break;
      }
      case 'today-save': {
        var inp = $('amount-input');
        if (!inp) break;
        submitDay(state.sel, inp.value, false, { hintEl: $('hint'), inputEl: inp }).then(function (ok) {
          if (ok && document.activeElement && document.activeElement.blur) document.activeElement.blur();
        });
        break;
      }
      case 'today-closed': submitDay(state.sel, '', true, null); break;
      case 'today-reopen': clearDay(state.sel); break;
      case 'open-editor': openEditor(el.getAttribute('data-key')); break;
      case 'editor-save': editorSave(); break;
      case 'editor-cancel': closeEditor(); break;
      case 'editor-delete': {
        var key = state.editor && state.editor.key;
        if (!key) break;
        closeEditor();
        clearDay(key);
        break;
      }
      case 'confirm-yes': closeConfirm(true); break;
      case 'confirm-no': closeConfirm(false); break;
      case 'toast-undo': {
        var id = el.getAttribute('data-id');
        var fn = toastActions[id];
        delete toastActions[id];
        var t = $(id);
        if (t && t.parentNode) t.parentNode.removeChild(t);
        if (fn) fn();
        break;
      }
      case 'theme':
        state.settings.theme = el.getAttribute('data-theme');
        Store.saveSettings(state.settings);
        applyTheme();
        refresh(true);
        break;
      case 'weekday': {
        var d = +el.getAttribute('data-d');
        var i = state.settings.closedWeekdays.indexOf(d);
        if (i >= 0) state.settings.closedWeekdays.splice(i, 1); else state.settings.closedWeekdays.push(d);
        Store.saveSettings(state.settings);
        refresh(true);
        break;
      }
      case 'analysis-period': state.analysisPeriod = el.getAttribute('data-period'); refresh(true); break;
      case 'goto-cost': {
        go('settings');
        var cc = $('cost-card');
        if (cc && cc.scrollIntoView) cc.scrollIntoView({ block: 'center' });
        var ci = $('cost-input');
        if (ci) ci.focus();
        break;
      }
      case 'note-tag': toggleNoteTag(el.getAttribute('data-tag')); break;
      case 'print-month': printReport(monthReport(state.month.y, state.month.m), 'Utarg-' + state.month.y + '-' + ('0' + (state.month.m + 1)).slice(-2)); break;
      case 'print-year': printReport(yearReport(state.year), 'Utarg-' + state.year); break;
      case 'exp-add': openExpense(null, el.getAttribute('data-key') || state.today); break;
      case 'exp-edit': openExpense(el.getAttribute('data-id'), null); break;
      case 'exp-save': expenseSave(); break;
      case 'exp-delete': deleteExpense(); break;
      case 'exp-tag': toggleExpTag(el.getAttribute('data-tag')); break;
      case 'export-exp-csv': {
        var ey = +el.getAttribute('data-y');
        download('utarg-wydatki-' + ey + '.csv', '\ufeff' + C.csvExpenses(state.data, ey), 'text/csv;charset=utf-8');
        break;
      }
      case 'sync-connect': connect(); break;
      case 'sync-now': Store.setDirty(true); Sync.run(); break;
      case 'sync-disconnect':
        confirmDialog({
          title: 'Odłączyć kopię na GitHubie?',
          text: 'Dane zostaną na tym urządzeniu i w repozytorium, ale aplikacja przestanie wysyłać nowe wpisy. Token zostanie usunięty z tego urządzenia.',
          ok: 'Odłącz', cancel: 'Anuluj', danger: true
        }).then(function (yes) { if (yes) { Sync.disconnect(); refresh(true); } });
        break;
      case 'export-json':
        download('utarg-kopia-' + C.todayKey() + '.json', C.serialize(state.data), 'application/json');
        break;
      case 'export-csv': {
        var yr = +el.getAttribute('data-y');
        download('utarg-' + yr + '.csv', '﻿' + C.csvYear(state.data, yr), 'text/csv;charset=utf-8');
        break;
      }
      case 'import-pick': { var f = $('import-file'); if (f) f.click(); break; }
      case 'install':
        if (state.installPrompt) {
          state.installPrompt.prompt();
          state.installPrompt = null;
        }
        break;
      case 'reload': window.location.reload(); break;
      default: break;
    }
  }

  function saveCost(text) {
    var hint = $('cost-hint');
    if (!text.trim()) {
      state.settings.openCost = 0;
      Store.saveSettings(state.settings);
      setHint(hint, '', false);
      showToast('Koszt otwarcia wyłączony');
      return;
    }
    var r = C.parseAmount(text);
    if (!r.ok) { setHint(hint, r.error, true); return; }
    state.settings.openCost = r.value;
    Store.saveSettings(state.settings);
    setHint(hint, '', false);
    showToast('Zapisano koszt otwarcia: ' + C.formatMoney(r.value));
  }

  function trapFocus(ev, root) {
    var f = root.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }

  function bindEvents() {
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t.id === 'ed-backdrop') { closeEditor(); return; }
      if (t.id === 'cf-backdrop') { closeConfirm(false); return; }
      var el = t.closest ? t.closest('[data-action]') : null;
      if (el && !el.disabled) handleAction(el, ev);
    });

    document.addEventListener('input', function (ev) {
      var t = ev.target;
      if (t.id === 'ed-note') { syncNoteChips(); return; }
      if (t.id === 'ex-note') { syncExpChips(); return; }
      if (t.id === 'amount-input' || t.id === 'ed-amount' || t.id === 'ex-amount') {
        if (t.id === 'amount-input') state.typing = true;
        amountPreview(t);
      }
    });

    document.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.id === 'ed-closed' && state.editor) {
        state.editor.closed = t.checked;
        var inp = $('ed-amount');
        inp.disabled = t.checked;
        setHint($('ed-hint'), t.checked ? 'Ten dzień będzie liczył się jako 0,00 zł.' : '', false);
        if (!t.checked) inp.focus();
      } else if (t.id === 'cost-input') {
        saveCost(t.value);
      } else if (t.id === 'import-file') {
        importFile(t.files && t.files[0]);
        t.value = '';
      }
    });

    document.addEventListener('keydown', function (ev) {
      var t = ev.target;
      if (ev.key === 'Escape') {
        if ($('confirm-root').firstChild) { closeConfirm(false); ev.preventDefault(); return; }
        if (state.editor) { closeEditor(); ev.preventDefault(); return; }
      }
      if (ev.key === 'Tab') {
        var cf = $('confirm-root').querySelector('.sheet');
        var md = $('modal-root').querySelector('.sheet');
        if (cf) trapFocus(ev, cf); else if (md) trapFocus(ev, md);
        return;
      }
      if (ev.key === 'Enter' && !ev.isComposing) {
        if (t.id === 'amount-input') { ev.preventDefault(); handleAction(document.querySelector('[data-action="today-save"]'), ev); }
        else if (t.id === 'ed-amount' || t.id === 'ed-note' || t.id === 'ex-amount' || t.id === 'ex-note') { ev.preventDefault(); editorSave(); }
        else if (t.id === 'repo-input' || t.id === 'token-input') { ev.preventDefault(); connect(); }
      }
    });

    // po zakończeniu pisania wykonaj odroczone odświeżenie (np. zmiany z drugiego urządzenia)
    document.addEventListener('focusout', function (ev) {
      if (ev.target && ev.target.id === 'amount-input') {
        state.typing = false;
        if (state.deferred) setTimeout(function () { if (!state.typing && state.deferred) refresh(false); }, 250);
      }
    });

    window.addEventListener('popstate', function () {
      if (ignorePop > 0) { ignorePop--; return; }
      if (state.editor) { state.editor = null; renderModal(); }
    });

    window.addEventListener('storage', function (ev) {
      if (ev.key === 'utarg.data.v1' && ev.newValue) {
        var other = C.parseSerialized(ev.newValue).data;
        state.data = C.merge(state.data, other);
        refresh(false);
      }
    });

    window.addEventListener('beforeinstallprompt', function (ev) {
      ev.preventDefault();
      state.installPrompt = ev;
      if (state.view === 'settings') refresh(false);
    });

    var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (mq && mq.addEventListener) mq.addEventListener('change', applyTheme);
  }

  /* ---------- Zmiana dnia i usługa offline ---------- */

  function checkDayChange() {
    var nt = C.todayKey();
    if (nt === state.today) return;
    state.today = nt;
    if (state.selFollowsToday) state.sel = nt;
    refresh(false);
  }

  function registerWorker() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; }
      var root = $('toasts');
      if (!root || $('update-toast')) return;
      var el = document.createElement('div');
      el.className = 'toast';
      el.id = 'update-toast';
      el.innerHTML = '<span class="msg">Dostępna nowa wersja aplikacji</span><button data-action="reload">Odśwież</button>';
      root.appendChild(el);
    });
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') reg.update().catch(function () { /* offline */ });
      });
    }).catch(function () { /* aplikacja działa także bez trybu offline */ });
  }

  /* ---------- Start ---------- */

  function finishStart() {
    renderView();
    focusAmount();
    applyTheme();
    if (Sync.getConfig()) Sync.run();
    Store.requestPersistence();
  }

  function start() {
    buildShell();
    bindEvents();
    applyTheme();
    Sync.init({
      getData: function () { return state.data; },
      getVersion: function () { return state.version; },
      applyRemote: function (d) {
        state.data = C.merge(state.data, d);
        state.storageOk = Store.save(state.data) && state.storageOk;
        refresh(false);
      },
      onStatus: function (s) {
        state.sync = s;
        renderPill();
        if (state.view === 'settings' || state.view === 'today') refresh(false);
      }
    });

    // Natychmiast pokaż dane z localStorage, a po chwili dołącz kopię z IndexedDB.
    state.data = Store.loadSync();
    var started = false;
    function begin(data) {
      if (data) state.data = C.merge(state.data, data);
      if (started) { refresh(false); return; }
      started = true;
      finishStart();
    }
    var timeout = setTimeout(function () { begin(null); }, 1500);
    Store.load().then(function (d) { clearTimeout(timeout); begin(d); }, function () { clearTimeout(timeout); begin(null); });

    setInterval(checkDayChange, 30000);
    // co minutę (gdy aplikacja jest widoczna) sprawdź, czy ktoś inny nie dopisał danych
    setInterval(function () {
      if (document.visibilityState === 'visible') Sync.poll();
    }, 60000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') checkDayChange();
    });
    registerWorker();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  // udostępnione do testów
  window.__utarg = { state: state, submitDay: submitDay };
})();
