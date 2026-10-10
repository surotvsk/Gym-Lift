'use strict';
/* GymQuest social (migration 0005) — feature, privacy and access-rule (RLS) suite.
   LOCAL test database only (see lib.js). Uses only disposable local users plus the
   pre-0005 users written by seed-pre0005.js (GQ_STATE). Run after applying 0005:

     node tests/social/run.js            # or a filter: node tests/social/run.js "block|age"
*/

const fs = require('fs');
const L = require('./lib');
const { check, section, errText, sql, sqlVal, lit } = L;

const FILTER = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const ok = (r) => r && !r.error;
const code = (r) => (r && r.error && (r.error.code || '')) || '';
const msg = (r) => (r && r.error && (r.error.message || '')) || '';
const rows = (r) => (r && Array.isArray(r.data) ? r.data : []);

let fx;
async function uploadPhoto(u, p, bytes, type) {
  return u.c.storage.from('community').upload(p, bytes || fx.jpeg, { contentType: type || 'image/jpeg' });
}
/* Upload n photos (+thumbs) into the caller's folder under a fresh post folder. */
async function uploadSet(u, n, tag) {
  const folder = u.id + '/' + (tag || 'p' + Math.random().toString(36).slice(2, 9));
  const out = [];
  for (let i = 0; i < n; i++) {
    const image = folder + '/' + i + '.jpg', thumb = folder + '/' + i + '_thumb.jpg';
    const a = await uploadPhoto(u, image), b = await uploadPhoto(u, thumb);
    if (a.error || b.error) throw new Error('upload: ' + errText(a) + errText(b));
    out.push({ image, thumb });
  }
  return out;
}
async function createPost(u, text, photos) {
  return u.c.rpc('create_post', { p_text: text, p_photos: photos || [] });
}
const approve = (M, id) => M.c.from('posts').update({ status: 'approved', published_at: new Date().toISOString() }).eq('id', id).select('id');
const feed = (u, scope, extra) => u.c.rpc('community_feed', Object.assign({ p_scope: scope }, extra || {}));
const signed = (u, p) => u.c.storage.from('community').createSignedUrl(p, 600);
async function readable(u, p) {
  const r = await signed(u, p);
  if (r.error || !r.data || !r.data.signedUrl) return false;
  const res = await fetch(r.data.signedUrl);
  return res.ok;
}

const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

/* ------------------------------------------------------------------------- */
let S, M, A, B, C;           // pre-0005 users (no 16+ confirmation yet), M = local test moderator
let U1, U2, U3, U4, U5;      // users created after 0005 (16+ confirmed at signup)

scenario('migration kept the pre-0005 data', async () => {
  const p = S.posts;
  const st = sql('select id, status, caption, image_path, thumb_path from public.posts where id in ('
    + [p.a1.id, p.a2.id, p.b1.id, p.c1.id].map(lit).join(',') + ') order by caption').split('\n');
  check('all 4 seeded posts still exist with status, text and photo paths', st.length === 4
    && st.some((l) => l.startsWith(p.a1.id + '|approved|edited after approval|' + p.a1.img + '|' + p.a1.th))
    && st.some((l) => l.startsWith(p.a2.id + '|pending|pending post|'))
    && st.some((l) => l.startsWith(p.b1.id + '|rejected|'))
    && st.some((l) => l.startsWith(p.c1.id + '|approved|')), st.join(' / '));
  check('already-approved posts credited once in the moderation history',
    sqlVal("select count(*) from public.moderation_actions where action = 'approve' and post_id in (" + lit(p.a1.id) + ',' + lit(p.c1.id) + ')') === '2');
  check('report and block kept', sqlVal('select count(*) from public.reports where post_id = ' + lit(p.a1.id)) === '1'
    && sqlVal('select count(*) from public.blocks where blocker_id = ' + lit(C.id)) === '1');
  check('private backup kept', sqlVal('select count(*) from public.backups where user_id = ' + lit(A.id)) === '1');
  check('owner still reads own photos', await readable(A, p.a2.img));
});

scenario('age: 16+ confirmation', async () => {
  const noAge = await L.admin.auth.admin.createUser({ email: 'gqlocal-noage-' + L.runTag + '@example.test', password: 'pw-x-12345A', email_confirm: true });
  check('account creation without the 16+ flag is refused (admin path)', !!noAge.error, 'created ' + (noAge.data && noAge.data.user && noAge.data.user.id));
  const pub = await L.anon().auth.signUp({ email: 'gqlocal-noage2-' + L.runTag + '@example.test', password: 'pw-x-12345A' });
  check('public signup without the 16+ flag is refused', !!pub.error);
  const withAge = await L.anon().auth.signUp({ email: 'gqlocal-age-' + L.runTag + '@example.test', password: 'pw-x-12345A', options: { data: { age_16_confirmed: true } } });
  check('public signup with the 16+ flag works', ok(withAge) && withAge.data.user, errText(withAge));
  const uid = withAge.data && withAge.data.user && withAge.data.user.id;
  check('signup stores only the fact (source=signup, age_min=16, no birth date column)',
    sqlVal('select source || \'|\' || age_min from public.community_consents where user_id = ' + lit(uid)) === 'signup|16'
    && sqlVal("select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'community_consents' and column_name ilike '%birth%'") === '0');

  // A: existing user without confirmation
  const before = await A.c.from('posts').select('id').eq('id', S.posts.c1.id);
  check('existing user without 16+ cannot see other users\' posts', rows(before).length === 0);
  check('... but still sees own posts', rows(await A.c.from('posts').select('id').eq('user_id', A.id)).length >= 2);
  check('... and still reads own private backup (sync unaffected)', rows(await A.c.from('backups').select('user_id').eq('user_id', A.id)).length === 1);
  const f = await A.c.from('follows').insert({ follower_id: A.id, followee_id: C.id });
  check('... cannot follow', !!f.error);
  const lk = await A.c.from('likes').insert({ post_id: S.posts.c1.id, user_id: A.id });
  check('... cannot like', !!lk.error);
  check('... cannot post', !!(await createPost(A, 'hello')).error);
  check('... other users\' photos do not load', !(await readable(A, S.posts.c1.th)));
  const acc = await A.c.rpc('accept_age_requirement');
  check('one-time confirmation works', ok(acc) && sqlVal('select source from public.community_consents where user_id = ' + lit(A.id)) === 'prompt', errText(acc));
  check('after confirming, approved posts of others are visible', rows(await A.c.from('posts').select('id').eq('id', S.posts.c1.id)).length === 1);
  check('... and their photos load', await readable(A, S.posts.c1.th));
  for (const u of [B, C, M]) await u.c.rpc('accept_age_requirement');
  check('consents: own row only', rows(await U1.c.from('community_consents').select('user_id')).every((r) => r.user_id === U1.id)
    && rows(await U1.c.from('community_consents').select('user_id')).length === 1);
});

scenario('anon (signed-out) has no access', async () => {
  const an = L.anon();
  for (const t of ['profiles', 'posts', 'reports', 'blocks', 'follows', 'likes', 'reposts', 'post_media', 'post_stats',
    'profile_stats', 'community_consents', 'moderation_actions', 'rate_events', 'username_changes', 'backups', 'backup_versions']) {
    const r = await an.from(t).select('*').limit(1);
    check('anon cannot read ' + t, !!r.error || rows(r).length === 0, 'rows=' + rows(r).length);
  }
  for (const [fn, args] of [['community_feed', { p_scope: 'everyone' }], ['profile_card', { p_user: A.id }],
    ['is_moderator', {}], ['active_post_count', { uid: A.id }], ['community_object_count', { uid: A.id }],
    ['follow_list', { p_user: A.id, p_kind: 'followers' }], ['create_post', { p_text: 'x' }]]) {
    const r = await an.rpc(fn, args);
    check('anon cannot call ' + fn, !!r.error, JSON.stringify(r.data));
  }
  check('anon cannot load an approved post\'s photo', !(await readable({ c: an }, S.posts.c1.img)));
  const up = await an.storage.from('community').upload(A.id + '/anon.jpg', fx.jpeg, { contentType: 'image/jpeg' });
  check('anon cannot upload', !!up.error);
});

scenario('posts: text-only, 1–4 photos, limits', async () => {
  const t = await createPost(U1, '  Leg day done 💪  ');
  check('text-only post created (pending)', ok(t) && sqlVal('select status || \'|\' || caption || \'|\' || coalesce(image_path, \'NULL\') from public.posts where id = ' + lit(t.data)) === 'pending|Leg day done 💪|NULL', errText(t));
  check('empty post (no text, no photo) refused', !!(await createPost(U1, '   ')).error);
  check('text over 500 characters refused', !!(await createPost(U1, 'x'.repeat(501))).error);
  const four = await uploadSet(U1, 4);
  const p4 = await createPost(U1, 'four photos', four);
  check('post with 4 photos created', ok(p4) && sqlVal('select count(*) from public.post_media where post_id = ' + lit(p4.data)) === '3', errText(p4));
  const five = await uploadSet(U1, 5);
  const p5 = await createPost(U1, 'five', five);
  check('5 photos refused (too_many_photos)', /too_many_photos/.test(msg(p5)), errText(p5));
  const one = await uploadSet(U2, 1);
  const p1 = await createPost(U2, '', one);
  check('photo-only post (no text) created', ok(p1), errText(p1));
  U2.photoPost = p1.data; U2.photo = one[0];
  U1.textPost = t.data; U1.fourPost = p4.data; U1.four = four;

  const big = Buffer.alloc(6 * 1024 * 1024 + 10, 1);
  check('file over 6 MB refused by the bucket', !!(await uploadPhoto(U1, U1.id + '/big/0.jpg', big)).error);
  check('non-image type refused (text/plain)', !!(await uploadPhoto(U1, U1.id + '/t/0.jpg', Buffer.from('hello'), 'text/plain')).error);
  check('GIF refused', !!(await uploadPhoto(U1, U1.id + '/g/0.jpg', fx.jpeg, 'image/gif')).error);
  check('PNG accepted', ok(await uploadPhoto(U1, U1.id + '/png/0.png', fx.png, 'image/png')));
  check('WebP type accepted', ok(await uploadPhoto(U1, U1.id + '/webp/0.webp', fx.jpeg, 'image/webp')));
});

scenario('photo paths: ownership and no swap after review', async () => {
  const other = await uploadSet(U2, 1);
  const r1 = await createPost(U1, 'steal', other);
  check('create_post with another user\'s photo path refused', !!r1.error, errText(r1));
  const r2 = await U1.c.from('posts').insert({ user_id: U1.id, image_path: other[0].image, thumb_path: other[0].thumb, caption: 'steal2' });
  check('direct insert with another user\'s photo path refused (v46 path)', !!r2.error, errText(r2));
  const mine = await uploadSet(U1, 1);
  const r3 = await createPost(U1, 'mixed', [mine[0], other[0]]);
  check('photo 2 from another user\'s folder refused', !!r3.error, errText(r3));
  const r4 = await createPost(U1, 'dots', [{ image: U1.id + '/../' + U2.id + '/x.jpg', thumb: U1.id + '/x_thumb.jpg' }]);
  check('path with ../ refused', !!r4.error, errText(r4));
  const up = await uploadPhoto(U1, U2.id + '/intrude/0.jpg');
  check('upload into another user\'s folder refused', !!up.error);
  const later = await U1.c.from('post_media').insert({ post_id: U1.fourPost, position: 3, image_path: mine[0].image, thumb_path: mine[0].thumb });
  check('photos cannot be added to an existing post later', !!later.error, errText(later));

  // Swap: delete a referenced file and upload different bytes under the same path.
  const del = await U2.c.storage.from('community').remove([U2.photo.image]);
  check('owner may delete own file', ok(del));
  const swap = await uploadPhoto(U2, U2.photo.image, fx.png, 'image/png');
  check('re-upload onto a path a post references is refused (no swap)', !!swap.error);
});

scenario('post text locked after review; moderation log', async () => {
  const pend = await U1.c.from('posts').update({ caption: 'Leg day done 💪 (edited)' }).eq('id', U1.textPost).select('caption');
  check('pending post text editable by author', ok(pend) && rows(pend)[0] && rows(pend)[0].caption.endsWith('(edited)'), errText(pend));
  const ap = await approve(M, U1.textPost);
  check('moderator approves', rows(ap).length === 1, errText(ap));
  const locked = await U1.c.from('posts').update({ caption: 'swapped text' }).eq('id', U1.textPost).select('caption');
  check('approved post text is locked (post_locked)', /post_locked/.test(msg(locked)), errText(locked) || JSON.stringify(locked.data));
  await approve(M, U1.fourPost); await approve(M, U2.photoPost);
  const rej = await createPost(U3, 'will be rejected');
  await M.c.from('posts').update({ status: 'rejected' }).eq('id', rej.data);
  const lockedRej = await U3.c.from('posts').update({ caption: 'retry' }).eq('id', rej.data).select('caption');
  check('rejected post text is locked', /post_locked/.test(msg(lockedRej)), errText(lockedRej));
  U3.rejected = rej.data;
  const pending = await createPost(U3, 'still pending');
  U3.pending = pending.data;
  check('approve / reject recorded with the moderator', sqlVal("select count(*) from public.moderation_actions where moderator_id = " + lit(M.id)
    + " and ((post_id = " + lit(U1.textPost) + " and action = 'approve') or (post_id = " + lit(rej.data) + " and action = 'reject'))") === '2');
  const forged = await U3.c.from('posts').insert({ user_id: U3.id, caption: 'time travel', created_at: '2000-01-01T00:00:00Z' }).select('created_at').single();
  check('a client cannot backdate created_at', ok(forged) && !String(forged.data.created_at).startsWith('2000'), errText(forged));
  await U3.c.from('posts').delete().eq('id', forged.data && forged.data.id);
});

scenario('visibility: pending / rejected / approved, photos 1–4', async () => {
  check('others see approved text post', rows(await U2.c.from('posts').select('id').eq('id', U1.textPost)).length === 1);
  check('others do not see a pending post', rows(await U1.c.from('posts').select('id').eq('id', U3.pending)).length === 0);
  check('others do not see a rejected post', rows(await U1.c.from('posts').select('id').eq('id', U3.rejected)).length === 0);
  check('moderator sees pending', rows(await M.c.from('posts').select('id').eq('id', U3.pending)).length === 1);
  check('photos 1–4 of an approved post load for others', (await Promise.all(U1.four.map((p) => readable(U2, p.image)))).every(Boolean));
  const p = await uploadSet(U3, 2);
  const pend = await createPost(U3, 'pending photos', p);
  check('photos of a pending post do not load for others', !(await readable(U1, p[0].image)) && !(await readable(U1, p[1].image)), errText(pend));
  check('... but load for the moderator', await readable(M, p[1].image));
  check('... and for the author', await readable(U3, p[1].thumb));
  check('extra photos of a pending post are not listed to others', rows(await U1.c.from('post_media').select('post_id').eq('post_id', pend.data)).length === 0);
  const ev = rows(await feed(U2, 'everyone', { p_limit: 50 }));
  const item = ev.find((x) => x.post_id === U1.fourPost);
  check('Everyone feed lists the approved post with all 4 photos in order', item && item.photos.length === 4 && item.photos[0].image === U1.four[0].image && item.photos[3].image === U1.four[3].image);
  check('Everyone feed has no pending or rejected posts', !ev.some((x) => x.post_id === U3.pending || x.post_id === U3.rejected || x.post_id === pend.data));
  const list = await U1.c.storage.from('community').list(U3.id);
  check('cannot list another user\'s folder', rows(list).length === 0, JSON.stringify(list.data));
});

scenario('follows', async () => {
  const f = await U1.c.from('follows').insert({ follower_id: U1.id, followee_id: U2.id });
  check('follow works', ok(f), errText(f));
  check('duplicate follow refused', !!(await U1.c.from('follows').insert({ follower_id: U1.id, followee_id: U2.id })).error);
  check('self-follow refused', !!(await U1.c.from('follows').insert({ follower_id: U1.id, followee_id: U1.id })).error);
  check('following on behalf of someone else refused', !!(await U1.c.from('follows').insert({ follower_id: U3.id, followee_id: U2.id })).error);
  await U3.c.from('follows').insert({ follower_id: U3.id, followee_id: U2.id });
  await U2.c.from('follows').insert({ follower_id: U2.id, followee_id: U3.id });
  const card = rows(await U1.c.rpc('profile_card', { p_user: U2.id }))[0] || {};
  check('profile counts: followers 2, following 1, i_follow', card.followers === 2 && card.following === 1 && card.i_follow === true, JSON.stringify(card));
  const fl = rows(await U1.c.rpc('follow_list', { p_user: U2.id, p_kind: 'followers' })).map((r) => r.user_id).sort();
  check('followers list', JSON.stringify(fl) === JSON.stringify([U1.id, U3.id].sort()), JSON.stringify(fl));
  const fg = rows(await U1.c.rpc('follow_list', { p_user: U2.id, p_kind: 'following' })).map((r) => r.user_id);
  check('following list', fg.length === 1 && fg[0] === U3.id);
  const un = await U3.c.from('follows').delete().eq('follower_id', U3.id).eq('followee_id', U2.id).select('followee_id');
  check('unfollow works and counts drop', rows(un).length === 1 && (rows(await U1.c.rpc('profile_card', { p_user: U2.id }))[0] || {}).followers === 1);
  const steal = await U3.c.from('follows').delete().eq('follower_id', U1.id).select('followee_id');
  check('cannot remove someone else\'s follow', rows(steal).length === 0 && sqlVal('select count(*) from public.follows where follower_id = ' + lit(U1.id)) === '1');
  check('counters cannot be written by clients', !!(await U1.c.from('profile_stats').update({ followers: 999 }).eq('user_id', U1.id).select('user_id')).error
    || rows(await U1.c.from('profile_stats').update({ followers: 999 }).eq('user_id', U1.id).select('user_id')).length === 0);
  check('counters cannot be inserted by clients', !!(await U1.c.from('post_stats').insert({ post_id: U1.textPost, likes: 50 })).error);
});

scenario('likes and shares', async () => {
  const lk = await U2.c.from('likes').insert({ post_id: U1.fourPost, user_id: U2.id });
  check('like an approved post', ok(lk), errText(lk));
  check('double like refused', !!(await U2.c.from('likes').insert({ post_id: U1.fourPost, user_id: U2.id })).error);
  await U3.c.from('likes').insert({ post_id: U1.fourPost, user_id: U3.id });
  check('like count 2', sqlVal('select likes from public.post_stats where post_id = ' + lit(U1.fourPost)) === '2');
  check('like a pending post refused', !!(await U1.c.from('likes').insert({ post_id: U3.pending, user_id: U1.id })).error);
  check('like a rejected post refused', !!(await U1.c.from('likes').insert({ post_id: U3.rejected, user_id: U1.id })).error);
  check('liking as someone else refused', !!(await U1.c.from('likes').insert({ post_id: U2.photoPost, user_id: U3.id })).error);
  check('who liked stays private (other users)', rows(await U3.c.from('likes').select('user_id').eq('post_id', U1.fourPost)).every((r) => r.user_id === U3.id));
  check('who liked stays private (the post author)', rows(await U1.c.from('likes').select('user_id').eq('post_id', U1.fourPost)).length === 0);
  check('who liked stays private (moderators)', rows(await M.c.from('likes').select('user_id').eq('post_id', U1.fourPost)).length === 0);
  const it = rows(await feed(U2, 'everyone', { p_limit: 50 })).find((x) => x.post_id === U1.fourPost) || {};
  check('feed shows count and liked_by_me', it.likes === 2 && it.liked_by_me === true, JSON.stringify(it));
  const unl = await U3.c.from('likes').delete().eq('post_id', U1.fourPost).eq('user_id', U3.id).select('post_id');
  check('unlike works, count 1', rows(unl).length === 1 && sqlVal('select likes from public.post_stats where post_id = ' + lit(U1.fourPost)) === '1');

  const rp = await U2.c.from('reposts').insert({ user_id: U2.id, post_id: U1.fourPost });
  check('share an approved post', ok(rp), errText(rp));
  check('double share refused', !!(await U2.c.from('reposts').insert({ user_id: U2.id, post_id: U1.fourPost })).error);
  check('sharing own post refused', !!(await U1.c.from('reposts').insert({ user_id: U1.id, post_id: U1.fourPost })).error);
  check('sharing a pending post refused', !!(await U1.c.from('reposts').insert({ user_id: U1.id, post_id: U3.pending })).error);
  check('share count 1', sqlVal('select reposts from public.post_stats where post_id = ' + lit(U1.fourPost)) === '1');
});

scenario('Following feed', async () => {
  // U1 follows U2 (from 'follows'). U2 shared U1's 4-photo post. U3 posts; U2 shares it.
  const u3post = await createPost(U3, 'U3 approved post'); await approve(M, u3post.data); U3.approved = u3post.data;
  await U2.c.from('reposts').insert({ user_id: U2.id, post_id: U3.approved });
  const fd = rows(await feed(U1, 'following', { p_limit: 50 }));
  const ids = fd.map((x) => x.post_id);
  check('own-follow feed: U2\'s approved post is there', ids.includes(U2.photoPost));
  check('a share by a followed account appears once, marked as shared by them', fd.filter((x) => x.post_id === U3.approved).length === 1
    && (fd.find((x) => x.post_id === U3.approved) || {}).reposted_by === U2.id);
  check('posts of accounts I do not follow (and nobody I follow shared) are absent', !ids.includes(S.posts.c1.id));
  check('no duplicates', new Set(ids).size === ids.length);
  check('newest activity first', fd.every((x, i) => i === 0 || new Date(fd[i - 1].activity_at) >= new Date(x.activity_at)));
  const p1 = rows(await feed(U1, 'following', { p_limit: 1 }));
  const p2 = rows(await feed(U1, 'following', { p_limit: 1, p_before: p1[0].activity_at, p_before_id: p1[0].post_id }));
  check('paging continues without repeating', p1.length === 1 && p2.length === 1 && p1[0].post_id !== p2[0].post_id);
  const pend = await createPost(U2, 'U2 pending');
  check('pending posts of followed accounts are absent', !rows(await feed(U1, 'following', { p_limit: 50 })).some((x) => x.post_id === pend.data));
  const up = rows(await feed(U1, 'user', { p_user: U2.id, p_limit: 50 })).map((x) => x.post_id);
  check('profile feed: only that user\'s approved posts', up.includes(U2.photoPost) && !up.includes(pend.data) && !up.includes(U3.approved));
  U2.pending = pend.data;
});

scenario('blocks', async () => {
  // Before: U1 -> U2 follow, U2 -> U1? add; U2 likes and shares U1's post.
  await U2.c.from('follows').insert({ follower_id: U2.id, followee_id: U1.id });
  const b = await U1.c.from('blocks').insert({ blocker_id: U1.id, blocked_id: U2.id });
  check('block works', ok(b), errText(b));
  check('follows removed in both directions', sqlVal('select count(*) from public.follows where (follower_id = ' + lit(U1.id) + ' and followee_id = ' + lit(U2.id) + ') or (follower_id = ' + lit(U2.id) + ' and followee_id = ' + lit(U1.id) + ')') === '0');
  check('blocked user\'s like on the blocker\'s post removed', sqlVal('select count(*) from public.likes where user_id = ' + lit(U2.id) + ' and post_id = ' + lit(U1.fourPost)) === '0');
  check('blocked user\'s share of the blocker\'s post removed', sqlVal('select count(*) from public.reposts where user_id = ' + lit(U2.id) + ' and post_id = ' + lit(U1.fourPost)) === '0');
  check('counters follow the clean-up', sqlVal('select likes || \'/\' || reposts from public.post_stats where post_id = ' + lit(U1.fourPost)) === '0/0');
  for (const [x, y, label] of [[U2, U1, 'blocked user'], [U1, U2, 'blocker']]) {
    check(label + ' cannot see the other\'s profile', rows(await x.c.from('profiles').select('id').eq('id', y.id)).length === 0
      && rows(await x.c.rpc('profile_card', { p_user: y.id })).length === 0);
    check(label + ' cannot see the other\'s posts (table and feeds)', rows(await x.c.from('posts').select('id').eq('user_id', y.id)).length === 0
      && !rows(await feed(x, 'everyone', { p_limit: 50 })).some((i) => i.author_id === y.id));
  }
  check('blocked user cannot load the blocker\'s photos', !(await readable(U2, U1.four[0].image)));
  check('blocker cannot load the blocked user\'s photos', !(await readable(U1, U2.photo.thumb)));
  check('blocked user cannot follow the blocker', !!(await U2.c.from('follows').insert({ follower_id: U2.id, followee_id: U1.id })).error);
  check('blocker cannot follow the blocked user', !!(await U1.c.from('follows').insert({ follower_id: U1.id, followee_id: U2.id })).error);
  check('blocked user cannot like / share the blocker\'s post', !!(await U2.c.from('likes').insert({ post_id: U1.fourPost, user_id: U2.id })).error
    && !!(await U2.c.from('reposts').insert({ user_id: U2.id, post_id: U1.fourPost })).error);
  // A third user's Following feed: a share of a post whose author they blocked disappears.
  await U5.c.from('follows').insert({ follower_id: U5.id, followee_id: U3.id });
  await U3.c.from('reposts').insert({ user_id: U3.id, post_id: U2.photoPost });
  const beforeB = rows(await feed(U5, 'following', { p_limit: 50 })).some((x) => x.post_id === U2.photoPost);
  await U5.c.from('blocks').insert({ blocker_id: U5.id, blocked_id: U2.id });
  const afterB = rows(await feed(U5, 'following', { p_limit: 50 })).some((x) => x.post_id === U2.photoPost);
  check('Following feed: a share of a blocked author\'s post disappears', beforeB && !afterB, 'before=' + beforeB + ' after=' + afterB);
  await U5.c.from('blocks').delete().eq('blocker_id', U5.id).eq('blocked_id', U2.id);
  // Lists: U2 follows U3 (from 'follows'); the blocker U1 must not see U2 in U3's followers.
  const u3f = rows(await U1.c.rpc('follow_list', { p_user: U3.id, p_kind: 'followers' })).map((r) => r.user_id);
  check('follower lists never show someone the viewer blocked', sqlVal('select count(*) from public.follows where follower_id = ' + lit(U2.id) + ' and followee_id = ' + lit(U3.id)) === '1'
    && !u3f.includes(U2.id), JSON.stringify(u3f));
  await U3.c.from('follows').insert({ follower_id: U3.id, followee_id: U1.id });
  check('the blocked user cannot read the blocker\'s follower list', rows(await U2.c.rpc('follow_list', { p_user: U1.id, p_kind: 'followers' })).length === 0
    && rows(await U2.c.from('follows').select('follower_id').eq('followee_id', U1.id)).length === 0);
  check('the block row is private to the blocker', rows(await U2.c.from('blocks').select('blocker_id')).length === 0);
  const unb = await U1.c.from('blocks').delete().eq('blocker_id', U1.id).eq('blocked_id', U2.id).select('blocked_id');
  check('unblock makes the profile visible again (follows are not restored)', rows(unb).length === 1
    && rows(await U2.c.from('profiles').select('id').eq('id', U1.id)).length === 1
    && sqlVal('select count(*) from public.follows where follower_id = ' + lit(U1.id) + ' and followee_id = ' + lit(U2.id)) === '0');
});

scenario('suspension', async () => {
  const p = await uploadSet(U4, 1); const post = await createPost(U4, 'U4 post', p); await approve(M, post.data);
  await U1.c.from('follows').insert({ follower_id: U1.id, followee_id: U4.id });
  check('before: U4 post visible', rows(await U1.c.from('posts').select('id').eq('id', post.data)).length === 1);
  check('a normal user cannot suspend', rows(await U1.c.from('profiles').update({ suspended: true }).eq('id', U4.id).select('id')).length === 0
    && sqlVal('select suspended from public.profiles where id = ' + lit(U4.id)) === 'f');
  const s = await M.c.from('profiles').update({ suspended: true }).eq('id', U4.id).select('id');
  check('moderator suspends', rows(s).length === 1, errText(s));
  check('suspended account\'s posts disappear (table, Everyone, Following, profile)', rows(await U1.c.from('posts').select('id').eq('id', post.data)).length === 0
    && !rows(await feed(U1, 'everyone', { p_limit: 50 })).some((x) => x.post_id === post.data)
    && !rows(await feed(U1, 'following', { p_limit: 50 })).some((x) => x.post_id === post.data)
    && !rows(await feed(U1, 'user', { p_user: U4.id })).length);
  check('... and their photos stop loading', !(await readable(U1, p[0].image)));
  check('suspended account cannot post, upload, follow, like or share', !!(await createPost(U4, 'x')).error
    && !!(await uploadPhoto(U4, U4.id + '/s/0.jpg')).error
    && !!(await U4.c.from('follows').insert({ follower_id: U4.id, followee_id: U3.id })).error
    && !!(await U4.c.from('likes').insert({ post_id: U3.approved, user_id: U4.id })).error
    && !!(await U4.c.from('reposts').insert({ user_id: U4.id, post_id: U3.approved })).error);
  check('nobody can follow a suspended account', !!(await U3.c.from('follows').insert({ follower_id: U3.id, followee_id: U4.id })).error);
  check('only the account itself and moderators learn the suspended flag via profile_card',
    (rows(await U1.c.rpc('profile_card', { p_user: U4.id }))[0] || {}).suspended === null
    && (rows(await M.c.rpc('profile_card', { p_user: U4.id }))[0] || {}).suspended === true);
  const lift = await M.c.from('profiles').update({ suspended: false }).eq('id', U4.id).select('id');
  check('lift suspension: posts visible again', rows(lift).length === 1 && rows(await U1.c.from('posts').select('id').eq('id', post.data)).length === 1);
  check('suspend and lift recorded', sqlVal("select string_agg(action, ',' order by id) from public.moderation_actions where user_id = " + lit(U4.id) + " and action in ('suspend','unsuspend')") === 'suspend,unsuspend');
  U4.post = post.data;
});

scenario('reports and review', async () => {
  const r1 = await U1.c.from('reports').insert({ reporter_id: U1.id, post_id: U4.post, reason: 'Spam' }).select('id').single();
  const r2 = await U3.c.from('reports').insert({ reporter_id: U3.id, post_id: U2.photoPost, reason: 'Harassment' }).select('id').single();
  check('users can report', ok(r1) && ok(r2), errText(r1) + errText(r2));
  check('reporter sees only own reports', rows(await U1.c.from('reports').select('id')).every((r) => r.id !== r2.data.id));
  check('a normal user cannot resolve reports', /not_allowed/.test(msg(await U1.c.rpc('resolve_report', { p_report: r1.data.id, p_outcome: 'dismissed' }))));
  const d = await M.c.rpc('resolve_report', { p_report: r1.data.id, p_outcome: 'dismissed' });
  check('dismiss: report resolved and recorded', ok(d) && sqlVal('select status from public.reports where id = ' + lit(r1.data.id)) === 'resolved'
    && sqlVal("select count(*) from public.moderation_actions where report_id = " + lit(r1.data.id) + " and action = 'report_dismissed'") === '1', errText(d));
  check('dismiss keeps the post', sqlVal('select status from public.posts where id = ' + lit(U4.post)) === 'approved');
  const u = await M.c.rpc('resolve_report', { p_report: r2.data.id, p_outcome: 'upheld', p_remove_post: true });
  check('uphold + remove: post removed, both actions recorded', ok(u) && sqlVal('select status from public.posts where id = ' + lit(U2.photoPost)) === 'rejected'
    && sqlVal("select string_agg(action, ',' order by action) from public.moderation_actions where post_id = " + lit(U2.photoPost) + " and moderator_id = " + lit(M.id) + " and action in ('remove','report_upheld')") === 'remove,report_upheld', errText(u));
  check('a resolved report cannot be resolved twice', !!(await M.c.rpc('resolve_report', { p_report: r2.data.id, p_outcome: 'upheld' })).error);
  check('moderation history: moderators only (not even the user about whom it is)', rows(await U2.c.from('moderation_actions').select('id')).length === 0
    && rows(await M.c.from('moderation_actions').select('id').eq('user_id', U2.id)).length >= 1);
  const rm = await M.c.from('posts').update({ status: 'rejected' }).eq('id', U3.approved).select('id');
  check('moderator removes an approved post directly (recorded as remove)', rows(rm).length === 1
    && sqlVal("select count(*) from public.moderation_actions where post_id = " + lit(U3.approved) + " and action = 'remove'") === '1');
});

scenario('privacy: private data and other users\' media', async () => {
  check('another user cannot read A\'s backup row', rows(await U1.c.from('backups').select('user_id').eq('user_id', A.id)).length === 0);
  check('moderator cannot read A\'s backup row', rows(await M.c.from('backups').select('user_id').eq('user_id', A.id)).length === 0);
  check('moderator cannot read A\'s backup versions', rows(await M.c.from('backup_versions').select('id').eq('user_id', A.id)).length === 0);
  const bm = await M.c.storage.from('backups').download(S.backupMedia);
  check('moderator cannot download A\'s backup media', !!bm.error || !bm.data);
  const bm2 = await U1.c.storage.from('backups').download(S.backupMedia);
  check('another user cannot download A\'s backup media', !!bm2.error || !bm2.data);
  check('A still reads own backup', rows(await A.c.from('backups').select('user_id').eq('user_id', A.id)).length === 1);
  check('rate_events: no client access (user)', rows(await U1.c.from('rate_events').select('id')).length === 0);
  check('rate_events: no client access (moderator)', rows(await M.c.from('rate_events').select('id')).length === 0);
  check('username_changes: own only', rows(await U1.c.from('username_changes').select('user_id')).every((r) => r.user_id === U1.id));
  check('consents: moderators cannot read other users\' confirmations', rows(await M.c.from('community_consents').select('user_id')).every((r) => r.user_id === M.id));
  check('posts carry no private workout data (columns)', sqlVal("select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'posts'")
    === 'caption,created_at,id,image_path,published_at,status,thumb_path,user_id');
  check('profiles expose no email', sqlVal("select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name ilike '%mail%'") === '0');
});

scenario('usernames: reserved names and 30-day limit', async () => {
  const set = (u, name) => u.c.from('profiles').update({ username: name }).eq('id', u.id).select('username');
  const mname = sqlVal('select username from public.profiles where id = ' + lit(M.id));
  for (const n of ['admin', 'Adm1n', 'the_admin', 'admin_team', 'gym_quest', 'GymQuest_Official', 'g.y.m.q.u.e.s.t', 'moderat0r',
    'Moderation-Team', 'support.team', 'official', '0fficial', 'staff', 'root', 'mod', 'system_bot']) {
    const r = await set(U5, n);
    check('reserved: ' + n, /username_reserved/.test(msg(r)), errText(r) || JSON.stringify(r.data));
  }
  const look = mname.replace(/_/g, '.').replace(/a/i, '4');
  check('look-alike of a moderator\'s name refused (' + look + ')', /username_reserved/.test(msg(await set(U5, look))));
  const okName = await set(U5, 'Badminton_Fan');
  check('a normal name that merely contains "admin" inside is allowed (Badminton_Fan)', ok(okName) && rows(okName)[0].username === 'Badminton_Fan', errText(okName));
  const again = await set(U5, 'Badminton_Fan2');
  check('second rename within 30 days refused (username_cooldown with date)', /username_cooldown:\d{4}-\d\d-\d\d/.test(msg(again)), errText(again));
  check('bio-only update is not a rename', ok(await U5.c.from('profiles').update({ bio: 'hi', username: 'Badminton_Fan' }).eq('id', U5.id)));
  sql("update public.username_changes set changed_at = now() - interval '31 days' where user_id = " + lit(U5.id));
  check('rename allowed again after 30 days', ok(await set(U5, 'Badminton_Fan2')));
  sql("update public.profiles set username = 'Admin' where id = " + lit(U3.id));   // simulate an existing reserved name
  check('an existing reserved name is not forced to change (bio edit works)', ok(await U3.c.from('profiles').update({ bio: 'kept' }).eq('id', U3.id)));
  const dup = await set(U5, sqlVal('select upper(username) from public.profiles where id = ' + lit(U1.id)));
  check('duplicate (case-insensitive) still refused', !!dup.error);
  check('a user cannot make themselves moderator', !!(await U5.c.from('profiles').update({ role: 'moderator' }).eq('id', U5.id)).error);
  check('Moderator badge comes from the server (profile_card)', (rows(await U5.c.rpc('profile_card', { p_user: M.id }))[0] || {}).moderator === true
    && (rows(await U5.c.rpc('profile_card', { p_user: U1.id }))[0] || {}).moderator === false);
  const mr = await M.c.from('profiles').update({ username: 'renamed_by_mod_' + L.runTag.slice(-4) }).eq('id', U3.id).select('username');
  check('a moderator can rename an abusive/reserved name', rows(mr).length === 1, errText(mr));
});

scenario('spam limits', async () => {
  const fake = (u, kind, n) => sql('insert into public.rate_events (user_id, kind) select ' + lit(u.id) + ', ' + lit(kind) + ' from generate_series(1, ' + n + ');');
  fake(U5, 'follow', 200);
  check('follows: 200 per day', /rate_limited:follow/.test(msg(await U5.c.from('follows').insert({ follower_id: U5.id, followee_id: U1.id }))));
  fake(U5, 'like', 300);
  check('likes: 300 per hour', /rate_limited:like/.test(msg(await U5.c.from('likes').insert({ post_id: U1.fourPost, user_id: U5.id }))));
  fake(U5, 'repost', 50);
  check('shares: 50 per day', /rate_limited:repost/.test(msg(await U5.c.from('reposts').insert({ user_id: U5.id, post_id: U1.fourPost }))));
  fake(U5, 'report', 20);
  check('reports: 20 per day', /rate_limited:report/.test(msg(await U5.c.from('reports').insert({ reporter_id: U5.id, post_id: U1.fourPost, reason: 'x' }))));
  fake(U5, 'post', 20);
  check('posts: 20 per day', /rate_limited:post/.test(msg(await createPost(U5, 'spam'))));
  sql("update public.rate_events set created_at = now() - interval '25 hours' where user_id = " + lit(U5.id));
  check('limits expire with their window', ok(await U5.c.from('follows').insert({ follower_id: U5.id, followee_id: U1.id })));
  // 10 active posts
  for (let i = 0; i < 10; i++) await createPost(U3, 'active ' + i);
  check('10 active posts at most', !!(await createPost(U3, 'eleventh')).error);
  // 40 files per user
  const U6 = await L.newUser('files');
  let okCount = 0;
  for (let i = 0; i < 40; i++) if (!(await uploadPhoto(U6, U6.id + '/f/' + i + '.jpg')).error) okCount++;
  check('40 files per user, the 41st refused', okCount === 40 && !!(await uploadPhoto(U6, U6.id + '/f/40.jpg')).error, 'uploaded ' + okCount);
});

scenario('v46 app flows still work after 0005', async () => {
  const v = await L.newUser('v46');
  const img = v.id + '/legacy1.jpg', th = v.id + '/legacy1_thumb.jpg';
  const up = (await uploadPhoto(v, img)).error || (await uploadPhoto(v, th)).error;
  const ins = await v.c.from('posts').insert({ user_id: v.id, image_path: img, thumb_path: th, caption: '' }).select('id').single();
  check('v46 single-photo share (upload + insert)', !up && ok(ins), errText(ins));
  check('v46 caption edit while pending', ok(await v.c.from('posts').update({ caption: 'legacy caption' }).eq('id', ins.data.id)));
  await approve(M, ins.data.id);
  const q = await U1.c.from('posts').select('id,user_id,caption,thumb_path,created_at,profiles(username,avatar_path)').eq('status', 'approved').order('created_at', { ascending: false }).range(0, 49);
  check('v46 feed query works and includes it', ok(q) && rows(q).some((r) => r.id === ins.data.id && r.profiles && r.profiles.username), errText(q));
  check('v46 feed query handles text-only posts (null thumb_path)', rows(q).some((r) => r.id === U1.textPost && r.thumb_path === null));
  check('v46 moderator queue query works', ok(await M.c.from('posts').select('id,user_id,caption,thumb_path,created_at,profiles(username)').eq('status', 'pending')));
  check('v46 report resolve (status only) works', ok(await M.c.from('reports').update({ status: 'resolved' }).eq('status', 'open').select('id')));
  check('v46 blocks read works', ok(await U1.c.from('blocks').select('blocked_id').eq('blocker_id', U1.id)));
});

scenario('Leave Community and full deletion', async () => {
  const X = await L.newUser('leave');
  const Y = await L.newUser('delete');
  for (const u of [X, Y]) {
    const p = await uploadSet(u, 4); const post = await createPost(u, 'bye', p); await approve(M, post.data); u.post = post.data;
    await u.c.from('follows').insert({ follower_id: u.id, followee_id: U1.id });
    await U1.c.from('follows').insert({ follower_id: U1.id, followee_id: u.id });
    await u.c.from('likes').insert({ post_id: U1.fourPost, user_id: u.id });
    await u.c.from('reposts').insert({ user_id: u.id, post_id: U1.textPost });
    await U1.c.from('likes').insert({ post_id: post.data, user_id: U1.id });
    await u.c.from('reports').insert({ reporter_id: u.id, post_id: U1.textPost, reason: 'test' });
    await u.c.from('blocks').insert({ blocker_id: u.id, blocked_id: U5.id });
    await u.c.rpc('save_backup', { p_payload: { plan: 'p' }, p_schema: 1, p_base_revision: 0, p_device: 't', p_app_version: 'v47' });
    await u.c.storage.from('backups').upload(u.id + '/media/m/h', fx.jpeg, { contentType: 'image/jpeg' });
    await u.c.storage.from('avatars').upload(u.id + '/avatar.jpg', fx.jpeg, { contentType: 'image/jpeg', upsert: true });
  }
  await M.c.from('profiles').update({ suspended: true }).eq('id', X.id);
  await M.c.from('profiles').update({ suspended: false }).eq('id', X.id);
  sql("insert into public.username_changes (user_id, changed_at) values (" + lit(X.id) + ", now())");

  const socialCount = (id) => sql(`select
      (select count(*) from public.posts where user_id = ${lit(id)}) || ',' ||
      (select count(*) from public.post_media m join public.posts p on p.id = m.post_id where p.user_id = ${lit(id)}) || ',' ||
      (select count(*) from public.follows where follower_id = ${lit(id)} or followee_id = ${lit(id)}) || ',' ||
      (select count(*) from public.likes where user_id = ${lit(id)}) || ',' ||
      (select count(*) from public.reposts where user_id = ${lit(id)}) || ',' ||
      (select count(*) from public.reports where reporter_id = ${lit(id)}) || ',' ||
      (select count(*) from public.blocks where blocker_id = ${lit(id)} or blocked_id = ${lit(id)}) || ',' ||
      (select count(*) from public.rate_events where user_id = ${lit(id)}) || ',' ||
      (select count(*) from storage.objects where bucket_id in ('community','avatars') and (storage.foldername(name))[1] = ${lit(id)})`);
  check('precondition: both accounts have social rows', socialCount(X.id).split(',').every((n) => Number(n) > 0) && socialCount(Y.id).split(',').every((n) => Number(n) > 0), socialCount(X.id) + ' / ' + socialCount(Y.id));

  // Failure must be reported, never a false success.
  sql('revoke delete on public.likes from service_role;');
  const fail = await X.c.functions.invoke('delete-account', { method: 'POST', body: { mode: 'community' } });
  sql('grant delete on public.likes to service_role;');
  let failBody = null; try { failBody = fail.error && fail.error.context ? await fail.error.context.json() : null; } catch (e) {}
  check('Leave Community reports a database-delete failure (500, table named)', !!fail.error && failBody && failBody.error === 'db_delete_failed' && failBody.table === 'likes', JSON.stringify(failBody));

  const leave = await X.c.functions.invoke('delete-account', { method: 'POST', body: { mode: 'community' } });
  check('Leave Community succeeds', !leave.error && leave.data && leave.data.ok === true, JSON.stringify(leave.error && leave.error.message));
  check('Leave Community: no social rows or community/avatar files left', socialCount(X.id) === '0,0,0,0,0,0,0,0,0', socialCount(X.id));
  check('Leave Community: counters updated (post author lost a like and follower)',
    sqlVal('select likes from public.post_stats where post_id = ' + lit(U1.fourPost)) === sqlVal('select count(*) from public.likes where post_id = ' + lit(U1.fourPost)));
  check('Leave Community keeps: account, profile (bio cleared), backup, 16+ confirmation, moderation history, rename date',
    sqlVal('select count(*) from auth.users where id = ' + lit(X.id)) === '1'
    && sqlVal("select bio || '|' || coalesce(avatar_path, 'NULL') from public.profiles where id = " + lit(X.id)) === '|NULL'
    && sqlVal('select count(*) from public.backups where user_id = ' + lit(X.id)) === '1'
    && sqlVal("select count(*) from storage.objects where bucket_id = 'backups' and (storage.foldername(name))[1] = " + lit(X.id)) === '1'
    && sqlVal('select count(*) from public.community_consents where user_id = ' + lit(X.id)) === '1'
    && sqlVal('select count(*) from public.moderation_actions where user_id = ' + lit(X.id)) !== '0'
    && sqlVal('select count(*) from public.username_changes where user_id = ' + lit(X.id)) === '1');

  const del = await Y.c.functions.invoke('delete-account', { method: 'POST', body: { mode: 'full' } });
  check('full deletion succeeds', !del.error && del.data && del.data.ok === true, JSON.stringify(del.error && del.error.message));
  const left = sql(`select string_agg(t, ',') from (
      select 'auth' t from auth.users where id = ${lit(Y.id)}
      union all select 'profiles' from public.profiles where id = ${lit(Y.id)}
      union all select 'posts' from public.posts where user_id = ${lit(Y.id)}
      union all select 'post_media' from public.post_media where post_id = ${lit(Y.post)}
      union all select 'post_stats' from public.post_stats where post_id = ${lit(Y.post)}
      union all select 'profile_stats' from public.profile_stats where user_id = ${lit(Y.id)}
      union all select 'follows' from public.follows where follower_id = ${lit(Y.id)} or followee_id = ${lit(Y.id)}
      union all select 'likes' from public.likes where user_id = ${lit(Y.id)} or post_id = ${lit(Y.post)}
      union all select 'reposts' from public.reposts where user_id = ${lit(Y.id)}
      union all select 'consents' from public.community_consents where user_id = ${lit(Y.id)}
      union all select 'moderation_actions' from public.moderation_actions where user_id = ${lit(Y.id)}
      union all select 'rate_events' from public.rate_events where user_id = ${lit(Y.id)}
      union all select 'username_changes' from public.username_changes where user_id = ${lit(Y.id)}
      union all select 'reports' from public.reports where reporter_id = ${lit(Y.id)} or reported_user_id = ${lit(Y.id)}
      union all select 'blocks' from public.blocks where blocker_id = ${lit(Y.id)} or blocked_id = ${lit(Y.id)}
      union all select 'backups' from public.backups where user_id = ${lit(Y.id)}
      union all select 'backup_versions' from public.backup_versions where user_id = ${lit(Y.id)}
      union all select 'storage:' || bucket_id from storage.objects where (storage.foldername(name))[1] = ${lit(Y.id)}
    ) x`);
  check('full deletion: nothing left in any table or bucket', left === '', left);
});

/* ------------------------------------------------------------------------- */
(async () => {
  if (L.sqlVal("select to_regclass('public.follows') is not null") !== 't') throw new Error('0005 is not applied');
  S = JSON.parse(fs.readFileSync(process.env.GQ_STATE, 'utf8'));
  fx = L.fixtures();
  [M, A, B, C] = await Promise.all(['M', 'A', 'B', 'C'].map((k) => L.signIn(S.users[k])));
  U1 = await L.newUser('u1'); U2 = await L.newUser('u2'); U3 = await L.newUser('u3');
  U4 = await L.newUser('u4'); U5 = await L.newUser('u5');
  for (const s of scenarios) {
    if (FILTER && !FILTER.test(s.name)) continue;
    section(s.name);
    try { await s.fn(); } catch (e) { check('scenario error', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)); }
  }
  console.log('\n==== checks: ' + L.results.pass + ' passed, ' + L.results.fail + ' failed ====');
  if (process.env.GQ_RESULTS) fs.writeFileSync(process.env.GQ_RESULTS, L.results.lines.join('\n') + '\n\n==== checks: ' + L.results.pass + ' passed, ' + L.results.fail + ' failed ====\n');
  process.exit(L.results.fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
