'use strict';
/* GymQuest — migration 0016 (Android message alerts, FCM tokens). LOCAL test stack only
   (lib.js refuses anything else); disposable local accounts.

     source claude-code/local-preview/test-env.sh && node tests/social/push-fcm.js

   Leaves the stack as it found it: if 0016 was not applied at the start, it is rolled back at the end.
   Checks: without 0016 push_fcm_register is "missing" (that is how the app detects it); 0016 refuses
   to run twice; only members register their own phone (invalid tokens, anon and non-members refused,
   at most 10 per member, a token moves to the account that registers it last, nobody else can
   unregister it); nobody can read the table or call the Edge Function's functions; push_targets()
   lists the recipient's FCM tokens next to the Web Push devices with the same block / duplicate /
   20-second rules; leaving Community and deleting the account remove the tokens; rollback restores
   0010's push_targets and 0012's leave cleanup and keeps web push devices and the social version. */
const path = require('path');
const L = require('./lib');
const { check, section, errText, sql, sqlVal, lit } = L;
const MIG = path.resolve(__dirname, '..', '..', 'supabase');
const UP = path.join(MIG, 'migrations', '0016_push_fcm.sql');
const DOWN = path.join(MIG, 'rollback', '0016_down.sql');
const tok = (tag) => 'fcm-' + tag + '-' + L.runTag + ':APA91b' + 'x'.repeat(40);
const present = () => sqlVal("select to_regclass('public.push_fcm_tokens') is not null") === 't';
const reload = () => sql(`notify pgrst, 'reload schema';`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function member(tag) {
  const u = await L.newUser('fcm-' + tag);
  const j = await u.c.rpc('community_join');
  if (j.error) throw new Error('community_join ' + tag + ': ' + errText(j));
  return u;
}
async function chatPair(tag) {
  const a = await member(tag + 'a'), b = await member(tag + 'b');
  const s = await a.c.from('friend_requests').insert({ from_id: a.id, to_id: b.id }).select('id').single();
  if (s.error) throw new Error('request: ' + errText(s));
  const r = await b.c.rpc('accept_friend_request', { p_request: s.data.id });
  if (r.error) throw new Error('accept: ' + errText(r));
  const c = await a.c.rpc('open_chat', { p_friend: b.id });
  if (c.error) throw new Error('open_chat: ' + errText(c));
  return { a, b, conv: c.data };
}
async function send(u, conv, body) {
  const r = await u.c.from('messages').insert({ conversation_id: conv, sender_id: u.id, body }).select('id').single();
  if (r.error) throw new Error('message: ' + errText(r));
  return r.data.id;
}
const targets = async (sender, msg) => {
  const r = await L.admin.rpc('push_targets', { p_sender: sender.id, p_message: msg });
  if (r.error) throw new Error('push_targets: ' + errText(r));
  return r.data;
};
const tokensOf = (u) => Number(sqlVal('select count(*) from public.push_fcm_tokens where user_id = ' + lit(u.id)));

(async () => {
  const wasPresent = present();
  const versionBefore = sqlVal('select public.community_social_version()');
  try {
    section('without 0016');
    if (wasPresent) { L.sqlFile(DOWN); reload(); await wait(500); }
    const x = await member('pre');
    const pre = await x.c.rpc('push_fcm_register', { p_token: tok('pre'), p_lang: 'en' });
    check('push_fcm_register is missing (app shows "not available")', !!pre.error && /PGRST202|function|schema cache/i.test(errText(pre)), errText(pre));

    section('apply 0016');
    L.sqlFile(UP); reload(); await wait(800);
    check('0016 applied', present());
    let again = null;
    try { L.sqlFile(UP); } catch (e) { again = String(e.stderr || e.message); }
    check('0016 refuses to run twice', !!again && /already applied/.test(again), again);
    check('community_social_version unchanged', sqlVal('select public.community_social_version()') === versionBefore);

    section('register / unregister');
    const a = await member('reg'), b = await member('reg2');
    let r = await a.c.rpc('push_fcm_register', { p_token: tok('a1'), p_lang: 'sk' });
    check('member registers this phone', !r.error && tokensOf(a) === 1, errText(r));
    check('language stored', sqlVal('select lang from public.push_fcm_tokens where token = ' + lit(tok('a1'))) === 'sk');
    r = await a.c.rpc('push_fcm_register', { p_token: tok('a1'), p_lang: 'xx' });
    check('re-register refreshes, unknown language → en', !r.error && tokensOf(a) === 1 && sqlVal('select lang from public.push_fcm_tokens where token = ' + lit(tok('a1'))) === 'en');
    check('invalid token refused', !!(await a.c.rpc('push_fcm_register', { p_token: 'short' })).error
      && !!(await a.c.rpc('push_fcm_register', { p_token: 'bad token with spaces ' + 'x'.repeat(30) })).error);
    check('anon refused', !!(await L.anon().rpc('push_fcm_register', { p_token: tok('anon') })).error);
    const sus = await member('sus');
    sql('update public.profiles set suspended = true where id = ' + lit(sus.id) + ';');
    check('suspended member refused (same rule as web push)', !!(await sus.c.rpc('push_fcm_register', { p_token: tok('sus') })).error);
    await b.c.rpc('push_fcm_unregister', { p_token: tok('a1') });
    check('another member cannot unregister it', tokensOf(a) === 1);
    r = await b.c.rpc('push_fcm_register', { p_token: tok('a1') });
    check('same phone signs in as another account → token moves', !r.error && tokensOf(a) === 0 && tokensOf(b) === 1, errText(r));
    for (let i = 0; i < 11; i++) await a.c.rpc('push_fcm_register', { p_token: tok('many' + i) });
    check('at most 10 phones per member (newest kept)', tokensOf(a) === 10
      && sqlVal('select count(*) from public.push_fcm_tokens where token = ' + lit(tok('many0'))) === '0');
    r = await a.c.rpc('push_fcm_unregister', { p_token: tok('many10') });
    check('owner unregisters', !r.error && tokensOf(a) === 9);

    section('access');
    check('members cannot read the token table', !!(await a.c.from('push_fcm_tokens').select('*')).error);
    check('members cannot write the token table', !!(await a.c.from('push_fcm_tokens').insert({ token: tok('w'), user_id: a.id })).error);
    check('members cannot call push_fcm_gone', !!(await a.c.rpc('push_fcm_gone', { p_token: tok('many9') })).error);
    check('members cannot call push_targets', !!(await a.c.rpc('push_targets', { p_sender: a.id, p_message: 1 })).error);
    r = await L.admin.rpc('push_fcm_gone', { p_token: tok('many9') });
    check('Edge Function (service role) removes a dead token', !r.error && tokensOf(a) === 8, errText(r));

    section('push_targets');
    const p = await chatPair('t');
    await p.b.c.rpc('push_fcm_register', { p_token: tok('tb'), p_lang: 'fr' });
    await p.a.c.rpc('push_fcm_register', { p_token: tok('ta') });
    let m = await send(p.a, p.conv, 'hello');
    let tg = await targets(p.a, m);
    check('recipient FCM token listed with language', tg.ok === true && Array.isArray(tg.fcm) && tg.fcm.length === 1
      && tg.fcm[0].token === tok('tb') && tg.fcm[0].lang === 'fr', JSON.stringify(tg));
    check('web push list still there', Array.isArray(tg.subs));
    check('sender name + chat id, no message text', tg.conversation === p.conv && typeof tg.sender_name === 'string' && !JSON.stringify(tg).includes('hello'));
    tg = await targets(p.a, m);
    check('same message twice → duplicate', tg.ok === false && tg.reason === 'duplicate');
    m = await send(p.a, p.conv, 'again');
    tg = await targets(p.a, m);
    check('follow-up within 20 s → recent (grouped)', tg.ok === false && tg.reason === 'recent');
    await p.b.c.from('blocks').insert({ blocker_id: p.b.id, blocked_id: p.a.id });
    m = await send(p.a, p.conv, 'blocked?').catch(() => null);
    if (m) { tg = await targets(p.a, m); check('blocked → no targets', tg.ok === false); }
    else check('blocked → cannot even send', true);

    section('cleanup');
    const c = await member('leave');
    await c.c.rpc('push_fcm_register', { p_token: tok('leave') });
    r = await L.admin.rpc('community_leave_cleanup', { p_user: c.id });
    check('leaving Community removes the tokens', !r.error && tokensOf(c) === 0, errText(r));
    const d = await member('del');
    await d.c.rpc('push_fcm_register', { p_token: tok('del') });
    await L.admin.auth.admin.deleteUser(d.id);
    check('deleting the account removes the tokens', sqlVal('select count(*) from public.push_fcm_tokens where token = ' + lit(tok('del'))) === '0');

    section('rollback');
    const webBefore = sqlVal('select count(*) from public.push_subscriptions');
    L.sqlFile(DOWN); reload(); await wait(800);
    check('0016 rolled back', !present());
    check('register gone again', !!(await a.c.rpc('push_fcm_register', { p_token: tok('rb') })).error);
    const q = await chatPair('rb');
    tg = await targets(q.a, await send(q.a, q.conv, 'hi'));
    check('push_targets back to 0010 (no fcm key)', tg.ok === true && !('fcm' in tg) && Array.isArray(tg.subs), JSON.stringify(tg));
    check('leave cleanup still works', !(await L.admin.rpc('community_leave_cleanup', { p_user: q.a.id })).error);
    check('web push devices untouched', sqlVal('select count(*) from public.push_subscriptions') === webBefore);
    check('social version unchanged', sqlVal('select public.community_social_version()') === versionBefore);
  } catch (e) {
    check('test error', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | '));
  } finally {
    try {
      if (wasPresent && !present()) { L.sqlFile(UP); reload(); }
      if (!wasPresent && present()) { L.sqlFile(DOWN); reload(); }
    } catch (e) { console.log('  restore failed: ' + e.message); }
    check('stack left as found (0016 ' + (wasPresent ? 'applied' : 'absent') + ')', present() === wasPresent);
    console.log('\n==== checks: ' + L.results.pass + ' passed, ' + L.results.fail + ' failed ====');
    process.exit(L.results.fail ? 1 : 0);
  }
})();
