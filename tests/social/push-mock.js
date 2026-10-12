'use strict';
/* Mock Web Push service for the LOCAL push tests (tests/social/push.js, ui-push.js).
   Listens on 0.0.0.0:9871 so the local Edge Function container reaches it as
   http://host.docker.internal:9871/push/<device id>. Decrypts payloads with Node crypto
   (RFC 8291, independent of the function's WebCrypto code) and verifies VAPID (RFC 8292). */
const http = require('http');
const crypto = require('crypto');
const MOCK_PORT = 9871;
const MOCK_PREFIX = 'http://host.docker.internal:' + MOCK_PORT + '/push/';
const VAPID_PUBLIC = process.env.GQ_VAPID_PUBLIC;   // the public key the local function was started with
const b64u = (buf) => Buffer.from(buf).toString('base64url');

const received = [];          // { id, headers, body }
const statusFor = {};         // id -> HTTP status to answer (default 201)
function startMock() {
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const id = decodeURIComponent((req.url || '').replace(/^\/push\//, ''));
      received.push({ id, method: req.method, headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(statusFor[id] || 201); res.end();
    });
  });
  return new Promise((r) => srv.listen(MOCK_PORT, '0.0.0.0', () => r(srv)));
}

/* A browser-like subscription: receiver key pair + auth secret. */
function device(id) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { id, endpoint: MOCK_PREFIX + id, ecdh, authBuf: auth, p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) };
}
/* RFC 8291 decryption, independent of the function's WebCrypto code. */
function decrypt(dev, body) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const cipher = body.subarray(21 + idlen);
  const ecdhSecret = dev.ecdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), dev.ecdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdhSecret, dev.authBuf, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  if (plain[plain.length - 1] !== 2) throw new Error('padding delimiter missing');
  return JSON.parse(plain.subarray(0, plain.length - 1).toString('utf8'));
}
/* VAPID header: valid ES256 signature by the configured key, right audience, not expired. */
function vapidOk(auth) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(String(auth || ''));
  if (!m) return 'no vapid header';
  if (VAPID_PUBLIC && m[2] !== VAPID_PUBLIC) return 'unexpected key';
  const [h, c, s] = m[1].split('.');
  const pub = Buffer.from(m[2], 'base64url');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
  const ok = crypto.verify('sha256', Buffer.from(h + '.' + c), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  if (!ok) return 'bad signature';
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  if (claims.aud !== 'http://host.docker.internal:' + MOCK_PORT) return 'bad aud ' + claims.aud;
  if (!(claims.exp > Date.now() / 1000) || claims.exp > Date.now() / 1000 + 24 * 3600) return 'bad exp';
  if (!claims.sub) return 'no sub';
  return '';
}

module.exports = { startMock, device, decrypt, vapidOk, received, statusFor, MOCK_PREFIX, MOCK_PORT };
