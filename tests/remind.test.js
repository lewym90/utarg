'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const C = require('../js/core.js');
const R = require('../tools/remind.js');

const utc = (s) => new Date(s);

function dataWith(entries, cfg) {
  let d = C.emptyData();
  let t = 1;
  for (const [k, a, closed] of entries) d = C.setDay(d, k, a, !!closed, t++);
  if (cfg) d = C.setCfg(d, cfg, 0, t);
  return d;
}

test('czas polski: lato (CEST) i zima (CET) oraz dzień zmiany czasu', () => {
  assert.deepEqual(R.localParts(utc('2026-07-01T14:40:00Z')), { key: '2026-07-01', minutes: 16 * 60 + 40 });
  assert.deepEqual(R.localParts(utc('2026-12-01T15:40:00Z')), { key: '2026-12-01', minutes: 16 * 60 + 40 });
  assert.deepEqual(R.localParts(utc('2026-03-29T14:40:00Z')), { key: '2026-03-29', minutes: 16 * 60 + 40 }); // po przestawieniu zegara
  assert.deepEqual(R.localParts(utc('2026-10-25T15:40:00Z')), { key: '2026-10-25', minutes: 16 * 60 + 40 }); // po powrocie do czasu zimowego
  assert.equal(R.localParts(utc('2026-07-01T22:30:00Z')).key, '2026-07-02'); // po północy czasu polskiego
});

test('okno 16:40–17:30: dokładnie jeden z dwóch wpisów cron trafia w okno, latem i zimą', () => {
  const empty = C.emptyData();
  const inWindow = (iso) => R.decide(empty, utc(iso)).send;
  // lato: 14:40 UTC trafia, 15:40 UTC nie
  assert.equal(inWindow('2026-07-01T14:40:00Z'), true);
  assert.equal(inWindow('2026-07-01T15:40:00Z'), false);
  // zima: 15:40 UTC trafia, 14:40 UTC nie
  assert.equal(inWindow('2026-12-01T15:40:00Z'), true);
  assert.equal(inWindow('2026-12-01T14:40:00Z'), false);
  // opóźnienie startu do 50 minut nadal mieści się w oknie, ale nie dłuższe
  assert.equal(inWindow('2026-07-01T15:20:00Z'), true);  // 17:20
  assert.equal(inWindow('2026-07-01T15:31:00Z'), false); // 17:31
  assert.equal(inWindow('2026-07-01T14:39:00Z'), false); // 16:39
});

test('nie wysyła, gdy jest wpis (utarg lub „zamknięte”) albo stały dzień wolny', () => {
  const day = '2026-10-22'; // czwartek
  const now = utc('2026-10-22T14:45:00Z'); // 16:45 CEST
  assert.equal(R.decide(dataWith([]), now).send, true);
  assert.equal(R.decide(dataWith([[day, 100000]]), now).send, false);
  assert.equal(R.decide(dataWith([[day, 0, true]]), now).send, false);
  assert.match(R.decide(dataWith([[day, 1]]), now).reason, /wpis/);
  // wpis z innego dnia nie liczy się
  assert.equal(R.decide(dataWith([['2026-10-21', 100000]]), now).send, true);
  // czwartek (4) jako stały dzień wolny
  assert.equal(R.decide(dataWith([], [4]), now).send, false);
  assert.equal(R.decide(dataWith([], [0, 6]), now).send, true);
  // usunięty wpis (znacznik) = brak wpisu
  let d = dataWith([[day, 100]]);
  d = C.setDay(d, day, null, false, 999);
  assert.equal(R.decide(d, now).send, true);
});

test('ręczne uruchomienia: force pomija okno, test wysyła zawsze', () => {
  const noon = utc('2026-10-22T10:00:00Z'); // 12:00
  assert.equal(R.decide(C.emptyData(), noon).send, false);
  assert.equal(R.decide(C.emptyData(), noon, { force: true }).send, true);
  assert.equal(R.decide(dataWith([['2026-10-22', 5]]), noon, { force: true }).send, false); // force nie omija wpisu
  const t = R.decide(dataWith([['2026-10-22', 5]]), noon, { test: true });
  assert.equal(t.send, true);
  assert.equal(t.mode, 'test');
});

function tmpDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utarg-remind-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}
const sub = (n) => ({ endpoint: 'https://push.example/' + n, keys: { p256dh: 'p' + n, auth: 'a' + n } });

test('wysyłka: do wszystkich telefonów, bez kwot w treści, wygasłe subskrypcje są usuwane z pliku', async () => {
  const dir = tmpDir({
    'utarg-dane.json': C.serialize(dataWith([['2026-10-21', 123456]])),
    'push-subskrypcje.json': JSON.stringify({ v: 1, subs: [sub(1), sub(2), sub(3), { endpoint: 'http://zly', keys: {} }] })
  });
  const sent = [];
  const out = await R.run({
    dataDir: dir, now: utc('2026-10-22T14:45:00Z'),
    send: async (s, payload) => {
      sent.push([s.endpoint, payload]);
      if (s.endpoint.endsWith('/2')) { const e = new Error('gone'); e.statusCode = 410; throw e; }
      if (s.endpoint.endsWith('/3')) { const e = new Error('chwilowy'); e.statusCode = 503; throw e; }
    }
  });
  assert.equal(out.subs, 3);
  assert.equal(out.sent, 1);
  assert.equal(out.removed, 1);
  assert.equal(out.failed, 1);
  assert.equal(sent.length, 3);
  assert.match(sent[0][1].body, /Nie wpisano jeszcze utargu/);
  assert.doesNotMatch(JSON.stringify(sent), /1234|123456/);
  const left = JSON.parse(fs.readFileSync(path.join(dir, 'push-subskrypcje.json'), 'utf8')).subs.map((s) => s.endpoint);
  assert.deepEqual(left, ['https://push.example/1', 'https://push.example/3']); // 410 usunięta, chwilowy błąd zostaje
});

test('wysyłka: gdy jest wpis, nic nie jest wysyłane i plik subskrypcji nie jest ruszany', async () => {
  const subs = JSON.stringify({ v: 1, subs: [sub(1)] });
  const dir = tmpDir({ 'utarg-dane.json': C.serialize(dataWith([['2026-10-22', 5]])), 'push-subskrypcje.json': subs });
  let calls = 0;
  const out = await R.run({ dataDir: dir, now: utc('2026-10-22T14:45:00Z'), send: async () => { calls++; } });
  assert.equal(calls, 0);
  assert.equal(out.decision.send, false);
  assert.equal(fs.readFileSync(path.join(dir, 'push-subskrypcje.json'), 'utf8'), subs);
});

test('wysyłka: brak plików z danymi i subskrypcjami nie powoduje błędu', async () => {
  const dir = tmpDir({});
  const out = await R.run({ dataDir: dir, now: utc('2026-10-22T14:45:00Z'), send: async () => { throw new Error('nie powinno'); } });
  assert.equal(out.subs, 0);
  assert.equal(out.sent, 0);
});

test('tryb próbny wysyła także, gdy wpis już jest', async () => {
  const dir = tmpDir({ 'utarg-dane.json': C.serialize(dataWith([['2026-10-22', 5]])), 'push-subskrypcje.json': JSON.stringify({ v: 1, subs: [sub(1)] }) });
  const got = [];
  const out = await R.run({ dataDir: dir, now: utc('2026-10-22T10:00:00Z'), test: true, send: async (s, p) => { got.push(p); } });
  assert.equal(out.sent, 1);
  assert.match(got[0].body, /Próbne powiadomienie/);
});

test('plik zadania: dwa wpisy cron o 16:40, brak sekretów w treści, klucz publiczny zgodny z aplikacją', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/przypomnienie.yml'), 'utf8');
  assert.match(yml, /cron: '40 14 \* \* \*'/);
  assert.match(yml, /cron: '40 15 \* \* \*'/);
  assert.match(yml, /secrets\.VAPID_PRIVATE_KEY/);
  const pub = /VAPID_PUBLIC_KEY: '([^']+)'/.exec(yml)[1];
  const app = fs.readFileSync(path.join(__dirname, '..', 'js/app.js'), 'utf8');
  assert.ok(app.includes("'" + pub + "'"), 'klucz publiczny w aplikacji i w zadaniu musi być taki sam');
  assert.doesNotMatch(yml, /VAPID_PRIVATE_KEY: '/);
  assert.match(yml, /npm install --no-save[^\n]*web-push@3\.6\.7/);
});

test('biblioteka powiadomień przyjmuje nasz format subskrypcji i wiadomości (bez wysyłania do sieci)', () => {
  let webpush;
  try { webpush = require('web-push'); } catch (e) { return; } // pakiet instalowany tylko do testów i w zadaniu GitHuba
  const crypto = require('node:crypto');
  const keys = webpush.generateVAPIDKeys();
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const sub = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') }
  };
  assert.equal(R.validSub(sub), true);
  const details = webpush.generateRequestDetails(sub, JSON.stringify({ title: 'Utarg', body: 'x' }), {
    TTL: 3600, urgency: 'normal',
    vapidDetails: { subject: 'https://lewym90.github.io/utarg/', publicKey: keys.publicKey, privateKey: keys.privateKey }
  });
  assert.equal(details.method, 'POST');
  assert.equal(details.headers.TTL, 3600);
  assert.match(details.headers.Authorization, /^vapid /);
});
