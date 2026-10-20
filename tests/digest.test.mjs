// 9pm digest tests: London-time gating (BST/GMT), once-per-day, "since last digest", .ics content, enable flag.
// Run: node tests/digest.test.mjs
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import { londonParts, digestDue, buildDigest, runDigest, DIGEST_TO, DIGEST_FROM } from '../worker/digest.js';
import { startWorker } from './helpers/worker-env.mjs';

let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('✓', name); };
const quietLog = async (fn) => { const l = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = l; } };

await t('cron 20:00 UTC sends in summer (BST), 21:00 UTC sends in winter (GMT)', () => {
  assert.equal(digestDue(new Date('2026-07-14T20:00:00Z'), null).due, true);   // 21:00 BST
  assert.equal(digestDue(new Date('2026-07-14T21:00:00Z'), null).due, false);  // 22:00 BST
  assert.equal(digestDue(new Date('2026-12-01T20:00:00Z'), null).due, false);  // 20:00 GMT
  assert.equal(digestDue(new Date('2026-12-01T21:00:00Z'), null).due, true);   // 21:00 GMT
});
await t('clock-change days: last Sunday of March and October', () => {
  assert.deepEqual(londonParts(new Date('2026-03-29T20:00:00Z')), { hour: 21, date: '2026-03-29' }); // BST starts 29 Mar 2026
  assert.deepEqual(londonParts(new Date('2026-10-25T21:00:00Z')), { hour: 21, date: '2026-10-25' }); // GMT from 25 Oct 2026
  assert.equal(digestDue(new Date('2026-10-25T20:00:00Z'), null).due, false);
});
await t('never twice for one London date', () => {
  assert.equal(digestDue(new Date('2026-12-01T21:00:00Z'), '2026-12-01').due, false);
  assert.equal(digestDue(new Date('2026-12-02T21:00:00Z'), '2026-12-01').due, true);
});

const students = [{ id: 's1', name: 'Sample Student A', subject: 'GCSE Maths', invoiceMethod: 'guidewell', label: 'Student A', rate: 38 }];
const sess = (id, o = {}) => ({ id, studentId: 's1', date: '2026-12-02', start: '16:00', duration: 60, status: 'scheduled', sequence: 0, createdAt: '2026-12-01T10:00:00.000Z', updatedAt: '2026-12-01T10:00:00.000Z', ...o });

await t('buildDigest: nothing new → null (no email)', () => assert.equal(buildDigest({ sessions: [], students }), null));
await t('buildDigest: one .ics, METHOD:PUBLISH, Europe/London VTIMEZONE, UID/SEQUENCE, no VALARM, no money', () => {
  const d = buildDigest({ sessions: [sess('b', { date: '2026-12-03', sequence: 2 }), sess('a'), sess('c', { status: 'cancelled', date: '2026-07-14' })], students, now: new Date('2026-12-01T21:00:00Z') });
  assert.equal(d.count, 3); assert.equal(d.filename, 'mentorflow-2026-12-01.ics');
  assert.match(d.subject, /3 lessons/); assert.match(d.text, /Sample Student A – GCSE Maths/); assert.match(d.text, /\(cancelled\)/);
  assert.equal(d.attachment.type, 'text/calendar; method=PUBLISH'); assert.equal(d.attachment.disposition, 'attachment');
  assert.equal(Buffer.from(d.attachment.content, 'base64').toString('utf8'), d.ics);
  assert.ok(d.ics.includes('METHOD:PUBLISH')); assert.ok(!d.ics.includes('VALARM'));
  const comp = new ICAL.Component(ICAL.parse(d.ics));
  const tz = comp.getFirstSubcomponent('vtimezone'); assert.equal(tz.getFirstPropertyValue('tzid'), 'Europe/London'); ICAL.TimezoneService.register(tz);
  const evs = comp.getAllSubcomponents('vevent').map(v => new ICAL.Event(v));
  assert.deepEqual(evs.map(e => e.uid), ['c@mentorflow', 'a@mentorflow', 'b@mentorflow']); // sorted by date/time
  assert.equal(evs[2].sequence, 2);
  assert.equal(evs[1].startDate.toJSDate().toISOString(), '2026-12-02T16:00:00.000Z'); // GMT
  assert.equal(evs[0].startDate.toJSDate().toISOString(), '2026-07-14T15:00:00.000Z'); // BST
  assert.equal(evs[0].component.getFirstPropertyValue('status'), 'CANCELLED');
  assert.ok(!/£|38/.test(d.ics.replace(/^(UID|DTSTAMP|CREATED|LAST-MODIFIED|DTSTART|DTEND).*$/gm, '')) && !/£/.test(d.text), 'no money in the email');
});

// ---------- runDigest against D1 ----------
const w = await startWorker();
const put = (store, rec, syncedAt, deleted = 0) => w.db.prepare('INSERT OR REPLACE INTO records (store,id,data,updated_at,deleted,seq,synced_at) VALUES (?1,?2,?3,?4,?5,(SELECT COALESCE(MAX(seq),0)+1 FROM records),?6)').bind(store, rec.id, JSON.stringify(rec), rec.updatedAt, deleted, syncedAt).run();
const sent = []; const binding = { send: async (m) => { sent.push(m); return { messageId: 'test-' + sent.length }; } };
const env = (o = {}) => ({ DB: w.db, DIGEST: binding, DIGEST_ENABLED: 'true', ...o });
try {
  await put('students', { ...students[0], updatedAt: '2026-11-01T10:00:00.000Z' }, '2026-11-01T10:00:00.000Z');
  await w.db.prepare("INSERT INTO meta (key,value) VALUES ('lastDigestAt','2026-12-01T21:00:00.000Z'),('lastDigestDate','2026-12-01')").run();

  await t('not 21:00 London → nothing sent', async () => {
    const r = await runDigest(env(), new Date('2026-12-02T20:00:00Z')); assert.equal(r.sent, false); assert.equal(sent.length, 0);
  });
  await t('nothing new since last digest → no email, but the day is recorded', async () => {
    const r = await runDigest(env(), new Date('2026-12-02T21:00:00Z')); assert.equal(r.reason, 'nothing new'); assert.equal(sent.length, 0);
    assert.equal((await w.db.prepare("SELECT value FROM meta WHERE key='lastDigestDate'").first()).value, '2026-12-02');
  });
  await t('sends one email with sessions added/changed since the last digest (incl. late syncs), from/to the right addresses', async () => {
    await put('sessions', sess('new1', { updatedAt: '2026-12-03T09:00:00.000Z' }), '2026-12-03T09:00:05.000Z');            // added today
    await put('sessions', sess('late', { updatedAt: '2026-12-02T22:30:00.000Z' }), '2026-12-03T12:00:00.000Z');            // edited offline last night, synced today
    await put('sessions', sess('old', { updatedAt: '2026-12-02T10:00:00.000Z' }), '2026-12-02T10:00:01.000Z');             // already covered by the 2 Dec digest
    await put('sessions', sess('restored', { updatedAt: '2026-06-01T10:00:00.000Z' }), '2026-12-03T13:00:00.000Z');       // old record re-uploaded by a backup restore
    await put('sessions', { id: 'gone', deletedAt: '2026-12-03T10:00:00.000Z', updatedAt: '2026-12-03T10:00:00.000Z' }, '2026-12-03T10:00:01.000Z', 1); // deleted
    const r = await runDigest(env(), new Date('2026-12-03T21:00:00Z'));
    assert.equal(r.sent, true); assert.equal(r.count, 2); assert.equal(sent.length, 1);
    const m = sent[0]; assert.equal(m.to, DIGEST_TO); assert.equal(m.from.email, DIGEST_FROM); assert.equal(m.attachments.length, 1);
    const ics = Buffer.from(m.attachments[0].content, 'base64').toString();
    assert.ok(ics.includes('UID:new1@mentorflow') && ics.includes('UID:late@mentorflow'));
    assert.ok(!ics.includes('UID:old@') && !ics.includes('UID:restored@') && !ics.includes('UID:gone@'));
  });
  await t('second cron run the same evening does not send again', async () => {
    await put('sessions', sess('after', { updatedAt: '2026-12-03T21:30:00.000Z' }), '2026-12-03T21:30:01.000Z');
    const r = await runDigest(env(), new Date('2026-12-03T21:00:00Z')); assert.equal(r.sent, false); assert.equal(sent.length, 1);
  });
  await t('DIGEST_ENABLED=false (or no send_email binding): never sends, logs, and advances so no backlog later', async () => {
    const r = await quietLog(() => runDigest(env({ DIGEST_ENABLED: 'false' }), new Date('2026-12-04T21:00:00Z')));
    assert.deepEqual([r.sent, r.reason, r.count], [false, 'disabled', 1]); assert.equal(sent.length, 1);
    await put('sessions', sess('x2', { updatedAt: '2026-12-05T09:00:00.000Z' }), '2026-12-05T09:00:01.000Z');
    const r2 = await quietLog(() => runDigest({ DB: w.db, DIGEST_ENABLED: 'true' }, new Date('2026-12-05T21:00:00Z')));
    assert.equal(r2.reason, 'disabled'); assert.equal(sent.length, 1);
    await put('sessions', sess('x3', { updatedAt: '2026-12-06T09:00:00.000Z' }), '2026-12-06T09:00:01.000Z');
    const r3 = await runDigest(env(), new Date('2026-12-06T21:00:00Z'));
    assert.equal(r3.count, 1, 'after switching on, only lessons since the last (silent) digest');
  });
  await t('scheduled() handler runs the digest from the cron trigger', async () => {
    const res = await w.mf.getWorker().then(wk => wk.scheduled({ scheduledTime: new Date('2026-12-07T20:00:00Z'), cron: '0 20,21 * * *' }));
    assert.equal(res.outcome, 'ok');
  });
} finally { await w.dispose(); }
console.log(`\n${n} digest test groups passed`);
