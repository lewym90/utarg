'use strict';
/*
 * Utarg – przypomnienie o wpisaniu utargu. Uruchamiane codziennie przez GitHub Actions (.github/workflows/przypomnienie.yml).
 *
 * Co robi: czyta plik z danymi (utarg-dane.json) i listę zapisanych telefonów (push-subskrypcje.json).
 * Jeśli za dziś (czas polski) nie ma wpisu – ani utargu, ani oznaczenia „zamknięte” – i dziś nie jest stały dzień wolny,
 * wysyła powiadomienie na wszystkie zapisane urządzenia. Treść nie zawiera żadnych kwot.
 *
 * Okno czasu: zadanie startuje o 16:40, ale GitHub potrafi je opóźnić, więc wysyłamy między 16:40 a 17:30.
 * Dwa wpisy cron (czas letni i zimowy) pilnują, żeby zadziałał tylko ten, który trafia w okno – bez dubli.
 */
const fs = require('fs');
const path = require('path');
const C = require('../js/core.js');

const TIMEZONE = 'Europe/Warsaw';
const WINDOW_START = 16 * 60 + 40;
const WINDOW_END = 17 * 60 + 30;

/** Data (RRRR-MM-DD) i minuta doby w czasie polskim dla podanej chwili. */
function localParts(date) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const o = {};
  f.formatToParts(date).forEach((p) => { o[p.type] = p.value; });
  return { key: `${o.year}-${o.month}-${o.day}`, minutes: Number(o.hour) * 60 + Number(o.minute) };
}

/**
 * Decyzja, czy wysłać przypomnienie.
 * opts: { test } – wyślij próbne powiadomienie niezależnie od wszystkiego,
 *       { force } – pomiń okno godzinowe (ręczne uruchomienie).
 */
function decide(data, now, opts) {
  opts = opts || {};
  const { key, minutes } = localParts(now);
  if (opts.test) return { send: true, mode: 'test', key };
  if (!opts.force && (minutes < WINDOW_START || minutes > WINDOW_END)) {
    return { send: false, reason: 'poza oknem godzinowym (16:40–17:30)', key, minutes };
  }
  if (C.getDay(data, key)) return { send: false, reason: 'za dziś jest już wpis', key };
  if (data.cfg && data.cfg.w.indexOf(C.weekdayOfKey(key)) >= 0) return { send: false, reason: 'stały dzień wolny', key };
  return { send: true, mode: 'reminder', key };
}

function validSub(s) {
  return !!s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) &&
    !!s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string';
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

/**
 * Główna logika. deps: { send(sub, payload) → Promise (odrzucony z .statusCode przy błędzie) }.
 * Zwraca podsumowanie; usuwa z pliku wygasłe subskrypcje (kody 404 i 410).
 */
async function run(o) {
  const raw = readJson(path.join(o.dataDir, 'utarg-dane.json'));
  const data = raw ? C.validate(raw).data : C.emptyData();
  const subsFile = path.join(o.dataDir, 'push-subskrypcje.json');
  const parsed = readJson(subsFile);
  const subs = parsed && Array.isArray(parsed.subs) ? parsed.subs.filter(validSub) : [];

  const d = decide(data, o.now, { test: o.test, force: o.force });
  const summary = { decision: d, subs: subs.length, sent: 0, failed: 0, removed: 0 };
  if (!d.send || !subs.length) return summary;

  const payload = d.mode === 'test'
    ? { title: 'Utarg', body: 'Próbne powiadomienie z GitHuba. Przypomnienia działają.', url: './' }
    : { title: 'Utarg', body: 'Nie wpisano jeszcze utargu za dziś.', url: './' };

  const keep = [];
  for (const sub of subs) {
    try {
      await o.send(sub, payload);
      summary.sent++;
      keep.push(sub);
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410) summary.removed++; // telefon wypisał się albo subskrypcja wygasła
      else { summary.failed++; keep.push(sub); }
    }
  }
  if (summary.removed) fs.writeFileSync(subsFile, JSON.stringify({ v: 1, subs: keep }, null, 2) + '\n');
  return summary;
}

async function main() {
  const webpush = require('web-push');
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    console.error('Brak kluczy VAPID. Dodaj sekret VAPID_PRIVATE_KEY w ustawieniach repozytorium (Settings → Secrets and variables → Actions).');
    process.exit(1);
  }
  webpush.setVapidDetails('https://lewym90.github.io/utarg/', pub, priv);
  const summary = await run({
    dataDir: process.env.DATA_DIR || 'data',
    now: new Date(),
    test: process.env.TEST === 'true',
    force: process.env.FORCE === 'true',
    send: (sub, payload) => webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600, urgency: 'normal' })
  });
  console.log(JSON.stringify(summary));
}

module.exports = { decide, run, localParts, validSub };

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
