'use strict';
/* GymQuest — opening a chat shows the newest messages (v70), in real headless Chrome against the
   LOCAL test stack (disposable local users only, never production).

     GQ_COMMUNITY_CONFIG=<local config js> node tests/social/ui-chat-scroll.js

   Checks (phone 390 × 844, and desktop): opening a long chat from the Messages list lands at the
   end — the newest message and the input are visible above the tab bar, the first message is not;
   loading reactions keeps it there; a friend's new message keeps you at the end when you were at
   the end, but does not pull you down while you read older messages; your own message always
   scrolls to the end; a short chat still shows its header; no console errors. */
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
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-social-chatscroll');
const PROFILES = path.join(WORK, 'profiles');
const SHOTS = path.join(WORK, 'shots');
let nextPort = 9960;
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
  await p.eval(`(state.settings.communityOptIn = true, persistState(), setLang('en'), true)`);
  await p.eval(`(switchTab('komunita'), true)`);
  await waitFor(() => p.eval(`!!communityProfile && communityVersion >= 4`), 30000, 'profile');
}
async function rendered(p) {
  await waitFor(() => p.eval(`(() => { const b = document.getElementById('community-body'); return !!b && b.innerText.indexOf(t('community.loading')) < 0 && b.innerText.length > 0; })()`), 30000, 'render');
  await wait(500);
}
async function view(p, v) { await p.eval(`(switchTab('komunita'), communitySetView(${J(v)}), true)`); await rendered(p); }
/* Po otvorení chatu sa čaká na skutočne vykreslený chat (správy), nie na obsah predchádzajúcej obrazovky. */
async function chatShown(p) {
  await waitFor(() => p.eval(`(() => { const box = document.getElementById('community-chat-msgs'); return communityView === 'chat' && communityChatMeta !== null && !!box && box.querySelectorAll('.cmsg').length === communityChatMsgs.length && !!(box.querySelector('.cmsg') || box.querySelector('.empty-state')); })()`), 30000, 'chat shown');
  await wait(300);
}
async function click(p, selector) {
  await waitFor(() => p.eval(`(() => { const el = document.querySelector(${J(selector)}); if (!el || el.disabled) return false; el.click(); return true; })()`), 15000, 'element ' + selector);
  await wait(500);
}
async function shot(p, name, selector) {
  await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await wait(400);
  if (selector) await p.eval(`(() => { const el = document.querySelector(${J(selector)}); if (el) el.scrollIntoView({ block: 'center' }); return true; })()`);
  await wait(300);
  const r = await p.c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
  await p.c.send('Emulation.clearDeviceMetricsOverride');
}
const bodyText = (p) => p.eval(`document.getElementById('community-body').innerText`);
async function member(tag, name) {
  const u = await L.newUser('uix-' + tag);
  u.name = name + '_' + L.runTag.slice(-5);
  const r = await u.c.from('profiles').update({ username: u.name }).eq('id', u.id).select('id');
  if (r.error) throw new Error('rename ' + errText(r));
  await u.c.rpc('community_join');
  return u;
}
async function typeMsg(p, text) {
  await p.eval(`(() => { const el = document.getElementById('community-chat-text'); el.value = ${J(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await click(p, '[data-community-action="chat-send"]');
}

(async () => {
  if (Number(sqlVal('select public.community_social_version()')) < 2) throw new Error('0008 must be applied');
  if (!process.env.GQ_COMMUNITY_CONFIG) throw new Error('GQ_COMMUNITY_CONFIG required');
  fs.mkdirSync(PROFILES, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await startServer(PORT, { new: REPO });
  const A = await member('a', 'ada'), B = await member('b', 'ben'), C = await member('c', 'cyd');
  for (const [x, y] of [[A, B], [C, B]]) {
    const req = await x.c.from('friend_requests').insert({ from_id: x.id, to_id: y.id }).select('id').single();
    await y.c.rpc('accept_friend_request', { p_request: req.data.id });
  }
  const conv = (await A.c.rpc('open_chat', { p_friend: B.id })).data;
  const convShort = (await C.c.rpc('open_chat', { p_friend: B.id })).data;
  /* dlhý chat: 36 správ striedavo (limit servera je 20 správ za minútu na osobu) */
  for (let i = 1; i <= 36; i++) {
    const u = i % 2 ? A : B;
    const r = await u.c.from('messages').insert({ conversation_id: conv, sender_id: u.id, body: 'Message number ' + i + (i % 5 ? '' : ' — a slightly longer one so the bubbles have different heights.') });
    if (r.error) throw new Error('seed message ' + i + ': ' + errText(r));
  }
  await C.c.from('messages').insert({ conversation_id: convShort, sender_id: C.id, body: 'Hi!' });
  const phone = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
  /* poloha správy voči viditeľnej ploche (nad spodnou lištou) */
  const pos = (p, needle) => p.eval(`(() => {
    const m = Array.from(document.querySelectorAll('#community-chat-msgs .cmsg')).find((x) => x.querySelector('.cmsg-body') && x.querySelector('.cmsg-body').textContent === ${J(needle)});
    if (!m) return null;
    /* viditeľné = nad prilepeným poľom na písanie a nad spodnou lištou */
    const r = m.getBoundingClientRect(), bar = document.querySelector('.tab-bar').getBoundingClientRect();
    const comp = document.querySelector('#community-body .ccomposer');
    const limit = Math.min(bar.top, comp ? comp.getBoundingClientRect().top : bar.top);
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), limit: Math.round(limit), visible: r.top >= 0 && r.bottom <= limit + 1, scrollY: Math.round(scrollY) };
  })()`);
  const composerVisible = (p) => p.eval(`(() => { const r = document.querySelector('#community-body .ccomposer').getBoundingClientRect(), bar = document.querySelector('.tab-bar').getBoundingClientRect(); return r.top >= 0 && r.bottom <= bar.top; })()`);
  try {
    const pB = await device('B');
    await signIn(pB, B);
    await pB.c.send('Emulation.setDeviceMetricsOverride', phone);

    section('opening a long chat from the Messages list (phone)');
    await view(pB, 'chats');
    await click(pB, `[data-community-action="open-chat"][data-chat="${conv}"]`);
    await chatShown(pB);
    await wait(600);
    const last = await pos(pB, 'Message number 36'), first = await pos(pB, 'Message number 1');
    check('the newest message is visible right away (above the input and the tab bar)', last && last.visible, J(last));
    check('the input box is visible', await composerVisible(pB));
    check('the first message is not on screen (the page is at the end, not the start)', first && !first.visible && first.top < 0, J(first));
    await shot(pB, 'chat-open-end', null);
    await pB.c.send('Emulation.setDeviceMetricsOverride', phone);
    await wait(16000);   // reakcie sa obnovujú každých 15 s (prekreslenie správ)
    check('after the reactions refresh it is still at the end', (await pos(pB, 'Message number 36')).visible);

    section('new messages');
    const pA = A;
    let r = await pA.c.from('messages').insert({ conversation_id: conv, sender_id: A.id, body: 'Live one' });
    if (r.error) throw new Error(errText(r));
    await waitFor(() => pos(pB, 'Live one').then((x) => !!x), 15000, 'live message');
    await wait(300);
    check('at the end: a friend\'s new message stays in view', (await pos(pB, 'Live one')).visible, J(await pos(pB, 'Live one')));
    await pB.eval(`(window.scrollTo(0, 0), true)`);
    await wait(300);
    const yTop = await pB.eval('Math.round(scrollY)');
    r = await pA.c.from('messages').insert({ conversation_id: conv, sender_id: A.id, body: 'Live two' });
    if (r.error) throw new Error(errText(r));
    await waitFor(() => pos(pB, 'Live two').then((x) => !!x), 15000, 'live message 2');
    await wait(300);
    check('reading older messages: a new message does not pull you down', (await pB.eval('Math.round(scrollY)')) === yTop && !(await pos(pB, 'Live two')).visible, { yTop, now: await pB.eval('Math.round(scrollY)') });
    await pB.eval(`(() => { const el = document.getElementById('community-chat-text'); el.value = 'My answer'; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await click(pB, '[data-community-action="chat-send"]');
    await waitFor(() => pos(pB, 'My answer').then((x) => !!x), 15000, 'own message');
    await wait(300);
    check('sending your own message scrolls to the end', (await pos(pB, 'My answer')).visible && await composerVisible(pB), J(await pos(pB, 'My answer')));

    section('re-opening and a short chat');
    await view(pB, 'chats');
    await pB.eval(`(window.scrollTo(0, 0), true)`);
    await click(pB, `[data-community-action="open-chat"][data-chat="${conv}"]`);
    await chatShown(pB);
    await wait(500);
    check('re-opening the chat lands at the end again', (await pos(pB, 'My answer')).visible);
    await view(pB, 'chats');
    await click(pB, `[data-community-action="open-chat"][data-chat="${convShort}"]`);
    await chatShown(pB);
    await wait(500);
    check('a short chat shows its message, the header and the input', (await pos(pB, 'Hi!')).visible && await composerVisible(pB)
      && await pB.eval(`(() => { const h = document.querySelector('#community-body .cchat-head, #community-body [data-community-action="back"]'); return !h || h.getBoundingClientRect().top >= 0; })()`));

    section('desktop width');
    await pB.c.send('Emulation.clearDeviceMetricsOverride');
    await pB.c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await view(pB, 'chats');
    await click(pB, `[data-community-action="open-chat"][data-chat="${conv}"]`);
    await chatShown(pB);
    await wait(500);
    check('desktop: the newest message and the input are visible', (await pos(pB, 'My answer')).visible && await composerVisible(pB));

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
