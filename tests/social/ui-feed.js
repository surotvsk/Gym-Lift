'use strict';
/* GymQuest v83 — Community is a feed (X/Twitter-like reading flow, Bento look). Real headless Chrome against the
   LOCAL test stack with disposable users and synthetic posts (never production).

     GQ_COMMUNITY_CONFIG=<local config js> [GQ_TEST_PORT=8134] node tests/social/ui-feed.js

   Checks: Community opens straight into posts under a compact header (no dashboard tiles, no Messages shortcut);
   New post, search and the ⋯ menu (Friends, Top 20, profile, my posts; Moderation only for moderators); text,
   photo, multi-photo and shared-workout posts render as one coherent card (avatar, name, time, text, media,
   workout, actions, menu); visibility unchanged (friends-only of a non-friend, pending, blocked authors hidden);
   older posts load by scrolling without duplicates, in order, without re-rendering what is loaded; a failed page
   shows Retry and Retry works; New post opens the composer, a published post is "submitted for review" and not
   public; Back from the composer, a post and a profile restores the feed position and the filter; post menus
   (own: delete; others: block / report; moderator: remove); the Messages tab still works; states: Community off,
   signed out, offline; light / dark at 390 and 1280 px, no overflow, header controls not overlapping, the last
   item clears the bottom menu; no console errors. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./lib');
const { startServer, Browser, waitFor } = require('../sync/lib');
const HELPERS = require('../sync/helpers');
const { check, section, sql, sqlVal, lit, errText } = L;

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT || 8124);
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-social-feed');
const PROFILES = path.join(WORK, 'profiles');
const SHOTS = path.join(WORK, 'shots');
let nextPort = 10030;
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
async function member(tag, name) {
  const u = await L.newUser('feed-' + tag);
  u.name = name + '_' + L.runTag.slice(-5);
  const r = await u.c.from('profiles').update({ username: u.name }).eq('id', u.id).select('id');
  if (r.error) throw new Error('rename ' + errText(r));
  await u.c.rpc('community_join');
  return u;
}
const IMG = fs.readFileSync(path.join(REPO, 'media', 'bench-press-poster.jpg'));
/* syntetické príspevky priamo v lokálnej databáze (denný limit príspevkov), 3 nahraté fotky na účet sa zdieľajú */
async function seed(u, list) {
  for (let k = 0; k < 3; k++) for (const f of [k + '.jpg', k + '_thumb.jpg']) {
    const up = await u.c.storage.from('community').upload(u.id + '/feed/' + f, IMG, { contentType: 'image/jpeg' });
    if (up.error && !/exists/i.test(up.error.message)) throw new Error('upload ' + up.error.message);
  }
  const ids = {};
  let q = 'begin; set local session_replication_role = replica; ';
  list.forEach(([key, kind, caption, opts], i) => {
    const id = require('crypto').randomUUID(); ids[key] = id;
    const at = "now() - interval '" + ((opts && opts.minutes) || i + 1) + " seconds'";   // sekundy: tento beh je vždy najnovší
    const photo = kind === 'photo' || kind === 'multi';
    q += 'insert into public.posts (id, user_id, image_path, thumb_path, caption, status, created_at, published_at, visibility) values ('
      + lit(id) + ',' + lit(u.id) + ',' + (photo ? lit(u.id + '/feed/0.jpg') : 'null') + ',' + (photo ? lit(u.id + '/feed/0_thumb.jpg') : 'null') + ',' + lit(caption)
      + ',' + lit((opts && opts.status) || 'approved') + ',' + at + ',' + ((opts && opts.status) === 'pending' ? 'null' : at) + ',' + lit((opts && opts.visibility) || 'public') + ');';
    if (kind === 'multi') for (const k of [1, 2]) q += 'insert into public.post_media (post_id, position, image_path, thumb_path) values (' + lit(id) + ',' + k + ',' + lit(u.id + '/feed/' + k + '.jpg') + ',' + lit(u.id + '/feed/' + k + '_thumb.jpg') + ');';
    if (kind === 'workout') q += "insert into public.post_attachments (post_id, data) values (" + lit(id) + ",'" + JSON.stringify({ kind: 'workout', name: 'FeedLegs', date: '2026-10-20', duration: 3000, xp: 48, exercises: [{ n: 'Squat', s: 5, r: 5, w: 90, d: 5 }] }) + "'::jsonb);";
  });
  sql(q + ' commit;');
  return ids;
}
const SC = `(communitySheetScroller() || document.scrollingElement)`;
async function feedShown(p) {
  await waitFor(() => p.eval(`activeTab === 'komunita' && communityView === 'feed' && communityFeed.items.length > 0 && !communityFeed.loading && !!document.querySelector('#community-feed .xpost')`), 30000, 'feed');
  await wait(300);
}
async function shot(p, name) { const r = await p.c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64')); }

(async () => {
  if (!process.env.GQ_COMMUNITY_CONFIG) throw new Error('GQ_COMMUNITY_CONFIG required');
  fs.mkdirSync(PROFILES, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await startServer(PORT, { new: REPO });
  const A = await member('a', 'ada'), B = await member('b', 'ben'), C = await member('c', 'cyd'), D = await member('d', 'dan'), M = await member('m', 'mod');
  L.makeModerator(M);
  const fr = await A.c.from('friend_requests').insert({ from_id: A.id, to_id: B.id }).select('id').single();
  await B.c.rpc('accept_friend_request', { p_request: fr.data.id });
  const blk = await A.c.from('blocks').insert({ blocker_id: A.id, blocked_id: D.id });
  if (blk.error || sqlVal(`select count(*) from public.blocks where blocker_id = ${lit(A.id)} and blocked_id = ${lit(D.id)}`) !== '1') throw new Error('block setup failed: ' + errText(blk));
  /* najnovšie príspevky (pár minút staré) – sú na začiatku feedu „Všetci" */
  const ids = await seed(B, [['text', 'text', 'FEED-TEXT long enough to read: squats, then a long walk home.', { minutes: 1 }], ['photo', 'photo', 'FEED-PHOTO', { minutes: 2 }],
    ['multi', 'multi', 'FEED-MULTI', { minutes: 3 }], ['workout', 'workout', 'FEED-WORKOUT shared', { minutes: 4 }], ['pend', 'text', 'FEED-PENDING-SECRET', { minutes: 5, status: 'pending' }]]);
  const cIds = await seed(C, [['fo', 'text', 'FEED-FRIENDS-ONLY-SECRET', { minutes: 2, visibility: 'friends' }], ['pub', 'text', 'FEED-CYD-PUBLIC', { minutes: 6 }]]);
  const dIds = await seed(D, [['blk', 'text', 'FEED-BLOCKED-AUTHOR', { minutes: 1 }]]);
  const mine = await seed(A, [['own', 'text', 'FEED-ADA-OWN', { minutes: 7 }]]);
  const conv = (await A.c.rpc('open_chat', { p_friend: B.id })).data;
  await B.c.from('messages').insert({ conversation_id: conv, sender_id: B.id, body: 'hello from ben' });
  try {
    const pA = await device('A');
    await signIn(pA, A);
    await pA.eval(`(setThemePref('light'), switchTab('dnes'), true)`);

    section('Community opens straight into the feed');
    await pA.eval(`(document.querySelector('.tab-bar [data-tab="komunita"]').click(), true)`);
    await feedShown(pA);
    check('posts right under a compact header (first post visible without scrolling)', await pA.eval(`document.querySelector('#community-feed .xpost').getBoundingClientRect().top < 340`), await pA.eval(`Math.round(document.querySelector('#community-feed .xpost').getBoundingClientRect().top)`));
    check('nothing but post cards between the posts (no stray text)', await pA.eval(`![...document.getElementById('community-feed').childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())`));
    check('no dashboard tiles above the feed', await pA.eval(`!document.querySelector('#screen-komunita .cnav, #screen-komunita .cbento, #screen-komunita .bt')`));
    check('no Messages shortcut anywhere on the Community screen', await pA.eval(`!document.querySelector('#screen-komunita [data-community-view="chats"], #screen-komunita [data-cgo="chats"], #screen-komunita [data-community-action="open-chat"]') && !/\\bMessages\\b/.test(document.getElementById('screen-komunita').innerText)`));
    check('header: New post, search and ⋯', await pA.eval(`!document.getElementById('btn-cnew').hidden && !document.getElementById('btn-csearch').hidden && !document.getElementById('btn-cmore').hidden`));
    await pA.eval(`(document.getElementById('btn-cmore').click(), true)`);
    const menu = await pA.eval(`[...document.querySelectorAll('#community-menu [data-cgo]')].map((x) => x.dataset.cgo)`);
    check('⋯ menu: Friends, Top 20, profile, my posts (no Moderation for a member)', J(menu) === J(['friends', 'leaderboard', 'profile', 'myposts']), J(menu));
    check('the menu reports it is open', await pA.eval(`document.getElementById('btn-cmore').getAttribute('aria-expanded') === 'true'`));
    await pA.eval(`(document.getElementById('btn-cmore').click(), true)`);
    await shot(pA, 'feed-light-390');

    section('posts read as one card');
    const card = (k) => `document.querySelector('#community-feed .xpost[data-post="${ids[k]}"]')`;
    check('text post: avatar, name, time, full text, actions; no empty photo', await pA.eval(`(() => { const c = ${card('text')}; return !!c && !!c.querySelector('.cpost-avatar') && c.querySelector('.community-name-btn').textContent === ${J(B.name)}
      && !!c.querySelector('.cpost-meta').textContent && /long walk home/.test(c.querySelector('.cpost-text').textContent) && !c.querySelector('.community-photos') && c.querySelectorAll('.cpost-actions .cpost-act').length === 3; })()`));
    check('photo post: text, then the photo', await pA.eval(`(() => { const c = ${card('photo')}; const m = c.querySelector('.xp-main'); return [...m.children].findIndex((x) => x.classList.contains('cpost-text')) < [...m.children].findIndex((x) => x.classList.contains('community-photos')) && !!c.querySelector('.community-photo'); })()`));
    check('multi-photo post keeps all 3 photos and its marker', await pA.eval(`(() => { const c = ${card('multi')}; return c.querySelector('.community-photos').dataset.count === '3' && !!c.querySelector('.cpost-multi'); })()`));
    check('shared workout shows its summary card', await pA.eval(`(() => { const c = ${card('workout')}; return !!c.querySelector('.cshare-card') && /FeedLegs/.test(c.innerText); })()`));
    check('a photo opens the photo viewer', await pA.eval(`(${card('photo')}.querySelector('[data-community-action="view-photo"]').click(), true)`) && await waitFor(() => pA.eval(`!!document.querySelector('#community-lightbox:not([hidden]) img')`), 15000, 'lightbox').then(() => true, () => false));
    await pA.eval(`(document.getElementById('community-lightbox').click(), true)`);

    section('visibility unchanged');
    /* podľa id (lokálny feed obsahuje aj príspevky s rovnakým textom z predošlých behov) */
    const has = (id) => pA.eval(`!!document.querySelector('#community-feed .xpost[data-post="${id}"]')`);
    const foShown = await has(cIds.fo), pubShown = await has(cIds.pub);
    check('friends-only post of a non-friend is hidden', !foShown && pubShown, J({ foShown, pubShown, items: await pA.eval(`communityFeed.items.slice(0, 14).map((x) => x.name + ':' + x.caption.slice(0, 18) + ':' + x.visibility)`) }));
    check('pending posts are hidden', !(await has(ids.pend)));
    check('blocked authors are hidden', !(await has(dIds.blk)) && await pA.eval(`!document.querySelector('#community-feed .community-name-btn[data-user="${D.id}"]')`));

    section('older posts while scrolling');
    const first = await pA.eval(`communityFeed.items.length`);
    const before = await pA.eval(`document.querySelector('#community-feed .xpost')`);
    await pA.eval(`(window.__firstNode = document.querySelector('#community-feed .xpost'), true)`);
    for (let i = 0; i < 6; i++) { await pA.eval(`window.scrollTo(0, document.documentElement.scrollHeight)`); await wait(900); }
    const st = await pA.eval(`({ n: communityFeed.items.length, keys: communityFeed.items.map((x) => x.id + '|' + (x.reposted_by || '')), at: communityFeed.items.map((x) => x.at), same: document.querySelector('#community-feed .xpost') === window.__firstNode, dom: document.querySelectorAll('#community-feed .xpost').length })`);
    check('more pages loaded by scrolling (' + first + ' → ' + st.n + ')', st.n > first + 10, J({ first, n: st.n }));
    check('no duplicates', new Set(st.keys).size === st.keys.length);
    check('same order as before (newest activity first)', st.at.every((x, i) => i === 0 || st.at[i - 1] >= x));
    check('loading more does not re-render what was already there', st.same && st.dom === st.n);
    check('… and leaves no stray text between appended posts', await pA.eval(`![...document.getElementById('community-feed').childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())`));
    await pA.c.send('Network.enable');
    await pA.c.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await pA.eval(`(communityFeed.done = false, window.scrollTo(0, document.documentElement.scrollHeight), true)`);
    await waitFor(() => pA.eval(`!!document.querySelector('#community-foot [data-community-action="more"]') && communityFeed.error`), 20000, 'error foot');
    check('a failed page shows a short note with Try again', /offline/i.test(await pA.eval(`document.getElementById('community-foot').innerText`)));
    await pA.c.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const nBefore = await pA.eval(`communityFeed.items.length`);
    await pA.eval(`(document.querySelector('#community-foot [data-community-action="more"]').click(), true)`);
    await waitFor(() => pA.eval(`!communityFeed.loading && !communityFeed.error`), 20000, 'retry');
    check('Try again loads the next page', (await pA.eval(`communityFeed.items.length`)) > nBefore || await pA.eval(`communityFeed.done`));

    section('Back restores the feed position and the filter');
    await pA.eval(`(window.scrollTo(0, 0), true)`);
    await pA.eval(`(document.querySelector('[data-community-action="scope"][data-scope="following"]') || {}).click && true`);
    await pA.eval(`(communityScope = 'everyone', true)`);
    await pA.eval(`(${card('workout')}.scrollIntoView({ block: 'center' }), true)`); await wait(300);
    const y = await pA.eval(`Math.round(window.scrollY)`);
    check('every post in the feed has a working comment button (not only the first)', await pA.eval(`[...document.querySelectorAll('#community-feed .xpost [data-community-action="comments"]')].every((b) => !b.disabled)`));
    await pA.eval(`(${card('workout')}.querySelector('[data-community-action="comments"]').click(), true)`);
    await waitFor(() => pA.eval(`communityView === 'comments' && !!document.getElementById('community-comment-text')`), 20000, 'post')
      .catch(async (e) => { console.log('DEBUG', J(await pA.eval(`({ v: communityView, has: !!${card('workout')}, body: document.getElementById('community-body').innerText.slice(0, 200) })`))); throw e; });
    check('a post opens with comments and the composer', true);
    await pA.eval(`(document.querySelector('#community-body [data-community-action="back"]').click(), true)`); await wait(300);
    check('Back → the feed at the same position', await pA.eval(`communityView === 'feed'`) && Math.abs((await pA.eval(`Math.round(window.scrollY)`)) - y) <= 2, J({ y, now: await pA.eval(`Math.round(window.scrollY)`) }));
    await pA.eval(`(${card('workout')}.querySelector('.community-name-btn').click(), true)`);
    await waitFor(() => pA.eval(`communityView === 'user' && !!document.querySelector('#community-body .cprofile:not(.pf-skel)')`), 20000, 'profile');
    await pA.eval(`(document.querySelector('#community-body [data-community-action="back"]').click(), true)`); await wait(300);
    check('Back from a profile → the feed at the same position', await pA.eval(`communityView === 'feed'`) && Math.abs((await pA.eval(`Math.round(window.scrollY)`)) - y) <= 2);
    await pA.eval(`(communitySetView('feed'), true)`); await feedShown(pA);
    await pA.eval(`(document.querySelector('[data-community-action="scope"][data-scope="friends"]').click(), true)`);
    await feedShown(pA);
    await pA.eval(`(${card('text')}.querySelector('[data-community-action="comments"]').click(), true)`);
    await waitFor(() => pA.eval(`communityView === 'comments' && !!document.querySelector('#community-body [data-community-action="back"]')`), 20000, 'post 2');
    await pA.eval(`(document.querySelector('#community-body [data-community-action="back"]').click(), true)`); await wait(300);
    check('Back keeps the Friends filter', await pA.eval(`communityScope === 'friends' && document.querySelector('[data-scope="friends"]').getAttribute('aria-pressed') === 'true'`));
    await pA.eval(`(document.querySelector('[data-community-action="scope"][data-scope="everyone"]').click(), true)`); await feedShown(pA);
    await waitFor(() => pA.eval(`communityScope === 'everyone' && !communityFeed.loading && !!${card('text')}`), 20000, 'everyone again');

    section('post menus and New post');
    await pA.eval(`(${card('text')}.querySelector('[data-community-action="post-menu"]').click(), true)`);
    check("someone else's post: Block and Report (no moderator Remove)", await pA.eval(`(() => { const m = ${card('text')}.querySelector('.cpost-menu'); return !m.hidden && !!m.querySelector('[data-community-action="block"]') && !!m.querySelector('[data-community-action="report-post"]') && !m.querySelector('[data-community-action="mod-remove"]'); })()`));
    await waitFor(() => pA.eval(`!!document.querySelector('#community-feed .xpost[data-post="${mine.own}"]') || (window.scrollTo(0, document.documentElement.scrollHeight), false)`), 20000, 'own post');
    await pA.eval(`(document.querySelector('#community-feed .xpost[data-post="${mine.own}"] [data-community-action="post-menu"]').click(), true)`);
    check('my own post: Delete', await pA.eval(`!!document.querySelector('#community-feed .xpost[data-post="${mine.own}"] .cpost-menu [data-community-action="delete-post"]')`));
    await pA.eval(`(window.scrollTo(0, 400), true)`); await wait(200);
    const y2 = await pA.eval(`Math.round(window.scrollY)`);
    check('New post stays reachable while scrolling (sticky header)', await pA.eval(`(() => { const r = document.getElementById('btn-cnew').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2).closest('#btn-cnew') !== null; })()`));
    await pA.eval(`(document.getElementById('btn-cnew').click(), true)`);
    await waitFor(() => pA.eval(`communityView === 'compose' && !!document.getElementById('community-compose-text')`), 20000, 'composer');
    check('New post opens the existing composer', true);
    await pA.eval(`(document.querySelector('#community-body [data-community-action="back"]').click(), true)`); await wait(300);
    check('Back from the composer → the feed at the same position', await pA.eval(`communityView === 'feed'`) && Math.abs((await pA.eval(`Math.round(window.scrollY)`)) - y2) <= 2);
    await pA.eval(`(document.getElementById('btn-cnew').click(), true)`);
    await waitFor(() => pA.eval(`!!document.getElementById('community-compose-text')`), 20000, 'composer 2');
    await pA.eval(`(() => { const el = document.getElementById('community-compose-text'); el.value = 'FEED-NEW-POST-FROM-UI'; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await pA.eval(`(document.querySelector('[data-community-action="compose-publish"]').click(), true)`);
    const posted = await waitFor(() => pA.eval(`communityView === 'myposts' && document.getElementById('community-body').innerText.indexOf('FEED-NEW-POST-FROM-UI') >= 0`), 20000, 'submitted').then(() => true, () => false);
    check('publishing shows it in My posts as submitted for review', posted && sqlVal(`select status from public.posts where caption = 'FEED-NEW-POST-FROM-UI'`) === 'pending');

    section('moderator, Messages tab, other states');
    const pM = await device('M');
    await signIn(pM, M);
    await pM.eval(`(switchTab('komunita'), true)`); await feedShown(pM);
    await pM.eval(`(document.getElementById('btn-cmore').click(), true)`);
    check('moderator: Moderation in the ⋯ menu', await pM.eval(`!!document.querySelector('#community-menu [data-cgo="moderate"]')`));
    await pM.eval(`(document.getElementById('btn-cmore').click(), document.querySelector('#community-feed .xpost[data-post="${ids.text}"] [data-community-action="post-menu"]').click(), true)`);
    check('moderator: Remove in a post menu', await pM.eval(`!!document.querySelector('#community-feed .xpost[data-post="${ids.text}"] .cpost-menu [data-community-action="mod-remove"]')`));
    await pA.eval(`(openMessagesTab(), true)`);
    await waitFor(() => pA.eval(`!!document.querySelector('[data-community-action="open-chat"][data-chat="${conv}"]')`), 20000, 'messages');
    check('the Messages tab still lists conversations', await pA.eval(`document.querySelector('.tab-bar .tab.active').dataset.tab === 'spravy'`));
    check('… and the Community header (New post) is not shown there', await pA.eval(`getComputedStyle(document.getElementById('community-head')).display === 'none' || document.getElementById('community-head').offsetParent === null`));
    const pG = await device('G');
    await pG.eval(`(setLang('en'), switchTab('komunita'), true)`); await wait(600);
    check('Community off: the intro (Enable) and no New post; nothing switched on', await pG.eval(`!!document.querySelector('[data-community-action="enable"]') && document.getElementById('btn-cnew').hidden && state.settings.communityOptIn !== true`));
    await pG.eval(`(state.settings.communityOptIn = true, renderCommunity(), true)`);
    await waitFor(() => pG.eval(`!!document.getElementById('community-email')`), 15000, 'sign in form');
    check('signed out: the sign-in form, no New post', await pG.eval(`document.getElementById('btn-cnew').hidden`));
    await pG.eval(`(state.settings.communityOptIn = false, true)`);
    await pA.c.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await pA.eval(`(communityMode = 'community', communityBack = [], communityView = 'feed', switchTab('komunita'), true)`);
    await waitFor(() => pA.eval(`!!document.querySelector('.cfeed-state [data-community-action="feed-retry"]')`), 20000, 'offline state');
    check('offline: a compact note with Try again', /offline/i.test(await pA.eval(`document.querySelector('.cfeed-state').innerText`)));
    await pA.c.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await pA.eval(`(document.querySelector('[data-community-action="feed-retry"]').click(), true)`);
    await feedShown(pA);
    check('Try again loads the feed', true);

    section('light / dark, phone and desktop');
    for (const [w, h] of [[390, 844], [1280, 900]]) for (const theme of ['light', 'dark']) {
      await pA.c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: w < 700 ? 2 : 1, mobile: w < 700 });
      await pA.eval(`(setThemePref('${theme}'), window.scrollTo(0, 0), true)`); await wait(400);
      const r = await pA.eval(`({ over: document.documentElement.scrollWidth > innerWidth + 1,
        overlap: (() => { const a = [...document.querySelectorAll('#community-head .screen-title, #btn-csearch, #btn-cmore, #btn-cnew')].map((x) => x.getBoundingClientRect());
          return a.some((x, i) => a.some((y, j) => j > i && x.left < y.right - 1 && y.left < x.right - 1 && x.top < y.bottom - 1 && y.top < x.bottom - 1)); })(),
        newPill: (() => { const b = document.getElementById('btn-cnew'); return getComputedStyle(b).backgroundColor; })() })`);
      check(w + ' px ' + theme + ': no overflow, header controls do not overlap', !r.over && !r.overlap, J(r));
      await shot(pA, 'feed-' + theme + '-' + w);
    }
    await pA.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await pA.eval(`(setThemePref('light'), window.scrollTo(0, document.documentElement.scrollHeight), true)`); await wait(500);
    check('the end of the feed clears the bottom menu', await pA.eval(`(() => { const f = document.getElementById('community-foot').getBoundingClientRect(), n = document.querySelector('.tab-bar').getBoundingClientRect(); return f.bottom <= n.top + 1 || document.documentElement.scrollHeight - innerHeight - scrollY > 2; })()`));

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
