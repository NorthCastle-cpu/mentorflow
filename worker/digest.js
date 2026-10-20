// 9pm digest: one email with one .ics holding every lesson added or changed since the last digest.
// Cron runs at 20:00 and 21:00 UTC; we only send on the run where it is 21:00 in Europe/London (BST or GMT).
import { buildIcs } from '../src/js/ics.js';
import { sortSessions } from '../src/js/constants.js';

export const DIGEST_TO = 'sarah_arissa@hotmail.co.uk';
export const DIGEST_FROM = 'mentorflow@saraharissa.com';
// A session synced late (e.g. edited offline) is still included if it was edited at most this long before the
// previous digest. Older records that are merely (re)uploaded – e.g. after a backup restore – are not re-sent.
export const LATE_SYNC_GRACE_MS = 3 * 86400e3;

export function londonParts(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map(x => [x.type, x.value]));
  return { hour: +p.hour, date: `${p.year}-${p.month}-${p.day}` };
}

/** Send only at 21:00 London time and at most once per London date. */
export function digestDue(now, lastDigestDate) {
  const { hour, date } = londonParts(now);
  if (hour !== 21) return { due: false, reason: `not 21:00 in London (it is ${String(hour).padStart(2, '0')}:00)`, date };
  if (lastDigestDate === date) return { due: false, reason: 'already sent today', date };
  return { due: true, date };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDate = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, d)); return `${DAYS[dt.getUTCDay()]} ${d} ${MONTHS[m - 1]}`; };
const endTime = (start, dur) => { const [h, m] = String(start || '0:0').split(':').map(Number); const t = h * 60 + (m || 0) + (+dur || 60); return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const toBase64 = (text) => { const b = new TextEncoder().encode(text); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };

/**
 * Pure: build the digest email for the given sessions (already filtered to "new since last digest").
 * Returns null when there is nothing to send.
 */
export function buildDigest({ sessions, students, now = new Date(), londonDate = londonParts(now).date }) {
  if (!sessions?.length) return null;
  const byId = new Map((students || []).map(s => [s.id, s]));
  const studentById = (id) => byId.get(id);
  const list = [...sessions].sort(sortSessions);
  const ics = buildIcs(list, { studentById, alarm: false, now });
  const n = list.length; const filename = `mentorflow-${londonDate}.ics`;
  const lines = list.map(s => {
    const st = studentById(s.studentId);
    const cancelled = s.status === 'cancelled' || s.status === 'late_cancel';
    return `• ${niceDate(s.date)} ${s.start}–${endTime(s.start, s.duration)}  ${st?.name || 'Lesson'}${st?.subject ? ' – ' + st.subject : ''}${cancelled ? ' (cancelled)' : ''}`;
  });
  const text = [`Hi Sarah,`, '', `${n === 1 ? 'One lesson was' : n + ' lessons were'} added or changed in MentorFlow since the last email:`, '', ...lines, '',
    `Open the attached calendar file (${filename}) and tap “Add All” to put ${n === 1 ? 'it' : 'them'} in your calendar.`,
    'Lessons you have added before are updated, not duplicated.', '', '– MentorFlow'].join('\n');
  return {
    subject: `MentorFlow: ${n} lesson${n === 1 ? '' : 's'} to add to your calendar (${niceDate(londonDate)})`,
    text, ics, filename, count: n,
    attachment: { content: toBase64(ics), filename, type: 'text/calendar; method=PUBLISH', disposition: 'attachment' },
  };
}

async function getMeta(db, key) { const r = await db.prepare('SELECT value FROM meta WHERE key = ?1').bind(key).first(); return r ? r.value : null; }
const setMeta = (db, key, value) => db.prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(key, value);

/** Sessions added or changed since `sinceIso` (by sync time), excluding stale re-uploads. */
export async function sessionsSince(db, sinceIso) {
  const editedAfter = new Date(Date.parse(sinceIso) - LATE_SYNC_GRACE_MS).toISOString();
  const { results: s = [] } = await db.prepare("SELECT data FROM records WHERE store = 'sessions' AND deleted = 0 AND synced_at > ?1 AND updated_at > ?2").bind(sinceIso, editedAfter).all();
  const { results: st = [] } = await db.prepare("SELECT data FROM records WHERE store = 'students' AND deleted = 0").all();
  return { sessions: s.map(r => JSON.parse(r.data)), students: st.map(r => JSON.parse(r.data)) };
}

/**
 * Run from the cron trigger. Never sends twice for one London date. With DIGEST_ENABLED != "true" (or no
 * send_email binding) it builds the digest, logs what it would send, and advances the markers so that switching
 * it on later does not dump a backlog.
 */
export async function runDigest(env, now = new Date(), { force = false } = {}) {
  const db = env.DB;
  const lastDate = await getMeta(db, 'lastDigestDate');
  const due = digestDue(now, lastDate);
  if (!due.due && !force) return { sent: false, reason: due.reason };
  const lastAt = (await getMeta(db, 'lastDigestAt')) || new Date(now.getTime() - 86400e3).toISOString();
  const { sessions, students } = await sessionsSince(db, lastAt);
  const digest = buildDigest({ sessions, students, now, londonDate: due.date });
  const mark = () => db.batch([setMeta(db, 'lastDigestDate', due.date), setMeta(db, 'lastDigestAt', now.toISOString())]);
  if (!digest) { await mark(); return { sent: false, reason: 'nothing new' }; }
  const enabled = env.DIGEST_ENABLED === 'true' && env.DIGEST && typeof env.DIGEST.send === 'function';
  if (!enabled) {
    console.log(`Digest disabled (DIGEST_ENABLED=${env.DIGEST_ENABLED}, binding ${env.DIGEST ? 'present' : 'missing'}): would have sent ${digest.count} lesson(s).`);
    await mark();
    return { sent: false, reason: 'disabled', count: digest.count };
  }
  const res = await env.DIGEST.send({
    to: env.DIGEST_TO || DIGEST_TO, from: { email: env.DIGEST_FROM || DIGEST_FROM, name: 'MentorFlow' },
    subject: digest.subject, text: digest.text, attachments: [digest.attachment],
  });
  await mark();
  return { sent: true, count: digest.count, messageId: res?.messageId };
}
