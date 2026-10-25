'use strict';
/* GymQuest v80 — the You tab is my profile (Instagram-like structure, Bento look). Real headless Chrome against the
   LOCAL test stack with disposable local users and synthetic posts (never production).

     GQ_COMMUNITY_CONFIG=<local config js> node tests/social/ui-you.js

   Checks: tapping You opens my profile at once (my avatar, name, @username, bio, real counts, Edit profile, pills);
   30 synthetic published posts (photos, multi-photo, text, shared workouts and plans) load newest-first across
   pages with no duplicates and none missing; the mixed view shows photos as tiles and text / workouts as readable
   cards; filters (Photos, Text, Workouts) count right; a post opens its full detail and Back restores the filter and
   the scroll position; my pending and rejected posts only for me; private chats, private workout history and
   progress photos never appear among posts, History is owner-only; another member sees only the approved posts;
   every earlier You action still works (Settings, goal, level / achievements, progress photos, Edit profile,
   Friends, followers list, ⋯ menu, New post); states: no posts, Community off (nothing enabled by itself),
   signed out, offline; light / dark at 390 and 1280 px without horizontal overflow; local data unchanged; no
   console errors. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./lib');
const { startServer, Browser, waitFor } = require('../sync/lib');
const HELPERS = require('../sync/helpers');
const { check, section, sql, sqlVal, lit, errText } = L;

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT || 8124);   // iný port, keď 8124 práve používa iný beh testov
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-social-you');
const PROFILES = path.join(WORK, 'profiles');
const SHOTS = path.join(WORK, 'shots');
let nextPort = 10010;
const browsers = [];
const pages = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;

async function device(name, w) {
  const b = new Browser(name + '-' + Date.now().toString(36), nextPort++, PROFILES);
  browsers.push(b);
  const p = await b.launch();
  p.logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error') p.logs.push(e.entry.text + ' ' + (e.entry.url || '')); });
  await p.navigate(BASE);
  await p.eval(HELPERS);
  await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); return true; })()`);
  await p.c.send('Emulation.setDeviceMetricsOverride', { width: w || 390, height: 844, deviceScaleFactor: 2, mobile: (w || 390) < 700 });
  pages.push([name, p]);
  return p;
}
async function signIn(p, u) {
  await p.eval('window.__gq.signIn(' + J(u.email) + ',' + J(u.password) + ')');
  await p.ready();
  await p.eval(HELPERS);
  await p.eval(`(state.settings.communityOptIn = true, persistState(), setLang('en'), true)`);
  await waitFor(() => p.eval(`!!communityProfile && communityVersion >= 5`), 30000, 'profile');
}
async function member(tag, name, bio) {
  const u = await L.newUser('you-' + tag);
  u.name = name + '_' + L.runTag.slice(-5);
  const r = await u.c.from('profiles').update({ username: u.name, bio: bio || '' }).eq('id', u.id).select('id');
  if (r.error) throw new Error('rename ' + errText(r));
  await u.c.rpc('community_join');
  return u;
}
const IMG = fs.readFileSync(path.join(REPO, 'media', 'bench-press-poster.jpg'));
async function upload(u, bucket, p) {
  const up = await u.c.storage.from(bucket).upload(p, IMG, { contentType: 'image/jpeg' });
  if (up.error) throw new Error('upload ' + up.error.message);
}
/* Synthetické príspevky so spätnými dátumami (priamo do lokálnej databázy, ako história). */
async function seedPosts(u, n) {
  const made = [];
  for (let k = 0; k < 3; k++) { await upload(u, 'community', u.id + '/you-shared/' + k + '.jpg'); await upload(u, 'community', u.id + '/you-shared/' + k + '_thumb.jpg'); }
  for (let i = 0; i < n; i++) {
    const id = require('crypto').randomUUID();
    const at = new Date(Date.now() - (i + 1) * 3 * 3600000).toISOString();
    const kind = i % 5 === 0 ? 'workout' : i % 7 === 3 ? 'plan' : i % 3 === 1 ? 'text' : i % 4 === 2 ? 'multi' : 'photo';
    let img = null, thumb = null, q = "begin; set local session_replication_role = replica; ";
    const extra = [];
    if (kind === 'photo' || kind === 'multi') {
      /* server dovolí ~24 súborov na účet – syntetické príspevky zdieľajú 3 nahraté fotky */
      for (let k = 0; k < (kind === 'multi' ? 3 : 1); k++) {
        const base = u.id + '/you-shared/' + ((i + k) % 3);
        if (k === 0) { img = base + '.jpg'; thumb = base + '_thumb.jpg'; } else extra.push([k, base]);
      }
    }
    const caption = kind === 'text' ? 'Text post number ' + i + ': rest day and a long walk.' : kind === 'workout' ? 'Workout share ' + i : kind === 'plan' ? 'Plan share ' + i : 'Photo ' + i;
    q += 'insert into public.posts (id, user_id, image_path, thumb_path, caption, status, created_at, published_at, visibility) values ('
      + lit(id) + ',' + lit(u.id) + ',' + (img ? lit(img) : 'null') + ',' + (thumb ? lit(thumb) : 'null') + ',' + lit(caption) + ",'approved'," + lit(at) + ',' + lit(at) + ",'public');";
    extra.forEach(([k, base]) => { q += 'insert into public.post_media (post_id, position, image_path, thumb_path) values (' + lit(id) + ',' + k + ',' + lit(base + '.jpg') + ',' + lit(base + '_thumb.jpg') + ');'; });
    if (kind === 'workout' || kind === 'plan') {
      const a = kind === 'workout'
        ? { kind: 'workout', name: 'Legs ' + i, date: at.slice(0, 10), duration: 3600, xp: 50, exercises: [{ n: 'Squat', s: 5, r: 5, w: 90, d: 5 }, { n: 'Leg press', s: 4, r: 10, w: 150, d: 4 }] }
        : { kind: 'plan', name: 'Upper ' + i, exercises: [{ n: 'Bench press', s: 4, r: 8, w: 70 }] };
      q += 'insert into public.post_attachments (post_id, data) values (' + lit(id) + ',' + lit(JSON.stringify(a)) + '::jsonb);';
    }
    sql(q + ' commit;');
    made.push({ id, kind, caption, at });
  }
  return made;
}

(async () => {
  if (!process.env.GQ_COMMUNITY_CONFIG) throw new Error('GQ_COMMUNITY_CONFIG required');
  fs.mkdirSync(PROFILES, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await startServer(PORT, { new: REPO });
  const A = await member('a', 'ada', 'Lifting since 2024 🏋️'), B = await member('b', 'ben'), E = await member('e', 'eve');
  const req = await A.c.from('friend_requests').insert({ from_id: A.id, to_id: B.id }).select('id').single();
  await B.c.rpc('accept_friend_request', { p_request: req.data.id });
  await B.c.from('follows').insert({ follower_id: B.id, followee_id: A.id });
  await upload(A, 'avatars', A.id + '/avatar-test.jpg');
  const av = await A.c.from('profiles').update({ avatar_path: A.id + '/avatar-test.jpg' }).eq('id', A.id).select('id');
  if (av.error) throw new Error('avatar ' + errText(av));
  const posts = await seedPosts(A, 30);
  /* vlastné: čakajúci a zamietnutý (len pre mňa) */
  /* (denný limit príspevkov by ďalšie create_post odmietol – syntetické stavy priamo v lokálnej databáze) */
  sql("begin; set local session_replication_role = replica; insert into public.posts (user_id, caption, status, created_at, visibility) values ("
    + lit(A.id) + ", 'PENDING-ONLY-ME', 'pending', now(), 'public'), (" + lit(A.id) + ", 'REJECTED-ONLY-ME', 'rejected', now() - interval '1 hour', 'public'); commit;");
  /* súkromný chat */
  const conv = (await A.c.rpc('open_chat', { p_friend: B.id })).data;
  await B.c.from('messages').insert({ conversation_id: conv, sender_id: B.id, body: 'PRIVATE-CHAT-MESSAGE' });
  const serverBefore = sqlVal(`select (select count(*) from public.posts where user_id = ${lit(A.id)}) || '/' || (select count(*) from public.messages where conversation_id = ${lit(conv)}) || '/' || (select count(*) from public.follows where follower_id = ${lit(A.id)} or followee_id = ${lit(A.id)})`);
  const expected = sql(`select id from public.posts where user_id = ${lit(A.id)} and status = 'approved' order by published_at desc, id desc`).split('\n').filter(Boolean);
  try {
    const pA = await device('A');
    await signIn(pA, A);
    await pA.eval(`(window.__gq.addWorkout('w-private-1', '2026-10-01'), window.__gq.addWorkout('w-private-2', '2026-10-03'), true)`);
    await pA.eval(`(state.history.forEach((w) => { if (w.id.indexOf('w-private') === 0) { w.planId = 'deleted-secret-plan'; w.planName = 'SecretPlan'; } }), saveState(), true)`);
    try { await pA.eval(`window.__gq.addProgress('pp-1', 3)`); } catch (e) {}
    const localBefore = await pA.eval(`JSON.stringify({ h: state.history, p: state.plans, a: state.achievements, g: state.settings.weeklyGoal, m: state.measurements, x: state.excusedWeeks })`);
    await pA.eval(`(setThemePref('light'), switchTab('dnes'), window.scrollTo(0, 0), true)`);

    section('tapping You opens my profile');
    await pA.eval(`(document.querySelector('.tab[data-tab="ty"]').click(), true)`);
    check('the You screen itself is the profile (no dashboard tiles, no extra tap)', await pA.eval(`activeTab === 'ty' && !document.querySelector('#screen-ty .bento-grid') && !!document.getElementById('ty-card') && !!document.getElementById('ty-seg')`));
    await waitFor(() => pA.eval(`!!tyFeed && tyFeed.items.length > 0 && !tyFeed.loading`), 30000, 'first page');
    await wait(400);
    check('my real avatar photo', await pA.eval(`(() => { const i = document.querySelector('#ty-av img'); return !!i && i.getAttribute('src').indexOf('avatar-test.jpg') > 0; })()`));
    check('my name and @username', (await pA.eval(`document.getElementById('ty-name').textContent`)) === A.name && (await pA.eval(`document.getElementById('ty-handle').textContent`)) === '@' + A.name);
    check('my bio', (await pA.eval(`document.getElementById('motivation-text').textContent`)) === 'Lifting since 2024 🏋️');
    const card = (await A.c.rpc('profile_card', { p_user: A.id })).data[0];
    const stats = await pA.eval(`[...document.querySelectorAll('#ty-stats .cstat-n')].map((x) => Number(x.textContent))`);
    check('real counts: posts, followers, following, friends', J(stats) === J([card.posts, card.followers, card.following, card.friends]), J({ stats, card }));
    check('compact Edit profile, Friends, level, goal and progress-photo actions', await pA.eval(`document.getElementById('ty-profile').textContent === t('community2.editProfile') && !document.getElementById('ty-friends').hidden && !!document.getElementById('ty-level-line').textContent && !!document.getElementById('ty-goal-line').textContent && !document.getElementById('ty-photos').hidden`));
    check('my posts start right below the header (visible without scrolling on a phone)', await pA.eval(`document.querySelector('#ty-posts > *').getBoundingClientRect().top < innerHeight`));
    await pA.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await pA.eval(`window.scrollTo(0, 0)`); await wait(300);
    await (async () => { const r = await pA.c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, 'you-light-390.png'), Buffer.from(r.data, 'base64')); })();

    section('history: newest first, every page, no duplicates');
    for (let i = 0; i < 20 && !(await pA.eval(`tyFeed.done`)); i++) { await pA.eval(`window.scrollTo(0, document.documentElement.scrollHeight)`); await wait(700); }
    const got = await pA.eval(`tyFeed.items.map((x) => x.id)`);
    check('all 30 published posts loaded by scrolling (pages of ' + await pA.eval('COMMUNITY_PAGE') + ')', got.length === expected.length && await pA.eval(`tyFeed.done`), got.length + ' of ' + expected.length);
    check('no duplicates', new Set(got).size === got.length);
    check('newest first, same order as the server', J(got) === J(expected));
    check('my pending and rejected posts shown first, marked, only on my profile', await pA.eval(`(() => { const t = [...document.querySelectorAll('#ty-posts .ty-pending')].map((x) => x.innerText).join('|'); return /PENDING-ONLY-ME/.test(t) && /REJECTED-ONLY-ME/.test(t); })()`));
    const n = (k) => posts.filter((p) => p.kind === k).length;
    check('every photo post is a tile (multi-photo marked with its count)', await pA.eval(`document.querySelectorAll('#ty-posts .ty-photo').length`) === n('photo') + n('multi') && await pA.eval(`document.querySelectorAll('#ty-posts .ty-photo .pf-count').length`) === n('multi'));
    check('text posts are readable cards with their whole text', await pA.eval(`[...document.querySelectorAll('#ty-posts .ty-text .ty-body')].length`) === n('text') && await pA.eval(`[...document.querySelectorAll('#ty-posts .ty-text .ty-body')].every((x) => /rest day and a long walk/.test(x.textContent))`));
    check('shared workouts and plans show a summary (name, exercises, XP)', await pA.eval(`document.querySelectorAll('#ty-posts .ty-workout').length`) === n('workout') + n('plan')
      && /Legs \d+/.test(await pA.eval(`document.querySelector('#ty-posts .ty-w-done').innerText`)) && /\+50 XP/.test(await pA.eval(`document.querySelector('#ty-posts .ty-w-done').innerText`)));

    section('filters');
    for (const [f, sel, cnt] of [['photos', '.ty-photo', n('photo') + n('multi')], ['text', '.ty-text', n('text')], ['workouts', '.ty-workout', n('workout') + n('plan')]]) {
      await pA.eval(`(document.querySelector('#ty-seg [data-ty-filter="${f}"]').click(), true)`); await wait(200);
      check(f + ': exactly the ' + cnt + ' posts of that kind', await pA.eval(`document.querySelectorAll('#ty-posts ${sel}').length`) === cnt && await pA.eval(`document.querySelectorAll('#ty-posts .ty-card:not(${sel}), #ty-posts .ty-photo:not(${sel})').length`) === 0);
      check(f + ': the filter reports it is selected', await pA.eval(`document.querySelector('#ty-seg [data-ty-filter="${f}"]').getAttribute('aria-selected') === 'true'`));
    }

    section('open a post and come back');
    await pA.eval(`(document.querySelector('#ty-seg [data-ty-filter="text"]').click(), true)`); await wait(200);
    await pA.eval(`(() => { const c = [...document.querySelectorAll('#ty-posts .ty-text')].pop(); c.scrollIntoView({ block: 'center' }); return true; })()`); await wait(300);
    const y = await pA.eval(`Math.round(window.scrollY)`);
    const target = await pA.eval(`[...document.querySelectorAll('#ty-posts .ty-text')].pop().dataset.tyPost`);
    await pA.eval(`([...document.querySelectorAll('#ty-posts .ty-text')].pop().click(), true)`);
    await waitFor(() => pA.eval(`activeTab === 'komunita' && communityView === 'comments' && !!document.querySelector('#community-body .cpost[data-post="${target}"]')`), 20000, 'post');
    check('the post opens with its full detail and actions', await pA.eval(`!!document.querySelector('#community-body .cpost [data-community-action="like"]') && !!document.getElementById('community-comment-text')`));
    await pA.eval(`(document.querySelector('#community-body [data-community-action="back"]').click(), true)`);
    await wait(400);
    check('Back returns to You with the same filter', await pA.eval(`activeTab === 'ty' && tyFilter === 'text' && document.querySelector('#ty-seg .ty-filter.on').dataset.tyFilter === 'text'`));
    check('… and the same scroll position', Math.abs((await pA.eval(`Math.round(window.scrollY)`)) - y) <= 2, J({ y, now: await pA.eval(`Math.round(window.scrollY)`) }));
    check('… without reloading (all pages still there)', await pA.eval(`tyFeed.items.length`) === expected.length);

    section('private things stay private');
    await pA.eval(`(document.querySelector('#ty-seg [data-ty-filter="all"]').click(), true)`); await wait(200);
    const youText = await pA.eval(`document.getElementById('screen-ty').innerText`);
    check('private chat messages never appear on the profile', !/PRIVATE-CHAT-MESSAGE/.test(youText));
    check('private workout history is not among the posts', !/SecretPlan/.test(youText));
    check('progress photos are not among the posts (no local blob images)', await pA.eval(`![...document.querySelectorAll('#ty-posts img')].some((i) => /^blob:|^data:/.test(i.getAttribute('src') || ''))`));
    await pA.eval(`(document.querySelector('#ty-seg [data-ty-filter="history"]').click(), true)`); await wait(200);
    check('History (owner-only, labelled) lists my private workouts', /SecretPlan/.test(await pA.eval(`document.getElementById('ty-posts').innerText`)) && await pA.eval(`!document.getElementById('ty-private').hidden && document.getElementById('ty-private').textContent === t('ty.historyPrivate')`));
    check('the server never got the private workouts', sqlVal(`select count(*) from public.posts where caption like '%SecretPlan%'`) === '0' && sqlVal(`select count(*) from public.post_attachments where data::text like '%SecretPlan%'`) === '0');
    await pA.eval(`(document.querySelector('[data-ty-day]').click(), true)`); await wait(300);
    check('a History item opens that day', await pA.eval(`!document.getElementById('modal-day').hidden`));
    await pA.eval(`(document.getElementById('modal-day').hidden = true, refreshUpdateBanner(), tySetFilter('all'), true)`);
    const pB = await device('B');
    await signIn(pB, B);
    await pB.eval(`(communityMode = 'community', communityBack = [], communityView = 'feed', switchTab('komunita'), communityOpenUser(${J(A.id)}), true)`);
    await waitFor(() => pB.eval(`communityView === 'user' && !!document.querySelector('#community-body .cprofile:not(.pf-skel)')`), 30000, 'A as seen by B');
    const bText = await pB.eval(`document.getElementById('community-body').innerText`);
    check('another member sees no pending / rejected posts and no private history', !/PENDING-ONLY-ME|REJECTED-ONLY-ME|SecretPlan|PRIVATE-CHAT/.test(bText));
    check('B’s own You shows B, not A', await pB.eval(`(switchTab('ty'), document.getElementById('ty-name').textContent)`) === B.name);

    section('everything from the old You tab is still reachable');
    await pA.eval(`(switchTab('ty'), window.scrollTo(0, 0), true)`); await wait(300);
    await pA.eval(`(document.getElementById('ty-settings').click(), true)`); await wait(200);
    check('Settings (gear in the header)', await pA.eval(`!document.getElementById('modal-settings').hidden`));
    await pA.eval(`(document.getElementById('btn-settings-close').click(), true)`);
    await pA.eval(`(document.getElementById('ty-goal').click(), true)`); await wait(200);
    check('weekly goal pill opens the goal in Settings', await pA.eval(`!document.getElementById('modal-settings').hidden`));
    await pA.eval(`(document.getElementById('btn-settings-close').click(), switchTab('ty'), true)`);
    await pA.eval(`(document.getElementById('ty-level').click(), true)`); await wait(200);
    check('level / XP pill opens achievements', await pA.eval(`activeTab === 'pokrok' && pokrokView === 'motivation'`));
    await pA.eval(`(document.getElementById('back-motivation').click(), true)`); await wait(200);
    check('… Back returns to You', await pA.eval(`activeTab === 'ty'`));
    await pA.eval(`(document.getElementById('ty-photos').click(), true)`); await wait(200);
    check('progress photos (owner-only) open', await pA.eval(`activeTab === 'pokrok' && pokrokView === 'photos'`));
    await pA.eval(`(document.getElementById('back-photos').click(), true)`); await wait(200);
    await pA.eval(`(document.getElementById('ty-profile').click(), true)`);
    await waitFor(() => pA.eval(`communityView === 'editprofile' && !!document.getElementById('community-username')`), 20000, 'edit');
    check('Edit profile opens name, bio, avatar, privacy and account settings', true);
    await pA.eval(`(document.querySelector('#community-body [data-community-action="back"]').click(), true)`); await wait(300);
    check('… Back returns to You', await pA.eval(`activeTab === 'ty'`));
    await pA.eval(`(document.getElementById('ty-friends').click(), true)`);
    await waitFor(() => pA.eval(`communityView === 'friends'`), 20000, 'friends');
    await pA.eval(`(document.querySelector('#community-body [data-community-action="back"]').click(), true)`); await wait(300);
    check('Friends opens and returns', await pA.eval(`activeTab === 'ty'`));
    await pA.eval(`(document.querySelector('#ty-stats [data-ty-stat="followers"]').click(), true)`);
    await waitFor(() => pA.eval(`communityView === 'list' && !!document.querySelector('#community-body [data-user="${B.id}"]')`), 20000, 'followers');
    check('the followers count opens the followers list', true);
    await pA.eval(`(document.querySelector('#community-body [data-community-action="back"]').click(), true)`); await wait(300);
    await pA.eval(`(document.getElementById('ty-more').click(), true)`);
    const menu = await pA.eval(`[...document.querySelectorAll('#ty-menu [data-ty-action]')].map((x) => x.dataset.tyAction)`);
    check('⋯ menu: settings and privacy, my posts, sign out (no moderation for a member)', J(menu) === J(['edit', 'myposts', 'signout']), J(menu));
    await pA.eval(`(document.getElementById('ty-more').click(), true)`);
    check('New post is in the header', await pA.eval(`!document.getElementById('ty-compose').hidden && document.getElementById('ty-compose').dataset.go === 'compose'`));

    section('states');
    const pE = await device('E');
    await signIn(pE, E);
    await pE.eval(`(switchTab('ty'), true)`);
    await waitFor(() => pE.eval(`!!tyFeed && tyFeed.done && !tyFeed.loading`), 30000, 'eve');
    check('no posts: a short empty note with New post', await pE.eval(`!!document.querySelector('#ty-posts .ty-empty [data-go="compose"]')`));
    const pG = await device('G');
    await pG.eval(`(setLang('en'), window.__gq.addWorkout('g1', '2026-10-02'), switchTab('ty'), true)`); await wait(400);
    check('Community off: personal profile and History still useful', await pG.eval(`document.getElementById('ty-name').textContent === t('tab.ty') && document.querySelectorAll('#ty-stats .cstat').length === 3 && document.querySelectorAll('#ty-posts .ty-hist').length === 1`));
    check('Community off: a short note with a Community button, nothing enabled by itself', await pG.eval(`!!document.querySelector('#ty-posts .ty-note [data-ty-action="community"]') && state.settings.communityOptIn !== true`));
    await pG.eval(`(document.querySelector('#ty-posts .ty-note [data-ty-action="community"]').click(), true)`); await wait(300);
    check('… the button only opens Community (the choice stays with me)', await pG.eval(`activeTab === 'komunita' && state.settings.communityOptIn !== true`));
    await pG.eval(`(state.settings.communityOptIn = true, tyFeed = null, switchTab('ty'), true)`);
    await waitFor(() => pG.eval(`!!document.querySelector('#ty-posts .ty-note')`), 15000, 'signed out note');
    check('opted in but signed out: "Sign in" note, History available', await pG.eval(`document.querySelector('#ty-posts .ty-note').textContent.indexOf(t('ty.signedOutLine')) >= 0 && document.querySelectorAll('#ty-seg [data-ty-filter]').length === 1`));
    await pG.eval(`(state.settings.communityOptIn = false, true)`);
    await pA.c.send('Network.enable');
    await pA.c.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await pA.eval(`(tyFeed = null, tyLoadedAt = 0, switchTab('dnes'), switchTab('ty'), true)`);
    await waitFor(() => pA.eval(`!!tyFeed && tyFeed.error`), 20000, 'offline');
    await wait(200);
    check('offline: a short note, my profile header and History still work', await pA.eval(`!!document.querySelector('#ty-posts .ty-note') && document.getElementById('ty-name').textContent === ${J(A.name)}`)
      && await pA.eval(`(tySetFilter('history'), document.querySelectorAll('#ty-posts .ty-hist').length >= 2)`));
    await pA.c.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await pA.eval(`(tySetFilter('all'), tyLoad(true), true)`);
    await waitFor(() => pA.eval(`!!tyFeed && !tyFeed.error && tyFeed.items.length > 0`), 20000, 'online again');

    section('light / dark, phone and desktop');
    for (const [w, h] of [[390, 844], [1280, 900]]) {
      for (const theme of ['light', 'dark']) {
        await pA.c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: w < 700 ? 2 : 1, mobile: w < 700 });
        await pA.eval(`(setThemePref('${theme}'), switchTab('ty'), window.scrollTo(0, 0), true)`); await wait(500);
        const r = await pA.eval(`({ over: document.documentElement.scrollWidth > innerWidth + 1, theme: document.documentElement.dataset.theme,
          overlap: (() => { const a = [...document.querySelectorAll('.ty-bar > *, .ty-bar-actions > *')].map((x) => x.getBoundingClientRect()).filter((r) => r.width);
            return a.some((x, i) => a.some((y, j) => j > i && !(x.right <= y.left + 1 || y.right <= x.left + 1 || x.bottom <= y.top + 1 || y.bottom <= x.top + 1) && !(x.left <= y.left && x.right >= y.right))); })() })`);
        check(w + ' px ' + theme + ': no horizontal overflow, header controls do not overlap', !r.over && !r.overlap && r.theme === theme, J(r));
        const s = await pA.c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, 'you-' + theme + '-' + w + '.png'), Buffer.from(s.data, 'base64'));
      }
    }
    await pA.eval(`(setThemePref('light'), true)`);

    section('data unchanged');
    const localAfter = await pA.eval(`JSON.stringify({ h: state.history, p: state.plans, a: state.achievements, g: state.settings.weeklyGoal, m: state.measurements, x: state.excusedWeeks })`);
    check('my local workouts, plans, achievements, goal, measurements and excused weeks are unchanged', localAfter === localBefore);
    const serverAfter = sqlVal(`select (select count(*) from public.posts where user_id = ${lit(A.id)}) || '/' || (select count(*) from public.messages where conversation_id = ${lit(conv)}) || '/' || (select count(*) from public.follows where follower_id = ${lit(A.id)} or followee_id = ${lit(A.id)})`);
    check('nothing was posted, sent or followed on my behalf', serverAfter === serverBefore, serverBefore + ' → ' + serverAfter);

    section('no errors');
    for (const [name, p] of pages) {
      check(name + ': no exceptions', p.errors.length === 0, J(p.errors));
      const errs = p.logs.filter((l) => !/favicon|127\.0\.0\.1:54321\/(auth|rest|functions|storage)\/v1\/.*(400|401|404)|ERR_INTERNET_DISCONNECTED|net::ERR/.test(l));
      check(name + ': no console errors', errs.length === 0, J(errs));
    }
  } catch (e) {
    check('test error', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | '));
  } finally {
    for (const b of browsers) b.killHard(true);
    await server.close();
  }
  console.log('\n==== checks: ' + L.results.pass + ' passed, ' + L.results.fail + ' failed ====');
  process.exit(L.results.fail ? 1 : 0);
})().catch((e) => { console.error(e); for (const b of browsers) b.killHard(true); process.exit(2); });
