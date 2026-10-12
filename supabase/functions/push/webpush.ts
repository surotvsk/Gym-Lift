// ============================================================================
// GymQuest — minimal Web Push sender (RFC 8030 / 8291 / 8292), WebCrypto only.
// ----------------------------------------------------------------------------
// No third-party code: the payload is encrypted with aes128gcm (RFC 8291) for the
// subscription's p256dh/auth keys, and the request is signed with a VAPID JWT
// (ES256, RFC 8292). Runs in Supabase Edge Functions (Deno) and in Node >= 22
// (tests import this file directly and check it against the RFC 8291 example).
// ============================================================================

export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string };
export type Vapid = { publicKey: string; privateKey: string; subject: string };

const enc = new TextEncoder();

export function b64uDecode(s: string): Uint8Array {
  const clean = String(s).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function b64uEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/* P-256 key as JWK from the raw uncompressed public point (65 bytes) and optional private scalar. */
function p256Jwk(publicRaw: Uint8Array, d?: Uint8Array): JsonWebKey {
  if (publicRaw.length !== 65 || publicRaw[0] !== 4) throw new Error('bad_p256_public_key');
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: b64uEncode(publicRaw.slice(1, 33)), y: b64uEncode(publicRaw.slice(33, 65)), ext: true };
  if (d) jwk.d = b64uEncode(d);
  return jwk;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8);
  return new Uint8Array(bits);
}

/* RFC 8291 encryption. `fixed` is only for tests (RFC example keys and salt). */
export async function encryptPayload(plaintext: Uint8Array, p256dh: string, authSecret: string,
  fixed?: { asPublic: string; asPrivate: string; salt: string }): Promise<Uint8Array> {
  const uaPublic = b64uDecode(p256dh);
  const auth = b64uDecode(authSecret);
  if (auth.length !== 16) throw new Error('bad_auth_secret');
  const uaKey = await crypto.subtle.importKey('jwk', p256Jwk(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);

  let asPrivateKey: CryptoKey;
  let asPublic: Uint8Array;
  if (fixed) {
    asPublic = b64uDecode(fixed.asPublic);
    asPrivateKey = await crypto.subtle.importKey('jwk', p256Jwk(asPublic, b64uDecode(fixed.asPrivate)),
      { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } else {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
    asPrivateKey = pair.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  }
  const salt = fixed ? b64uDecode(fixed.salt) : crypto.getRandomValues(new Uint8Array(16));

  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivateKey, 256));
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(auth, ecdh, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const record = concat(plaintext, new Uint8Array([2]));   // one record, padding delimiter 0x02
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, record));

  const rs = new Uint8Array([0, 0, 0x10, 0]);              // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/* VAPID (RFC 8292): "vapid t=<JWT>, k=<public key>" for the push service origin. */
export async function vapidAuthorization(endpoint: string, vapid: Vapid, nowSec?: number): Promise<string> {
  const pub = b64uDecode(vapid.publicKey);
  const key = await crypto.subtle.importKey('jwk', p256Jwk(pub, b64uDecode(vapid.privateKey)),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const header = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64uEncode(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: now + 12 * 3600, sub: vapid.subject })));
  const unsigned = header + '.' + claims;
  // WebCrypto ECDSA returns the raw r||s (64 bytes), which is exactly the JWS ES256 format.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned)));
  return 'vapid t=' + unsigned + '.' + b64uEncode(sig) + ', k=' + vapid.publicKey;
}

/* Sends one push. Returns the push service's HTTP status (201 = accepted; 404/410 = subscription gone). */
export async function sendPush(sub: PushSubscriptionKeys, payload: unknown, vapid: Vapid,
  opts?: { ttl?: number; topic?: string; urgency?: 'very-low' | 'low' | 'normal' | 'high' }): Promise<number> {
  const body = await encryptPayload(enc.encode(JSON.stringify(payload)), sub.p256dh, sub.auth);
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'Content-Encoding': 'aes128gcm',
    'TTL': String(opts?.ttl ?? 86400),
    'Urgency': opts?.urgency ?? 'high',
    'Authorization': await vapidAuthorization(sub.endpoint, vapid),
  };
  if (opts?.topic) headers['Topic'] = opts.topic;
  const res = await fetch(sub.endpoint, { method: 'POST', headers, body });
  try { await res.body?.cancel(); } catch (_e) { /* response body not needed */ }
  return res.status;
}
