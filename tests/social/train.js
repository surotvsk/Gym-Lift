'use strict';
/* GymQuest migration 0014 (train together with a friend). LOCAL test stack only (lib.js refuses
   anything else); disposable local accounts.
   Usage: node tests/social/train.js [filter] */
const L = require('./lib');
const { check, section, errText, sql, sqlVal, lit } = L;
const FILTER = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const J = JSON.stringify;
/* jsonb ukladá kľúče v inom poradí – porovnáva sa obsah, nie text */
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => (o[k] = canon(v[k]), o), {}) : v);
const same = (a, b) => J(canon(a)) === J(canon(b));
const rows = (r) => (r && Array.isArray(r.data) ? r.data : []);

async function member(tag) {
  const u = await L.newUser('tr-' + tag);
  const j = await u.c.rpc('community_join');
  if (j.error) throw new Error('community_join ' + tag + ': ' + errText(j));
  return u;
}
async function befriend(a, b) {
  const s = await a.c.from('friend_requests').insert({ from_id: a.id, to_id: b.id }).select('id').single();
  if (s.error) throw new Error('request: ' + errText(s));
  const r = await b.c.rpc('accept_friend_request', { p_request: s.data.id });
  if (r.error) throw new Error('accept: ' + errText(r));
}
const PLAN = { kind: 'plan', name: 'Push day', exercises: [{ n: 'Bench press', id: 'bench-press', s: 4, r: 8, w: 60 }] };
const PROG = { plan: 'Push day', ex: 'Bench press', exId: 'bench-press', done: 3, total: 12, last: { r: 8, w: 62.5 } };
const invite = (u, friend, plan) => u.c.rpc('train_invite', { p_friend: friend.id, p_plan: plan || null });
const current = async (u) => (await u.c.rpc('train_current')).data;
const end = (u, sid) => u.c.rpc('train_end', { p_session: sid });

const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

scenario('version and access', async () => {
  check('community_social_version() is 7', sqlVal('select public.community_social_version()') === '7');
  const anon = L.anon();
  for (const t of ['train_sessions', 'train_progress', 'train_cheers']) {
    const r = await anon.from(t).select('*').limit(1);
    check('signed out: no access to ' + t, L.denied(r), errText(r));
  }
  for (const fn of ['train_invite', 'train_current', 'train_respond', 'train_end', 'train_progress_put', 'train_cheer']) {
    const r = await anon.rpc(fn, {});
    check('signed out: ' + fn + ' refused', !!r.error, errText(r));
  }
  const a = await member('acc');
  for (const t of ['train_sessions', 'train_progress', 'train_cheers']) {
    const r = await a.c.from(t).insert({}).select();
    check('no direct insert into ' + t + ' (only through the functions)', !!r.error, errText(r));
  }
  for (const fn of ['train_rate', 'train_busy']) {
    const r = await a.c.rpc(fn, fn === 'train_busy' ? { p_user: a.id } : { k: 'x', lim: 1, win: '1 hour' });
    check('internal helper ' + fn + ' not callable by members', !!r.error, errText(r));
  }
  check('Realtime publishes the three tables', sqlVal(`select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('train_sessions', 'train_progress', 'train_cheers')`) === '3');
});

scenario('invite: friends only', async () => {
  const a = await member('ia'), b = await member('ib'), c = await member('ic');
  await befriend(a, b);
  let r = await invite(a, c);
  check('inviting someone who is not a friend is refused', !!r.error && /not_allowed/.test(errText(r)), errText(r));
  r = await a.c.rpc('train_invite', { p_friend: a.id });
  check('inviting yourself is refused', !!r.error, errText(r));
  r = await invite(a, b, { kind: 'workout', name: 'x', exercises: [{ n: 'e', s: 1, r: 1, w: 1, d: 1 }] });
  check('a workout instead of a plan is refused', !!r.error && /invalid_plan/.test(errText(r)), errText(r));
  r = await invite(a, b, PLAN);
  check('inviting a friend with a plan works', !r.error && typeof r.data === 'string', errText(r));
  const sid = r.data;
  const ca = await current(a), cb = await current(b);
  check('host sees the invitation (role host, partner = guest, plan attached)', ca && ca.id === sid && ca.status === 'invited' && ca.role === 'host' && ca.partner.id === b.id && ca.plan && ca.plan.name === 'Push day', J(ca));
  check('guest sees it (role guest, partner = host)', cb && cb.id === sid && cb.role === 'guest' && cb.partner.id === a.id && cb.partner.username, J(cb));
  check('a third member sees nothing', (await current(c)) === null && rows(await c.c.from('train_sessions').select('id').eq('id', sid)).length === 0);
  r = await invite(a, b);
  const old = sqlVal(`select status from public.train_sessions where id = ${lit(sid)}`);
  check('a new invitation replaces the host\'s open one (old one cancelled)', !r.error && old === 'cancelled', { err: errText(r), old });
  r = await invite(b, a);
  check('the guest cannot invite back while invited (busy)', !!r.error && /train_busy_me/.test(errText(r)), errText(r));
  await end(a, r.data || (await current(a)).id);
});

scenario('blocked and suspended', async () => {
  const a = await member('ba'), b = await member('bb');
  await befriend(a, b);
  await b.c.from('blocks').insert({ blocker_id: b.id, blocked_id: a.id });
  const r = await invite(a, b);
  check('after a block: invitation refused', !!r.error, errText(r));
});

scenario('respond: join, decline, expiry', async () => {
  const a = await member('ra'), b = await member('rb'), c = await member('rc');
  await befriend(a, b); await befriend(a, c);
  let sid = (await invite(a, b)).data;
  let r = await a.c.rpc('train_respond', { p_session: sid, p_accept: true });
  check('the host cannot accept their own invitation', !!r.error && /not_allowed/.test(errText(r)), errText(r));
  r = await c.c.rpc('train_respond', { p_session: sid, p_accept: true });
  check('someone else cannot accept it', !!r.error, errText(r));
  r = await b.c.rpc('train_respond', { p_session: sid, p_accept: false });
  check('the guest declines', !r.error && r.data === 'declined', errText(r));
  check('declined → no current session for either', (await current(a)) === null && (await current(b)) === null);
  r = await b.c.rpc('train_respond', { p_session: sid, p_accept: true });
  check('a declined invitation cannot be accepted later', !!r.error && /train_expired/.test(errText(r)), errText(r));
  sid = (await invite(a, b)).data;
  sql(`update public.train_sessions set created_at = now() - interval '31 minutes' where id = ${lit(sid)}`);
  r = await b.c.rpc('train_respond', { p_session: sid, p_accept: true });
  check('an invitation older than 30 minutes has expired', !!r.error && /train_expired/.test(errText(r)), errText(r));
  check('…and is no longer shown', (await current(b)) === null);
  sid = (await invite(a, b)).data;
  r = await b.c.rpc('train_respond', { p_session: sid, p_accept: true });
  const cb = await current(b);
  check('the guest joins → active for both', !r.error && r.data === 'active' && cb.status === 'active' && cb.started_at && (await current(a)).status === 'active', errText(r));
  r = await invite(a, c);
  check('while training with ben, ada cannot invite cyd (one session at a time)', !!r.error && /train_busy_me/.test(errText(r)), errText(r));
  r = await invite(c, a);
  check('cyd cannot invite ada while she is training (busy friend)', !!r.error && /train_busy_friend/.test(errText(r)), errText(r));
  r = await end(b, sid);
  check('either participant ends the session', !r.error && r.data === 'ended' && (await current(a)) === null, errText(r));
  sid = (await invite(a, b)).data;
  await b.c.rpc('train_respond', { p_session: sid, p_accept: true });
  sql(`update public.train_sessions set started_at = now() - interval '6 hours 1 minute' where id = ${lit(sid)}`);
  check('an active session ends by itself after 6 hours', (await current(a)) === null && (await current(b)) === null);
  r = await a.c.rpc('train_progress_put', { p_session: sid, p_data: PROG });
  check('…and accepts no more progress', !!r.error && /train_not_active/.test(errText(r)), errText(r));
});

scenario('progress: partner only, validated', async () => {
  const a = await member('pa'), b = await member('pb'), c = await member('pc');
  await befriend(a, b);
  const sid = (await invite(a, b)).data;
  let r = await a.c.rpc('train_progress_put', { p_session: sid, p_data: PROG });
  check('no progress before the friend joins', !!r.error && /train_not_active/.test(errText(r)), errText(r));
  await b.c.rpc('train_respond', { p_session: sid, p_accept: true });
  r = await a.c.rpc('train_progress_put', { p_session: sid, p_data: PROG });
  check('progress saved', !r.error, errText(r));
  const cb = await current(b);
  check('the partner sees it (exercise, sets, last set) with a time', cb.theirs && same(cb.theirs.data, PROG) && cb.theirs.updated_at, J(cb.theirs));
  check('…and my own summary comes back as "mine"', same((await current(a)).mine, PROG));
  check('a third member cannot read it', rows(await c.c.from('train_progress').select('*').eq('session_id', sid)).length === 0);
  r = await c.c.rpc('train_progress_put', { p_session: sid, p_data: PROG });
  check('a third member cannot write into the session', !!r.error && /not_allowed/.test(errText(r)), errText(r));
  for (const [name, bad] of [
    ['unknown field (private data)', Object.assign({}, PROG, { history: [1, 2, 3] })],
    ['text too long', Object.assign({}, PROG, { ex: 'x'.repeat(81) })],
    ['done is not a number', Object.assign({}, PROG, { done: '3' })],
    ['negative total', Object.assign({}, PROG, { total: -1 })],
    ['bad last set', Object.assign({}, PROG, { last: { r: 8, w: 62.5, note: 'x' } })],
    ['not an object', [1, 2]],
  ]) {
    r = await a.c.rpc('train_progress_put', { p_session: sid, p_data: bad });
    check('refused: ' + name, !!r.error && /invalid_progress|check/.test(errText(r)), errText(r));
  }
  r = await b.c.rpc('train_progress_put', { p_session: sid, p_data: { plan: 'Legs', ex: 'Squat', done: 12, total: 12, fin: true } });
  check('the guest reports "finished"', !r.error && (await current(a)).theirs.data.fin === true, errText(r));
});

scenario('cheers', async () => {
  const a = await member('ca'), b = await member('cb'), c = await member('cc');
  await befriend(a, b);
  const sid = (await invite(a, b)).data;
  await b.c.rpc('train_respond', { p_session: sid, p_accept: true });
  let r = await b.c.rpc('train_cheer', { p_session: sid, p_emoji: '💪' });
  check('a cheer is sent', !r.error, errText(r));
  const ca = await current(a);
  check('the partner gets it (last 2 minutes)', ca.cheers.length === 1 && ca.cheers[0].emoji === '💪', J(ca.cheers));
  check('my own cheers are not listed back to me', (await current(b)).cheers.length === 0);
  r = await b.c.rpc('train_cheer', { p_session: sid, p_emoji: '<script>' });
  check('only the 4 cheer emojis are accepted', !!r.error && /invalid_cheer/.test(errText(r)), errText(r));
  r = await c.c.rpc('train_cheer', { p_session: sid, p_emoji: '🔥' });
  check('a third member cannot cheer', !!r.error, errText(r));
  let limited = false;
  for (let i = 0; i < 31 && !limited; i++) {
    const x = await b.c.rpc('train_cheer', { p_session: sid, p_emoji: '👏' });
    if (x.error && /rate_limited/.test(errText(x))) limited = true;
  }
  check('spam limit: at most 30 cheers in 10 minutes', limited);
});

scenario('invite spam limit', async () => {
  const a = await member('sa'), b = await member('sb');
  await befriend(a, b);
  let limited = false, n = 0;
  for (let i = 0; i < 32 && !limited; i++) {
    const r = await invite(a, b);
    if (r.error && /rate_limited/.test(errText(r))) limited = true; else n++;
  }
  check('at most 30 invitations a day', limited && n === 30, { n });
});

scenario('unfriend, leave Community, account deletion', async () => {
  const a = await member('ua'), b = await member('ub'), c = await member('uc');
  await befriend(a, b); await befriend(a, c);
  let sid = (await invite(a, b)).data;
  await b.c.rpc('train_respond', { p_session: sid, p_accept: true });
  await a.c.rpc('train_progress_put', { p_session: sid, p_data: PROG });
  await b.c.rpc('train_cheer', { p_session: sid, p_emoji: '🔥' });
  const pair = [a.id, b.id].sort();
  await a.c.from('friendships').delete().eq('user_a', pair[0]).eq('user_b', pair[1]);
  check('unfriending deletes the pair\'s session, progress and cheers', sqlVal(`select (select count(*) from public.train_sessions where id = ${lit(sid)}) + (select count(*) from public.train_progress where session_id = ${lit(sid)}) + (select count(*) from public.train_cheers where session_id = ${lit(sid)})`) === '0');
  sid = (await invite(a, c)).data;
  const r = await L.admin.rpc('community_leave_cleanup', { p_user: c.id });
  check('Leave Community (cleanup) removes the sessions too', !r.error && sqlVal(`select count(*) from public.train_sessions where id = ${lit(sid)}`) === '0', errText(r));
  const d = await member('ud'), e = await member('ue');
  await befriend(d, e);
  sid = (await invite(d, e)).data;
  await L.admin.auth.admin.deleteUser(e.id);
  check('deleting the account removes its sessions (cascade)', sqlVal(`select count(*) from public.train_sessions where id = ${lit(sid)}`) === '0');
});

scenario('old sessions are removed after 7 days', async () => {
  const a = await member('oa'), b = await member('ob');
  await befriend(a, b);
  const sid = (await invite(a, b)).data;
  await end(a, sid);
  sql(`update public.train_sessions set created_at = now() - interval '8 days' where id = ${lit(sid)}`);
  await invite(a, b);
  check('an ended session older than 7 days is deleted on the next invitation', sqlVal(`select count(*) from public.train_sessions where id = ${lit(sid)}`) === '0');
});

scenario('rollback 0014_down and re-apply', async () => {
  const undone = L.rollbackFrom(14);
  check('after rollback: version 6', sqlVal('select public.community_social_version()') === '6');
  check('after rollback: tables, functions and trigger gone', sqlVal(`select to_regclass('public.train_sessions') is null and to_regclass('public.train_progress') is null
    and to_regclass('public.train_cheers') is null and not exists (select 1 from pg_proc where proname like 'train\\_%')
    and not exists (select 1 from pg_trigger where tgname = 'friendships_train_cleanup')`) === 't');
  const a = await member('rk1'), b = await member('rk2');
  await befriend(a, b);
  const pair = [a.id, b.id].sort();
  const del = await a.c.from('friendships').delete().eq('user_a', pair[0]).eq('user_b', pair[1]).select('user_a');
  check('after rollback: unfriending still works', !del.error && rows(del).length === 1, errText(del));
  check('after rollback: leave cleanup still works', !(await L.admin.rpc('community_leave_cleanup', { p_user: a.id })).error);
  L.reapply(undone);
  check('re-applied: version 7 again', sqlVal('select public.community_social_version()') === '7');
  await new Promise((r) => setTimeout(r, 1500));
});

(async () => {
  for (const sc of scenarios) {
    if (FILTER && !FILTER.test(sc.name)) continue;
    section(sc.name);
    try { await sc.fn(); } catch (e) { check('scenario error: ' + sc.name, false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
  }
  console.log('\n==== checks: ' + L.results.pass + ' passed, ' + L.results.fail + ' failed ====');
  process.exit(L.results.fail ? 1 : 0);
})();
