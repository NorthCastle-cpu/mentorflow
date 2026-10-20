// Small UI pieces for Cloudflare sync: the "Sign in to sync" banner (Today) and the Sync card status (More).
import { syncState } from './sync.js';
import { esc } from './util.js';
import { icon } from './ui.js';

const when = (iso) => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

export function syncBannerHtml() {
  if (syncState.mode !== 'cloudflare' || syncState.status !== 'needs-login') return '<div data-sync-banner hidden></div>';
  return `<div class="banner warn" data-sync-banner data-testid="sync-login-banner">${icon('cloud')}<div><b>Sign in to sync</b><small>Your lessons are safe on this device. Sign in to copy them to your private MentorFlow cloud.</small></div><button class="btn small primary" data-action="sync-login">Sign in to sync</button></div>`;
}

export function syncStatusHtml() {
  const S = syncState;
  if (S.mode !== 'cloudflare') return `<div data-sync-status><p class="muted small">This copy of MentorFlow keeps data on this device only. Use JSON backup to move data between devices.</p></div>`;
  const line = {
    'needs-login': '<b class="overdue">Not signed in.</b> Changes are kept on this device until you sign in.',
    syncing: 'Syncing…',
    offline: 'Offline – changes will sync when you are back online.',
    error: `Sync problem: ${esc(S.message)}`,
    ok: `Synced${S.lastSyncAt ? ' · ' + esc(when(S.lastSyncAt)) : ''}.`,
    idle: S.lastSyncAt ? `Last synced ${esc(when(S.lastSyncAt))}.` : 'Not synced yet.',
  }[S.status] || '';
  return `<div data-sync-status data-testid="sync-status"><p class="small">${icon('cloud')} ${line}</p>
    <p class="muted small">Everything (students, lessons, tasks, money, expenses and settings) is copied to your own private Cloudflare database. Only your Notion token stays on this device.</p>
    <div class="btn-row">${S.status === 'needs-login' ? '<button class="btn primary" data-action="sync-login" data-testid="sync-login">Sign in to sync</button>' : ''}<button class="btn" data-action="sync-now" data-testid="sync-now" ${S.status === 'syncing' ? 'disabled' : ''}>Sync now</button></div></div>`;
}

/** Refresh just the sync bits of the page (avoids a full re-render while Sarah is typing). */
export function updateSyncDom() {
  document.querySelectorAll('[data-sync-banner]').forEach(el => { el.outerHTML = syncBannerHtml(); });
  document.querySelectorAll('[data-sync-status]').forEach(el => { el.outerHTML = syncStatusHtml(); });
}
