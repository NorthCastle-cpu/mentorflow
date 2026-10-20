// Sync provider abstraction. MentorFlow is local-first: IndexedDB is the source of truth and
// a provider may optionally push/pull changes. Only the local provider is functional today.

/** @interface */
export class SyncProvider {
  get id() { return 'base'; }
  get label() { return 'Base'; }
  get available() { return false; }
  /** @returns {Promise<{ok:boolean,message:string}>} */
  async testConnection() { throw new Error('not implemented'); }
  /** Push local snapshot. @param {object} snapshot result of exportBackup() */
  async push(snapshot) { throw new Error('not implemented'); }
  /** Pull remote changes. @returns {Promise<object|null>} snapshot-shaped object */
  async pull() { throw new Error('not implemented'); }
}

export class LocalOnlyProvider extends SyncProvider {
  get id() { return 'local'; }
  get label() { return 'This device only'; }
  get available() { return true; }
  async testConnection() { return { ok: true, message: 'Data is stored on this device (IndexedDB). Use JSON backup to move it.' }; }
  async push() { return { ok: true, pushed: 0 }; }
  async pull() { return null; }
}

/**
 * Notion sync — STUB. Planned mapping:
 *  students → Notion database "Students", sessions → "Sessions" (relation to Students),
 *  tasks → "Tasks", expenses → "Expenses". Conflict resolution: last-writer-wins on updatedAt.
 * Notion's API does not allow browser CORS requests, so a tiny relay (e.g. a Cloudflare Worker)
 * will be required; `relayUrl` is reserved for that.
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

export const PROVIDERS = { local: LocalOnlyProvider, notion: NotionProvider };
export function getProvider(settings) {
  if (settings?.syncProvider === 'notion') return new NotionProvider({ token: settings.notionToken, databaseId: settings.notionDatabaseId });
  return new LocalOnlyProvider();
}
