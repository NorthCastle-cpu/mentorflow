// Unit tests for .ics generation + export ranges. Run: node tests/calendar.test.mjs
// Validates output with ical.js (npm) and, if available, python icalendar (tests/validate_ics.py).
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ICAL from 'ical.js';
import * as db from '../src/js/db.js';
const origWarn = console.warn; console.warn = () => {}; await db.getAll('students'); console.warn = origWarn; // in-memory storage in Node
const store = await import('../src/js/store.js');
const cal = await import('../src/js/calendar.js');
const { state } = store;
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('✓', name); };
const iso = (daysAgo, h = 12) => { const d = new Date(); d.setHours(h, 0, 0, 0); d.setDate(d.getDate() - daysAgo); return d.toISOString(); };

const A = store.saveStudent({ name: 'Sample Student A', subject: 'GCSE Maths', invoiceMethod: 'guidewell', rate: 38, label: 'Student A', active: true });
const B = store.saveStudent({ name: 'Sample Student B', subject: 'English; essays, poetry', invoiceMethod: 'direct', rate: 50, location: 'Online', active: true });
const mk = (o) => { const s = store.saveSession({ duration: 60, status: 'scheduled', ...o }); return s; };
const s1 = mk({ studentId: A.id, date: '2026-07-14', start: '16:00', notes: 'Bring calculator, ruler; past paper 2' }); // BST
const s2 = mk({ studentId: B.id, date: '2026-12-01', start: '17:30', duration: 90 }); // GMT
const s3 = mk({ studentId: A.id, date: '2026-10-21', start: '10:00', status: 'cancelled' });

await t('sequence starts at 0 and increments on every edit', () => {
  assert.equal(s1.sequence, 0);
  const e1 = store.saveSession({ ...s1, notes: s1.notes + ' (edited)' }); assert.equal(e1.sequence, 1);
  const e2 = store.saveSession({ ...e1, start: '16:15' }); assert.equal(e2.sequence, 2);
  assert.ok(e2.createdAt && e2.updatedAt && e2.createdAt <= e2.updatedAt);
});

await t('migration fills createdAt/updatedAt/sequence on legacy records', () => {
  const legacy = [{ id: 'old1', studentId: A.id, date: '2026-01-05', start: '09:00', duration: 60, status: 'completed' }];
  assert.equal(store.migrateSessions(legacy), 1);
  assert.ok(legacy[0].createdAt && legacy[0].updatedAt === legacy[0].createdAt && legacy[0].sequence === 0);
});

let ics;
await t('ical.js parses the calendar and all fields are right', () => {
  ics = cal.buildIcs(state.sessions);
  const comp = new ICAL.Component(ICAL.parse(ics));
  assert.equal(comp.getFirstPropertyValue('version'), '2.0');
  const tz = comp.getFirstSubcomponent('vtimezone'); assert.equal(tz.getFirstPropertyValue('tzid'), 'Europe/London');
  ICAL.TimezoneService.register(tz);
  const evs = comp.getAllSubcomponents('vevent').map(v => new ICAL.Event(v));
  assert.equal(evs.length, 3);
  const e1 = evs.find(e => e.uid === `${s1.id}@mentorflow`);
  assert.equal(e1.summary, 'Sample Student A – GCSE Maths');
  assert.equal(e1.startDate.toString(), '2026-07-14T16:15:00'); assert.equal(e1.startDate.zone.tzid, 'Europe/London');
  assert.equal(e1.startDate.toJSDate().toISOString(), '2026-07-14T15:15:00.000Z'); // BST = UTC+1
  assert.equal(e1.endDate.toString(), '2026-07-14T17:15:00');
  assert.equal(e1.sequence, 2);
  assert.match(e1.description, /^Channel: Guidewell/); assert.match(e1.description, /Bring calculator, ruler; past paper 2/);
  assert.equal(e1.location, null);
  assert.equal(e1.component.getFirstProperty('categories'), null, 'old TimeTree label is ignored');
  assert.equal(e1.summary, 'Sample Student A – GCSE Maths');
  const e2 = evs.find(e => e.uid === `${s2.id}@mentorflow`);
  assert.equal(e2.summary, 'Sample Student B – English; essays, poetry'); // escaping round-trips
  assert.equal(e2.startDate.toJSDate().toISOString(), '2026-12-01T17:30:00.000Z'); // GMT
  assert.equal(e2.duration.toSeconds(), 5400); assert.equal(e2.location, 'Online');
  assert.equal(e2.component.getFirstProperty('categories'), null);
  const e3 = evs.find(e => e.uid === `${s3.id}@mentorflow`);
  assert.equal(e3.component.getFirstPropertyValue('status'), 'CANCELLED');
  assert.ok(!/£|38|50\.00|rate/i.test(ics.replace(/UID:.*|DTSTAMP:.*|CREATED:.*|LAST-MODIFIED:.*|DTSTART.*|DTEND.*/g, '')), 'no money in export');
});

await t('reminders: off by default, 30-minute VALARM when enabled, never on cancelled', () => {
  assert.equal(state.settings.calendarAlarm, false);
  assert.ok(!ics.includes('BEGIN:VALARM'));
  store.saveSettings({ calendarAlarm: true });
  const withAlarm = cal.buildIcs(state.sessions);
  assert.equal((withAlarm.match(/BEGIN:VALARM/g) || []).length, 2);
  assert.ok(withAlarm.includes('TRIGGER:-PT30M'));
  store.saveSettings({ calendarAlarm: false });
});

await t('RFC 5545 line folding (≤75 octets, UTF-8 safe) and CRLF', () => {
  const long = store.saveSession({ ...state.sessions.find(s => s.id === s2.id), notes: 'Résumé – ' + 'très long commentaire ✓ '.repeat(12) });
  const out = cal.buildIcs([long]);
  for (const line of out.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, 'too long: ' + line);
  assert.ok(!/[^\r]\n/.test(out));
  const ev = new ICAL.Event(new ICAL.Component(ICAL.parse(out)).getFirstSubcomponent('vevent'));
  assert.ok(ev.description.includes('très long commentaire ✓ très'));
});

await t('python icalendar validates the file', () => {
  writeFileSync('/tmp/mf-unit.ics', cal.buildIcs(state.sessions));
  try {
    const out = JSON.parse(execFileSync('python3', [new URL('./validate_ics.py', import.meta.url).pathname, '/tmp/mf-unit.ics', '3']).toString());
    assert.deepEqual(out.problems, []);
    assert.equal(out.events.find(e => e.uid === `${s1.id}@mentorflow`).utcoffset, '1:00:00');
  } catch (e) { if (/No module named/.test(String(e.stderr || e.message))) console.log('  (python icalendar not installed – skipped)'); else throw e; }
});

await t('export ranges: today / 3 days / 7 days / all / since last export', () => {
  const set = (s, created, updated = created) => { const x = state.sessions.find(y => y.id === s.id); x.createdAt = created; x.updatedAt = updated; };
  set(s1, iso(10), iso(0));        // created long ago, changed today
  set(s2, iso(2));                  // created 2 days ago
  set(s3, iso(5));                  // created 5 days ago
  state.sessions = state.sessions.filter(s => [s1.id, s2.id, s3.id].includes(s.id));
  const ids = (r) => cal.sessionsForRange(r).map(s => s.id).sort();
  assert.deepEqual(ids('today'), [s1.id]);
  assert.deepEqual(ids('3d'), [s1.id, s2.id].sort());
  assert.deepEqual(ids('7d'), [s1.id, s2.id, s3.id].sort());
  assert.deepEqual(ids('all'), [s1.id, s2.id, s3.id].sort());
  store.saveSettings({ lastCalendarExportAt: iso(3) });
  assert.equal(cal.lastExportBeforeToday(), true);
  assert.deepEqual(cal.sessionsSinceLastExport().map(s => s.id).sort(), [s1.id, s2.id].sort());
});

await t('marking exported sets the badge without bumping version; edits clear it', () => {
  const before = state.sessions.find(s => s.id === s2.id); const seq = before.sequence; const upd = before.updatedAt;
  store.markCalendarExported([s2.id]);
  const after = state.sessions.find(s => s.id === s2.id);
  assert.equal(after.sequence, seq); assert.equal(after.updatedAt, upd);
  assert.equal(store.isCalendarExported(after), true);
  assert.equal(cal.lastExportBeforeToday(), false);
  const edited = store.saveSession({ ...after, notes: 'moved' });
  assert.equal(store.isCalendarExported(edited), false);
  assert.equal(edited.sequence, seq + 1);
});

console.log(`\n${n} calendar test groups passed`);
