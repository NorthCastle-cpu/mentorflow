// IndexedDB persistence layer. All app data lives locally on the device (source of truth).
// Sync support (Cloudflare D1):
//  * deletes write a tombstone {id, deletedAt, updatedAt} instead of erasing, so deletions can sync;
//  * every local write also records "store/id" in the `outbox` store, so the sync engine knows what to push;
//  * writes that come FROM the server use applyRemote(), which does not touch the outbox.
const DB_NAME = 'mentorflow';
const DB_VERSION = 2; // v2: outbox store for sync
export const STORES = ['students', 'sessions', 'tasks', 'expenses', 'meta'];
const OUTBOX = 'outbox';
const ALL = [...STORES, OUTBOX];

let dbp = null;
let memoryFallback = null; // used if IndexedDB is unavailable
const writeListeners = new Set();
/** Called after every LOCAL write (not for remote applies). Used to schedule a sync. */
export const onLocalWrite = (fn) => { writeListeners.add(fn); return () => writeListeners.delete(fn); };
const notify = () => writeListeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });

export const isTombstone = (v) => !!(v && v.deletedAt);
export const tombstone = (id, at = new Date().toISOString()) => ({ id, deletedAt: at, updatedAt: at });
const okey = (store, id) => `${store}/${id}`;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  return dbp;
}

function tx(storeNames, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    result = fn(t);
  }));
}

function ensureFallback(e) {
  if (!memoryFallback) {
    console.warn('Falling back to in-memory storage:', e);
    memoryFallback = Object.fromEntries(ALL.map(s => [s, {}]));
  }
}

/** All live records (tombstones excluded). */
export async function getAll(store) {
  return (await getAllRaw(store)).filter(v => !isTombstone(v));
}

/** All records including tombstones (for sync). */
export async function getAllRaw(store) {
  if (memoryFallback) return Object.values(memoryFallback[store]);
  try {
    return await open().then(db => new Promise((resolve, reject) => {
      const r = db.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  } catch (e) {
    ensureFallback(e);
    return [];
  }
}

export async function get(store, id) {
  if (memoryFallback) return memoryFallback[store][id];
  return open().then(db => new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

function writeLocal(store, values) {
  const at = new Date().toISOString();
  if (memoryFallback) {
    values.forEach(v => { memoryFallback[store][v.id] = v; memoryFallback[OUTBOX][okey(store, v.id)] = { key: okey(store, v.id), store, id: v.id, at }; });
    notify(); return Promise.resolve();
  }
  return tx([store, OUTBOX], 'readwrite', t => {
    const os = t.objectStore(store); const ob = t.objectStore(OUTBOX);
    values.forEach(v => { os.put(v); ob.put({ key: okey(store, v.id), store, id: v.id, at }); });
  }).then(() => notify());
}

export const put = (store, value) => writeLocal(store, [value]);
export const putMany = (store, values) => values.length ? writeLocal(store, values) : Promise.resolve();

/** Delete = write a tombstone so the deletion can sync to other devices. */
export function del(store, id) { return writeLocal(store, [tombstone(id)]); }

/** Apply records that came from the server (no outbox entry, no write notification). */
export function applyRemote(store, values) {
  if (!values.length) return Promise.resolve();
  if (memoryFallback) { values.forEach(v => memoryFallback[store][v.id] = v); return Promise.resolve(); }
  return tx([store], 'readwrite', t => { const os = t.objectStore(store); values.forEach(v => os.put(v)); });
}

export async function getOutbox() {
  if (memoryFallback) return Object.values(memoryFallback[OUTBOX]);
  return open().then(db => new Promise((resolve, reject) => {
    const r = db.transaction(OUTBOX).objectStore(OUTBOX).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  }));
}

/** Remove outbox entries that were pushed, unless they were written again after `at` was captured. */
export function clearOutbox(entries) {
  if (!entries.length) return Promise.resolve();
  if (memoryFallback) { entries.forEach(e => { const cur = memoryFallback[OUTBOX][e.key]; if (cur && cur.at === e.at) delete memoryFallback[OUTBOX][e.key]; }); return Promise.resolve(); }
  return tx([OUTBOX], 'readwrite', t => {
    const ob = t.objectStore(OUTBOX);
    entries.forEach(e => { const r = ob.get(e.key); r.onsuccess = () => { if (r.result && r.result.at === e.at) ob.delete(e.key); }; });
  });
}

/** Erase everything on this device (data + outbox). Synced copies on the server are not touched. */
export function clearAll() {
  try { localStorage.removeItem('mentorflow-sync-cursor'); } catch {} // next sync starts with a full pull
  if (memoryFallback) { ALL.forEach(s => memoryFallback[s] = {}); return Promise.resolve(); }
  return tx(ALL, 'readwrite', t => { ALL.forEach(s => t.objectStore(s).clear()); });
}

export function isPersistentStorage() { return !memoryFallback; }

// Ask the browser not to evict our data (Safari honours this for Home Screen apps).
export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch {}
  return false;
}
