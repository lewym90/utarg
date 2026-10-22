/*
 * Utarg – kopia zapasowa i synchronizacja przez GitHub (API „Contents”).
 *
 * Dane trafiają do pliku JSON w PRYWATNYM repozytorium użytkownika. Każda zmiana to osobny commit,
 * więc cała historia jest zachowana. Przy każdej synchronizacji dane z GitHuba i z urządzenia są
 * scalane (nowszy wpis wygrywa), więc kilka urządzeń nigdy się nawzajem nie nadpisuje.
 *
 * Token dostępu jest przechowywany wyłącznie na urządzeniu (localStorage) i wysyłany tylko do api.github.com.
 */
(function (root) {
  'use strict';
  var C = root.UtargCore;
  var Store = root.UtargStore;

  var KEY_CFG = 'utarg.sync.v1';
  var API = 'https://api.github.com';
  var DEFAULT_PATH = 'utarg-dane.json';
  var TIMEOUT_MS = 20000;
  var MAX_ATTEMPTS = 4;

  function SyncError(code, message) {
    var e = new Error(message);
    e.name = 'SyncError';
    e.code = code;
    return e;
  }

  /* ---------- Konfiguracja ---------- */

  function loadConfig() {
    var raw = Store.lsGet(KEY_CFG);
    if (!raw) return null;
    try {
      var c = JSON.parse(raw);
      if (c && typeof c.owner === 'string' && typeof c.repo === 'string' && typeof c.token === 'string' && c.token) {
        return {
          owner: c.owner, repo: c.repo, branch: c.branch || '', path: c.path || DEFAULT_PATH,
          token: c.token, lastSync: Number(c.lastSync) || 0, public: c.public === true
        };
      }
    } catch (e) { /* uszkodzona konfiguracja */ }
    return null;
  }

  function saveConfig(cfg) {
    return Store.lsSet(KEY_CFG, JSON.stringify(cfg));
  }

  function clearConfig() {
    try { localStorage.removeItem(KEY_CFG); } catch (e) { /* ignoruj */ }
  }

  /** Przyjmuje „login/repo” albo adres https://github.com/login/repo(.git) */
  function parseRepo(text) {
    var s = String(text || '').trim().replace(/\.git$/i, '').replace(/\/+$/, '');
    s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, '');
    var m = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/.exec(s);
    return m ? { owner: m[1], repo: m[2] } : null;
  }

  /* ---------- Base64 (UTF-8) ---------- */

  function toB64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function fromB64(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ---------- Warstwa HTTP ---------- */

  function request(cfg, method, path, body) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    var headers = {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + cfg.token,
      'X-GitHub-Api-Version': '2022-11-28'
    };
    var init = { method: method, headers: headers, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    if (ctrl) init.signal = ctrl.signal;
    return fetch(API + path, init).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.text().then(function (text) {
        var json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
        return { status: res.status, json: json, headers: res.headers };
      });
    }, function () {
      if (timer) clearTimeout(timer);
      throw SyncError('offline', 'Brak połączenia z GitHubem.');
    });
  }

  function failFromStatus(res) {
    var s = res.status;
    var msg = res.json && res.json.message ? String(res.json.message) : '';
    if (s === 401) return SyncError('auth', 'Token jest nieprawidłowy albo wygasł. Utwórz nowy token.');
    if (s === 403 || s === 429) {
      if (res.headers && res.headers.get('x-ratelimit-remaining') === '0') {
        return SyncError('rate', 'Limit zapytań GitHuba został chwilowo wyczerpany. Spróbuj za kilka minut.');
      }
      return SyncError('perm', 'Token nie ma uprawnień do zapisu. Potrzebne jest „Contents: Read and write” dla tego repozytorium.');
    }
    if (s === 404) return SyncError('notfound', 'Nie znaleziono repozytorium. Sprawdź nazwę i to, czy token ma do niego dostęp.');
    if (s >= 500) return SyncError('server', 'GitHub ma chwilowe problemy. Spróbuj ponownie za chwilę.');
    return SyncError('other', 'GitHub zwrócił błąd ' + s + (msg ? ' (' + msg + ')' : '') + '.');
  }

  function contentsPath(cfg) {
    return '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) +
      '/contents/' + cfg.path.split('/').map(encodeURIComponent).join('/');
  }

  /* ---------- Test połączenia ---------- */

  /**
   * Sprawdza repozytorium i token. Odmawia pracy z repozytorium PUBLICZNYM (dane firmy muszą być prywatne).
   * Zwraca Promise<{branch}> albo odrzuca SyncError.
   */
  function testConnection(cfg, opts) {
    opts = opts || {};
    var base = '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo);
    return request(cfg, 'GET', base).then(function (res) {
      if (res.status !== 200) throw failFromStatus(res);
      var repo = res.json || {};
      if (repo.private !== true && !opts.allowPublic) {
        throw SyncError('public', 'To repozytorium jest PUBLICZNE. Dane firmy muszą być w repozytorium prywatnym. Utwórz nowe repozytorium z opcją „Private”.');
      }
      if (repo.permissions && repo.permissions.push === false) {
        throw SyncError('perm', 'Token nie ma uprawnień do zapisu. Potrzebne jest „Contents: Read and write” dla tego repozytorium.');
      }
      var branch = cfg.branch || repo.default_branch || 'main';
      var specified = !!cfg.branch;
      return request(cfg, 'GET', base + '/branches/' + encodeURIComponent(branch)).then(function (b) {
        if (specified && (b.status === 404 || b.status === 409)) {
          throw SyncError('nobranch', 'W tym repozytorium nie ma gałęzi „' + branch + '”. Utwórz ją na GitHubie (lista gałęzi, wpisz nazwę, „Create branch”) i spróbuj ponownie.');
        }
        if (b.status === 404 || b.status === 409) {
          throw SyncError('empty', 'Repozytorium jest puste. Dodaj do niego dowolny plik (np. README) i spróbuj ponownie.');
        }
        if (b.status !== 200) throw failFromStatus(b);
        return { branch: branch, isPublic: repo.private !== true };
      });
    });
  }

  /* ---------- Jedna synchronizacja ---------- */

  function pullPush(cfg, local, attempt) {
    var ref = cfg.branch ? '?ref=' + encodeURIComponent(cfg.branch) : '';
    return request(cfg, 'GET', contentsPath(cfg) + ref).then(function (res) {
      var remote = C.emptyData();
      var sha = null;
      var remoteText = '';
      if (res.status === 200 && res.json && typeof res.json.content === 'string') {
        sha = res.json.sha;
        remoteText = fromB64(res.json.content);
        var parsed = C.parseSerialized(remoteText);
        if (parsed.error) {
          throw SyncError('corrupt', 'Plik kopii na GitHubie jest uszkodzony. Nic nie zostało nadpisane. Sprawdź plik w repozytorium.');
        }
        remote = parsed.data;
      } else if (res.status === 404) {
        sha = null; // pliku jeszcze nie ma – zostanie utworzony
      } else {
        throw failFromStatus(res);
      }

      var merged = C.merge(local, remote);
      var newText = C.serialize(merged);
      var remoteCanonical = sha ? C.serialize(remote) : null;
      var needPush = remoteCanonical !== newText;
      var changedLocal = !C.sameData(merged, local);

      if (!needPush) return { data: merged, changedLocal: changedLocal, pushed: false };

      var now = new Date();
      var body = {
        message: 'Utarg: kopia ' + C.todayKey(now) + ' ' + ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2) +
          ' (' + C.countEntries(merged) + ' ' + C.plural(C.countEntries(merged), 'wpis', 'wpisy', 'wpisów') + ')',
        content: toB64(newText)
      };
      if (cfg.branch) body.branch = cfg.branch;
      if (sha) body.sha = sha;
      return request(cfg, 'PUT', contentsPath(cfg), body).then(function (put) {
        if (put.status === 200 || put.status === 201) {
          return { data: merged, changedLocal: changedLocal, pushed: true };
        }
        if ((put.status === 409 || put.status === 422) && attempt < MAX_ATTEMPTS) {
          // ktoś zmienił plik w międzyczasie – pobierz jeszcze raz i scal
          return pullPush(cfg, merged, attempt + 1);
        }
        throw failFromStatus(put);
      });
    });
  }

  /* ---------- Silnik z kolejką i statusem ---------- */

  var hooks = null;
  var running = false;
  var again = false;
  var timer = null;
  var retryTimer = null;
  var status = { state: 'off', lastSync: 0, error: '', code: '' };

  function setStatus(patch) {
    for (var k in patch) status[k] = patch[k];
    if (hooks && hooks.onStatus) hooks.onStatus(Object.assign({}, status));
  }

  function init(h) {
    hooks = h;
    root.addEventListener('online', function () { requestRun(300); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') maybePullOnFocus();
    });
    var cfg = loadConfig();
    if (!cfg) {
      setStatus({ state: 'off' });
      return;
    }
    setStatus({ state: Store.isDirty() ? 'pending' : 'synced', lastSync: cfg.lastSync, error: '', code: '' });
  }

  var lastAttempt = 0;
  function maybePullOnFocus() {
    if (!loadConfig()) return;
    if (Date.now() - lastAttempt > 30000 || Store.isDirty()) requestRun(200);
  }

  function requestRun(delay) {
    if (!loadConfig()) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, delay == null ? 800 : delay);
  }

  /** Planuje synchronizację (zbija kilka szybkich zmian w jedną). */
  function schedule(delay) {
    if (!loadConfig()) return;
    if (!status.state || status.state === 'synced') setStatus({ state: 'pending' });
    requestRun(delay);
  }

  function scheduleRetry() {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(function () { if (Store.isDirty() || status.state === 'pending') run(); }, 60000);
  }

  function run() {
    var cfg = loadConfig();
    if (!cfg) { setStatus({ state: 'off' }); return Promise.resolve(); }
    if (running) { again = true; return Promise.resolve(); }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setStatus({ state: 'pending', error: 'Brak połączenia. Kopia zostanie wysłana, gdy wróci internet.', code: 'offline' });
      scheduleRetry();
      return Promise.resolve();
    }
    running = true;
    lastAttempt = Date.now();
    setStatus({ state: 'syncing', error: '', code: '' });
    var startVersion = hooks.getVersion();
    return pullPush(cfg, hooks.getData(), 1).then(function (r) {
      if (r.changedLocal) hooks.applyRemote(r.data);
      cfg.lastSync = Date.now();
      saveConfig(cfg);
      // flaga „niewysłane zmiany” znika tylko wtedy, gdy w trakcie wysyłki nie zapisano nic nowego
      if (hooks.getVersion() === startVersion) Store.setDirty(false);
      setStatus({ state: Store.isDirty() ? 'pending' : 'synced', lastSync: cfg.lastSync, error: '', code: '' });
      if (hooks.onSynced) hooks.onSynced(r);
    }).catch(function (e) {
      var code = e && e.code ? e.code : 'other';
      var msg = e && e.name === 'SyncError' ? e.message : 'Nie udało się wysłać kopii.';
      if (code === 'offline') {
        setStatus({ state: 'pending', error: 'Brak połączenia. Kopia zostanie wysłana, gdy wróci internet.', code: code });
        scheduleRetry();
      } else if (code === 'server' || code === 'rate') {
        setStatus({ state: 'pending', error: msg, code: code });
        scheduleRetry();
      } else {
        setStatus({ state: 'error', error: msg, code: code });
      }
    }).then(function () {
      running = false;
      if (again) { again = false; requestRun(300); }
    });
  }

  /** Łączy z repozytorium: sprawdza dostęp i robi pierwszą synchronizację. */
  function connect(owner, repo, token, opts) {
    opts = opts || {};
    var cfg = {
      owner: owner, repo: repo, branch: String(opts.branch || '').trim(), path: DEFAULT_PATH,
      token: String(token || '').trim(), lastSync: 0, public: false
    };
    if (!cfg.token) return Promise.reject(SyncError('auth', 'Wklej token dostępu.'));
    return testConnection(cfg, { allowPublic: !!opts.allowPublic }).then(function (info) {
      cfg.branch = info.branch;
      cfg.public = info.isPublic === true;
      saveConfig(cfg);
      Store.setDirty(true);
      setStatus({ state: 'pending', error: '', code: '' });
      return run();
    }).then(function () {
      if (status.state === 'error') throw SyncError(status.code, status.error);
      return true;
    });
  }

  function disconnect() {
    clearConfig();
    if (timer) clearTimeout(timer);
    if (retryTimer) clearTimeout(retryTimer);
    setStatus({ state: 'off', lastSync: 0, error: '', code: '' });
  }

  function getStatus() { return Object.assign({}, status); }
  function getConfigPublic() {
    var c = loadConfig();
    return c ? { owner: c.owner, repo: c.repo, branch: c.branch, path: c.path, public: c.public } : null;
  }

  root.UtargSync = {
    init: init, schedule: schedule, run: run, connect: connect, disconnect: disconnect,
    getStatus: getStatus, getConfig: getConfigPublic, parseRepo: parseRepo,
    // udostępnione do testów
    _pullPush: pullPush, _toB64: toB64, _fromB64: fromB64
  };
})(typeof self !== 'undefined' ? self : this);
