// /api/changes: newest-updatedAt-wins sync between devices and D1.
export const STORES = new Set(['students', 'sessions', 'tasks', 'expenses', 'meta', 'settings']);
// Never stored on the server, even if a client sends them.
export const LOCAL_ONLY = { settings: new Set(['notionToken', 'syncProvider']), meta: new Set(['settings']) };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
export const MAX_BATCH = 500, MAX_RECORD_BYTES = 100_000, MAX_BODY_BYTES = 2_000_000, PAGE = 500;

export class ApiError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

export function validateChange(c) {
  if (!c || typeof c !== 'object') throw new ApiError('Bad change');
  if (!STORES.has(c.store)) throw new ApiError(`Unknown store: ${String(c.store).slice(0, 40)}`);
  if (typeof c.id !== 'string' || !c.id || c.id.length > 200) throw new ApiError('Bad id');
  if (typeof c.updatedAt !== 'string' || !ISO.test(c.updatedAt)) throw new ApiError('Bad updatedAt');
  if (!c.data || typeof c.data !== 'object' || Array.isArray(c.data)) throw new ApiError('Bad data');
  const data = JSON.stringify(c.data);
  if (data.length > MAX_RECORD_BYTES) throw new ApiError('Record too large', 413);
  return { store: c.store, id: c.id, data, updatedAt: c.updatedAt, deleted: c.deleted ? 1 : 0 };
}

const UPSERT = `INSERT INTO records (store, id, data, updated_at, deleted, seq, synced_at)
  VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COALESCE(MAX(seq), 0) + 1 FROM records), ?6)
  ON CONFLICT (store, id) DO UPDATE SET
    data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted,
    seq = excluded.seq, synced_at = excluded.synced_at
  WHERE excluded.updated_at > records.updated_at`;

export const rowToWire = (r) => ({ store: r.store, id: r.id, data: JSON.parse(r.data), updatedAt: r.updated_at, deleted: !!r.deleted, seq: r.seq });

/** Apply a batch. Returns {applied, stale}: stale = server copies that are strictly newer than what was sent. */
export async function pushChanges(db, changes, now = new Date()) {
  if (!Array.isArray(changes)) throw new ApiError('changes must be an array');
  if (changes.length > MAX_BATCH) throw new ApiError(`At most ${MAX_BATCH} changes per request`, 413);
  const clean = changes.map(validateChange).filter(c => !LOCAL_ONLY[c.store]?.has(c.id));
  if (!clean.length) return { applied: 0, stale: [] };
  const syncedAt = now.toISOString();
  const results = await db.batch(clean.map(c => db.prepare(UPSERT).bind(c.store, c.id, c.data, c.updatedAt, c.deleted, syncedAt)));
  const ignored = clean.filter((c, i) => !(results[i]?.meta?.changes > 0));
  let stale = [];
  if (ignored.length) {
    const rows = await db.batch(ignored.map(c => db.prepare('SELECT store, id, data, updated_at, deleted, seq FROM records WHERE store = ?1 AND id = ?2').bind(c.store, c.id)));
    stale = rows.flatMap((r, i) => (r.results || []).filter(row => row.updated_at > ignored[i].updatedAt)).map(rowToWire);
  }
  return { applied: clean.length - ignored.length, stale };
}

export async function pullChanges(db, since = 0, limit = PAGE) {
  since = Math.max(0, Math.floor(+since || 0)); limit = Math.min(PAGE, Math.max(1, Math.floor(+limit || PAGE)));
  const { results = [] } = await db.prepare('SELECT store, id, data, updated_at, deleted, seq FROM records WHERE seq > ?1 ORDER BY seq LIMIT ?2').bind(since, limit + 1).all();
  const more = results.length > limit; const page = results.slice(0, limit);
  return { changes: page.map(rowToWire), cursor: page.length ? page[page.length - 1].seq : since, more };
}
