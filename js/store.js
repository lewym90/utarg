/*
 * Utarg – lokalny zapis danych na urządzeniu.
 * Dane są zapisywane podwójnie: w localStorage (szybko, synchronicznie) i w IndexedDB (kopia lustrzana).
 * Przy starcie oba zapisy są scalane, więc awaria jednego z nich nie powoduje utraty danych.
 * Dodatkowo przechowywana jest poprzednia wersja danych (utarg.data.prev) jako zabezpieczenie.
 */
(function (root) {
  'use strict';
  var C = root.UtargCore;

  var KEY = 'utarg.data.v1';
  var KEY_PREV = 'utarg.data.prev';
  var KEY_SETTINGS = 'utarg.settings.v1';
  var KEY_DIRTY = 'utarg.dirty';
  var DB_NAME = 'utarg';
  var DB_STORE = 'kv';

  var DEFAULT_SETTINGS = { theme: 'auto', closedWeekdays: [], openCost: 0 };

  function lsGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); return true; } catch (e) { return false; }
  }

  /* ---------- IndexedDB ---------- */

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error('Brak IndexedDB')); return; }
      var req;
      try { req = root.indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () { req.result.createObjectStore(DB_STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('IndexedDB zablokowana')); };
    });
  }

  function idbGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var r = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
        r.onsuccess = function () { resolve(r.result); db.close(); };
        r.onerror = function () { reject(r.error); db.close(); };
      });
    });
  }

  // zapisy do IndexedDB idą jeden po drugim, więc starszy zapis nigdy nie nadpisze nowszego
  var idbQueue = Promise.resolve();
  function idbSet(key, value) {
    var job = idbQueue.then(function () { return idbSetNow(key, value); });
    idbQueue = job.then(null, function () { /* błąd jednego zapisu nie blokuje kolejnych */ });
    return job;
  }

  function idbSetNow(key, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(value, key);
        tx.oncomplete = function () { resolve(); db.close(); };
        tx.onerror = function () { reject(tx.error); db.close(); };
        tx.onabort = function () { reject(tx.error); db.close(); };
      });
    });
  }

  /* ---------- Dane ---------- */

  function readLocalStorageData() {
    var raw = lsGet(KEY);
    if (!raw) return C.emptyData();
    return C.parseSerialized(raw).data;
  }

  /**
   * Wczytuje dane przy starcie: scala localStorage i IndexedDB.
   * Zwraca Promise<data>; nigdy nie jest odrzucany.
   */
  function load() {
    var fromLs = readLocalStorageData();
    return idbGet(KEY).then(function (raw) {
      var fromIdb = raw ? C.parseSerialized(raw).data : C.emptyData();
      return C.merge(fromLs, fromIdb);
    }, function () {
      return fromLs;
    });
  }

  /**
   * Zapisuje dane. Zwraca true, jeśli zapis do localStorage się udał.
   * Zapis do IndexedDB odbywa się równolegle (błąd tutaj nie jest krytyczny, bo działa localStorage).
   */
  function save(data) {
    var text = C.serialize(data);
    var prev = lsGet(KEY);
    if (prev && prev !== text) lsSet(KEY_PREV, prev);
    var ok = lsSet(KEY, text);
    idbSet(KEY, text).then(null, function () { /* kopia lustrzana opcjonalna */ });
    return ok;
  }

  /** Poprzednia wersja danych (sprzed ostatniego zapisu) – zabezpieczenie awaryjne. */
  function loadPrevious() {
    var raw = lsGet(KEY_PREV);
    return raw ? C.parseSerialized(raw).data : null;
  }

  /* ---------- Ustawienia ---------- */

  function loadSettings() {
    var s = { theme: DEFAULT_SETTINGS.theme, closedWeekdays: [], openCost: 0, cfgT: 0 };
    var raw = lsGet(KEY_SETTINGS);
    if (!raw) return s;
    try {
      var o = JSON.parse(raw);
      if (o && (o.theme === 'auto' || o.theme === 'light' || o.theme === 'dark')) s.theme = o.theme;
      if (o && Array.isArray(o.closedWeekdays)) {
        s.closedWeekdays = o.closedWeekdays.filter(function (d, i, a) {
          return Number.isInteger(d) && d >= 0 && d <= 6 && a.indexOf(d) === i;
        });
      }
      if (o && Number.isSafeInteger(o.cfgT) && o.cfgT > 0) s.cfgT = o.cfgT;
      if (o && Number.isSafeInteger(o.openCost) && o.openCost > 0 && o.openCost <= C.MAX_GROSZE) s.openCost = o.openCost;
    } catch (e) { /* użyj domyślnych */ }
    return s;
  }

  function saveSettings(s) {
    return lsSet(KEY_SETTINGS, JSON.stringify({ theme: s.theme, closedWeekdays: s.closedWeekdays, openCost: s.openCost || 0, cfgT: s.cfgT || 0 }));
  }

  /* ---------- Flaga „są zmiany niewysłane na GitHub” ---------- */

  function isDirty() { return lsGet(KEY_DIRTY) === '1'; }
  function setDirty(v) { lsSet(KEY_DIRTY, v ? '1' : '0'); }

  /** Prosi przeglądarkę, żeby nie czyściła danych aplikacji przy braku miejsca. */
  function requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        return navigator.storage.persist().then(function (v) { return !!v; }, function () { return false; });
      }
    } catch (e) { /* ignoruj */ }
    return Promise.resolve(false);
  }

  root.UtargStore = {
    load: load, loadSync: readLocalStorageData, save: save, loadPrevious: loadPrevious,
    loadSettings: loadSettings, saveSettings: saveSettings,
    isDirty: isDirty, setDirty: setDirty, requestPersistence: requestPersistence,
    lsGet: lsGet, lsSet: lsSet
  };
})(typeof self !== 'undefined' ? self : this);
