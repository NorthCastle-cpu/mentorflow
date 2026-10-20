// Client sync tests: pure merge helpers + two simulated devices syncing through the real Worker + D1 (Miniflare).
// Run: node tests/sync.test.mjs
import assert from 'node:assert/strict';
import { startWorker, jwt } from './helpers/worker-env.mjs';
import { isNewer, mergeSettings, settingsToWire, toWire, fromWire, syncOnce, applyIncoming, CloudflareProvider, NeedsLoginError, getProvider, detectServer } from '../src/js/sync.js';

let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('✓', name); };
const quiet = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };
// Each "device" gets its own copy of db.js (separate module instance → separate in-memory store).
async function device(name) {
  const db = await import(`../src/js/db.js?device=${name}`);
  await quiet(() => db.getAllRaw('students')); // no IndexedDB in Node → in-memory fallback
  const kv = new Map(); const storage = { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v), del: (k) => kv.delete(k) };
  return { db, storage };
}

// ---------- pure helpers ----------
await t('isNewer: newest updatedAt wins, ties keep local, missing local always loses', () => {
  assert.equal(isNewer({ updatedAt: '2026-10-20T10:00:01.000Z' }, { updatedAt: '2026-10-20T10:00:00.000Z' }), true);
  assert.equal(isNewer({ updatedAt: '2026-10-20T10:00:00.000Z' }, { updatedAt: '2026-10-20T10:00:00.000Z' }), false);
  assert.equal(isNewer({ updatedAt: '2026-10-20T09:00:00.000Z' }, { updatedAt: '2026-10-20T10:00:00.000Z' }), false);
  assert.equal(isNewer({ updatedAt: '2026-01-01T00:00:00.000Z' }, undefined), true);
  assert.equal(isNewer({ id: 'a', deletedAt: '2026-10-20T11:00:00.000Z', updatedAt: '2026-10-20T11:00:00.000Z' }, { updatedAt: '2026-10-20T10:00:00.000Z' }), true, 'tombstone newer than edit wins');
});
await t('toWire/fromWire round-trip records and tombstones', () => {
  const r = { id: 'x', name: 'A', updatedAt: '2026-10-20T10:00:00.000Z' };
  assert.deepEqual(fromWire(toWire('students', r)), r);
  const tomb = { id: 'y', deletedAt: '2026-10-20T11:00:00.000Z', updatedAt: '2026-10-20T11:00:00.000Z' };
  const w = toWire('sessions', tomb); assert.equal(w.deleted, true); assert.deepEqual(fromWire(w), tomb);
});
await t('settings sync per field; Notion token and sync choice never leave the device', () => {
  const local = { id: 'settings', defaultRate: 40, notionToken: 'secret', syncProvider: 'off', yourName: 'Sample Tutor',
    _fieldTimes: { defaultRate: '2026-10-20T10:00:00.000Z', notionToken: '2026-10-20T10:00:00.000Z', syncProvider: '2026-10-20T10:00:00.000Z', yourName: '2026-10-20T09:00:00.000Z' } };
  const wire = settingsToWire(local);
  assert.deepEqual(wire.map(w => w.id).sort(), ['defaultRate', 'yourName']);
  const { settings, changed } = mergeSettings(local, [
    { store: 'settings', id: 'defaultRate', updatedAt: '2026-10-20T09:59:00.000Z', data: { value: 35 } }, // older → ignored
    { store: 'settings', id: 'yourName', updatedAt: '2026-10-20T09:30:00.000Z', data: { value: 'Sample Tutor B' } }, // newer → taken
    { store: 'settings', id: 'monthlyTarget', updatedAt: '2026-10-20T08:00:00.000Z', data: { value: 2500 } }, // never set locally → taken
    { store: 'settings', id: 'notionToken', updatedAt: '2030-01-01T00:00:00.000Z', data: { value: 'evil' } }, // never accepted
  ]);
  assert.equal(changed, 2); assert.equal(settings.defaultRate, 40); assert.equal(settings.yourName, 'Sample Tutor B'); assert.equal(settings.monthlyTarget, 2500); assert.equal(settings.notionToken, 'secret');
  assert.equal(mergeSettings({}, []).settings.id, 'settings');
});
await t('getProvider: Cloudflare only when served by the Worker; "off" and Notion respected', () => {
  assert.equal(getProvider({ syncProvider: 'local' }, { serverPresent: false }).id, 'local');
  assert.equal(getProvider({ syncProvider: 'local' }, { serverPresent: true }).id, 'cloudflare');
  assert.equal(getProvider({ syncProvider: 'off' }, { serverPresent: true }).id, 'local');
  assert.equal(getProvider({ syncProvider: 'notion' }, { serverPresent: true }).id, 'notion');
});
await t('expired Access session (opaque redirect / 302 / 401 / 403 / HTML login page) → NeedsLoginError', async () => {
  const fake = (res) => new CloudflareProvider({ fetchImpl: async () => res });
  const resp = (status, type = 'basic', ct = 'application/json') => ({ status, type, ok: status >= 200 && status < 300, headers: new Headers({ 'Content-Type': ct }), json: async () => ({}) });
  for (const r of [resp(0, 'opaqueredirect'), resp(302), resp(401), resp(403), resp(200, 'basic', 'text/html')]) await assert.rejects(fake(r).pull(0), NeedsLoginError);
  const offline = new CloudflareProvider({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(offline.pull(0), (e) => e.offline === true);
  assert.equal((await detectServer(async () => resp(0, 'opaqueredirect'))).present, true);
  assert.equal((await detectServer(async () => resp(404, 'basic', 'text/html'))).present, false, 'GitHub Pages → no sync');
});

// ---------- db layer: tombstones + outbox ----------
await t('db.del writes a tombstone (hidden from getAll, visible to sync) and queues it', async () => {
  const { db } = await device('unit');
  await db.put('students', { id: 'a', name: 'A', updatedAt: '2026-10-20T10:00:00.000Z' });
  await db.del('students', 'a');
  assert.equal((await db.getAll('students')).length, 0);
  const raw = await db.getAllRaw('students'); assert.equal(raw.length, 1); assert.ok(raw[0].deletedAt && raw[0].updatedAt === raw[0].deletedAt);
  assert.deepEqual((await db.getOutbox()).map(e => e.key), ['students/a']);
  await db.applyRemote('students', [{ id: 'b', name: 'B', updatedAt: '2026-10-20T10:00:00.000Z' }]);
  assert.equal((await db.getOutbox()).length, 1, 'remote applies are not queued');
});

// ---------- two devices through the real Worker ----------
const w = await startWorker();
const token = await jwt();
const providerFor = () => new CloudflareProvider({ fetchImpl: (url, opts) => w.mf.dispatchFetch('https://mentorflow.example.workers.dev/api/' + url.replace('./api/', ''), { ...opts, headers: { ...opts.headers, 'Cf-Access-Jwt-Assertion': token } }) });
try {
  const ipad = await device('ipad'), pc = await device('pc');
  const sync = (d) => syncOnce(d.db, providerFor(), { storage: d.storage });
  const ts = (m) => `2026-10-20T10:${String(m).padStart(2, '0')}:00.000Z`;

  await t('iPad pushes everything (students, sessions, tasks, expenses, checklists, settings); PC pulls it', async () => {
    await ipad.db.putMany('students', [{ id: 's1', name: 'Test Student One', subject: 'Maths', updatedAt: ts(1) }]);
    await ipad.db.putMany('sessions', [{ id: 'l1', studentId: 's1', date: '2026-10-21', start: '16:00', duration: 60, status: 'scheduled', sequence: 0, updatedAt: ts(1) }]);
    await ipad.db.put('tasks', { id: 't1', title: 'Homework', updatedAt: ts(1) });
    await ipad.db.put('expenses', { id: 'e1', amount: 9.99, category: 'Travel', date: '2026-10-20', updatedAt: ts(1) });
    await ipad.db.put('meta', { id: 'checklist-2026-10', items: { 'gw-invoice': true }, updatedAt: ts(1) });
    await ipad.db.put('meta', { id: 'settings', defaultRate: 45, notionToken: 'secret-token', _fieldTimes: { defaultRate: ts(1), notionToken: ts(1) } });
    const r = await sync(ipad); assert.equal(r.pushed, 6, '5 records + 1 setting field (Notion token excluded)'); assert.equal((await ipad.db.getOutbox()).length, 0);
    const p = await sync(pc); assert.ok(p.changed >= 6);
    assert.equal((await pc.db.getAll('sessions'))[0].start, '16:00');
    assert.equal((await pc.db.getAll('expenses'))[0].amount, 9.99);
    const s = await pc.db.get('meta', 'settings'); assert.equal(s.defaultRate, 45); assert.equal(s.notionToken, undefined, 'Notion token stayed on the iPad');
    assert.equal((await pc.db.get('meta', 'checklist-2026-10')).items['gw-invoice'], true);
  });
  await t('concurrent edits: the newest edit wins on both devices', async () => {
    await pc.db.put('students', { id: 's1', name: 'PC edit (newer)', subject: 'Maths', updatedAt: ts(5) });
    await ipad.db.put('students', { id: 's1', name: 'iPad edit (older)', subject: 'Maths', updatedAt: ts(3) });
    await sync(pc); await sync(ipad);
    assert.equal((await ipad.db.get('students', 's1')).name, 'PC edit (newer)', 'iPad adopts the newer server copy (stale echo)');
    await sync(pc); assert.equal((await pc.db.get('students', 's1')).name, 'PC edit (newer)');
  });
  await t('deleting on one device removes it on the other (tombstone), and an older offline edit cannot resurrect it', async () => {
    await pc.db.put('sessions', { id: 'l1', studentId: 's1', date: '2026-10-21', start: '16:30', duration: 60, status: 'scheduled', sequence: 1, updatedAt: ts(6) });
    await sync(pc); await sync(ipad);
    assert.equal((await ipad.db.get('sessions', 'l1')).start, '16:30');
    await ipad.db.del('sessions', 'l1'); // tombstone with the current time (newer than ts(6))
    await sync(ipad);
    // PC edits offline with an older timestamp, then syncs
    await pc.db.put('sessions', { id: 'l1', studentId: 's1', date: '2026-10-21', start: '17:00', duration: 60, status: 'scheduled', sequence: 2, updatedAt: ts(7) });
    await sync(pc);
    assert.equal((await pc.db.getAll('sessions')).length, 0, 'deleted on PC too');
    assert.ok((await pc.db.get('sessions', 'l1')).deletedAt);
  });
  await t('settings merge per field across devices', async () => {
    await pc.db.put('meta', { ...(await pc.db.get('meta', 'settings')), monthlyTarget: 3000, _fieldTimes: { ...(await pc.db.get('meta', 'settings'))._fieldTimes, monthlyTarget: ts(8) } });
    const ip = await ipad.db.get('meta', 'settings');
    await ipad.db.put('meta', { ...ip, yourName: 'Sample Tutor', _fieldTimes: { ...ip._fieldTimes, yourName: ts(9) } });
    await sync(pc); await sync(ipad); await sync(pc);
    const a = await ipad.db.get('meta', 'settings'), b = await pc.db.get('meta', 'settings');
    for (const s of [a, b]) { assert.equal(s.monthlyTarget, 3000); assert.equal(s.yourName, 'Sample Tutor'); assert.equal(s.defaultRate, 45); }
    assert.equal(a.notionToken, 'secret-token'); assert.equal(b.notionToken, undefined);
  });
  await t('erase + restore on a new device: full re-pull, restored old copies do not overwrite newer server data', async () => {
    const fresh = await device('new-ipad');
    await fresh.db.put('students', { id: 's1', name: 'Old name from an old backup', updatedAt: ts(0) });
    const r = await sync(fresh);
    assert.equal(r.pushed, 0); assert.equal((await fresh.db.get('students', 's1')).name, 'PC edit (newer)');
    assert.equal((await fresh.db.getAll('tasks')).length, 1);
  });
  await t('an unauthenticated device gets NeedsLoginError and keeps its changes queued', async () => {
    const d = await device('signed-out');
    await d.db.put('tasks', { id: 'q1', title: 'queued', updatedAt: ts(10) });
    const p = new CloudflareProvider({ fetchImpl: (url, opts) => w.mf.dispatchFetch('https://mentorflow.example.workers.dev/api/' + url.replace('./api/', ''), opts) });
    await assert.rejects(syncOnce(d.db, p, { storage: d.storage }), NeedsLoginError);
    assert.equal((await d.db.getOutbox()).length, 1);
  });
} finally { await w.dispose(); }
console.log(`\n${n} sync test groups passed`);
