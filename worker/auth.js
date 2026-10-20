// Cloudflare Access JWT verification, done in the Worker itself (a second lock behind Access).
// Every /api request must carry a Cf-Access-Jwt-Assertion header that is:
//   RS256-signed by a key from https://<team>.cloudflareaccess.com/cdn-cgi/access/certs,
//   issued by that team domain, for one of our Access application AUDs, unexpired,
//   and for exactly the allowed email. Anything else is rejected (fail closed), including missing config.
const enc = new TextEncoder();
export const DEFAULT_ALLOWED_EMAIL = 'sarah_arissa@hotmail.co.uk';

function fromB64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function teamUrl(env) {
  let d = String(env.ACCESS_TEAM_DOMAIN || '').trim().replace(/\/+$/, '');
  if (!d) return '';
  if (!/^https:\/\//.test(d)) d = 'https://' + d;
  return d;
}
export const audiences = (env) => String(env.ACCESS_AUD || '').split(',').map(s => s.trim()).filter(Boolean);
export const allowedEmail = (env) => String(env.ALLOWED_EMAIL || DEFAULT_ALLOWED_EMAIL).trim().toLowerCase();

let jwksCache = { url: null, at: 0, keys: [] };
export function _resetJwksCache() { jwksCache = { url: null, at: 0, keys: [] }; }
async function getKeys(env, force) {
  const url = teamUrl(env) + '/cdn-cgi/access/certs';
  if (!force && jwksCache.url === url && Date.now() - jwksCache.at < 3600e3) return jwksCache.keys;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Could not load Access keys');
  const j = await r.json();
  jwksCache = { url, at: Date.now(), keys: j.keys || [] };
  return jwksCache.keys;
}

export async function verifyAccessJwt(env, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  let header, claims;
  try {
    header = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
  } catch { return null; }
  if (header.alg !== 'RS256') return null;
  let keys = await getKeys(env, false);
  let jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) { keys = await getKeys(env, true); jwk = keys.find(k => k.kid === header.kid); }
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
  if (!ok) return null;
  const now = Date.now() / 1000;
  if (typeof claims.exp !== 'number' || claims.exp < now - 30) return null;
  if (typeof claims.nbf === 'number' && claims.nbf > now + 30) return null;
  if (claims.iss !== teamUrl(env)) return null;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences(env).some(a => aud.includes(a))) return null;
  return claims;
}

/** @returns {Promise<{ok:true,email:string}|{ok:false,status:number,error:string}>} */
export async function authenticate(env, request) {
  if (!teamUrl(env) || !audiences(env).length) return { ok: false, status: 503, error: 'Sync is not configured yet.' };
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return { ok: false, status: 401, error: 'Please sign in.' };
  let claims = null;
  try { claims = await verifyAccessJwt(env, token); } catch { claims = null; }
  if (!claims) return { ok: false, status: 401, error: 'Please sign in again.' };
  const email = String(claims.email || '').trim().toLowerCase();
  if (!email || email !== allowedEmail(env)) return { ok: false, status: 403, error: 'This account is not allowed.' };
  return { ok: true, email };
}
