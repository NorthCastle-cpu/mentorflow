-- MentorFlow sync store (Cloudflare D1).
-- records: one row per app record (store + id). `data` is the record JSON. Deletes are tombstones (deleted = 1).
--   updated_at = the client's edit time (newest wins); seq = server-assigned, strictly increasing change number
--   (pull cursor); synced_at = server time the row was last written (used by the 9pm digest).
CREATE TABLE IF NOT EXISTS records (
  store      TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  data       TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  seq        INTEGER NOT NULL DEFAULT 0,
  synced_at  TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (store, id)
);
CREATE INDEX IF NOT EXISTS records_updated_at ON records (updated_at);
CREATE INDEX IF NOT EXISTS records_seq ON records (seq);
CREATE INDEX IF NOT EXISTS records_store_synced ON records (store, synced_at);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
