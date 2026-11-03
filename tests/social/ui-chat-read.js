'use strict';
/* GymQuest — chat "seen" only when the chat is really visible, Back from a profile keeps the place,
   the header avatar opens the profile, no alert for the chat you are reading (v91), in real headless
   Chrome against the LOCAL test stack (disposable local users only, never production).

     GQ_COMMUNITY_CONFIG=<local config js> node tests/social/ui-chat-read.js

   Checks: (a) hidden page = no chat_reads update, becomes read within 3 s once visible, the missed
   message appears; the URL carries #chat=<id> while the chat is visible and loses it when leaving;
   (b) scrolled-up chat -> header name -> profile -> Back = same place (±40 px); (c) a real tap on
   the header avatar opens the profile; (d) sw.js shouldShowPush(): same chat open and focused =
   no notification, other chat = shown, iOS / iPadOS-desktop UA = always shown, and the push handler
   really calls it. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const L = require('./lib');
const { startServer, Browser, waitFor } = require('../sync/lib');
const HELPERS = require('../sync/helpers');
const { check, section, sql, sqlVal, lit, errText } = L;

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-social-chatread');
const PROFILES = path.join(WORK, 'profiles');
let nextPort = 9970;
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
async function chatShown(p) {
  await waitFor(() => p.eval(`(() => { const box = document.getElementById('community-chat-msgs'); return communityView === 'chat' && communityChatMeta !== null && !!box && box.querySelectorAll('.cmsg').length === communityChatMsgs.length && !!(box.querySelector('.cmsg') || box.querySelector('.empty-state')); })()`), 30000, 'chat shown');
  await wait(600);
}
async function click(p, selector) {
  await waitFor(() => p.eval(`(() => { const el = document.querySelector(${J(selector)}); if (!el || el.disabled) return false; el.click(); return true; })()`), 15000, 'element ' + selector);
  await wait(500);
}
/* skutočné ťuknutie do stredu prvku (nie el.click()) */
async function tap(p, selector) {
  const r = await waitFor(() => p.eval(`(() => { const el = document.querySelector(${J(selector)}); if (!el) return null; const b = el.getBoundingClientRect(); return b.width && b.height ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null; })()`), 15000, 'element ' + selector);
  for (const type of ['mousePressed', 'mouseReleased']) await p.c.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
  await wait(500);
}
/* skrytá stránka: prepíše visibilityState/hidden a pošle visibilitychange (ako pri prepnutí karty) */
const setVisible = (p, vis) => p.eval(`(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => ${J(vis ? 'visible' : 'hidden')} });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${J(!vis)} });
  document.dispatchEvent(new Event('visibilitychange'));
  return true;
})()`);
const SCROLLER = `(communitySheetScroller() || document.scrollingElement)`;
const lastRead = (cid, uid) => Number(sqlVal(`select coalesce((select last_read_id from public.chat_reads where conversation_id=${lit(cid)} and user_id=${lit(uid)}), 0)`));
async function member(tag, name) {
  const u = await L.newUser('uir-' + tag);
  u.name = name + '_' + L.runTag.slice(-5);
  const r = await u.c.from('profiles').update({ username: u.name }).eq('id', u.id).select('id');
  if (r.error) throw new Error('rename ' + errText(r));
  await u.c.rpc('community_join');
  return u;
}

(async () => {
  if (Number(sqlVal('select public.community_social_version()')) < 8) throw new Error('0015 (chat Seen) must be applied');
  if (!process.env.GQ_COMMUNITY_CONFIG) throw new Error('GQ_COMMUNITY_CONFIG required');
  fs.mkdirSync(PROFILES, { recursive: true });
  const server = await startServer(PORT, { new: REPO });
  const A = await member('a', 'ada'), B = await member('b', 'ben');
  const req = await A.c.from('friend_requests').insert({ from_id: A.id, to_id: B.id }).select('id').single();
  await B.c.rpc('accept_friend_request', { p_request: req.data.id });
  const conv = (await A.c.rpc('open_chat', { p_friend: B.id })).data;
  for (let i = 1; i <= 36; i++) {
    const u = i % 2 ? A : B;
    const r = await u.c.from('messages').insert({ conversation_id: conv, sender_id: u.id, body: 'Message number ' + i + (i % 5 ? '' : ' — a slightly longer one so the bubbles have different heights.') });
    if (r.error) throw new Error('seed message ' + i + ': ' + errText(r));
  }
  const phone = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
  try {
    const pB = await device('B');
    await signIn(pB, B);
    await pB.c.send('Emulation.setDeviceMetricsOverride', phone);
    await view(pB, 'chats');
    await click(pB, `[data-community-action="open-chat"][data-chat="${conv}"]`);
    await chatShown(pB);

    section('(a) seen only when visible');
    await waitFor(() => Promise.resolve(lastRead(conv, B.id) > 0), 10000, 'initial read');
    const base = lastRead(conv, B.id);
    check('visible chat is marked read on open', base > 0, String(base));
    check('URL carries #chat=<id> while the chat is visible', (await pB.eval('location.hash')) === '#chat=' + conv, await pB.eval('location.hash'));
    check('communityChatVisible() is true', await pB.eval('communityChatVisible()') === true);
    await setVisible(pB, false);
    check('communityChatVisible() is false when the page is hidden', await pB.eval('communityChatVisible()') === false);
    let r = await A.c.from('messages').insert({ conversation_id: conv, sender_id: A.id, body: 'While you were away' });
    if (r.error) throw new Error(errText(r));
    await wait(4000);
    check('hidden page: no chat_reads update', lastRead(conv, B.id) === base, lastRead(conv, B.id) + ' vs ' + base);
    await setVisible(pB, true);
    await waitFor(() => Promise.resolve(lastRead(conv, B.id) > base), 3000, 'read after visible').catch(() => {});
    check('after becoming visible it is marked read within 3 s', lastRead(conv, B.id) > base, lastRead(conv, B.id) + ' vs ' + base);
    check('the missed message appears in the open chat', await pB.eval(`communityChatMsgs.some((m) => m.body === 'While you were away')`));

    section('(b) Back from the friend\'s profile keeps the place');
    await pB.eval(`(${SCROLLER}.scrollTop = Math.max(0, ${SCROLLER}.scrollTop - 600), true)`);
    await wait(400);
    const before = await pB.eval(`Math.round(${SCROLLER}.scrollTop)`);
    check('precondition: scrolled up from the end', !(await pB.eval('communityChatAtEnd()')) && before > 0, String(before));
    await click(pB, '.cchat-who');
    await waitFor(() => pB.eval(`communityView === 'user'`), 15000, 'profile view');
    await wait(800);
    check('the #chat= hash is removed when leaving the chat', !/^#chat=/.test(await pB.eval('location.hash')), await pB.eval('location.hash'));
    await click(pB, '[data-community-action="back"]');
    await chatShown(pB);
    await wait(800);
    const after = await pB.eval(`Math.round(${SCROLLER}.scrollTop)`);
    check('same chat and same scroll offset (±40 px)', await pB.eval(`communityView === 'chat' && communityChatId === ${J(conv)}`) && Math.abs(after - before) <= 40, before + ' -> ' + after);
    check('the hash is back after returning', (await pB.eval('location.hash')) === '#chat=' + conv);
    await view(pB, 'chats');
    check('the hash is removed when the chat closes', !/^#chat=/.test(await pB.eval('location.hash')));
    check('history was not polluted (length unchanged by hash)', await pB.eval('history.length') < 10);
    await click(pB, `[data-community-action="open-chat"][data-chat="${conv}"]`);
    await chatShown(pB);
    check('re-opening from the list lands at the end (no stale restore)', await pB.eval('communityChatAtEnd()'));

    section('(c) header avatar opens the profile');
    await tap(pB, '.cchat-who .community-avatar');
    await waitFor(() => pB.eval(`communityView === 'user' && communityViewUser === ${J(A.id)}`), 10000, 'profile via avatar').catch(() => {});
    check('tapping the avatar opens the friend\'s profile', await pB.eval(`communityView === 'user' && communityViewUser === ${J(A.id)}`));

    section('(d) service worker: no alert for the chat you are reading');
    const swSrc = fs.readFileSync(path.join(REPO, 'sw.js'), 'utf8');
    const m = swSrc.match(/function shouldShowPush[\s\S]*?\n}\n/);
    check('sw.js defines shouldShowPush', !!m);
    const shouldShowPush = vm.runInNewContext('(' + m[0].replace(/^function shouldShowPush/, 'function') + ')', { URL });
    const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
    const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    const IPADOS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
    const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    const X = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', Y = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const open = (id, over) => Object.assign({ url: BASE + '#chat=' + id, focused: true, visibilityState: 'visible' }, over || {});
    check('same chat open, focused, visible, non-iOS: not shown', shouldShowPush([open(X)], { conv: X }, ANDROID) === false);
    check('desktop Chrome: not shown', shouldShowPush([open(X)], { conv: X }, CHROME) === false);
    check('other conversation: shown', shouldShowPush([open(X)], { conv: Y }, ANDROID) === true);
    check('no client: shown', shouldShowPush([], { conv: X }, ANDROID) === true);
    check('client not focused: shown', shouldShowPush([open(X, { focused: false })], { conv: X }, ANDROID) === true);
    check('client hidden: shown', shouldShowPush([open(X, { visibilityState: 'hidden' })], { conv: X }, ANDROID) === true);
    check('no #chat hash: shown', shouldShowPush([open(X, { url: BASE })], { conv: X }, ANDROID) === true);
    check('iPhone UA: always shown', shouldShowPush([open(X)], { conv: X }, IPHONE) === true);
    check('iPadOS desktop UA (Macintosh + Safari): always shown', shouldShowPush([open(X)], { conv: X }, IPADOS) === true);
    check('push without conv: shown', shouldShowPush([open(X)], {}, ANDROID) === true);
    check('the push handler calls shouldShowPush before showNotification',
      /addEventListener\('push'[\s\S]*?shouldShowPush\([\s\S]*?showNotification/.test(swSrc));

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
