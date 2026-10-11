'use strict';
/* GymQuest social Phase 2 (migration 0008) — UI test in real headless Chrome against the
   LOCAL test stack (disposable local users; lib.js refuses anything else). Two browsers
   (A and B) exercise the new Community tab end to end, including live chat.

     GQ_COMMUNITY_CONFIG=<local config js> node tests/social/ui-phase2.js

   Needs 0005 + 0008 applied. The last section rolls 0008 back (and re-applies it) to check
   the app falls back to the 0005 Community and friends-only posts stay hidden. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./lib');
const { startServer, Browser, waitFor } = require('../sync/lib');
const HELPERS = require('../sync/helpers');
const { check, section, sql, sqlVal, lit, errText } = L;

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-social-ui2');
const PROFILES = path.join(WORK, 'profiles');
let nextPort = 9880;
const browsers = [];
const pages = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;

async function device(name) {
  const b = new Browser(name + '-' + Date.now().toString(36), nextPort++, PROFILES);
  browsers.push(b);
  const p = await b.launch();
  p.logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error') p.logs.push(e.entry.text + ' ' + (e.entry.url || '')); });
  await p.navigate(BASE);
  await p.eval(HELPERS);
  pages.push([name, p]);
  return p;
}
async function signIn(p, u) {
  await p.eval('window.__gq.signIn(' + J(u.email) + ',' + J(u.password) + ')');
  await p.ready();
  await p.eval(HELPERS);
  await p.eval(`(state.settings.communityOptIn = true, persistState(), true)`);
  await tab(p, 'komunita');
  await waitFor(() => p.eval(`!!communityProfile && communityVersion === 2`), 30000, 'profile');
}
async function tab(p, name) { await p.eval(`(document.querySelector('.tab-bar [data-tab="${name}"]').click(), true)`); await wait(300); }
const bodyText = (p) => p.eval(`document.getElementById('community-body').innerText`);
async function rendered(p) {
  await waitFor(() => p.eval(`(() => { const b = document.getElementById('community-body'); return !!b && b.innerText.indexOf(t('community.loading')) < 0 && b.innerText.length > 0; })()`), 30000, 'render');
  await wait(500);
}
async function nav(p, v) { await click(p, '.cnav [data-community-view="' + v + '"]'); await rendered(p); }
async function click(p, selector) {
  await waitFor(() => p.eval(`(() => { const el = document.querySelector(${J(selector)}); if (!el || el.disabled) return false; el.click(); return true; })()`),
    15000, 'element ' + selector);
  await wait(400);
}
async function type(p, selector, text) {
  await waitFor(() => p.eval(`(() => { const el = document.querySelector(${J(selector)}); if (!el) return false;
    el.focus(); el.value = ${J(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`), 15000, 'input ' + selector);
}
async function approve(M, id) {
  const r = await M.c.from('posts').update({ status: 'approved', published_at: new Date().toISOString() }).eq('id', id).select('id');
  if (r.error || !(r.data || []).length) throw new Error('approve: ' + errText(r));
}

(async () => {
  if (sqlVal('select public.community_social_version()') !== '2') throw new Error('0008 must be applied');
  if (!process.env.GQ_COMMUNITY_CONFIG) throw new Error('GQ_COMMUNITY_CONFIG required');
  fs.mkdirSync(PROFILES, { recursive: true });
  const server = await startServer(PORT, { new: REPO });
  const tag = L.runTag.slice(-5);
  const M = await L.newUser('ui2-mod'); L.makeModerator(M);
  const A = await L.newUser('ui2-a'), B = await L.newUser('ui2-b'), C = await L.newUser('ui2-c');
  for (const [u, n] of [[A, 'anna'], [B, 'boris'], [C, 'cyril']]) {
    u.name = n + '_' + tag;
    const r = await u.c.from('profiles').update({ username: u.name }).eq('id', u.id).select('id');
    if (r.error) throw new Error('rename ' + errText(r));
    await u.c.rpc('community_join');
  }
  const bPost = (await B.c.rpc('create_post', { p_text: 'Leg day done 💪 ' + tag })).data;
  await approve(M, bPost);
  try {
    section('layout: 5 tabs, Motivation inside Progress, Community as a tab');
    const pA = await device('A');
    const tabs = await pA.eval(`Array.from(document.querySelectorAll('.tab-bar .tab')).map((b) => b.dataset.tab)`);
    check('bottom bar: Today, Training, Progress, Calendar, Community', J(tabs) === J(['dnes', 'trening', 'pokrok', 'kalendar', 'komunita']), J(tabs));
    await tab(pA, 'pokrok');
    await pA.eval(`(document.querySelector('#pokrok-subtabs [data-pokrok="motivation"]').click(), true)`); await wait(300);
    check('Motivation is a Progress sub-tab with the level and achievements', await pA.eval(`!document.getElementById('subview-motivation').hidden
      && !!document.getElementById('level-value') && document.getElementById('achievements-list').children.length > 0`));
    check('no separate Motivation screen and no header globe button any more', await pA.eval(`!document.getElementById('screen-motivacia') && !document.getElementById('btn-community')`));
    await signIn(pA, A);
    check('Community opens as a tab with its own navigation (Home, Search, New, Messages, Profile)', await pA.eval(`!document.getElementById('screen-komunita').hidden
      && document.querySelectorAll('.cnav .cnav-btn').length === 5`));
    await rendered(pA);
    check('Home shows the scope chips Everyone / Following / Friends', await pA.eval(`document.querySelectorAll('.cscope .goal-chip').length === 3`));

    section('feed card and comments');
    await waitFor(() => pA.eval(`!!document.querySelector('.cpost[data-post=${J(bPost)}]')`), 20000, 'B post in feed');
    check('the post card has avatar, name, time, actions and the comments link', await pA.eval(`(() => { const c = document.querySelector('.cpost[data-post=${J(bPost)}]');
      return !!c.querySelector('.cpost-avatar') && !!c.querySelector('.cpost-meta') && !!c.querySelector('[data-community-action="like"]')
        && !!c.querySelector('[data-community-action="comments"]') && !!c.querySelector('.cpost-comments-link'); })()`));
    await click(pA, '.cpost[data-post=' + J(bPost) + '] .cpost-comments-link'); await rendered(pA);
    await type(pA, '#community-comment-text', 'Great work!');
    await click(pA, '[data-community-action="comment-send"]'); await rendered(pA);
    check('a comment is posted and shown', (await bodyText(pA)).includes('Great work!')
      && sqlVal('select count(*) from public.post_comments where post_id = ' + lit(bPost)) === '1');
    await click(pA, '[data-community-action="back"]'); await rendered(pA);
    await waitFor(() => pA.eval(`(document.querySelector('.cpost[data-post=${J(bPost)}] .cpost-comments-link') || {}).textContent === t('community2.viewComments', { n: 1 })`), 15000, 'count');
    check('Back returns to the feed, which shows "View comments (1)"', true);

    section('search and friend request (live badge)');
    const pB = await device('B');
    await signIn(pB, B);
    await nav(pA, 'search');
    await type(pA, '#community-search', 'bori');
    await waitFor(() => pA.eval(`document.getElementById('community-search-results').innerText.indexOf(${J(B.name)}) >= 0`), 15000, 'search result');
    check('searching part of a name finds the member', true);
    await click(pA, '#community-search-results [data-community-action="friend-add"]');
    await waitFor(() => pA.eval(`document.getElementById('community-search-results').innerText.indexOf(t('community2.requested')) >= 0`), 15000, 'requested');
    check('Add friend → "Request sent"', sqlVal(`select count(*) from public.friend_requests where from_id = ${lit(A.id)} and to_id = ${lit(B.id)}`) === '1');
    await tab(pB, 'dnes');
    await waitFor(() => pB.eval(`!document.getElementById('tab-community-badge').hidden && document.getElementById('tab-community-badge').textContent === '1'`), 20000, 'live request badge');
    check('the recipient gets a live badge on the Community tab (without reloading)', true);
    await tab(pB, 'komunita'); await rendered(pB);
    await nav(pB, 'profile');
    await click(pB, '[data-community-action="go-friends"]'); await rendered(pB);
    check('the request appears under Friend requests', (await bodyText(pB)).includes(A.name));
    await click(pB, '[data-community-action="friend-accept"]'); await rendered(pB);
    check('Accept → now friends', sqlVal(`select count(*) from public.friendships where ${lit(A.id)} in (user_a, user_b) and ${lit(B.id)} in (user_a, user_b)`) === '1');
    check('the badge clears', await pB.eval(`document.getElementById('tab-community-badge').hidden`));

    section('live chat');
    await click(pB, '[data-community-action="message"][data-user=' + J(A.id) + ']'); await rendered(pB);
    check('Message opens the chat view', await pB.eval(`communityView === 'chat' && !!document.getElementById('community-chat-text')`));
    await nav(pA, 'chats');
    await type(pB, '#community-chat-text', 'Hi Anna!');
    await pB.eval(`(() => { const el = document.getElementById('community-chat-text'); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
    await waitFor(() => pB.eval(`document.getElementById('community-chat-msgs').innerText.indexOf('Hi Anna!') >= 0`), 15000, 'own message');
    check('Enter sends; the message appears as a bubble', await pB.eval(`!!document.querySelector('.cmsg.mine')`));
    await waitFor(() => pA.eval(`document.getElementById('community-body').innerText.indexOf('Hi Anna!') >= 0`), 20000, 'chat list live');
    check('the receiver\'s chat list updates live with the message and an unread badge', await pA.eval(`!!document.querySelector('.cchat-row.unread')`)
      && await pA.eval(`!document.getElementById('tab-community-badge').hidden`));
    await click(pA, '.cchat-row'); await rendered(pA);
    check('opening the chat shows the message and clears unread', (await bodyText(pA)).includes('Hi Anna!')
      && await waitFor(() => pA.eval(`document.getElementById('tab-community-badge').hidden`), 15000, 'badge cleared').then(() => true));
    await type(pA, '#community-chat-text', 'Hey Boris, see you at the gym');
    await click(pA, '[data-community-action="chat-send"]');
    await waitFor(() => pB.eval(`document.getElementById('community-chat-msgs').innerText.indexOf('see you at the gym') >= 0`), 20000, 'live reply');
    check('a reply appears live in the other open chat', true);
    check('a moderator never gets the messages (RLS)', (await M.c.from('messages').select('id').limit(5)).data.length === 0);

    section('friends-only post');
    await nav(pA, 'compose');
    await type(pA, '#community-compose-text', 'Only for my friends ' + tag);
    await pA.eval(`(document.querySelector('input[name="community-visibility"][value="friends"]').click(), true)`);
    await click(pA, '[data-community-action="compose-publish"]');
    await waitFor(() => Promise.resolve(sqlVal(`select count(*) from public.posts where user_id = ${lit(A.id)} and visibility = 'friends'`) === '1'), 20000, 'fo post');
    const fo = sqlVal(`select id from public.posts where user_id = ${lit(A.id)} and visibility = 'friends'`);
    check('the composer creates a friends-only post', !!fo);
    await approve(M, fo);
    await nav(pB, 'feed');
    await click(pB, '.cscope [data-scope="friends"]'); await rendered(pB);
    await waitFor(() => pB.eval(`!!document.querySelector('.cpost[data-post=${J(fo)}] .cpost-friends')`), 15000, 'friends feed');
    check('a friend sees it in Friends with the "Friends only" label', true);
    await click(pB, '.cscope [data-scope="everyone"]'); await rendered(pB);
    check('... but not in Everyone', !(await pB.eval(`!!document.querySelector('.cpost[data-post=${J(fo)}]')`)));
    const pC = await device('C');
    await signIn(pC, C);
    await rendered(pC);
    check('a non-friend never sees it', !(await pC.eval(`!!document.querySelector('.cpost[data-post=${J(fo)}]')`)));

    section('own profile: search setting');
    await nav(pA, 'profile');
    check('own profile shows counts with friends', await pA.eval(`document.querySelectorAll('.cprofile-stats .cstat').length === 4`));
    await pA.eval(`(document.getElementById('community-searchable').click(), true)`); await wait(800);
    check('"Show me in search" off is saved', sqlVal('select searchable from public.profiles where id = ' + lit(A.id)) === 'f');
    await pA.eval(`(document.getElementById('community-searchable').click(), true)`); await wait(800);
    check('... and on again', sqlVal('select searchable from public.profiles where id = ' + lit(A.id)) === 't');

    section('translations: no raw keys in 6 languages, Arabic right-to-left');
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await pA.eval(`(setLang(${J(lang)}), true)`);
      const raw = [];
      for (const v of ['feed', 'search', 'chats', 'profile', 'compose']) {
        await nav(pA, v);
        const m = ((await bodyText(pA)) + ' ' + (await pA.eval(`document.querySelector('.tab-bar').innerText`))).match(/\b(community2?|auth|tab)\.[a-zA-Z_]+/g);
        if (m) raw.push(v + ':' + m.join(','));
      }
      await click(pA, '[data-community-action="go-friends"]').catch(() => {});
      check('no untranslated keys (' + lang + ')', raw.length === 0, J(raw));
    }
    check('Arabic switches the page to right-to-left', await pA.eval(`document.documentElement.dir === 'rtl'`));
    await pA.eval(`(setLang('en'), true)`);

    section('fallback when 0008 is rolled back (0005 Community), friends-only stays hidden');
    L.sqlFile(path.join(REPO, 'supabase', 'rollback', '0008_down.sql'));
    sql("notify pgrst, 'reload schema';"); await wait(2000);
    const pR = await device('rolled-back');
    await signIn2(pR, C);
    check('the app falls back to the 0005 Community (no Search/Messages)', await pR.eval(`communityVersion === 1 && !document.querySelector('.cnav') && !!document.querySelector('#community-tabs')`));
    check('the friends-only post stays hidden from non-friends', (await C.c.from('posts').select('id').eq('id', fo)).data.length === 0);
    L.sqlFile(path.join(REPO, 'supabase', 'migrations', '0008_social_phase2.sql'));
    sql("notify pgrst, 'reload schema';"); await wait(2000);
    check('0008 re-applied: friendship and chat are back', sqlVal(`select count(*) from public.friendships where ${lit(A.id)} in (user_a, user_b)`) === '1'
      && sqlVal(`select count(*) from public.messages m join public.conversations c on c.id = m.conversation_id where ${lit(A.id)} in (c.user_a, c.user_b)`) === '2');

    for (const [n, p] of pages) {
      check('no page exceptions (' + n + ')', p.errors.length === 0, J(p.errors));
      const other = p.logs.filter((l) => !/favicon\.ico/.test(l));
      check('no console errors (' + n + ')', other.length === 0, J(other));
    }
  } finally {
    for (const b of browsers) b.killHard(true);
    await server.close();
  }
  console.log('\n==== checks: ' + L.results.pass + ' passed, ' + L.results.fail + ' failed ====');
  process.exit(L.results.fail ? 1 : 0);
})().catch((e) => { console.error(e); for (const b of browsers) b.killHard(true); process.exit(2); });

/* Sign-in for the rolled-back server (version 1: no community_join, classic tabs). */
async function signIn2(p, u) {
  await p.eval('window.__gq.signIn(' + J(u.email) + ',' + J(u.password) + ')');
  await p.ready();
  await p.eval(HELPERS);
  await p.eval(`(state.settings.communityOptIn = true, persistState(), true)`);
  await tab(p, 'komunita');
  await waitFor(() => p.eval(`!!communityProfile && communityVersion === 1`), 30000, 'profile v1');
  await rendered(p);
}
