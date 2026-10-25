'use strict';
/* GymQuest v80 — Instagram-style profile in Bento (presentation + navigation only), real headless Chrome
   against the LOCAL test stack with disposable local users and synthetic posts (never production).

     GQ_COMMUNITY_CONFIG=<local config js> node tests/social/ui-profile.js

   Checks: You → Community profile opens my profile directly (no Community tiles at any moment, top bar with
   my name, ⋯ menu); own actions (Edit profile, Friends, menu: settings, my posts, sign out; Moderation only
   for moderators); counts match the server; my grid shows pending + approved photo + text-only posts; a
   pending tile opens My posts; another profile opens directly from the feed, comments, chat header, search,
   friends list and follower lists, with a skeleton carrying the right name and never the feed; Back returns
   to the previous screen with its scroll position; follow keeps the position; another user's pending and
   friends-only posts are not shown; block/report in the menu, moderator items only for moderators; a grid
   tile opens the full post; light / dark / system; 320, 390 and 1280 px without horizontal overflow or
   overlapping bar controls; no console errors. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./lib');
const { startServer, Browser, waitFor } = require('../sync/lib');
const HELPERS = require('../sync/helpers');
const { check, section, sql, lit, errText } = L;

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-social-profile');
const PROFILES = path.join(WORK, 'profiles');
const SHOTS = path.join(WORK, 'shots');
let nextPort = 9990;
const browsers = [];
const pages = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;

async function device(name, w, h) {
  const b = new Browser(name + '-' + Date.now().toString(36), nextPort++, PROFILES);
  browsers.push(b);
  const p = await b.launch();
  p.logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error') p.logs.push(e.entry.text + ' ' + (e.entry.url || '')); });
  await p.navigate(BASE);
  await p.eval(HELPERS);
  await p.c.send('Emulation.setDeviceMetricsOverride', { width: w || 390, height: h || 844, deviceScaleFactor: 2, mobile: (w || 390) < 700 });
  pages.push([name, p]);
  return p;
}
async function signIn(p, u) {
  await p.eval('window.__gq.signIn(' + J(u.email) + ',' + J(u.password) + ')');
  await p.ready();
  await p.eval(HELPERS);
  await p.eval(`(state.settings.communityOptIn = true, persistState(), setLang('en'), true)`);
  await p.eval(`(switchTab('komunita'), true)`);
  await waitFor(() => p.eval(`!!communityProfile && communityVersion >= 5`), 30000, 'profile');
}
async function member(tag, name) {
  const u = await L.newUser('pf-' + tag);
  u.name = name + '_' + L.runTag.slice(-5);
  const r = await u.c.from('profiles').update({ username: u.name, bio: name === 'ben' ? 'Bench every Monday 🏋️' : '' }).eq('id', u.id).select('id');
  if (r.error) throw new Error('rename ' + errText(r));
  await u.c.rpc('community_join');
  return u;
}
async function friends(x, y) {
  const req = await x.c.from('friend_requests').insert({ from_id: x.id, to_id: y.id }).select('id').single();
  if (req.error) throw new Error('friend ' + errText(req));
  await y.c.rpc('accept_friend_request', { p_request: req.data.id });
}
const IMG = fs.readFileSync(path.join(REPO, 'media', 'bench-press-poster.jpg'));
async function post(u, text, nPhotos, opts) {
  const photos = [];
  const folder = u.id + '/pf-' + Math.random().toString(36).slice(2, 8);
  for (let i = 0; i < nPhotos; i++) {
    for (const f of [i + '.jpg', i + '_thumb.jpg']) {
      const up = await u.c.storage.from('community').upload(folder + '/' + f, IMG, { contentType: 'image/jpeg' });
      if (up.error) throw new Error('upload ' + up.error.message);
    }
    photos.push({ image: folder + '/' + i + '.jpg', thumb: folder + '/' + i + '_thumb.jpg' });
  }
  const r = await u.c.rpc('create_post', { p_text: text, p_photos: photos, p_visibility: (opts && opts.visibility) || 'public' });
  if (r.error) throw new Error('post ' + errText(r));
  if (!(opts && opts.pending)) sql("begin; set local session_replication_role = replica; update public.posts set status = 'approved', published_at = now() where id = " + lit(r.data) + "; commit;");
  return r.data;
}
/* Sleduje obsah #community-body pri každej zmene: či sa niekedy ukázali dlaždice Community a čo bolo v lište. */
const WATCH = `(() => { window.__frames = []; const b = document.getElementById('community-body');
  if (window.__mo) window.__mo.disconnect();
  window.__mo = new MutationObserver(() => window.__frames.push({ tiles: !!b.querySelector('.cnav.cbento, .cscope, #community-feed .cpost, #community-feed .cpost-skel'), bar: (b.querySelector('.csub-head .csub-title') || {}).textContent || '', skel: !!b.querySelector('.pf-skel') }));
  window.__mo.observe(b, { childList: true }); return true; })()`;
const frames = (p) => p.eval(`window.__frames`);
const profileShown = (p, name) => waitFor(() => p.eval(`!!document.querySelector('#community-body .cprofile:not(.pf-skel)') && (document.querySelector('#community-body .csub-head .csub-title') || {}).textContent === ${J(name)}`), 30000, 'profile ' + name);
const SC = `(communitySheetScroller() || document.scrollingElement)`;
async function shot(p, name) {
  const r = await p.c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
}
async function clickSel(p, sel) {
  await waitFor(() => p.eval(`(() => { const el = document.querySelector(${J(sel)}); if (!el) return false; el.click(); return true; })()`), 20000, 'click ' + sel);
}

(async () => {
  if (!process.env.GQ_COMMUNITY_CONFIG) throw new Error('GQ_COMMUNITY_CONFIG required');
  fs.mkdirSync(PROFILES, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await startServer(PORT, { new: REPO });
  const A = await member('a', 'ada'), B = await member('b', 'ben'), C = await member('c', 'cyd'), M = await member('m', 'mod');
  L.makeModerator(M);
  await friends(A, B);
  await A.c.from('follows').insert({ follower_id: A.id, followee_id: B.id });
  await C.c.from('follows').insert({ follower_id: C.id, followee_id: B.id });
  /* príspevky: moje (fotka, text, čakajúci), Benove (2 fotky, text, čakajúci), Cydov len pre priateľov */
  await post(A, 'My first lift', 1);
  await post(A, 'Text only from Ada: rest day, long walk.', 0);
  await post(A, 'Waiting for the moderator', 0, { pending: true });
  for (let i = 0; i < 4; i++) await post(B, 'Ben photo ' + i, i === 0 ? 2 : 1);
  const bText = await post(B, 'Ben text-only post about squats', 0);
  await post(B, 'Ben pending secret', 0, { pending: true });
  await post(C, 'Cyd friends-only secret', 0, { visibility: 'friends' });
  await post(C, 'Cyd public', 0);
  const conv = (await A.c.rpc('open_chat', { p_friend: B.id })).data;
  await B.c.from('messages').insert({ conversation_id: conv, sender_id: B.id, body: 'Hey Ada' });
  const cardA = (await A.c.rpc('profile_card', { p_user: A.id })).data[0];
  try {
    const pA = await device('A');
    await signIn(pA, A);
    await pA.eval(`setThemePref('light'); true`);

    /* v80 (neskôr): karta Ty JE môj profil (tests/social/ui-you.js); môj profil v Community sa otvára ťuknutím na
       moje meno (napr. v príspevku) – tu tá istá cesta (openOwnProfileSheet) s návratom na Ty */
    section('my profile sheet (tapping my own name), Back to You');
    await pA.eval(`(document.querySelector('.tab[data-tab="ty"]').click(), true)`);
    await wait(400);
    await pA.eval(WATCH);
    await pA.eval(`(openOwnProfileSheet('ty'), true)`);
    await profileShown(pA, A.name);
    let fr = await frames(pA);
    check('opens directly: no Community tiles, feed chips or posts above it at any moment', fr.every((f) => !f.tiles), J(fr));
    check('the first thing shown is a skeleton with my name (never another screen)', fr.length > 0 && fr[0].skel && fr[0].bar === A.name, J(fr[0]));
    check('top bar: Back, my username, ⋯ menu', await pA.eval(`!!document.querySelector('.csub-head [data-community-action="back"]') && !!document.querySelector('.csub-head .pf-more')`));
    check('exactly one top bar (no duplicate headings)', await pA.eval(`document.querySelectorAll('#community-body .csub-head, #community-body .k-head').length === 1`));
    const stats = await pA.eval(`[...document.querySelectorAll('#community-body .cstat .cstat-n')].map((x) => Number(x.textContent))`);
    check('counts are the real ones (posts, followers, following, friends)', J(stats) === J([cardA.posts, cardA.followers, cardA.following, cardA.friends]), J({ stats, cardA }));
    check('Edit profile and Friends buttons', await pA.eval(`!!document.querySelector('.pf-actions [data-community-action="edit-profile"]') && !!document.querySelector('.pf-actions [data-community-action="go-friends"]')`));
    await pA.eval(`(document.querySelector('.pf-more').click(), true)`);
    const menuA = await pA.eval(`[...document.querySelectorAll('#community-profile-menu .pf-menu-item')].map((x) => x.dataset.communityAction)`);
    check('⋯ menu: settings and privacy, my posts, sign out — no moderation for a normal member', J(menuA) === J(['edit-profile', 'go-myposts', 'signout']), J(menuA));
    check('the menu reports that it is open', await pA.eval(`document.querySelector('.pf-more').getAttribute('aria-expanded') === 'true'`));
    await pA.eval(`(document.querySelector('.pf-more').click(), true)`);
    const tilesA = await pA.eval(`[...document.querySelectorAll('#community-body .pf-grid .pf-tile')].map((x) => ({ text: x.classList.contains('pf-text'), pending: x.classList.contains('pf-pending'), img: !!x.querySelector('img') }))`);
    check('my grid: the pending post (marked) first, then my photo post and my text-only post', tilesA.length === 3 && tilesA[0].pending && tilesA.some((x) => x.img && !x.pending) && tilesA.some((x) => x.text && !x.pending), J(tilesA));
    check('text-only post is readable in the grid', /rest day, long walk/.test(await pA.eval(`document.querySelector('.pf-grid').innerText`)));
    await shot(pA, 'own-light');
    await pA.eval(`setThemePref('dark'); true`); await wait(300); await shot(pA, 'own-dark');
    await pA.eval(`setThemePref('light'); true`);
    await clickSel(pA, '.pf-grid .pf-pending');
    await waitFor(() => pA.eval(`communityView === 'myposts' && !!document.querySelector('#community-body [data-community-action="delete-post"]')`), 20000, 'my posts');
    check('the pending tile opens My posts (edit / delete there)', true);
    await pA.eval(`(document.querySelector('#community-body [data-community-action="back"]').click(), true)`);
    await profileShown(pA, A.name);
    check('Back returns to my profile', await pA.eval(`communityView === 'profile'`));
    await clickSel(pA, '.pf-actions [data-community-action="edit-profile"]');
    await waitFor(() => pA.eval(`communityView === 'editprofile' && !!document.getElementById('community-username') && !!document.getElementById('community-searchable')`), 20000, 'edit');
    check('Edit profile keeps name, bio, avatar, privacy and account actions', await pA.eval(`!!document.getElementById('community-bio') && !!document.querySelector('[data-community-action="save-profile"]') && !!document.querySelector('[data-community-action="delete-account"]') && !!document.querySelector('[data-community-action="leave"]')`));
    await pA.eval(`(document.getElementById('community-bio').value = 'Synthetic bio', document.querySelector('[data-community-action="save-profile"]').click(), true)`);
    await wait(1200);
    await pA.eval(`(document.querySelector('#community-body [data-community-action="back"]').click(), true)`);
    await waitFor(() => pA.eval(`(document.querySelector('#community-body .cprofile-bio') || {}).textContent === 'Synthetic bio'`), 20000, 'bio');
    check('back on my profile the new bio is shown (refreshed in place)', true);
    await pA.eval(`(document.querySelector('#community-body [data-community-action="back"]').click(), true)`);
    await wait(400);
    check('Back from my profile returns to You', await pA.eval(`activeTab === 'ty'`));

    section('another profile from the feed');
    await pA.eval(`(communityMode = 'community', communityBack = [], communityReturnTab = null, communityScope = 'everyone', communityView = 'feed', switchTab('komunita'), true)`);
    await waitFor(() => pA.eval(`!!document.querySelector('#community-feed .community-name-btn[data-user="${B.id}"]')`), 30000, 'feed with ben');
    await pA.eval(`(document.querySelector('#community-feed .community-name-btn[data-user="${B.id}"]').scrollIntoView({ block: 'center' }), true)`);
    await wait(300);
    const feedY = await pA.eval(`Math.round(window.scrollY)`);
    await pA.eval(WATCH);
    await pA.eval(`(document.querySelector('#community-feed .community-name-btn[data-user="${B.id}"]').click(), true)`);
    await profileShown(pA, B.name);
    fr = await frames(pA);
    check('opens directly: the feed and its tiles never appear above or instead of the profile', fr.every((f) => !f.tiles), J(fr));
    check('the skeleton already carries Ben’s name (never another profile)', fr[0] && fr[0].skel && fr[0].bar === B.name, J(fr[0]));
    const actB = await pA.eval(`[...document.querySelectorAll('.pf-actions [data-community-action]')].map((x) => x.dataset.communityAction)`);
    check('actions for a friend I follow: Following, Friends, Message', J(actB) === J(['follow', 'unfriend-ask', 'message']), J(actB));
    await pA.eval(`(document.querySelector('.pf-more').click(), true)`);
    const menuB = await pA.eval(`[...document.querySelectorAll('#community-profile-menu .pf-menu-item')].map((x) => x.dataset.communityAction)`);
    check('⋯ menu: Block and Report — no moderator items for a normal member', J(menuB) === J(['block', 'report-user']), J(menuB));
    await pA.eval(`(document.querySelector('.pf-more').click(), true)`);
    const gridB = await pA.eval(`({ n: document.querySelectorAll('.pf-grid .pf-tile').length, text: document.querySelector('.pf-grid').innerText, multi: document.querySelectorAll('.pf-grid .pf-tile .pf-mark').length, pending: document.querySelectorAll('.pf-grid .pf-pending').length })`);
    check('Ben’s grid: his 4 photo posts and his text-only post', gridB.n === 5 && /squats/.test(gridB.text), J(gridB));
    check('multi-photo post is marked', gridB.multi >= 1);
    check('his pending post is not shown to me', !/pending secret/.test(gridB.text) && gridB.pending === 0);
    await shot(pA, 'other-light');
    await pA.eval(`setThemePref('dark'); true`); await wait(300); await shot(pA, 'other-dark');
    /* Systém: voľba sa neuloží (kľúč chýba) a vzhľad nasleduje telefón – tu ho prepneme cez emuláciu */
    await pA.c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await pA.eval(`setThemePref('auto'); true`); await wait(300);
    check('System mode follows the phone (dark) and renders the profile', await pA.eval(`themePref() === 'auto' && document.documentElement.dataset.theme === 'dark' && !!document.querySelector('#community-body .cprofile')`));
    await pA.c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }); await wait(300);
    check('… and switches with it (light)', await pA.eval(`document.documentElement.dataset.theme === 'light'`));
    await shot(pA, 'other-system');
    await pA.eval(`setThemePref('light'); true`);

    section('grid tile → full post → Back keeps the place');
    await pA.eval(`(${SC}.scrollTop = 120, true)`); await wait(200);
    const yB = await pA.eval(`Math.round(${SC}.scrollTop)`);
    await clickSel(pA, `.pf-grid .pf-tile[data-post="${bText}"]`);
    await waitFor(() => pA.eval(`communityView === 'comments' && !!document.querySelector('#community-body .cpost[data-post="${bText}"]')`), 20000, 'post');
    check('the tile opens the full post (with likes and comments)', await pA.eval(`!!document.querySelector('#community-body .cpost [data-community-action="like"]') && !!document.getElementById('community-comment-text')`));
    await pA.eval(`(document.querySelector('#community-body [data-community-action="back"]').click(), true)`);
    await wait(150);
    check('Back shows Ben’s profile at once, at the same scroll position', await pA.eval(`communityView === 'user' && Math.abs(${SC}.scrollTop - ${yB}) <= 2 && !!document.querySelector('.pf-grid')`), J({ yB, now: await pA.eval(`Math.round(${SC}.scrollTop)`) }));
    await wait(1500);
    check('… and stays there after the quiet refresh', await pA.eval(`Math.abs(${SC}.scrollTop - ${yB}) <= 2`));

    section('follow keeps the place; lists open profiles');
    await clickSel(pA, '.pf-actions [data-community-action="follow"]');
    await waitFor(() => pA.eval(`(document.querySelector('.pf-actions [data-community-action="follow"]') || {}).dataset && document.querySelector('.pf-actions [data-community-action="follow"]').dataset.on === '1'`), 20000, 'unfollowed');
    check('unfollow works and the scroll position stays', await pA.eval(`Math.abs(${SC}.scrollTop - ${yB}) <= 2`));
    await clickSel(pA, '.pf-actions [data-community-action="follow"]');
    await waitFor(() => pA.eval(`document.querySelector('.pf-actions [data-community-action="follow"]').dataset.on === '0'`), 20000, 'followed again');
    await pA.eval(`(${SC}.scrollTop = 0, true)`);
    await clickSel(pA, '.cstat[data-kind="followers"]');
    await waitFor(() => pA.eval(`communityView === 'list' && !!document.querySelector('#community-body [data-community-action="open-user"][data-user="${C.id}"]')`), 20000, 'followers');
    check('Followers count opens the followers list', true);
    await pA.eval(WATCH);
    await pA.eval(`(document.querySelector('#community-body [data-community-action="open-user"][data-user="${C.id}"]').click(), true)`);
    await profileShown(pA, C.name);
    check('a person in the list opens their profile directly', (await frames(pA)).every((f) => !f.tiles));
    const gridC = await pA.eval(`document.querySelector('#community-body').innerText`);
    check('Cyd’s friends-only post is not shown to a non-friend; his public one is', !/friends-only secret/.test(gridC) && /Cyd public/.test(gridC));
    await pA.eval(`(document.querySelector('#community-body [data-community-action="back"]').click(), true)`);
    await wait(200);
    check('Back → the followers list', await pA.eval(`communityView === 'list'`));
    await pA.eval(`(document.querySelector('#community-body [data-community-action="back"]').click(), true)`);
    await profileShown(pA, B.name);
    check('Back → Ben’s profile (not Cyd’s)', await pA.eval(`communityViewUser === ${J(B.id)}`));
    await pA.eval(`(document.querySelector('#community-body [data-community-action="back"]').click(), true)`);
    await wait(200);
    check('Back → the feed, at the same scroll position, with its header', await pA.eval(`communityView === 'feed' && !document.getElementById('btn-cnew').hidden && Math.abs(window.scrollY - ${feedY}) <= 2`), J({ feedY, now: await pA.eval(`Math.round(window.scrollY)`) }));

    section('other entry points');
    await pA.eval(`(openMessagesTab(), true)`);
    await clickSel(pA, `[data-community-action="open-chat"][data-chat="${conv}"]`);
    await waitFor(() => pA.eval(`communityView === 'chat' && !!document.querySelector('.cchat-who')`), 20000, 'chat');
    await pA.eval(`(document.querySelector('.cchat-who').click(), true)`);
    await profileShown(pA, B.name);
    check('chat header → Ben’s profile', true);
    await pA.eval(`(document.querySelector('#community-body [data-community-action="back"]').click(), true)`);
    await waitFor(() => pA.eval(`communityView === 'chat' && !!document.getElementById('community-chat-text')`), 20000, 'back to chat');
    check('Back → the chat', true);
    await pA.eval(`(communityMode = 'community', communitySetView('friends'), true)`);
    await clickSel(pA, `#community-body [data-community-action="open-user"][data-user="${B.id}"]`);
    await profileShown(pA, B.name);
    check('friends list → Ben’s profile', true);
    await pA.eval(`(document.querySelector('#community-body [data-community-action="back"]').click(), true)`);
    await wait(300);
    check('Back → friends list', await pA.eval(`communityView === 'friends'`));
    await pA.eval(`(communitySetView('search'), true)`);
    await waitFor(() => pA.eval(`!!document.getElementById('community-search')`), 20000, 'search');
    await pA.eval(`(() => { const el = document.getElementById('community-search'); el.value = ${J(C.name)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await clickSel(pA, `#community-body [data-community-action="open-user"][data-user="${C.id}"]`);
    await profileShown(pA, C.name);
    check('search result → Cyd’s profile', true);
    await pA.eval(`(document.querySelector('#community-body [data-community-action="back"]').click(), true)`);
    await wait(300);
    check('Back → search with the same text and results', await pA.eval(`communityView === 'search' && document.getElementById('community-search').value === ${J(C.name)} && !!document.querySelector('#community-body [data-community-action="open-user"][data-user="${C.id}"]')`));
    await pA.eval(`(communitySetView('feed'), true)`);
    await waitFor(() => pA.eval(`!!document.querySelector('#community-feed .community-name-btn[data-user="${A.id}"]')`), 30000, 'my post in feed');
    await pA.eval(`(document.querySelector('#community-feed .community-name-btn[data-user="${A.id}"]').click(), true)`);
    await profileShown(pA, A.name);
    check('tapping my own name opens my own profile (with Edit profile)', await pA.eval(`communityView === 'profile' && !!document.querySelector('.pf-actions [data-community-action="edit-profile"]')`));

    section('moderator sees moderator items, layout at other sizes');
    const pM = await device('M', 320, 640);
    await signIn(pM, M);
    await pM.eval(`(communityMode = 'community', communityBack = [], communityView = 'feed', switchTab('komunita'), true)`);
    await pM.eval(`(communityOpenUser(${J(B.id)}), true)`);
    await profileShown(pM, B.name);
    await pM.eval(`(document.querySelector('.pf-more').click(), true)`);
    const menuM = await pM.eval(`[...document.querySelectorAll('#community-profile-menu .pf-menu-item')].map((x) => x.dataset.communityAction)`);
    check('moderator: Block, Report and the two leaderboard moderation items', J(menuM) === J(['block', 'report-user', 'lb-mod', 'lb-mod']), J(menuM));
    await pM.eval(`(openOwnProfileSheet('ty'), true)`);
    await profileShown(pM, M.name);
    await pM.eval(`(document.querySelector('.pf-more').click(), true)`);
    check('moderator: Moderation in my own menu', await pM.eval(`!!document.querySelector('#community-profile-menu [data-community-action="go-moderate"]')`));
    const layout = `(() => { const bar = document.querySelector('.csub-head'); const parts = [...bar.children].map((x) => x.getBoundingClientRect());
      const overlap = parts.some((a, i) => parts.some((b, j) => j > i && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1));
      const sc = communitySheetScroller();
      const tiles = [...document.querySelectorAll('.pf-actions .btn, .cstat')].map((x) => x.getBoundingClientRect());
      const outside = tiles.some((r) => r.left < -1 || r.right > innerWidth + 1);
      return { overflowX: (sc ? sc.scrollWidth > sc.clientWidth + 1 : document.documentElement.scrollWidth > innerWidth + 1), overlap, outside }; })()`;
    for (const [w, h] of [[320, 640], [1280, 800]]) {
      await pM.c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });
      await pM.eval(`(communityOpenUser(${J(B.id)}), true)`);
      await profileShown(pM, B.name);
      await wait(300);
      const r = await pM.eval(layout);
      check(w + ' px: no horizontal overflow, bar controls do not overlap, buttons and counts on screen', !r.overflowX && !r.overlap && !r.outside, J(r));
      await shot(pM, 'other-' + w);
    }
    for (const theme of ['light', 'dark']) {
      await pA.eval(`setThemePref('${theme}'); true`);
      const r = await pA.eval(layout);
      check('390 px ' + theme + ': no overflow or overlap', !r.overflowX && !r.overlap && !r.outside, J(r));
    }

    section('no errors');
    for (const [name, p] of pages) {
      check(name + ': no exceptions', p.errors.length === 0, J(p.errors));
      const errs = p.logs.filter((l) => !/favicon|127\.0\.0\.1:54321\/(auth|rest|functions)\/v1\/.*(400|401|404)/.test(l));
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
