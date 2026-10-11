'use strict';
/* GymQuest social Phase 2 (migration 0008) — access rules, privacy and deletion.
   LOCAL test stack only (lib.js refuses anything else); disposable local accounts.
   Needs 0001–0006 + 0005 + 0008 applied and the delete-account function served
   locally (`supabase functions serve`).
   Usage: node tests/social/phase2.js [filter] */
const L = require('./lib');
const { check, section, errText, sql, sqlVal, lit } = L;

const FILTER = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const ok = (r) => r && !r.error;
const rows = (r) => (r && Array.isArray(r.data) ? r.data : []);
const code = (r) => (r && r.error && (r.error.code || '')) || '';
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const J = JSON.stringify;
let fx, M;

async function member(tag) {
  const u = await L.newUser('p2-' + tag);
  const j = await u.c.rpc('community_join');
  if (j.error) throw new Error('community_join ' + tag + ': ' + errText(j));
  return u;
}
async function approve(id) {
  const r = await M.c.from('posts').update({ status: 'approved', published_at: new Date().toISOString() }).eq('id', id).select('id');
  if (!ok(r) || !rows(r).length) throw new Error('approve: ' + errText(r));
}
async function textPost(u, text, visibility) {
  const r = await u.c.rpc('create_post', { p_text: text, p_photos: [], p_visibility: visibility || 'public' });
  if (!ok(r)) throw new Error('create_post: ' + errText(r));
  await approve(r.data);
  return r.data;
}
async function befriend(a, b) {
  const s = await a.c.from('friend_requests').insert({ from_id: a.id, to_id: b.id }).select('id').single();
  if (!ok(s)) throw new Error('request: ' + errText(s));
  const r = await b.c.rpc('accept_friend_request', { p_request: s.data.id });
  if (!ok(r)) throw new Error('accept: ' + errText(r));
}
async function invoke(u, mode) {
  const token = (await u.c.auth.getSession()).data.session.access_token;
  const r = await fetch(L.URL_ + '/functions/v1/delete-account', { method: 'POST',
    headers: { apikey: process.env.GQ_LOCAL_ANON, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: J({ mode }) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

scenario('search: only Community members who keep search on; no self, blocked or suspended', async () => {
  const tag = L.runTag.slice(-5);
  const A = await member('srch-a'), B = await member('srch-b'), C = await member('srch-c');
  const D = await L.newUser('p2-srch-d');                     // never opened Community
  for (const [u, n] of [[A, 'a'], [B, 'b'], [C, 'c'], [D, 'd']]) {   // searchable names (new accounts get user_<id>)
    const r = await u.c.from('profiles').update({ username: 'srch-' + n + '-' + tag }).eq('id', u.id).select('id');
    if (!ok(r) || !rows(r).length) throw new Error('rename: ' + errText(r));
  }
  const find = async (u, q) => rows(await u.c.rpc('search_users', { p_query: q })).map((r) => r.id);
  const q = 'srch-';
  let hits = await find(A, q + 'b-' + tag);
  check('a member finds another member by part of the username', hits.includes(B.id), J(hits));
  hits = await find(A, 'srch-');
  check('non-members never appear (account that never opened Community)', !hits.includes(D.id), J(hits));
  check('the caller is not listed', !hits.includes(A.id));
  check('queries shorter than 2 characters return nothing', (await find(A, 'p')).length === 0);
  await B.c.rpc('set_searchable', { p_on: false });
  check('"Show me in search" off hides the member', !(await find(A, q + 'b-' + tag)).includes(B.id));
  await B.c.rpc('set_searchable', { p_on: true });
  check('... and on shows them again', (await find(A, q + 'b-' + tag)).includes(B.id));
  await A.c.from('blocks').insert({ blocker_id: A.id, blocked_id: C.id });
  check('a blocked user is not found by the blocker', !(await find(A, q + 'c-' + tag)).includes(C.id));
  check('... nor does the blocked user find the blocker', !(await find(C, q + 'a-' + tag)).includes(A.id));
  sql('update public.profiles set suspended = true where id = ' + lit(B.id));
  check('a suspended account is not found', !(await find(C, q + 'b-' + tag)).includes(B.id));
  sql('update public.profiles set suspended = false where id = ' + lit(B.id));
  const an = await L.anon().rpc('search_users', { p_query: 'p2' });
  check('signed-out callers cannot search', !!an.error, errText(an));
  const r = await A.c.from('profiles').update({ searchable: false, community_joined_at: null }).eq('id', A.id);
  check('membership/search columns cannot be written directly (functions only)', !!r.error, errText(r));
});

scenario('friend requests and friendships: private, one per pair, members only', async () => {
  const A = await member('fr-a'), B = await member('fr-b'), C = await member('fr-c');
  const D = await L.newUser('p2-fr-d');
  const s = await A.c.from('friend_requests').insert({ from_id: A.id, to_id: B.id }).select('id').single();
  check('a member sends a request to a member', ok(s), errText(s));
  check('the recipient sees it as incoming', rows(await B.c.rpc('friend_requests_list')).some((r) => r.direction === 'incoming' && r.user_id === A.id));
  check('a third user cannot see it', rows(await C.c.from('friend_requests').select('id').eq('id', s.data.id)).length === 0);
  check('no duplicate request', !!(await A.c.from('friend_requests').insert({ from_id: A.id, to_id: B.id })).error);
  check('no reverse request while one is pending (accept instead)', !!(await B.c.from('friend_requests').insert({ from_id: B.id, to_id: A.id })).error);
  check('no request to a non-member', !!(await A.c.from('friend_requests').insert({ from_id: A.id, to_id: D.id })).error);
  check('no request to oneself', !!(await A.c.from('friend_requests').insert({ from_id: A.id, to_id: A.id })).error);
  check('no request in someone else\'s name', !!(await C.c.from('friend_requests').insert({ from_id: B.id, to_id: A.id })).error);
  const wrong = await A.c.rpc('accept_friend_request', { p_request: s.data.id });
  check('the sender cannot accept their own request', !!wrong.error, errText(wrong));
  const acc = await B.c.rpc('accept_friend_request', { p_request: s.data.id });
  check('the recipient accepts', ok(acc), errText(acc));
  check('both see "friends"', (await A.c.rpc('friend_state', { other: B.id })).data === 'friends'
    && (await B.c.rpc('friend_state', { other: A.id })).data === 'friends');
  check('the request is gone after accepting', sqlVal('select count(*) from public.friend_requests where from_id = ' + lit(A.id)) === '0');
  check('friend lists are private: a third user sees no friendship row', rows(await C.c.from('friendships').select('*')).length === 0);
  const cardByC = rows(await C.c.rpc('profile_card', { p_user: A.id }))[0];
  const cardByA = rows(await A.c.rpc('profile_card', { p_user: A.id }))[0];
  check('the friend count is shown only on one\'s own profile', cardByC && cardByC.friends === null && cardByA.friends === 1, J({ cardByC, cardByA }));
  check('friends_list shows only one\'s own friends', rows(await A.c.rpc('friends_list')).map((r) => r.user_id).join() === B.id);
  const fr2 = await C.c.from('friend_requests').insert({ from_id: C.id, to_id: B.id }).select('id').single();
  const dec = await B.c.from('friend_requests').delete().eq('id', fr2.data.id).select('id');
  check('the recipient declines (deletes) a request', ok(dec) && rows(dec).length === 1, errText(dec));
  const fr3 = await C.c.from('friend_requests').insert({ from_id: C.id, to_id: A.id }).select('id').single();
  const steal = await B.c.from('friend_requests').delete().eq('id', fr3.data.id).select('id');
  check('nobody else can delete a request', rows(steal).length === 0);
  await C.c.from('friend_requests').delete().eq('id', fr3.data.id);
  // spam limit: at most 3 requests to the same person in 30 days
  let n = 1;   // fr3 counted once
  for (let i = 0; i < 3; i++) {
    const t = await C.c.from('friend_requests').insert({ from_id: C.id, to_id: A.id }).select('id').single();
    if (ok(t)) { n++; await C.c.from('friend_requests').delete().eq('id', t.data.id); } else break;
  }
  check('at most 3 requests to the same person in 30 days', n === 3, 'sent ' + n);
});

scenario('chat: friends only, participants only — never moderators; realtime only to participants', async () => {
  const A = await member('ch-a'), B = await member('ch-b'), C = await member('ch-c');
  await befriend(A, B);
  const notFriend = await C.c.rpc('open_chat', { p_friend: A.id });
  check('no chat with a non-friend', !!notFriend.error, errText(notFriend));
  const o = await A.c.rpc('open_chat', { p_friend: B.id });
  check('a friend opens the chat', ok(o), errText(o));
  const conv = o.data;
  check('opening again returns the same chat', (await B.c.rpc('open_chat', { p_friend: A.id })).data === conv);
  // realtime: B and C (and the moderator) listen; only B may receive A's message
  const got = { B: [], C: [], M: [] };
  const subs = [], status = {};
  for (const [k, u] of [['B', B], ['C', C], ['M', M]]) {
    const ch = u.c.channel('p2-' + k + '-' + L.runTag).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
      (p) => got[k].push(p.new));
    await new Promise((res) => ch.subscribe((st) => { status[k] = st; if (st === 'SUBSCRIBED' || st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') res(); }));
    subs.push([u, ch]);
  }
  await wait(1500);
  const sent = await A.c.from('messages').insert({ conversation_id: conv, sender_id: A.id, body: 'hello B' }).select('id').single();
  check('a participant sends a message', ok(sent), errText(sent));
  for (let i = 0; i < 80 && !got.B.length; i++) await wait(250);
  await wait(1500);
  check('realtime: all three listeners subscribed', ['B', 'C', 'M'].every((k) => status[k] === 'SUBSCRIBED'), J(status));
  check('realtime: the other participant receives it live', got.B.some((m) => m.body === 'hello B'), J({ got: got.B, status }));
  check('realtime: a third user receives nothing', got.C.length === 0, J(got.C));
  check('realtime: a moderator receives nothing', got.M.length === 0, J(got.M));
  for (const [u, ch] of subs) await u.c.removeChannel(ch);
  check('the other participant reads it', rows(await B.c.from('messages').select('body').eq('conversation_id', conv)).length === 1);
  check('a third user cannot read the chat or its messages', rows(await C.c.from('messages').select('id').eq('conversation_id', conv)).length === 0
    && rows(await C.c.from('conversations').select('id').eq('id', conv)).length === 0);
  check('a moderator cannot read the chat or its messages', rows(await M.c.from('messages').select('id').eq('conversation_id', conv)).length === 0
    && rows(await M.c.from('conversations').select('id').eq('id', conv)).length === 0);
  check('no message in someone else\'s name', !!(await B.c.from('messages').insert({ conversation_id: conv, sender_id: A.id, body: 'spoof' })).error);
  check('no message into a chat one is not part of', !!(await C.c.from('messages').insert({ conversation_id: conv, sender_id: C.id, body: 'x' })).error);
  check('empty messages are refused', !!(await A.c.from('messages').insert({ conversation_id: conv, sender_id: A.id, body: '   ' })).error);
  let list = rows(await B.c.rpc('chat_list'));
  check('chat list shows the chat with 1 unread message', list.length === 1 && list[0].unread === 1 && list[0].other_id === A.id, J(list));
  check('unread total = 1', (await B.c.rpc('chat_unread_total')).data === 1);
  await B.c.rpc('mark_read', { p_conversation: conv });
  check('after mark_read: 0 unread', (await B.c.rpc('chat_unread_total')).data === 0);
  check('marking someone else\'s chat as read is refused', !!(await C.c.rpc('mark_read', { p_conversation: conv })).error);
  const delOther = await B.c.from('messages').delete().eq('id', sent.data.id).select('id');
  check('one cannot delete the other person\'s message', rows(delOther).length === 0);
  const m2 = await B.c.from('messages').insert({ conversation_id: conv, sender_id: B.id, body: 'reply' }).select('id').single();
  const delOwn = await B.c.from('messages').delete().eq('id', m2.data.id).select('id');
  check('deleting one\'s own message removes it for both', rows(delOwn).length === 1
    && rows(await A.c.from('messages').select('id').eq('id', m2.data.id)).length === 0);
  // report one message: only that message is copied for the moderator
  const repOwn = await A.c.rpc('report_message', { p_message: sent.data.id, p_reason: 'spam' });
  check('one cannot report one\'s own message', !!repOwn.error);
  check('a non-participant cannot report it', !!(await C.c.rpc('report_message', { p_message: sent.data.id, p_reason: 'spam' })).error);
  const rep = await B.c.rpc('report_message', { p_message: sent.data.id, p_reason: 'spam' });
  check('a participant reports the other\'s message', ok(rep), errText(rep));
  const modView = rows(await M.c.from('reports').select('message_excerpt,reported_user_id').eq('message_id', sent.data.id));
  check('the moderator sees only the copied message in the report', modView.length === 1 && modView[0].message_excerpt === 'hello B' && modView[0].reported_user_id === A.id, J(modView));
  check('... and still cannot read the conversation', rows(await M.c.from('messages').select('id').eq('conversation_id', conv)).length === 0);
  const forged = await C.c.from('reports').insert({ reporter_id: C.id, reported_user_id: A.id, reason: 'x', message_excerpt: 'fake' });
  check('a report with a forged message copy is refused', !!forged.error, errText(forged));
  // unfriend: read-only; re-friend reopens
  await A.c.from('friendships').delete().or('user_a.eq.' + A.id + ',user_b.eq.' + A.id);
  list = rows(await A.c.rpc('chat_list'));
  check('unfriending closes the chat (read-only)', list[0] && list[0].closed === true && list[0].can_send === false, J(list));
  check('... no new messages', !!(await A.c.from('messages').insert({ conversation_id: conv, sender_id: A.id, body: 'x' })).error);
  check('... the history is still readable', rows(await A.c.from('messages').select('id').eq('conversation_id', conv)).length === 1);
  await befriend(B, A);
  check('becoming friends again reopens it', rows(await A.c.rpc('chat_list'))[0].can_send === true);
  const del = await B.c.from('conversations').delete().eq('id', conv).select('id');
  check('"Delete chat" removes the chat and its messages for both', rows(del).length === 1
    && sqlVal('select count(*) from public.messages where conversation_id = ' + lit(conv)) === '0');
});

scenario('friends-only posts: friends only, never in Everyone/Following, photos protected', async () => {
  const A = await member('vis-a'), B = await member('vis-b'), C = await member('vis-c');
  await befriend(A, B);
  await C.c.from('follows').insert({ follower_id: C.id, followee_id: A.id });
  const pub = await textPost(A, 'public post', 'public');
  const fo = await textPost(A, 'friends only post', 'friends');
  const feedIds = async (u, scope, extra) => rows(await u.c.rpc('community_feed', Object.assign({ p_scope: scope }, extra || {}))).map((r) => r.post_id);
  check('Everyone shows the public post, never the friends-only one', (await feedIds(B, 'everyone')).includes(pub) && !(await feedIds(B, 'everyone')).includes(fo));
  check('Following never shows the friends-only one', !(await feedIds(C, 'following')).includes(fo) && (await feedIds(C, 'following')).includes(pub));
  check('the Friends feed shows it to a friend', (await feedIds(B, 'friends')).includes(fo));
  check('a friend sees it on the profile', (await feedIds(B, 'user', { p_user: A.id })).includes(fo));
  check('a non-friend (even a follower) cannot see it anywhere', !(await feedIds(C, 'user', { p_user: A.id })).includes(fo)
    && rows(await C.c.from('posts').select('id').eq('id', fo)).length === 0);
  check('a friend may like it', ok(await B.c.from('likes').insert({ post_id: fo, user_id: B.id })));
  check('a non-friend may not like it', !!(await C.c.from('likes').insert({ post_id: fo, user_id: C.id })).error);
  check('nobody can share a friends-only post', !!(await B.c.from('reposts').insert({ user_id: B.id, post_id: fo })).error);
  const lock = await A.c.from('posts').update({ visibility: 'public' }).eq('id', fo).select('id');
  check('visibility cannot be changed after review', !!lock.error && /post_locked/.test(errText(lock)), errText(lock));
  // a friends-only photo post: the photo loads for a friend, not for others
  const folder = A.id + '/vis' + L.runTag;
  for (const n of ['a.jpg', 'a_thumb.jpg']) await A.c.storage.from('community').upload(folder + '/' + n, fx.jpeg, { contentType: 'image/jpeg' });
  const ph = await A.c.rpc('create_post', { p_text: 'photo', p_photos: [{ image: folder + '/a.jpg', thumb: folder + '/a_thumb.jpg' }], p_visibility: 'friends' });
  await approve(ph.data);
  const sB = await B.c.storage.from('community').createSignedUrl(folder + '/a.jpg', 60);
  const sC = await C.c.storage.from('community').createSignedUrl(folder + '/a.jpg', 60);
  check('the photo of a friends-only post loads for a friend', ok(sB) && !!sB.data.signedUrl, errText(sB));
  check('... and not for a non-friend', !!sC.error || !sC.data, errText(sC));
  const v1 = await A.c.rpc('create_post', { p_text: 'v47 call' });
  check('the v47/v48 call create_post(p_text) still works (public by default)', ok(v1)
    && sqlVal('select visibility from public.posts where id = ' + lit(v1.data)) === 'public', errText(v1));
});

scenario('comments: visible with the post, deletable by author / post author / moderator, reportable', async () => {
  const A = await member('cm-a'), B = await member('cm-b'), C = await member('cm-c');
  const post = await textPost(A, 'comment on me', 'public');
  const c1 = await C.c.from('post_comments').insert({ post_id: post, user_id: C.id, body: 'nice!' }).select('id').single();
  check('a member comments on a visible post', ok(c1), errText(c1));
  const list = rows(await B.c.rpc('post_comments_list', { p_post: post }));
  check('others see the comment with its author', list.length === 1 && list[0].username && list[0].body === 'nice!', J(list));
  const feed = rows(await B.c.rpc('community_feed', { p_scope: 'everyone' })).find((r) => r.post_id === post);
  check('the feed shows the comment count', feed && feed.comments === 1, J(feed));
  check('no comment in someone else\'s name', !!(await B.c.from('post_comments').insert({ post_id: post, user_id: C.id, body: 'x' })).error);
  const pend = await A.c.rpc('create_post', { p_text: 'pending' });
  check('no comment on a pending post', !!(await B.c.from('post_comments').insert({ post_id: pend.data, user_id: B.id, body: 'x' })).error);
  check('empty comments are refused', !!(await B.c.from('post_comments').insert({ post_id: post, user_id: B.id, body: ' ' })).error);
  check('another user cannot delete the comment', rows(await B.c.from('post_comments').delete().eq('id', c1.data.id).select('id')).length === 0);
  check('the post author can delete it', rows(await A.c.from('post_comments').delete().eq('id', c1.data.id).select('id')).length === 1);
  const c2 = await C.c.from('post_comments').insert({ post_id: post, user_id: C.id, body: 'mine' }).select('id').single();
  check('the commenter can delete their own comment', rows(await C.c.from('post_comments').delete().eq('id', c2.data.id).select('id')).length === 1);
  const c3 = await C.c.from('post_comments').insert({ post_id: post, user_id: C.id, body: 'rude' }).select('id').single();
  const rep = await B.c.rpc('report_comment', { p_comment: c3.data.id, p_reason: 'abuse' });
  check('a comment can be reported (copy kept)', ok(rep) && sqlVal('select comment_excerpt from public.reports where comment_id = ' + lit(c3.data.id)) === 'rude', errText(rep));
  const rid = sqlVal('select id from public.reports where comment_id = ' + lit(c3.data.id));
  const res = await M.c.rpc('resolve_report', { p_report: rid, p_outcome: 'upheld', p_remove_post: true });
  check('upholding the report removes the comment (the post stays)', ok(res) && sqlVal('select count(*) from public.post_comments where id = ' + lit(c3.data.id)) === '0'
    && sqlVal('select status from public.posts where id = ' + lit(post)) === 'approved', errText(res));
  check('... and records the resolution time', sqlVal('select resolved_at is not null from public.reports where id = ' + lit(rid)) === 't');
  const c4 = await C.c.from('post_comments').insert({ post_id: post, user_id: C.id, body: 'later blocked' }).select('id').single();
  await A.c.from('blocks').insert({ blocker_id: A.id, blocked_id: C.id });
  check('blocking removes the blocked user\'s comments on the blocker\'s posts', sqlVal('select count(*) from public.post_comments where id = ' + lit(c4.data.id)) === '0');
  sql("insert into public.rate_events (user_id, kind) select " + lit(B.id) + ", 'comment_hour' from generate_series(1, 59)");
  check('comment limit: the 60th comment in an hour is accepted', ok(await B.c.from('post_comments').insert({ post_id: post, user_id: B.id, body: '60' })));
  const lim = await B.c.from('post_comments').insert({ post_id: post, user_id: B.id, body: '61' });
  check('... the 61st is refused', !!lim.error && /rate_limited/.test(errText(lim)), errText(lim));
});

scenario('blocking removes the friendship, requests and the whole chat', async () => {
  const A = await member('bl-a'), B = await member('bl-b');
  await befriend(A, B);
  const conv = (await A.c.rpc('open_chat', { p_friend: B.id })).data;
  await A.c.from('messages').insert({ conversation_id: conv, sender_id: A.id, body: 'before block' });
  await B.c.from('blocks').insert({ blocker_id: B.id, blocked_id: A.id });
  check('friendship, chat and messages are gone', sqlVal(`select (select count(*) from public.friendships where ${lit(A.id)} in (user_a, user_b))
    + (select count(*) from public.conversations where id = ${lit(conv)}) + (select count(*) from public.messages where conversation_id = ${lit(conv)})`) === '0');
  check('a new request between them is refused', !!(await A.c.from('friend_requests').insert({ from_id: A.id, to_id: B.id })).error);
});

scenario('daily purge: closed chats after 30 days, messages after 12 months, report copies 90 days after resolution', async () => {
  const A = await member('pg-a'), B = await member('pg-b'), C = await member('pg-c');
  await befriend(A, B); await befriend(A, C);
  const old = (await A.c.rpc('open_chat', { p_friend: B.id })).data;
  const live = (await A.c.rpc('open_chat', { p_friend: C.id })).data;
  await A.c.from('messages').insert({ conversation_id: live, sender_id: A.id, body: 'ancient' });
  await A.c.from('messages').insert({ conversation_id: live, sender_id: A.id, body: 'recent' });
  sql(`update public.conversations set closed_at = now() - interval '31 days' where id = ${lit(old)};
       update public.messages set created_at = now() - interval '13 months' where body = 'ancient' and conversation_id = ${lit(live)};
       insert into public.reports (reporter_id, reported_user_id, reason, message_id, message_excerpt, status, resolved_at)
       values (${lit(C.id)}, ${lit(A.id)}, 'x', 1, 'old copy', 'resolved', now() - interval '91 days'),
              (${lit(C.id)}, ${lit(A.id)}, 'x', 2, 'fresh copy', 'resolved', now() - interval '10 days');`);
  sql('select public.chat_purge()');
  check('a chat closed 31 days ago is deleted', sqlVal('select count(*) from public.conversations where id = ' + lit(old)) === '0');
  check('an open chat stays; its 13-month-old message is deleted, the recent one stays',
    sqlVal('select count(*) from public.conversations where id = ' + lit(live)) === '1'
    && sqlVal(`select string_agg(body, ',') from public.messages where conversation_id = ${lit(live)}`) === 'recent');
  check('a report copy resolved 91 days ago is erased, a 10-day-old one kept',
    sqlVal(`select count(*) from public.reports where reporter_id = ${lit(C.id)} and message_excerpt = 'old copy'`) === '0'
    && sqlVal(`select count(*) from public.reports where reporter_id = ${lit(C.id)} and message_excerpt = 'fresh copy'`) === '1');
  check('the purge job is scheduled daily', sqlVal("select schedule from cron.job where jobname = 'gymquest-chat-purge'") === '23 3 * * *');
});

scenario('Leave Community and full deletion remove all Phase 2 data', async () => {
  const X = await member('lv-x'), Y = await member('lv-y'), F = await member('lv-f');
  for (const u of [X, Y]) {
    await befriend(u, F);
    const conv = (await u.c.rpc('open_chat', { p_friend: F.id })).data;
    await u.c.from('messages').insert({ conversation_id: conv, sender_id: u.id, body: 'mine' });
    await F.c.from('messages').insert({ conversation_id: conv, sender_id: F.id, body: 'theirs' });
    await F.c.rpc('mark_read', { p_conversation: conv });
    const p = await textPost(F, 'post of F', 'public');
    await u.c.from('post_comments').insert({ post_id: p, user_id: u.id, body: 'my comment' });
    const own = await textPost(u, 'own post', 'friends');
    await F.c.from('post_comments').insert({ post_id: own, user_id: F.id, body: 'on your post' });
    const fm = rows(await F.c.from('messages').select('id').eq('sender_id', u.id))[0];
    await F.c.rpc('report_message', { p_message: fm.id, p_reason: 'x' });
    u.pending = (await u.c.from('friend_requests').insert({ from_id: u.id, to_id: (u === X ? Y : X).id }).select('id').single()).data;
  }
  const count = (id) => sqlVal(`select
      (select count(*) from public.friendships where ${lit(id)} in (user_a, user_b)) || ',' ||
      (select count(*) from public.friend_requests where ${lit(id)} in (from_id, to_id)) || ',' ||
      (select count(*) from public.conversations where ${lit(id)} in (user_a, user_b)) || ',' ||
      (select count(*) from public.messages where sender_id = ${lit(id)}) || ',' ||
      (select count(*) from public.post_comments where user_id = ${lit(id)})`);
  check('precondition: friendships, requests, chats, messages and comments exist', count(X.id).split(',').every((n) => Number(n) > 0), count(X.id));
  const leave = await invoke(X, 'community');
  check('Leave Community answers 200 ok', leave.status === 200 && leave.body && leave.body.ok === true, J(leave));
  check('Leave Community removed friendships, requests, chats, messages and comments', count(X.id) === '0,0,0,0,0', count(X.id));
  check('... and took the user out of search; account and profile kept',
    sqlVal('select community_joined_at is null from public.profiles where id = ' + lit(X.id)) === 't'
    && sqlVal('select count(*) from auth.users where id = ' + lit(X.id)) === '1');
  const del = await invoke(Y, 'full');
  check('full deletion answers 200 ok', del.status === 200 && del.body && del.body.ok === true, J(del));
  const left = sql(`select string_agg(t, ',') from (
      select 'auth' t from auth.users where id = ${lit(Y.id)}
      union all select 'profile' from public.profiles where id = ${lit(Y.id)}
      union all select 'friendships' from public.friendships where ${lit(Y.id)} in (user_a, user_b)
      union all select 'requests' from public.friend_requests where ${lit(Y.id)} in (from_id, to_id)
      union all select 'conversations' from public.conversations where ${lit(Y.id)} in (user_a, user_b)
      union all select 'messages' from public.messages where sender_id = ${lit(Y.id)}
      union all select 'chat_reads' from public.chat_reads where user_id = ${lit(Y.id)}
      union all select 'comments' from public.post_comments where user_id = ${lit(Y.id)}
      union all select 'report copies' from public.reports where reported_user_id = ${lit(Y.id)} or reporter_id = ${lit(Y.id)}) x`);
  check('full deletion leaves nothing (friends, requests, chats, messages, read markers, comments, report copies)', left === '', left);
});

scenario('signed-out callers and privileges', async () => {
  const an = L.anon();
  for (const t of ['friend_requests', 'friendships', 'conversations', 'messages', 'chat_reads', 'post_comments']) {
    const r = await an.from(t).select('*').limit(1);
    check('anon cannot read ' + t, !!r.error || rows(r).length === 0, errText(r));
  }
  for (const [f, a] of [['chat_list', {}], ['friends_list', {}], ['open_chat', { p_friend: M.id }], ['community_join', {}]]) {
    const r = await an.rpc(f, a);
    check('anon cannot call ' + f, !!r.error, errText(r));
  }
  const sr = sql(`select string_agg(c.relname || ':' || p, ',') from pg_class c cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
     where c.relnamespace = 'public'::regnamespace and c.relname in ('friend_requests','friendships','conversations','messages','chat_reads','post_comments')
       and has_table_privilege('service_role', c.oid, p)`);
  check('service_role has no direct rights on the new tables (the cleanup runs through one function)', sr === '', sr);
  check('authenticated users cannot call the Leave Community cleanup', !!(await M.c.rpc('community_leave_cleanup', { p_user: M.id })).error);
});

(async () => {
  fx = L.fixtures();
  if (sqlVal('select public.community_social_version()') !== '2') throw new Error('apply migration 0008 first');
  M = await L.newUser('p2-mod'); L.makeModerator(M);
  for (const sc of scenarios) {
    if (FILTER && !FILTER.test(sc.name)) continue;
    section(sc.name);
    try { await sc.fn(); } catch (e) { check('scenario ran without error', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)); }
  }
  console.log('\n==== checks: ' + L.results.pass + ' passed, ' + L.results.fail + ' failed ====');
  if (process.env.GQ_RESULTS) require('fs').writeFileSync(process.env.GQ_RESULTS, L.results.lines.join('\n') + '\n');
  process.exit(L.results.fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
