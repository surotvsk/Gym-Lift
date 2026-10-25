'use strict';
/* GymQuest v80 — "Seen" in chats (migration 0015), instant Messages list, and the You tab with your own
   posts and pics. Real headless Chrome against the LOCAL test stack (disposable local users only).

     GQ_COMMUNITY_CONFIG=<local config js> node tests/social/ui-v80.js

   Checks: under my last message "Sent" turns into "Seen" live when the friend reads it; no label when the
   last message is the friend's; read positions are visible only to the two participants (RLS); on an older
   server (0015 rolled back) no label and no errors, chats still work; the Messages list opens instantly
   from memory the second time; the You tab lists my posts (pending marked), shows the pics grid, counts,
   opens My posts and returns to You, enlarges a pic, and shows a Join tile without Community; 390 px;
   no console errors. */
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
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-social-v80');
const PROFILES = path.join(WORK, 'profiles');
const SHOTS = path.join(WORK, 'shots');
let nextPort = 9980;
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
  await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  pages.push([name, p]);
  return p;
}
async function signIn(p, u) {
  await p.eval('window.__gq.signIn(' + J(u.email) + ',' + J(u.password) + ')');
  await p.ready();
  await p.eval(HELPERS);
  await p.eval(`(state.settings.communityOptIn = true, persistState(), setLang('en'), true)`);
  await p.eval(`(switchTab('komunita'), true)`);
  await waitFor(() => p.eval(`!!communityProfile && communityVersion >= 4`), 30000, 'profile');
}
async function shot(p, name) {
  const r = await p.c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
}
async function member(tag, name) {
  const u = await L.newUser('v80-' + tag);
  u.name = name + '_' + L.runTag.slice(-5);
  const r = await u.c.from('profiles').update({ username: u.name }).eq('id', u.id).select('id');
  if (r.error) throw new Error('rename ' + errText(r));
  await u.c.rpc('community_join');
  return u;
}
async function openChat(p, conv) {
  await p.eval(`(openMessagesTab(), true)`);
  await waitFor(() => p.eval(`!!document.querySelector('[data-community-action="open-chat"][data-chat="${conv}"]')`), 30000, 'chat row');
  await p.eval(`(document.querySelector('[data-community-action="open-chat"][data-chat="${conv}"]').click(), true)`);
  await waitFor(() => p.eval(`communityView === 'chat' && !!document.getElementById('community-chat-text') && communityChatMeta && communityChatMeta.conversation_id === ${J(conv)}`), 30000, 'chat open');
  await wait(400);
}
const seenLabel = (p) => p.eval(`(() => { const el = document.getElementById('community-chat-seen'); return el ? el.textContent : null; })()`);
async function send(p, text) {
  await p.eval(`(() => { const el = document.getElementById('community-chat-text'); el.value = ${J(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await p.eval(`(document.querySelector('[data-community-action="chat-send"]').click(), true)`);
  await waitFor(() => p.eval(`communityChatMsgs.some((m) => m.body === ${J(text)})`), 15000, 'sent');
  await wait(300);
}

(async () => {
  if (!process.env.GQ_COMMUNITY_CONFIG) throw new Error('GQ_COMMUNITY_CONFIG required');
  if (Number(sqlVal('select public.community_social_version()')) < 8) throw new Error('0015 must be applied');
  fs.mkdirSync(PROFILES, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await startServer(PORT, { new: REPO });
  const A = await member('a', 'ada'), B = await member('b', 'ben'), C = await member('c', 'cyd');
  const req = await A.c.from('friend_requests').insert({ from_id: A.id, to_id: B.id }).select('id').single();
  await B.c.rpc('accept_friend_request', { p_request: req.data.id });
  const conv = (await A.c.rpc('open_chat', { p_friend: B.id })).data;
  await B.c.from('messages').insert({ conversation_id: conv, sender_id: B.id, body: 'Hi Ada' });
  try {
    const pA = await device('A');
    await signIn(pA, A);

    section('Seen (version 8)');
    await openChat(pA, conv);
    check('the friend wrote last: no Seen/Sent label', (await seenLabel(pA)) === null);
    await send(pA, 'Hello Ben');
    check('my new message shows "Sent"', (await seenLabel(pA)) === 'Sent', await seenLabel(pA));
    const r1 = await B.c.rpc('mark_read', { p_conversation: conv, p_last_id: null });
    check('friend reads it (mark_read)', !r1.error, errText(r1));
    let live = true;
    try { await waitFor(async () => (await seenLabel(pA)) === 'Seen', 15000, 'seen live'); } catch (e) { live = false; }
    check('"Seen" appears live, without reopening the chat', live, await seenLabel(pA));
    await shot(pA, 'seen');
    await send(pA, 'Second one');
    check('a newer message is "Sent" again until it is read', (await seenLabel(pA)) === 'Sent');
    check('only my last message carries a label', await pA.eval(`document.querySelectorAll('.cmsg-seen').length === 1`));
    await pA.eval(`(switchTab('dnes'), true)`);
    await B.c.rpc('mark_read', { p_conversation: conv, p_last_id: null });
    await openChat(pA, conv);
    check('reopening the chat shows "Seen"', (await seenLabel(pA)) === 'Seen');

    section('read positions are private to the two participants (RLS)');
    const rows = await A.c.from('chat_reads').select('user_id,last_read_id').eq('conversation_id', conv);
    check('a participant sees both read positions', !rows.error && rows.data.length === 2 && rows.data.some((x) => x.user_id === B.id), J(rows.data || errText(rows)));
    const other = await C.c.from('chat_reads').select('user_id').eq('conversation_id', conv);
    check('someone outside the chat sees nothing', !other.error && other.data.length === 0, J(other.data || errText(other)));
    const forge = await C.c.from('chat_reads').insert({ conversation_id: conv, user_id: C.id, last_read_id: 999 });
    check('nobody can write read positions directly', !!forge.error);
    const forgeUpd = await A.c.from('chat_reads').update({ last_read_id: 0 }).eq('conversation_id', conv).eq('user_id', B.id).select('user_id');
    check('a participant cannot change the friend\'s read position', !!forgeUpd.error || (forgeUpd.data || []).length === 0);

    section('Messages list opens instantly the second time');
    await pA.eval(`(switchTab('dnes'), true)`);
    const instant = await pA.eval(`(() => { openMessagesTab(); return !!document.querySelector('#community-body [data-community-action="open-chat"][data-chat="${conv}"]'); })()`);
    check('the chat list is on screen synchronously (from memory), then refreshed', instant);
    await waitFor(() => pA.eval(`!document.querySelector('#community-body').innerText.includes(t('community.loading'))`), 15000, 'refreshed');
    check('cache belongs to this account only', await pA.eval(`communityChatsCache.uid === communityProfile.id`));

    section('You tab: my posts and pics');
    const img = fs.readFileSync(path.join(REPO, 'media', 'bench-press-poster.jpg'));
    const folder = A.id + '/v80-' + Date.now().toString(36);
    for (const f of ['0.jpg', '0_thumb.jpg', '1.jpg', '1_thumb.jpg']) {
      const up = await A.c.storage.from('community').upload(folder + '/' + f, img, { contentType: 'image/jpeg' });
      if (up.error) throw new Error('upload ' + f + ': ' + up.error.message);
    }
    let r = await A.c.rpc('create_post', { p_text: 'Bench day', p_photos: [{ image: folder + '/0.jpg', thumb: folder + '/0_thumb.jpg' }, { image: folder + '/1.jpg', thumb: folder + '/1_thumb.jpg' }] });
    if (r.error) throw new Error('post: ' + errText(r));
    sql("begin; set local session_replication_role = replica; update public.posts set status = 'approved', published_at = now() where user_id = " + lit(A.id) + "; commit;");
    r = await A.c.rpc('create_post', { p_text: 'Waiting for review', p_photos: [] });
    if (r.error) throw new Error('post 2: ' + errText(r));
    /* v80 (neskôr): Ty = môj profil – podrobne v tests/social/ui-you.js; tu tie isté základné kontroly */
    await pA.eval(`(document.querySelector('.tab[data-tab="ty"]').click(), true)`);
    await waitFor(() => pA.eval(`!!tyFeed && tyFeed.items.length === 1 && tyFeed.extra.length === 1`), 30000, 'ty posts');
    await wait(300);
    check('You lists my pending post (marked) first, then my photo post', await pA.eval(`(() => { const t = document.getElementById('ty-posts').innerText; return t.indexOf('Waiting for review') >= 0 && !!document.querySelector('#ty-posts .ty-pending') && !!document.querySelector('#ty-posts .ty-photo img'); })()`));
    check('the pending post is marked', await pA.eval(`!!document.querySelector('#ty-posts .ty-pending .ty-status')`));
    check('the photo post shows its photo count', await pA.eval(`(document.querySelector('#ty-posts .ty-photo .pf-count') || {}).textContent === '2'`));
    check('the profile header shows posts / followers / following / friends', await pA.eval(`document.querySelectorAll('#ty-stats .cstat').length === 4 && document.querySelector('#ty-stats .cstat-n').textContent === '1'`));
    check('Progress photos and New post are there', await pA.eval(`!document.getElementById('ty-photos').hidden && !document.getElementById('ty-compose').hidden`));
    await shot(pA, 'ty-posts');
    await pA.eval(`(tySetFilter('photos'), true)`); await wait(300);
    check('Pics shows my photo post', await pA.eval(`document.querySelectorAll('#ty-posts .ty-photo img').length === 1`));
    check('the filter reports its state', await pA.eval(`document.querySelector('#ty-seg [data-ty-filter="photos"]').getAttribute('aria-selected') === 'true'`));
    await shot(pA, 'ty-pics');
    await pA.eval(`(tySetFilter('all'), true)`); await wait(200);
    await pA.eval(`(document.querySelector('#ty-posts .ty-pending').click(), true)`);
    await waitFor(() => pA.eval(`activeTab === 'komunita' && communityView === 'myposts' && !!document.querySelector('#community-body [data-community-action="delete-post"]')`), 30000, 'my posts');
    check('tapping the pending post opens My posts (edit / delete there)', true);
    await pA.eval(`(communityGoBack(), true)`); await wait(300);
    check('Back returns to You', await pA.eval(`activeTab === 'ty'`));
    await pA.eval(`(document.getElementById('ty-photos').click(), true)`); await wait(300);
    check('Progress photos opens the photos screen', await pA.eval(`activeTab === 'pokrok' && pokrokView === 'photos'`));
    await pA.eval(`(document.getElementById('back-photos').click(), true)`); await wait(300);
    check('… and Back returns to You', await pA.eval(`activeTab === 'ty'`));
    await pA.eval(`(state.settings.communityOptIn = false, renderTy(), true)`);
    check('without Community: a short note with a Community button, only History, no New post', await pA.eval(`!!document.querySelector('#ty-posts .ty-note [data-ty-action="community"]') && document.querySelectorAll('#ty-seg [data-ty-filter]').length === 1 && document.getElementById('ty-compose').hidden`));
    await pA.eval(`(state.settings.communityOptIn = true, tyFilter = 'all', renderTy(), true)`);

    section('older server (0015 rolled back)');
    const done = L.rollbackFrom(15);
    try {
      check('server is back at version 7', Number(sqlVal('select public.community_social_version()')) === 7);
      const pOld = await device('A-old');
      await signIn(pOld, A);
      await openChat(pOld, conv);
      await send(pOld, 'On the old server');
      check('no Seen/Sent label on an older server', (await seenLabel(pOld)) === null);
      check('chatting still works', await pOld.eval(`communityChatMsgs.some((m) => m.body === 'On the old server')`));
    } finally {
      L.reapply(done);
    }
    check('0015 re-applied (version 8)', Number(sqlVal('select public.community_social_version()')) === 8);

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
