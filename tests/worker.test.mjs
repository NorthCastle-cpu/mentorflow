// Worker API tests: Access JWT enforcement (fail closed) + /api/changes merge rules and tombstones.
// Run: node tests/worker.test.mjs
import assert from 'node:assert/strict';
import { startWorker, jwt, otherKey, SARAH } from './helpers/worker-env.mjs';

let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('✓', name); };
const w = await startWorker();
const good = await jwt();
const rec = (store, id, updatedAt, data = {}, deleted = false) => ({ store, id, updatedAt, deleted, data: { id, updatedAt, ...data } });

try {
  // ---------- authentication: every /api endpoint fails closed ----------
  const endpoints = [['GET', '/api/session'], ['GET', '/api/changes?since=0'], ['POST', '/api/changes'], ['GET', '/api/login'], ['GET', '/api/digest/preview'], ['GET', '/api/does-not-exist'], ['GET', '/api']];
  await t('no Access JWT → 401 on every /api endpoint', async () => {
    for (const [method, path] of endpoints) {
      const r = await w.call(path, { method, body: method === 'POST' ? { changes: [] } : undefined });
      assert.equal(r.status, 401, `${method} ${path}`); assert.equal(r.headers.get('Cache-Control'), 'no-store');
    }
  });
  await t('forged / wrong JWTs are rejected', async () => {
    const now = Math.floor(Date.now() / 1000);
    const cases = {
      'bad signature': await jwt({}, { key: otherKey.privateKey }), 'unknown kid': await jwt({}, { kid: 'nope' }),
      'wrong audience': await jwt({ aud: ['someone-elses-app'] }), 'wrong issuer': await jwt({ iss: 'https://evil.cloudflareaccess.com' }),
      expired: await jwt({ exp: now - 3600 }), 'not yet valid': await jwt({ nbf: now + 3600 }), garbage: 'abc.def.ghi', 'alg none': 'eyJhbGciOiJub25lIn0.eyJlbWFpbCI6InNhcmFoX2FyaXNzYUBob3RtYWlsLmNvLnVrIn0.',
    };
    for (const [name, token] of Object.entries(cases)) assert.equal((await w.call('/api/session', { token })).status, 401, name);
  });
  await t('valid JWT for another email → 403; no service-token (email-less) access', async () => {
    assert.equal((await w.call('/api/session', { token: await jwt({ email: 'saraharissa@gmail.com' }) })).status, 403);
    assert.equal((await w.call('/api/changes?since=0', { token: await jwt({ email: 'attacker@example.com' }) })).status, 403);
    assert.equal((await w.call('/api/session', { token: await jwt({ email: undefined, common_name: 'svc' }) })).status, 403);
  });
  await t('valid JWT for Sarah (either AUD, any case) → allowed', async () => {
    const r = await w.call('/api/session', { token: good }); assert.equal(r.status, 200); assert.deepEqual(r.data, { app: 'mentorflow', email: SARAH });
    assert.equal((await w.call('/api/session', { token: await jwt({ aud: 'aud-custom-domain', email: 'Sarah_Arissa@Hotmail.co.uk' }) })).status, 200);
  });
  await t('missing Access config → 503 even with a "valid" token (fail closed)', async () => {
    const w2 = await startWorker({ ACCESS_AUD: '' });
    try { assert.equal((await w2.call('/api/session', { token: good })).status, 503); } finally { await w2.dispose(); }
  });
  await t('writes need X-MentorFlow header and same origin', async () => {
    assert.equal((await w.call('/api/changes', { method: 'POST', token: good, body: { changes: [] }, headers: { 'X-MentorFlow': '' } })).status, 403);
    assert.equal((await w.call('/api/changes', { method: 'POST', token: good, body: { changes: [] }, headers: { Origin: 'https://evil.example' } })).status, 403);
  });
  await t('/api/login redirects a signed-in user back to the app', async () => {
    const r = await w.call('/api/login', { token: good }); assert.equal(r.status, 302); assert.match(r.headers.get('Location'), /\/#\/more$/);
  });
  await t('static assets are served without touching the API', async () => {
    const r = await w.mf.dispatchFetch('https://mentorflow.example.workers.dev/index.html'); assert.equal(await r.text(), 'static asset');
  });

  // ---------- sync merge ----------
  const push = (changes, token = good) => w.call('/api/changes', { method: 'POST', token, body: { changes } });
  const pull = (since = 0) => w.call(`/api/changes?since=${since}`, { token: good });
  await t('push inserts new records; pull returns them with an increasing cursor', async () => {
    const r = await push([rec('students', 's1', '2026-10-20T10:00:00.000Z', { name: 'Test Student One' }), rec('sessions', 'x1', '2026-10-20T10:00:00.000Z', { studentId: 's1', date: '2026-10-21', start: '16:00' })]);
    assert.equal(r.status, 200); assert.equal(r.data.applied, 2); assert.deepEqual(r.data.stale, []);
    const p = await pull(0); assert.equal(p.data.changes.length, 2); assert.ok(p.data.cursor >= 2); assert.equal(p.data.more, false);
    assert.equal(p.data.changes[0].data.name, 'Test Student One');
    assert.equal((await pull(p.data.cursor)).data.changes.length, 0);
  });
  await t('newest updatedAt wins: older push is ignored and the newer server copy comes back as stale', async () => {
    assert.equal((await push([rec('students', 's1', '2026-10-20T12:00:00.000Z', { name: 'Newer name' })])).data.applied, 1);
    const r = await push([rec('students', 's1', '2026-10-20T11:00:00.000Z', { name: 'Older name' })]);
    assert.equal(r.data.applied, 0); assert.equal(r.data.stale.length, 1); assert.equal(r.data.stale[0].data.name, 'Newer name');
    const tie = await push([rec('students', 's1', '2026-10-20T12:00:00.000Z', { name: 'Same time, different device' })]);
    assert.equal(tie.data.applied, 0); assert.equal(tie.data.stale.length, 0, 'ties keep the server copy and are not echoed');
    const row = await w.db.prepare("SELECT data FROM records WHERE store='students' AND id='s1'").first();
    assert.equal(JSON.parse(row.data).name, 'Newer name');
  });
  await t('tombstones: a newer delete wins over an older edit, and syncs as deleted', async () => {
    const before = (await pull(0)).data.cursor;
    assert.equal((await push([rec('sessions', 'x1', '2026-10-20T13:00:00.000Z', { deletedAt: '2026-10-20T13:00:00.000Z' }, true)])).data.applied, 1);
    const late = await push([rec('sessions', 'x1', '2026-10-20T12:30:00.000Z', { studentId: 's1', notes: 'offline edit made before the delete' })]);
    assert.equal(late.data.applied, 0); assert.equal(late.data.stale[0].deleted, true);
    const p = await pull(before); assert.equal(p.data.changes.length, 1); assert.equal(p.data.changes[0].deleted, true); assert.equal(p.data.changes[0].id, 'x1');
    const resurrect = await push([rec('sessions', 'x1', '2026-10-20T14:00:00.000Z', { studentId: 's1', notes: 're-created later' })]);
    assert.equal(resurrect.data.applied, 1, 'an edit newer than the tombstone wins');
  });
  await t('all data stores sync (money, settings, checklists) but never the Notion token', async () => {
    const r = await push([
      rec('expenses', 'e1', '2026-10-20T10:00:00.000Z', { amount: 12.5, category: 'Travel' }),
      rec('tasks', 't1', '2026-10-20T10:00:00.000Z', { title: 'Mark homework' }),
      rec('meta', 'checklist-2026-10', '2026-10-20T10:00:00.000Z', { items: { 'gw-invoice': true } }),
      { store: 'settings', id: 'defaultRate', updatedAt: '2026-10-20T10:00:00.000Z', deleted: false, data: { value: 45 } },
      { store: 'settings', id: 'bankSortCode', updatedAt: '2026-10-20T10:00:00.000Z', deleted: false, data: { value: '00-00-00' } },
      { store: 'settings', id: 'notionToken', updatedAt: '2026-10-20T10:00:00.000Z', deleted: false, data: { value: 'secret_should_never_sync' } },
      rec('meta', 'settings', '2026-10-20T10:00:00.000Z', { notionToken: 'secret_should_never_sync' }),
    ]);
    assert.equal(r.data.applied, 5);
    const all = JSON.stringify((await w.db.prepare('SELECT * FROM records').all()).results);
    assert.ok(!all.includes('secret_should_never_sync'));
    const rate = await w.db.prepare("SELECT data FROM records WHERE store='settings' AND id='defaultRate'").first();
    assert.equal(JSON.parse(rate.data).value, 45);
  });
  await t('validation: unknown store, bad timestamps, oversize batches are rejected', async () => {
    assert.equal((await push([rec('passwords', 'p', '2026-10-20T10:00:00.000Z')])).status, 400);
    assert.equal((await push([rec('students', 'p', 'yesterday')])).status, 400);
    assert.equal((await push(Array.from({ length: 501 }, (_, i) => rec('tasks', 'b' + i, '2026-10-20T10:00:00.000Z')))).status, 413);
    assert.equal((await w.call('/api/changes', { method: 'POST', token: good, body: 'not json' })).status, 400);
  });
  await t('pull pages through large change sets', async () => {
    const start = (await pull(0)).data.cursor;
    await push(Array.from({ length: 450 }, (_, i) => rec('tasks', 'bulk' + i, '2026-10-20T10:00:00.000Z')));
    await push(Array.from({ length: 450 }, (_, i) => rec('tasks', 'bulk2-' + i, '2026-10-20T10:00:00.000Z')));
    const p1 = await pull(start); assert.equal(p1.data.changes.length, 500); assert.equal(p1.data.more, true);
    const p2 = await pull(p1.data.cursor); assert.equal(p2.data.changes.length, 400); assert.equal(p2.data.more, false);
  });
} finally { await w.dispose(); }
console.log(`\n${n} worker test groups passed`);
