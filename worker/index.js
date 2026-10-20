// MentorFlow Worker: serves the PWA (static assets in dist/) and the private sync API.
// /api/* always runs here first (run_worker_first) and every endpoint verifies the Cloudflare Access JWT itself,
// so even if the Access application were removed or misconfigured, no data could be read or written.
import { authenticate } from './auth.js';
import { pushChanges, pullChanges, ApiError, MAX_BODY_BYTES } from './api.js';
import { runDigest, sessionsSince, buildDigest, londonParts } from './digest.js';

const SECURITY = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (data, status = 200) => Response.json(data, { status, headers: SECURITY });

async function readJson(request) {
  const len = +(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY_BYTES) throw new ApiError('Request too large', 413);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new ApiError('Request too large', 413);
  try { return JSON.parse(text); } catch { throw new ApiError('Invalid JSON'); }
}

export async function handleApi(request, env) {
  const url = new URL(request.url);
  const auth = await authenticate(env, request);
  if (!auth.ok) return json({ error: auth.error, needLogin: auth.status === 401 }, auth.status);

  if (!['GET', 'HEAD'].includes(request.method)) {
    // Cross-site protection for writes.
    const origin = request.headers.get('Origin');
    if ((origin && origin !== url.origin) || request.headers.get('X-MentorFlow') !== '1') return json({ error: 'Request blocked.' }, 403);
  }
  const route = `${request.method} ${url.pathname.replace(/\/+$/, '')}`;
  try {
    switch (route) {
      case 'GET /api/session': return json({ app: 'mentorflow', email: auth.email });
      case 'GET /api/login': return new Response(null, { status: 302, headers: { ...SECURITY, Location: url.origin + '/#/more' } });
      case 'GET /api/changes': return json(await pullChanges(env.DB, url.searchParams.get('since'), url.searchParams.get('limit')));
      case 'POST /api/changes': { const body = await readJson(request); return json(await pushChanges(env.DB, body.changes)); }
      case 'GET /api/digest/preview': {
        // What tonight's email would contain (no email is sent, nothing is recorded).
        const lastAt = (await env.DB.prepare("SELECT value FROM meta WHERE key = 'lastDigestAt'").first())?.value || new Date(Date.now() - 86400e3).toISOString();
        const d = buildDigest({ ...(await sessionsSince(env.DB, lastAt)), now: new Date() });
        return json({ since: lastAt, enabled: env.DIGEST_ENABLED === 'true' && !!env.DIGEST, count: d?.count || 0, subject: d?.subject || null, text: d?.text || null, ics: d?.ics || null });
      }
      default: return json({ error: 'Not found' }, 404);
    }
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Something went wrong.' }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    const now = new Date(event.scheduledTime || Date.now());
    const r = await runDigest(env, now);
    console.log('digest', londonParts(now), JSON.stringify(r));
  },
};
