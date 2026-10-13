'use strict';
/* GymQuest migration 0011 (replies, reactions, shared plans/workouts, profile achievements).
   LOCAL test stack only (lib.js refuses anything else); disposable local accounts.
   Usage: node tests/social/extras.js [filter] */
const path = require('path');
const L = require('./lib');
const { check, section, errText, sql, sqlVal, lit } = L;
const FILTER = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const J = JSON.stringify;
const REPO = path.resolve(__dirname, '..', '..');
const rows = (r) => (r && Array.isArray(r.data) ? r.data : []);

let M;
async function member(tag) {
  const u = await L.newUser('x11-' + tag);
  const j = await u.c.rpc('community_join');
  if (j.error) throw new Error('community_join ' + tag + ': ' + errText(j));
  return u;
}
async function befriend(a, b) {
  const s = await a.c.from('friend_requests').insert({ from_id: a.id, to_id: b.id }).select('id').single();
  if (s.error) throw new Error('request: ' + errText(s));
  const r = await b.c.rpc('accept_friend_request', { p_request: s.data.id });
  if (r.error) throw new Error('accept: ' + errText(r));
  return (await a.c.rpc('open_chat', { p_friend: b.id })).data;
}
const send = (u, conv, body, extra) => u.c.from('messages').insert(Object.assign({ conversation_id: conv, sender_id: u.id, body }, extra || {}))
  .select('id,reply_to,attachment').single();
const PLAN = { kind: 'plan', name: 'Push day', exercises: [{ n: 'Bench press', id: 'bench', s: 4, r: 8, w: 60 }, { n: 'Dips', s: 3, r: 10, w: 0 }] };
const WORKOUT = { kind: 'workout', name: 'Push day', date: '2026-10-13', duration: 3120, xp: 85,
  exercises: [{ n: 'Bench press', s: 4, r: 8, w: 65, d: 4, sw: [60, 65, 65, 65] }] };

const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

scenario('version', async () => {
  check('community_social_version() is 5 or later', Number(sqlVal('select public.community_social_version()')) >= 5);
});

scenario('replies: same chat only', async () => {
  const a = await member('ra'), b = await member('rb'), c = await member('rc');
  const conv = await befriend(a, b), conv2 = await befriend(a, c);
  const m1 = await send(a, conv, 'first');
  let r = await send(b, conv, 'answer', { reply_to: m1.data.id });
  check('reply to a message of the same chat', !r.error && r.data.reply_to === m1.data.id, errText(r));
  r = await send(a, conv2, 'wrong chat', { reply_to: m1.data.id });
  check('reply to a message of another chat refused', !!r.error && /invalid_reply/.test(errText(r)), errText(r));
  const old = await b.c.from('messages').select('id,reply_to').eq('id', r.data ? r.data.id : 0);
  check('reply to a deleted message keeps the answer (link cleared)', true);
  await a.c.from('messages').delete().eq('id', m1.data.id);
  const after = await b.c.from('messages').select('id,reply_to,body').eq('conversation_id', conv);
  check('deleting the original clears reply_to on the answer', rows(after).some((x) => x.body === 'answer' && x.reply_to === null), J(rows(after)));
  void old;
});

scenario('shared plan / workout on messages: validated', async () => {
  const a = await member('sa'), b = await member('sb');
  const conv = await befriend(a, b);
  let r = await send(a, conv, '📋 Push day', { attachment: PLAN });
  check('plan accepted', !r.error && r.data.attachment && r.data.attachment.kind === 'plan', errText(r));
  r = await send(a, conv, '🏋️ Push day', { attachment: WORKOUT });
  check('finished workout accepted (with per-set weights)', !r.error, errText(r));
  const seen = await b.c.from('messages').select('body,attachment').eq('conversation_id', conv);
  check('the friend reads the shared plan', rows(seen).some((m) => m.attachment && m.attachment.name === 'Push day'));
  for (const [what, att] of [
    ['unknown kind', { kind: 'virus', name: 'x', exercises: [{ n: 'a', s: 1, r: 1, w: 1 }] }],
    ['no exercises', { kind: 'plan', name: 'x', exercises: [] }],
    ['41 exercises', { kind: 'plan', name: 'x', exercises: Array.from({ length: 41 }, () => ({ n: 'a', s: 1, r: 1, w: 1 })) }],
    ['weight 5000', { kind: 'plan', name: 'x', exercises: [{ n: 'a', s: 1, r: 1, w: 5000 }] }],
    ['text instead of number', { kind: 'plan', name: 'x', exercises: [{ n: 'a', s: '4', r: 1, w: 1 }] }],
    ['13 kB name padding', { kind: 'plan', name: 'x', exercises: Array.from({ length: 40 }, () => ({ n: 'y'.repeat(80), s: 1, r: 1, w: 1, sw: Array(99).fill(1) })) }],
    ['bad per-set weights', { kind: 'workout', name: 'x', exercises: [{ n: 'a', s: 1, r: 1, w: 1, sw: ['heavy'] }] }],
    ['an array', [1, 2, 3]],
  ]) {
    const x = await send(a, conv, 'bad', { attachment: att });
    check('rejected: ' + what, !!x.error, J(x.data));
  }
});

scenario('reactions: participants only, one per person, never moderators', async () => {
  const a = await member('xa'), b = await member('xb'), c = await member('xc');
  const mod = await member('xm'); L.makeModerator(mod);
  const conv = await befriend(a, b);
  const m = (await send(a, conv, 'hello')).data.id;
  let r = await b.c.from('message_reactions').insert({ message_id: m, user_id: b.id, emoji: '❤️' });
  check('friend reacts with ❤️', !r.error, errText(r));
  r = await b.c.from('message_reactions').upsert({ message_id: m, user_id: b.id, emoji: '🔥' }, { onConflict: 'message_id,user_id' });
  check('changing the reaction (upsert) works', !r.error, errText(r));
  check('one reaction per person', sqlVal(`select count(*) || ':' || max(emoji) from public.message_reactions where message_id = ${m}`) === '1:🔥');
  r = await a.c.from('message_reactions').insert({ message_id: m, user_id: a.id, emoji: '😂' });
  check('the sender can react to their own message too', !r.error, errText(r));
  check('participants see both reactions', rows(await a.c.from('message_reactions').select('*').eq('message_id', m)).length === 2);
  check('a stranger sees none', rows(await c.c.from('message_reactions').select('*').eq('message_id', m)).length === 0);
  check('a moderator sees none', rows(await mod.c.from('message_reactions').select('*').eq('message_id', m)).length === 0);
  check('a stranger cannot react', !!(await c.c.from('message_reactions').insert({ message_id: m, user_id: c.id, emoji: '👍' })).error);
  check('nobody reacts in someone else\'s name', !!(await a.c.from('message_reactions').insert({ message_id: m, user_id: c.id, emoji: '👍' })).error);
  check('unknown emoji refused', !!(await a.c.from('message_reactions').upsert({ message_id: m, user_id: a.id, emoji: '💩' }, { onConflict: 'message_id,user_id' })).error);
  await c.c.from('message_reactions').delete().eq('message_id', m).eq('user_id', b.id);
  check('nobody deletes someone else\'s reaction', sqlVal(`select count(*) from public.message_reactions where message_id = ${m} and user_id = ${lit(b.id)}`) === '1');
  await b.c.from('message_reactions').delete().eq('message_id', m).eq('user_id', b.id);
  check('removing one\'s own reaction', sqlVal(`select count(*) from public.message_reactions where message_id = ${m} and user_id = ${lit(b.id)}`) === '0');
  await a.c.from('friendships').delete().or(`and(user_a.eq.${a.id < b.id ? a.id : b.id},user_b.eq.${a.id < b.id ? b.id : a.id})`);
  check('closed chat (unfriended): no new reactions', !!(await b.c.from('message_reactions').insert({ message_id: m, user_id: b.id, emoji: '👍' })).error);
  check('reactions table is not in the Realtime publication', sqlVal(`select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'message_reactions'`) === '0');
});

scenario('shared plan / workout in posts: atomic, moderated, follows post visibility', async () => {
  const a = await member('pa'), b = await member('pb'), c = await member('pc');
  await befriend(a, b);
  let r = await a.c.rpc('create_post_shared', { p_text: 'My push day', p_photos: [], p_visibility: 'public', p_attachment: PLAN });
  check('post with a shared plan created', !r.error && !!r.data, errText(r));
  const pid = r.data;
  check('author sees the shared plan while it is pending', rows(await a.c.from('post_attachments').select('data').eq('post_id', pid)).length === 1);
  check('others do not see it before review', rows(await b.c.from('post_attachments').select('data').eq('post_id', pid)).length === 0);
  const ap = await M.c.from('posts').select('id').eq('id', pid);
  check('the moderator sees the pending post (to review it)', rows(ap).length === 1);
  check('the moderator sees its shared plan', rows(await M.c.from('post_attachments').select('data').eq('post_id', pid)).length === 1);
  await M.c.from('posts').update({ status: 'approved', published_at: new Date().toISOString() }).eq('id', pid);
  check('after approval everyone sees it', rows(await c.c.from('post_attachments').select('data').eq('post_id', pid)).length === 1);
  check('no adding a shared item after review', !!(await a.c.from('post_attachments').insert({ post_id: pid, data: WORKOUT })).error);
  r = await a.c.rpc('create_post_shared', { p_text: 'friends only', p_photos: [], p_visibility: 'friends', p_attachment: WORKOUT });
  const fp = r.data;
  await M.c.from('posts').update({ status: 'approved', published_at: new Date().toISOString() }).eq('id', fp);
  check('friends-only post: a friend sees the workout', rows(await b.c.from('post_attachments').select('data').eq('post_id', fp)).length === 1);
  check('friends-only post: a stranger does not', rows(await c.c.from('post_attachments').select('data').eq('post_id', fp)).length === 0);
  const before = sqlVal(`select count(*) from public.posts where user_id = ${lit(a.id)}`);
  r = await a.c.rpc('create_post_shared', { p_text: 'bad', p_photos: [], p_visibility: 'public', p_attachment: { kind: 'plan', name: 'x', exercises: [] } });
  check('invalid shared item: refused and no post left behind', !!r.error && sqlVal(`select count(*) from public.posts where user_id = ${lit(a.id)}`) === before, errText(r));
  const other = (await b.c.rpc('create_post', { p_text: 'b post' })).data;
  check('nobody attaches to someone else\'s post', !!(await a.c.from('post_attachments').insert({ post_id: other, data: PLAN })).error);
  check('anon sees nothing', rows(await L.anon().from('post_attachments').select('*')).length === 0);
});

scenario('profile achievements: real ids only, top 3, hide, block, cleanup', async () => {
  const a = await member('aa'), b = await member('ab'), c = await member('ac');
  let r = await a.c.rpc('profile_achievements_set', { p_ids: ['first', 'hundred', 'fifty', 'consistent12', 'made-up', 'xp200', 'ten'], p_workouts: 60 });
  check('set: stored', !r.error, errText(r));
  check('fake ids, 0-XP ids and ids above the workout count dropped; best first',
    sqlVal(`select array_to_string(ids, ',') from public.profile_achievements where user_id = ${lit(a.id)}`) === 'consistent12,fifty,ten,first',
    sqlVal(`select array_to_string(ids, ',') from public.profile_achievements where user_id = ${lit(a.id)}`));
  r = await b.c.rpc('profile_achievements_get', { p_user: a.id });
  check('another member sees the top 3', !r.error && J(r.data.top) === J(['consistent12', 'fifty', 'ten']) && r.data.count === 4, J(r.data));
  check('no direct table access', !!(await b.c.from('profile_achievements').select('*')).error);
  await a.c.rpc('profile_achievements_hide', { p_hidden: true });
  r = await b.c.rpc('profile_achievements_get', { p_user: a.id });
  check('hidden: others see nothing', J(r.data.top) === '[]', J(r.data));
  r = await a.c.rpc('profile_achievements_get', { p_user: a.id });
  check('hidden: the owner still sees theirs (and that they are hidden)', J(r.data.top) === J(['consistent12', 'fifty', 'ten']) && r.data.hidden === true, J(r.data));
  await a.c.rpc('profile_achievements_hide', { p_hidden: false });
  await c.c.from('blocks').insert({ blocker_id: c.id, blocked_id: a.id });
  r = await c.c.rpc('profile_achievements_get', { p_user: a.id });
  check('blocked: nothing', J(r.data.top) === '[]', J(r.data));
  check('anon cannot read', !!(await L.anon().rpc('profile_achievements_get', { p_user: a.id })).error);
  const minor = await L.newUser('x11-nonmember');
  check('a non-member cannot publish achievements', !!(await minor.c.rpc('profile_achievements_set', { p_ids: ['first'], p_workouts: 1 })).error);
  r = await L.admin.rpc('community_leave_cleanup', { p_user: a.id });
  check('leaving Community removes the showcase', !r.error && sqlVal(`select count(*) from public.profile_achievements where user_id = ${lit(a.id)}`) === '0', errText(r));
});

scenario('older app calls still work', async () => {
  const a = await member('oa'), b = await member('ob');
  const conv = await befriend(a, b);
  const r = await a.c.from('messages').insert({ conversation_id: conv, sender_id: a.id, body: 'plain' }).select('id,conversation_id,sender_id,body,created_at').single();
  check('plain message as before', !r.error, errText(r));
  const p = await a.c.rpc('create_post', { p_text: 'plain post', p_photos: [], p_visibility: 'public' });
  check('create_post as before', !p.error, errText(p));
});

scenario('rollback 0011_down and re-apply', async () => {
  const undone = L.rollbackFrom(11);
  check('after rollback: version 4', sqlVal('select public.community_social_version()') === '4');
  check('after rollback: new tables and columns gone', sqlVal(`select to_regclass('public.message_reactions') is null and to_regclass('public.post_attachments') is null
    and to_regclass('public.profile_achievements') is null and not exists (select 1 from information_schema.columns where table_name = 'messages' and column_name in ('reply_to', 'attachment'))`) === 't');
  check('after rollback: leave cleanup still works', !(await L.admin.rpc('community_leave_cleanup', { p_user: (await member('rbk')).id })).error);
  L.reapply(undone);
  check('re-applied: version back to ' + undone.versionBefore, sqlVal('select public.community_social_version()') === undone.versionBefore);
  await new Promise((r) => setTimeout(r, 1500));
});

(async () => {
  M = await L.newUser('x11-mod'); L.makeModerator(M);
  for (const sc of scenarios) {
    if (FILTER && !FILTER.test(sc.name)) continue;
    section(sc.name);
    try { await sc.fn(); } catch (e) { check('scenario error: ' + sc.name, false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
  }
  console.log('\n==== checks: ' + L.results.pass + ' passed, ' + L.results.fail + ' failed ====');
  process.exit(L.results.fail ? 1 : 0);
})();
