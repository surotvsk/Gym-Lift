'use strict';
/* GymQuest — FCM sender of the `push` Edge Function (supabase/functions/push/fcm.ts), in Node
   against a local mock of Google's token and FCM endpoints. No Supabase, no accounts.

     node tests/social/push-fcm-ef.js

   Checks: the config comes only from FCM_SERVICE_ACCOUNT (missing / broken → FCM off, Web Push
   unchanged); test URLs are honoured only for a localhost SUPABASE_URL; the OAuth assertion is a
   valid RS256 JWT for the service account (scope firebase.messaging, aud = token URL, 1 h) and the
   access token is cached; each message goes to one token with high priority, title GymQuest, the
   "new message from <name>" text in the recipient's language, tag gq-chat-<conv>, channel
   'messages', data {type:'chat', conv} — never the message text; UNREGISTERED / 404 tokens are
   reported as gone; at most 10 tokens; a failing token endpoint fails the FCM part without
   throwing; index.ts wires it in after Web Push and deletes gone tokens via push_fcm_gone. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 9872;
let pass = 0, fail = 0;
const check = (n, ok, info) => { if (ok) pass++; else fail++; console.log((ok ? '  PASS ' : '  FAIL ') + n + (!ok && info !== undefined ? '  -> ' + JSON.stringify(info) : '')); };

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { type: 'service_account', project_id: 'gq-test', client_email: 'push@gq-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const BASE = 'http://127.0.0.1:' + PORT;
const ENV = { FCM_SERVICE_ACCOUNT: JSON.stringify(SA), FCM_TOKEN_URL: BASE + '/token', FCM_SEND_URL: BASE + '/send/{project}' };

const seen = { token: [], send: [] };
let tokenStatus = 200;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.url === '/token') {
      seen.token.push(body);
      if (tokenStatus !== 200) { res.writeHead(tokenStatus); res.end('{}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'ya29.test-token', expires_in: 3599, token_type: 'Bearer' }));
      return;
    }
    if (req.url === '/send/gq-test') {
      const j = JSON.parse(body || '{}');
      seen.send.push({ auth: req.headers.authorization, msg: j.message });
      const t = j.message && j.message.token;
      if (t === 'tok-dead') { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } })); return; }
      if (t === 'tok-unreg400') { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { status: 'INVALID_ARGUMENT', details: [{ errorCode: 'UNREGISTERED' }] } })); return; }
      if (t === 'tok-500') { res.writeHead(500); res.end('{}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ name: 'projects/gq-test/messages/1' }));
      return;
    }
    res.writeHead(404); res.end();
  });
});

function verifyJwt(jwt) {
  const [h, p, s] = jwt.split('.');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(h + '.' + p), publicKey, Buffer.from(s, 'base64url'));
  return { ok, header: JSON.parse(Buffer.from(h, 'base64url')), claims: JSON.parse(Buffer.from(p, 'base64url')) };
}

(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  try {
    const F = await import(path.join(REPO, 'supabase', 'functions', 'push', 'fcm.ts'));
    const get = (env) => (k) => env[k];

    /* config */
    check('no secret → FCM off', F.fcmConfig(get({}), 'http://127.0.0.1:54321') === null);
    check('broken secret → FCM off', F.fcmConfig(get({ FCM_SERVICE_ACCOUNT: '{nope' }), 'http://127.0.0.1:54321') === null);
    check('secret without private key → FCM off', F.fcmConfig(get({ FCM_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'x', client_email: 'e' }) }), 'http://127.0.0.1:54321') === null);
    const prod = F.fcmConfig(get(ENV), 'https://mbjbtprkwvoqgqphgudq.supabase.co');
    check('production ignores test URLs', prod && prod.tokenUrl === 'https://oauth2.googleapis.com/token'
      && prod.sendUrl === 'https://fcm.googleapis.com/v1/projects/gq-test/messages:send', prod && [prod.tokenUrl, prod.sendUrl]);
    const cfg = F.fcmConfig(get(ENV), 'http://127.0.0.1:54321');
    check('local stack uses the test URLs', cfg && cfg.tokenUrl === BASE + '/token' && cfg.sendUrl === BASE + '/send/gq-test', cfg && [cfg.tokenUrl, cfg.sendUrl]);

    /* access token */
    const now = 1_800_000_000;
    const at = await F.fcmAccessToken(cfg, now);
    check('access token returned', at === 'ya29.test-token', at);
    const form = new URLSearchParams(seen.token[0] || '');
    check('jwt-bearer grant', form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    const v = verifyJwt(form.get('assertion') || '..');
    check('assertion signed RS256 by the service account key', v.ok && v.header.alg === 'RS256');
    check('claims: iss, scope, aud, 1 h', v.claims.iss === SA.client_email && v.claims.scope === 'https://www.googleapis.com/auth/firebase.messaging'
      && v.claims.aud === BASE + '/token' && v.claims.iat === now && v.claims.exp === now + 3600, v.claims);
    await F.fcmAccessToken(cfg, now + 60);
    check('token cached (no second request)', seen.token.length === 1, seen.token.length);
    await F.fcmAccessToken(cfg, now + 3600);
    check('expired token refreshed', seen.token.length === 2, seen.token.length);

    /* delivery */
    const conv = '0b7f3c1e-1111-4222-8333-944445555666';
    const gone = [];
    const targets = [{ token: 'tok-ok', lang: 'fr' }, { token: 'tok-dead', lang: 'en' }, { token: 'tok-unreg400', lang: 'sk' }, { token: 'tok-500', lang: 'xx' }];
    const r = await F.deliverFcm(targets, 'Ana', conv, cfg, async (t) => { gone.push(t); }, now + 3700);
    check('result: 1 sent, 2 gone, 1 failed', r.sent === 1 && r.gone === 2 && r.failed === 1, r);
    check('gone tokens reported for deletion', JSON.stringify(gone.sort()) === JSON.stringify(['tok-dead', 'tok-unreg400']), gone);
    const m = (seen.send.find((s) => s.msg.token === 'tok-ok') || {}).msg || {};
    check('Bearer access token used', (seen.send[0] || {}).auth === 'Bearer ya29.test-token');
    check('high priority, collapse per chat', m.android && m.android.priority === 'HIGH' && m.android.collapse_key === conv, m.android);
    const n = (m.android && m.android.notification) || {};
    check('title GymQuest, French text with name', n.title === 'GymQuest' && n.body === 'Nouveau message de Ana', n);
    check('tag gq-chat-<conv>, channel messages, small icon', n.tag === 'gq-chat-' + conv && n.channel_id === 'messages' && n.icon === 'ic_stat_gq', n);
    check('data {type: chat, conv}', m.data && m.data.type === 'chat' && m.data.conv === conv, m.data);
    const unknownLang = (seen.send.find((s) => s.msg.token === 'tok-500') || {}).msg;
    check('unknown language → English', unknownLang && unknownLang.android.notification.body === 'New message from Ana');
    const sends = seen.send.length;
    const many = Array.from({ length: 14 }, (_, i) => ({ token: 'tok-ok-' + i, lang: 'en' }));
    await F.deliverFcm(many, 'Ana', conv, cfg, async () => {}, now + 3700);
    check('at most 10 tokens per message', seen.send.length - sends === 10, seen.send.length - sends);
    const empty = await F.deliverFcm([], 'Ana', conv, cfg, async () => {}, now + 3700);
    check('no tokens → nothing sent, no token request', empty.sent === 0 && seen.send.length - sends === 10);

    tokenStatus = 500;
    /* iný servisný účet = iný záznam v cache → musí žiadať o nový token, ktorý zlyhá */
    const bad = await F.deliverFcm([{ token: 'tok-ok', lang: 'en' }], 'Ana', conv, F.fcmConfig(get(Object.assign({}, ENV, { FCM_SERVICE_ACCOUNT: JSON.stringify(Object.assign({}, SA, { client_email: 'other@gq-test.iam.gserviceaccount.com' })) })), 'http://127.0.0.1:54321'), async () => {}, now + 3700);
    check('token endpoint down → all failed, no throw', bad.sent === 0 && bad.failed === 1, bad);

    /* index.ts wiring */
    const idx = fs.readFileSync(path.join(REPO, 'supabase', 'functions', 'push', 'index.ts'), 'utf8');
    check('index.ts imports fcm.ts', /from '\.\/fcm\.ts'/.test(idx));
    check('index.ts delivers data.fcm and deletes gone tokens via push_fcm_gone', /deliverFcm\(/.test(idx) && /data\.fcm/.test(idx) && /push_fcm_gone/.test(idx));
    check('index.ts still sends Web Push first, unchanged', /sendPush\(s, payload, vapid/.test(idx));
  } catch (e) {
    check('no exception', false, String(e && e.stack || e));
  } finally {
    server.close();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
