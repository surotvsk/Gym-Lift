'use strict';
/* GymQuest push notifications (migration 0010 + Edge Function `push`). LOCAL test stack only
   (lib.js refuses anything else); disposable local accounts.

     node tests/social/push.js [filter]

   Needs 0010 applied and the functions served locally with test VAPID keys and
   PUSH_TEST_ENDPOINT_PREFIX=http://host.docker.internal:9871/push/ (see README). A mock push
   service on port 9871 receives the notifications; this test decrypts them with its own
   implementation (Node crypto, RFC 8291) and verifies the VAPID signature (RFC 8292). The
   encryption module is also checked against the RFC 8291 example. */
const path = require('path');
const L = require('./lib');
const { check, section, errText, sql, sqlVal, lit } = L;
const FILTER = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const J = JSON.stringify;
const REPO = path.resolve(__dirname, '..', '..');

const { startMock, device, decrypt, vapidOk, received, statusFor } = require('./push-mock');

/* ---------- helpers ---------- */
let M;
async function member(tag) {
  const u = await L.newUser('push-' + tag);
  const j = await u.c.rpc('community_join');
  if (j.error) throw new Error('community_join ' + tag + ': ' + errText(j));
  u.name = sqlVal('select username from public.profiles where id = ' + lit(u.id));
  return u;
}
async function befriend(a, b) {
  const s = await a.c.from('friend_requests').insert({ from_id: a.id, to_id: b.id }).select('id').single();
  if (s.error) throw new Error('request: ' + errText(s));
  const r = await b.c.rpc('accept_friend_request', { p_request: s.data.id });
  if (r.error) throw new Error('accept: ' + errText(r));
  const c = await a.c.rpc('open_chat', { p_friend: b.id });
  if (c.error) throw new Error('open_chat: ' + errText(c));
  return c.data;
}
async function send(u, conv, body) {
  const r = await u.c.from('messages').insert({ conversation_id: conv, sender_id: u.id, body }).select('id').single();
  if (r.error) throw new Error('message: ' + errText(r));
  return r.data.id;
}
const subscribe = (u, d, lang) => u.c.rpc('push_subscribe', { p_endpoint: d.endpoint, p_p256dh: d.p256dh, p_auth: d.auth, p_lang: lang || 'en' });
async function invoke(u, body, noAuth) {
  const headers = { apikey: process.env.GQ_LOCAL_ANON, 'Content-Type': 'application/json' };
  if (!noAuth) headers.Authorization = 'Bearer ' + (await u.c.auth.getSession()).data.session.access_token;
  const r = await fetch(L.URL_ + '/functions/v1/push', { method: 'POST', headers, body: J(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const subsOf = (u) => Number(sqlVal('select count(*) from public.push_subscriptions where user_id = ' + lit(u.id)));
const forDevice = (d) => received.filter((x) => x.id === d.id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

scenario('encryption matches the RFC 8291 example', async () => {
  const w = await import(path.join(REPO, 'supabase', 'functions', 'push', 'webpush.ts'));
  const out = await w.encryptPayload(w.b64uDecode('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24'),
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg',
    { asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
      asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', salt: 'DGv6ra1nlYgDCS1FRnbzlw' });
  const expect = Buffer.concat([Buffer.from('DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8', 'base64url'),
    Buffer.from('8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ', 'base64url')]);
  check('aes128gcm output equals RFC 8291 Section 5', Buffer.from(out).equals(expect));
  const d = device('selftest');
  const blob = await w.encryptPayload(Buffer.from('{"x":1}'), d.p256dh, d.auth);
  check('random-key encryption decrypts with Node crypto', J(decrypt(d, Buffer.from(blob))) === '{"x":1}');
});

scenario('version and access', async () => {
  check('community_social_version() is 4', sqlVal('select public.community_social_version()') === '4');
  const a = await member('acc');
  const d = device('acc-' + L.runTag);
  check('anon cannot register a device', !!(await L.anon().rpc('push_subscribe', { p_endpoint: d.endpoint, p_p256dh: d.p256dh, p_auth: d.auth })).error);
  check('members cannot read the device table', !!(await a.c.from('push_subscriptions').select('*')).error);
  check('members cannot write the device table', !!(await a.c.from('push_subscriptions').insert({ endpoint: d.endpoint, user_id: a.id, p256dh: d.p256dh, auth: d.auth })).error);
  check('members cannot read the sent log', !!(await a.c.from('push_sent').select('*')).error);
  check('members cannot call push_targets', !!(await a.c.rpc('push_targets', { p_sender: a.id, p_message: 1 })).error);
  check('members cannot call push_gone', !!(await a.c.rpc('push_gone', { p_endpoint: d.endpoint })).error);
  const sus = await member('sus');
  sql('update public.profiles set suspended = true where id = ' + lit(sus.id) + ';');
  check('suspended member cannot register', !!(await subscribe(sus, d)).error);
});

scenario('register, status, unregister, ownership, limit', async () => {
  const a = await member('reg'), b = await member('reg2');
  const d = device('reg-' + L.runTag);
  check('bad endpoint rejected', !!(await a.c.rpc('push_subscribe', { p_endpoint: 'javascript:alert(1)', p_p256dh: d.p256dh, p_auth: d.auth })).error);
  check('bad keys rejected', !!(await a.c.rpc('push_subscribe', { p_endpoint: d.endpoint, p_p256dh: 'short', p_auth: d.auth })).error);
  let r = await subscribe(a, d, 'xx');
  check('member registers a device', !r.error, errText(r));
  check('unknown language stored as en', sqlVal('select lang from public.push_subscriptions where endpoint = ' + lit(d.endpoint)) === 'en');
  check('status: registered for the owner', (await a.c.rpc('push_status', { p_endpoint: d.endpoint })).data === true);
  check('status: not for another member', (await b.c.rpc('push_status', { p_endpoint: d.endpoint })).data === false);
  await b.c.rpc('push_unsubscribe', { p_endpoint: d.endpoint });
  check('another member cannot unregister it', subsOf(a) === 1);
  r = await subscribe(a, d, 'fr');
  check('registering again updates (no duplicate)', !r.error && subsOf(a) === 1 && sqlVal('select lang from public.push_subscriptions where endpoint = ' + lit(d.endpoint)) === 'fr');
  await subscribe(b, d, 'en');
  check('same device signed in as someone else moves to them', subsOf(a) === 0 && subsOf(b) === 1);
  await b.c.rpc('push_unsubscribe', { p_endpoint: d.endpoint });
  check('owner unregisters', subsOf(b) === 0);
  for (let i = 0; i < 12; i++) await subscribe(a, device('lim' + i + '-' + L.runTag));
  check('at most 10 devices per member', subsOf(a) === 10, String(subsOf(a)));
});

scenario('a message notifies the friend: encrypted, signed, name only, in their language', async () => {
  const a = await member('snd'), b = await member('rcv');
  const conv = await befriend(a, b);
  const db = device('rcv-' + L.runTag), da = device('snd-' + L.runTag);
  await subscribe(b, db, 'sk');
  await subscribe(a, da, 'en');
  const text = 'secret-text-' + L.runTag;
  const id = await send(a, conv, text);
  const r = await invoke(a, { action: 'send', message: id });
  check('function answers sent: 1', r.status === 200 && r.body && r.body.sent === 1, J(r));
  await wait(300);
  const got = forDevice(db);
  check('exactly one push reached the friend\'s device', got.length === 1, String(got.length));
  check('the sender\'s own device gets nothing', forDevice(da).length === 0);
  if (got.length) {
    const g = got[0];
    check('headers: POST, aes128gcm, TTL, high urgency, topic', g.method === 'POST' && g.headers['content-encoding'] === 'aes128gcm'
      && Number(g.headers.ttl) > 0 && g.headers.urgency === 'high' && g.headers.topic === conv.replace(/-/g, ''), J(g.headers));
    const v = vapidOk(g.headers.authorization);
    check('VAPID signature valid (audience, expiry, key)', v === '', v);
    let p = null;
    try { p = decrypt(db, g.body); } catch (e) { p = { error: String(e) }; }
    check('payload decrypts', p && !p.error, J(p));
    check('payload: Slovak text with the sender\'s name', p && p.body === 'Nová správa od ' + a.name && p.title === 'GymQuest', J(p));
    check('payload: chat id and tag', p && p.conv === conv && p.tag === 'gq-chat-' + conv && p.type === 'chat', J(p));
    check('the message text is never sent', !J(p).includes(text) && !g.body.toString('latin1').includes(text));
  }
  const again = await invoke(a, { action: 'send', message: id });
  await wait(200);
  check('no second notification for the same message', again.body && again.body.sent === 0 && again.body.reason === 'duplicate' && forDevice(db).length === 1, J(again));
});

scenario('quick follow-up messages are grouped (one notification per chat per 20 s)', async () => {
  const a = await member('grp-a'), b = await member('grp-b'), c = await member('grp-c');
  const conv = await befriend(a, b);
  const conv2 = await befriend(c, b);
  const d = device('grp-' + L.runTag);
  await subscribe(b, d, 'en');
  const m1 = await send(a, conv, 'one'), m2 = await send(a, conv, 'two');
  const r1 = await invoke(a, { action: 'send', message: m1 });
  const r2 = await invoke(a, { action: 'send', message: m2 });
  check('first message notified', r1.body && r1.body.sent === 1, J(r1));
  check('second message within 20 s grouped (not sent again)', r2.body && r2.body.sent === 0 && r2.body.reason === 'recent', J(r2));
  const m3 = await send(c, conv2, 'other chat');
  const r3 = await invoke(c, { action: 'send', message: m3 });
  check('another chat is notified independently', r3.body && r3.body.sent === 1, J(r3));
  sql(`update public.push_sent set created_at = now() - interval '25 seconds' where conversation_id = ${lit(conv)};`);
  const m4 = await send(a, conv, 'later');
  const r4 = await invoke(a, { action: 'send', message: m4 });
  check('after 20 s the chat notifies again', r4.body && r4.body.sent === 1, J(r4));
  await wait(300);
  check('the device got exactly 3 notifications', forDevice(d).length === 3, String(forDevice(d).length));
  const m5 = await send(a, conv, 'grouped again');
  await invoke(a, { action: 'send', message: m5 });
  sql(`update public.push_sent set created_at = now() - interval '25 seconds' where conversation_id = ${lit(conv)};`);
  const r6 = await invoke(a, { action: 'send', message: await send(a, conv, 'next') });
  check('a grouped (not notified) message does not hold back the next one', r6.body && r6.body.sent === 1, J(r6));
});

scenario('refusals: someone else\'s message, old message, no sign-in, bad request, blocked', async () => {
  const a = await member('rf-a'), b = await member('rf-b'), c = await member('rf-c');
  const conv = await befriend(a, b);
  const db = device('rf-' + L.runTag);
  await subscribe(b, db, 'en');
  const id = await send(a, conv, 'hi');
  let r = await invoke(c, { action: 'send', message: id });
  check('a stranger cannot trigger it', r.status === 200 && r.body.sent === 0 && r.body.reason === 'not_allowed', J(r));
  r = await invoke(b, { action: 'send', message: id });
  check('the recipient cannot trigger it for the sender\'s message', r.body && r.body.sent === 0, J(r));
  r = await invoke(a, { action: 'send', message: id }, true);
  check('no sign-in: refused', r.status === 401, J(r));
  r = await invoke(a, { action: 'send', message: 'x' });
  check('bad request: 400', r.status === 400, J(r));
  const old = await send(a, conv, 'old');
  sql(`update public.messages set created_at = now() - interval '11 minutes' where id = ${old};`);
  r = await invoke(a, { action: 'send', message: old });
  check('message older than 10 minutes: not notified', r.body && r.body.sent === 0, J(r));
  const later = await send(a, conv, 'before block');
  const bl = await b.c.from('blocks').insert({ blocker_id: b.id, blocked_id: a.id });
  check('block created', !bl.error, errText(bl));
  r = await invoke(a, { action: 'send', message: later });
  await wait(200);
  check('after a block: nothing sent', r.body && r.body.sent === 0 && forDevice(db).length === 0, J(r));
});

scenario('gone devices are removed; unknown push servers are never contacted', async () => {
  const a = await member('gn-a'), b = await member('gn-b');
  const conv = await befriend(a, b);
  const live = device('live-' + L.runTag), dead = device('dead-' + L.runTag);
  statusFor[dead.id] = 410;
  await subscribe(b, live); await subscribe(b, dead);
  const evil = { endpoint: 'https://evil.example.com/push/' + L.runTag, p256dh: live.p256dh, auth: live.auth };
  await b.c.rpc('push_subscribe', { p_endpoint: evil.endpoint, p_p256dh: evil.p256dh, p_auth: evil.auth, p_lang: 'en' });
  const id = await send(a, conv, 'x');
  const r = await invoke(a, { action: 'send', message: id });
  check('sent 1, gone 1, skipped 1 (unknown server)', r.body && r.body.sent === 1 && r.body.gone === 1 && r.body.skipped === 1, J(r));
  check('the gone device was deleted, the others kept', sqlVal('select count(*) from public.push_subscriptions where endpoint = ' + lit(dead.endpoint)) === '0'
    && sqlVal('select count(*) from public.push_subscriptions where endpoint = ' + lit(live.endpoint)) === '1');
});

scenario('leaving Community and deleting the account remove the devices', async () => {
  const a = await member('lv'), b = await member('del');
  await subscribe(a, device('lv-' + L.runTag)); await subscribe(b, device('del-' + L.runTag));
  const r = await L.admin.rpc('community_leave_cleanup', { p_user: a.id });
  check('leave cleanup removes the member\'s devices', !r.error && subsOf(a) === 0, errText(r));
  await L.admin.auth.admin.deleteUser(b.id);
  check('deleting the account removes the devices', subsOf(b) === 0);
});

scenario('rollback 0010_down and re-apply', async () => {
  L.sqlFile(path.join(REPO, 'supabase', 'rollback', '0010_down.sql'));
  check('after rollback: version 3', sqlVal('select public.community_social_version()') === '3');
  check('after rollback: tables gone', sqlVal(`select to_regclass('public.push_subscriptions') is null and to_regclass('public.push_sent') is null`) === 't');
  check('after rollback: leave cleanup still works', !(await L.admin.rpc('community_leave_cleanup', { p_user: (await member('rb')).id })).error);
  L.sqlFile(path.join(REPO, 'supabase', 'migrations', '0010_push.sql'));
  sql(`notify pgrst, 'reload schema';`);
  check('re-applied: version 4', sqlVal('select public.community_social_version()') === '4');
  await wait(1500);
});

(async () => {
  const mock = await startMock();
  M = await L.newUser('push-mod'); L.makeModerator(M);
  for (const sc of scenarios) {
    if (FILTER && !FILTER.test(sc.name)) continue;
    section(sc.name);
    try { await sc.fn(); } catch (e) { check('scenario error: ' + sc.name, false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
  }
  mock.close();
  console.log('\n==== checks: ' + L.results.pass + ' passed, ' + L.results.fail + ' failed ====');
  process.exit(L.results.fail ? 1 : 0);
})();
