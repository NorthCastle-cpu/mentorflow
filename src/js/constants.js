// Pure constants/helpers shared by the app (browser) and the Cloudflare Worker (digest).
// Keep this file free of DOM / IndexedDB access.
export const INVOICE_METHODS = {
  guidewell: { key: 'guidewell', label: 'Guidewell', short: 'GW', desc: 'Agency · monthly PDF invoice', color: '#0d9488' },
  luba:      { key: 'luba', label: 'Luba Jones', short: 'LJ', desc: 'Agency · monthly hours CSV', color: '#7c3aed' },
  direct:    { key: 'direct', label: 'Direct (parent)', short: 'D', desc: 'Email parent with bank details', color: '#ea580c' },
};
export const sortSessions = (a, b) => (a.date + a.start).localeCompare(b.date + b.start);
