// Test harness: runs the real Worker (worker/index.js) in Miniflare (local workerd) with a local D1 database,
// a fake Cloudflare Access team (our own RSA key served as the JWKS), and helpers to mint Access JWTs.
import { Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';

export const TEAM = 'https://mentorflow-test.cloudflareaccess.com';
export const AUD = 'aud-workers-dev,aud-custom-domain';
export const SARAH = 'sarah_arissa@hotmail.co.uk';

const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
export const otherKey = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'test-k1' };
const b64u = (b) => Buffer.from(b).toString('base64url');
export async function jwt(claims = {}, { key = kp.privateKey, kid = 'test-k1' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: TEAM, aud: ['aud-workers-dev'], email: SARAH, iat: now, exp: now + 600, ...claims };
  const h = b64u(JSON.stringify({ alg: 'RS256', kid })), p = b64u(JSON.stringify(body));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(h + '.' + p));
  return `${h}.${p}.${b64u(new Uint8Array(sig))}`;
}

export async function startWorker(vars = {}) {
  const mf = new Miniflare({
    modules: true,
    scriptPath: new URL('../../worker/index.js', import.meta.url).pathname,
    modulesRoot: new URL('../../', import.meta.url).pathname,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    compatibilityDate: '2026-05-01',
    d1Databases: { DB: 'test-db-' + Math.random().toString(36).slice(2) },
    bindings: { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ALLOWED_EMAIL: SARAH, DIGEST_ENABLED: 'false', ...vars },
    serviceBindings: { ASSETS: () => new Response('static asset', { headers: { 'Content-Type': 'text/plain' } }) },
    outboundService: (req) => {
      if (req.url === TEAM + '/cdn-cgi/access/certs') return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'Content-Type': 'application/json' } });
      return new Response('blocked in tests', { status: 599 });
    },
  });
  const db = await mf.getD1Database('DB');
  const sql = readFileSync(new URL('../../migrations/0001_init.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
  for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  const call = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
    const h = { ...headers }; if (token) h['Cf-Access-Jwt-Assertion'] = token;
    if (body !== undefined) { h['Content-Type'] = 'application/json'; h['X-MentorFlow'] ??= '1'; }
    const res = await mf.dispatchFetch('https://mentorflow.example.workers.dev' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    let data = null; const text = await res.text(); try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  };
  return { mf, db, call, dispose: () => mf.dispose() };
}
