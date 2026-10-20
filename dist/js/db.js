// IndexedDB persistence layer. All app data lives locally on the device.
const DB_NAME = 'mentorflow';
const DB_VERSION = 1;
export const STORES = ['students', 'sessions', 'tasks', 'expenses', 'meta'];

let dbp = null;
let memoryFallback = null; // used if IndexedDB is unavailable

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

export async function getAll(store) {
  if (memoryFallback) return Object.values(memoryFallback[store]);
  try {
    return await open().then(db => new Promise((resolve, reject) => {
      const r = db.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  } catch (e) {
    console.warn('Falling back to in-memory storage:', e);
    memoryFallback = Object.fromEntries(STORES.map(s => [s, {}]));
    return [];
  }
}

export function put(store, value) {
  if (memoryFallback) { memoryFallback[store][value.id] = value; return Promise.resolve(); }
  return tx([store], 'readwrite', t => { t.objectStore(store).put(value); });
}

export function putMany(store, values) {
  if (memoryFallback) { values.forEach(v => memoryFallback[store][v.id] = v); return Promise.resolve(); }
  return tx([store], 'readwrite', t => { const os = t.objectStore(store); values.forEach(v => os.put(v)); });
}

export function del(store, id) {
  if (memoryFallback) { delete memoryFallback[store][id]; return Promise.resolve(); }
  return tx([store], 'readwrite', t => { t.objectStore(store).delete(id); });
}

export function clearAll() {
  if (memoryFallback) { STORES.forEach(s => memoryFallback[s] = {}); return Promise.resolve(); }
  return tx(STORES, 'readwrite', t => { STORES.forEach(s => t.objectStore(s).clear()); });
}

export function isPersistentStorage() { return !memoryFallback; }

// Ask the browser not to evict our data (Safari honours this for Home Screen apps).
export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch {}
  return false;
}
