// Sync provider abstraction. MentorFlow is local-first: IndexedDB on the device is the source of truth and
// a provider pushes/pulls changes. CloudflareProvider syncs with the MentorFlow Worker (/api/changes → D1).
//
// Wire format (both directions): { store, id, data, updatedAt, deleted }
//  * stores: students, sessions, tasks, expenses, meta (checklists), settings (one record per setting field)
//  * newest updatedAt wins per record; deletes travel as tombstones ({id, deletedAt, updatedAt}, deleted: true)
//  * the Notion token setting never leaves the device.

export const SYNC_STORES = ['students', 'sessions', 'tasks', 'expenses', 'meta', 'settings'];
// notionToken: a secret that must never leave the device. syncProvider: a per-device choice (turning sync off on one
// device must not turn it off everywhere).
export const LOCAL_ONLY_SETTINGS = new Set(['notionToken', 'syncProvider']);
const SETTINGS_INTERNAL = new Set(['id', 'updatedAt', '_fieldTimes']);
const EPOCH = '1970-01-01T00:00:00.000Z';

/** @interface */
export class SyncProvider {
  get id() { return 'base'; }
  get label() { return 'Base'; }
  get available() { return false; }
  /** @returns {Promise<{ok:boolean,message:string}>} */
  async testConnection() { throw new Error('not implemented'); }
  /** Push changes. @param {Array} changes wire records @returns {Promise<{applied:number, stale:Array}>} */
  async push(changes) { throw new Error('not implemented'); }
  /** Pull remote changes after a cursor. @returns {Promise<{changes:Array, cursor:number, more:boolean}|null>} */
  async pull(since) { throw new Error('not implemented'); }
}

export class LocalOnlyProvider extends SyncProvider {
  get id() { return 'local'; }
  get label() { return 'This device only'; }
  get available() { return true; }
  async testConnection() { return { ok: true, message: 'Data is stored on this device (IndexedDB). Use JSON backup to move it.' }; }
  async push() { return { applied: 0, stale: [] }; }
  async pull() { return null; }
}

export class NeedsLoginError extends Error {
  constructor() { super('Please sign in to sync.'); this.name = 'NeedsLoginError'; }
}

/**
 * Cloudflare sync: same-origin calls to the MentorFlow Worker, which sits behind Cloudflare Access.
 * When the Access session has expired, Access answers with a redirect to its login page. We use
 * redirect:'manual' so that shows up as an "opaqueredirect" response instead of a confusing CORS failure,
 * and report it as NeedsLoginError so the app can show a clear "Sign in to sync" button.
 */
export class CloudflareProvider extends SyncProvider {
  constructor({ base = './api/', fetchImpl } = {}) { super(); this.base = base; this.fetch = fetchImpl || ((...a) => fetch(...a)); }
  get id() { return 'cloudflare'; }
  get label() { return 'Cloudflare (private sync)'; }
  get available() { return true; }
  get loginUrl() { return this.base + 'login'; }
  async request(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await this.fetch(this.base + path, {
        method, redirect: 'manual', credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), 'X-MentorFlow': '1' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { const err = new Error('You seem to be offline.'); err.offline = true; throw err; }
    if (res.type === 'opaqueredirect' || res.status === 0 || (res.status >= 300 && res.status < 400) || res.status === 401 || res.status === 403) throw new NeedsLoginError();
    const ct = res.headers.get('Content-Type') || '';
    if (!ct.includes('application/json')) { if (res.ok) throw new NeedsLoginError(); throw new Error(`Sync server error (${res.status})`); }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Sync server error (${res.status})`);
    return data;
  }
  async testConnection() {
    try { const s = await this.request('session'); return { ok: true, message: `Signed in as ${s.email}` }; }
    catch (e) { return { ok: false, needsLogin: e instanceof NeedsLoginError, message: e.message }; }
  }
  push(changes) { return this.request('changes', { method: 'POST', body: { changes } }); }
  pull(since = 0) { return this.request(`changes?since=${encodeURIComponent(since)}`); }
}

/**
 * Notion sync — STUB. Notion's API does not allow browser CORS requests, so a relay would be required.
 */
export class NotionProvider extends SyncProvider {
  constructor({ token = '', databaseId = '', relayUrl = '' } = {}) { super(); Object.assign(this, { token, databaseId, relayUrl }); }
  get id() { return 'notion'; }
  get label() { return 'Notion (coming soon)'; }
  get available() { return false; }
  async testConnection() { return { ok: false, message: 'Notion sync is not available yet. Your data stays on this device.' }; }
  async push() { throw new Error('Notion sync not implemented yet'); }
  async pull() { throw new Error('Notion sync not implemented yet'); }
}

export const PROVIDERS = { cloudflare: CloudflareProvider, off: LocalOnlyProvider, notion: NotionProvider };

/**
 * Which provider to use. `serverPresent` = the app is served by the MentorFlow Worker (detected at runtime).
 * 'off' = user chose "this device only". Legacy 'local' (and anything else) = automatic.
 */
export function getProvider(settings, { serverPresent = false } = {}) {
  if (settings?.syncProvider === 'notion') return new NotionProvider({ token: settings.notionToken, databaseId: settings.notionDatabaseId });
  if (settings?.syncProvider === 'off' || !serverPresent) return new LocalOnlyProvider();
  return new CloudflareProvider();
}

// ---------- pure merge helpers (unit-tested in tests/sync.test.mjs) ----------
export const recUpdatedAt = (r) => (r && (r.updatedAt || r.deletedAt || r.createdAt)) || EPOCH;
/** Newest-updatedAt-wins. Returns true if `incoming` should replace `local`. Ties keep the local copy. */
export const isNewer = (incoming, local) => !local || recUpdatedAt(incoming) > recUpdatedAt(local);

export function toWire(store, rec) {
  return { store, id: rec.id, data: rec, updatedAt: recUpdatedAt(rec), deleted: !!rec.deletedAt };
}
export function fromWire(w) {
  if (w.deleted) return { id: w.id, deletedAt: w.data?.deletedAt || w.updatedAt, updatedAt: w.updatedAt };
  return { ...w.data, id: w.id };
}

/** Explode the settings object into one wire record per edited field (excluding device-only fields). */
export function settingsToWire(settings) {
  const times = settings?._fieldTimes || {};
  return Object.keys(times).filter(k => !LOCAL_ONLY_SETTINGS.has(k) && !SETTINGS_INTERNAL.has(k))
    .map(k => ({ store: 'settings', id: k, data: { value: settings[k] === undefined ? null : settings[k] }, updatedAt: times[k], deleted: false }));
}

/** Merge per-field settings records into the local settings object. Returns {settings, changed}. */
export function mergeSettings(local, wires) {
  const s = { ...(local || {}), id: 'settings' }; const times = { ...(s._fieldTimes || {}) }; let changed = 0;
  for (const w of wires) {
    if (LOCAL_ONLY_SETTINGS.has(w.id) || SETTINGS_INTERNAL.has(w.id) || w.deleted) continue;
    if (times[w.id] && w.updatedAt <= times[w.id]) continue;
    s[w.id] = w.data?.value; times[w.id] = w.updatedAt; changed++;
  }
  s._fieldTimes = times;
  return { settings: s, changed };
}

// ---------- sync engine ----------
const CURSOR_KEY = 'mentorflow-sync-cursor';
const LAST_KEY = 'mentorflow-sync-last';
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };
export const resetSyncCursor = () => { ls.del(CURSOR_KEY); };

/** Apply incoming wire records to IndexedDB (newest wins). Returns number of records changed. */
export async function applyIncoming(db, wires) {
  let changed = 0;
  const byStore = new Map();
  for (const w of wires) { if (!SYNC_STORES.includes(w.store) || !w.id) continue; (byStore.get(w.store) || byStore.set(w.store, []).get(w.store)).push(w); }
  for (const [store, list] of byStore) {
    if (store === 'settings') {
      const local = await db.get('meta', 'settings');
      const { settings, changed: c } = mergeSettings(local, list);
      if (c) { await db.applyRemote('meta', [settings]); changed += c; }
      continue;
    }
    const out = [];
    for (const w of list) {
      if (store === 'meta' && w.id === 'settings') continue; // settings only travel field-by-field
      const incoming = fromWire(w); const local = await db.get(store, w.id);
      if (isNewer(incoming, local)) out.push(incoming);
    }
    if (out.length) { await db.applyRemote(store, out); changed += out.length; }
  }
  return changed;
}

/** Build the push payload from the outbox. */
export async function collectOutbox(db) {
  const entries = await db.getOutbox(); const changes = [];
  for (const e of entries) {
    if (e.store === 'meta' && e.id === 'settings') { changes.push(...settingsToWire(await db.get('meta', 'settings'))); continue; }
    const rec = await db.get(e.store, e.id);
    if (rec) changes.push(toWire(e.store, rec));
  }
  return { entries, changes };
}

/**
 * One full sync: push the outbox (in chunks), adopt any server copies that were newer, then pull
 * everything changed since our cursor. Returns {pushed, pulled, changed}.
 */
export async function syncOnce(db, provider, { chunk = 200, storage = ls } = {}) {
  const { entries, changes } = await collectOutbox(db);
  let pushed = 0, changed = 0;
  for (let i = 0; i < changes.length; i += chunk) {
    const r = await provider.push(changes.slice(i, i + chunk));
    pushed += r.applied || 0;
    if (r.stale?.length) changed += await applyIncoming(db, r.stale);
  }
  await db.clearOutbox(entries);
  let since = +(storage.get(CURSOR_KEY) || 0), pulled = 0, more = true, guard = 0;
  while (more && guard++ < 50) {
    const r = await provider.pull(since);
    if (!r) break;
    changed += await applyIncoming(db, r.changes || []);
    pulled += (r.changes || []).length;
    since = r.cursor ?? since; more = !!r.more;
    storage.set(CURSOR_KEY, String(since));
  }
  storage.set(LAST_KEY, new Date().toISOString());
  return { pushed, pulled, changed };
}

// ---------- status for the UI ----------
export const syncState = { mode: 'local', status: 'idle', message: '', lastSyncAt: ls.get(LAST_KEY) || '' };
const listeners = new Set();
export const onSyncState = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function setSyncState(patch) { Object.assign(syncState, patch); listeners.forEach(fn => { try { fn(syncState); } catch (e) { console.error(e); } }); }

/**
 * Is this copy of the app served by the MentorFlow Worker? (GitHub Pages / a static server answer 404.)
 * Any /api answer from Access (redirect) or the Worker (401/403/JSON) means yes.
 */
export async function detectServer(fetchImpl = fetch, base = './api/') {
  try {
    const r = await fetchImpl(base + 'session', { redirect: 'manual', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (r.type === 'opaqueredirect' || r.status === 0 || r.status === 401 || r.status === 403 || (r.status >= 300 && r.status < 400)) return { present: true, signedIn: false };
    if (r.ok && (r.headers.get('Content-Type') || '').includes('application/json')) { const j = await r.json(); return { present: j.app === 'mentorflow', signedIn: j.app === 'mentorflow', email: j.email }; }
  } catch {}
  return { present: false, signedIn: false };
}
