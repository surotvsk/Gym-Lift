'use strict';
/* GymQuest message notifications (0010 + `push` function) — UI test in real headless Chrome
   against the LOCAL test stack (disposable local users; lib.js refuses anything else).

     GQ_COMMUNITY_CONFIG=<local config with vapidPublicKey> node tests/social/ui-push.js

   Needs 0010 applied and the functions served locally (see README). Headless Chrome cannot
   subscribe to a real push service, so each browser gets a stand-in PushSubscription that points
   at the mock push service (push-mock.js); everything else is the real app, the real service
   worker and the real local server. Checks: turning notifications on/off from Chats and Profile,
   the language follows the app, a sent message reaches the friend (decrypted: name only), the
   service worker shows the notification, tapping it opens the chat (message and ?chat= start),
   sign-out unregisters, blocked/unsupported/iPhone-without-Home-Screen notes, 6 languages, and
   the app falls back cleanly when 0010 is rolled back. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./lib');
const { startServer, Browser, waitFor } = require('../sync/lib');
const HELPERS = require('../sync/helpers');
const { startMock, device: pushDevice, decrypt, received } = require('./push-mock');
const { check, section, sql, sqlVal, lit, errText } = L;

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const ORIGIN = 'http://localhost:' + PORT;
const BASE = ORIGIN + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-social-push');
const PROFILES = path.join(WORK, 'profiles');
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
let nextPort = 9940;
let reapplyLater = null;   // migrácie vrátené rollbackom – obnovia sa vždy, aj po chybe
const browsers = [];
const pages = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;

/* Stand-in PushManager: a subscription for `dev` (or no Push API at all with mode 'none'). */
function fakePush(dev, mode) {
  if (mode === 'none') return `(() => { try { delete window.PushManager; } catch (e) {} })();`;
  return `(() => {
    if (!window.PushManager) return;
    window.__pushLog = [];
    const make = (key) => ({ endpoint: ${J(dev.endpoint)}, options: { applicationServerKey: key || null },
      toJSON() { return { endpoint: this.endpoint, keys: { p256dh: ${J(dev.p256dh)}, auth: ${J(dev.auth)} } }; },
      async unsubscribe() { try { localStorage.removeItem('__fakepush'); } catch (e) {} window.__pushLog.push('unsubscribe'); return true; } });
    PushManager.prototype.subscribe = async function (o) {
      window.__pushLog.push('subscribe');
      try { localStorage.setItem('__fakepush', '1'); } catch (e) {}
      return make(o && o.applicationServerKey);
    };
    PushManager.prototype.getSubscription = async function () {
      let on = false; try { on = localStorage.getItem('__fakepush') === '1'; } catch (e) {}
      return on ? make(null) : null;
    };
  })();`;
}
async function browser(name, opts) {
  const b = new Browser(name + '-' + Date.now().toString(36), nextPort++, PROFILES);
  browsers.push(b);
  const p = await b.launch();
  p.logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error') p.logs.push(e.entry.text + ' ' + (e.entry.url || '')); });
  if (opts.ua) await p.c.send('Emulation.setUserAgentOverride', { userAgent: opts.ua, platform: 'iPhone' });
  await p.c.send('Page.addScriptToEvaluateOnNewDocument', { source: fakePush(opts.dev, opts.mode) });
  if (opts.permission === 'granted') await p.c.send('Browser.grantPermissions', { origin: ORIGIN, permissions: ['notifications'] });
  if (opts.permission === 'denied') await p.c.send('Browser.setPermission', { origin: ORIGIN, permission: { name: 'notifications' }, setting: 'denied' });
  p.regs = [];
  p.c.on('ServiceWorker.workerRegistrationUpdated', (e) => { (e.registrations || []).forEach((r) => p.regs.push(r)); });
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
  await p.eval(`(switchTab('komunita'), true)`);
  await waitFor(() => p.eval(`!!communityProfile && communityVersion >= 3`), 30000, 'profile');
}
async function rendered(p) {
  await waitFor(() => p.eval(`(() => { const b = document.getElementById('community-body'); return !!b && b.innerText.indexOf(t('community.loading')) < 0 && b.innerText.length > 0; })()`), 30000, 'render');
  await wait(500);
}
async function view(p, v) { await p.eval(`(switchTab('komunita'), communitySetView(${J(v)}), true)`); await rendered(p); }
async function click(p, selector) {
  await waitFor(() => p.eval(`(() => { const el = document.querySelector(${J(selector)}); if (!el || el.disabled) return false; el.click(); return true; })()`), 15000, 'element ' + selector);
  await wait(400);
}
const SHOTS = path.join(WORK, 'shots');
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
const subsFor = (u, dev) => Number(sqlVal(`select count(*) from public.push_subscriptions where user_id = ${lit(u.id)}` + (dev ? ` and endpoint = ${lit(dev.endpoint)}` : '')));
const forDevice = (d) => received.filter((x) => x.id === d.id);
async function member(tag, name) {
  const u = await L.newUser('uipush-' + tag);
  u.name = name + '_' + L.runTag.slice(-5);
  const r = await u.c.from('profiles').update({ username: u.name }).eq('id', u.id).select('id');
  if (r.error) throw new Error('rename ' + errText(r));
  const j = await u.c.rpc('community_join');
  if (j.error) throw new Error('join ' + errText(j));
  return u;
}

(async () => {
  if (Number(sqlVal('select public.community_social_version()')) < 4) throw new Error('0010 must be applied');
  if (!process.env.GQ_COMMUNITY_CONFIG) throw new Error('GQ_COMMUNITY_CONFIG required');
  if (!/vapidPublicKey/.test(fs.readFileSync(process.env.GQ_COMMUNITY_CONFIG, 'utf8'))) throw new Error('local config needs vapidPublicKey');
  fs.mkdirSync(PROFILES, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await startServer(PORT, { new: REPO });
  const mock = await startMock();
  const M = await L.newUser('uipush-mod'); L.makeModerator(M);
  const A = await member('a', 'ada'), B = await member('b', 'ben'), C = await member('c', 'cid');
  const req = await A.c.from('friend_requests').insert({ from_id: A.id, to_id: B.id }).select('id').single();
  await B.c.rpc('accept_friend_request', { p_request: req.data.id });
  const conv = (await A.c.rpc('open_chat', { p_friend: B.id })).data;
  const devA = pushDevice('uia-' + L.runTag), devB = pushDevice('uib-' + L.runTag), devC = pushDevice('uic-' + L.runTag);
  try {
    section('turn on from the Chats list');
    const pB = await browser('B', { dev: devB, permission: 'granted' });
    await signIn(pB, B);
    check('server supports notifications (version 4+)', (await pB.eval('communityVersion')) >= 4);
    await view(pB, 'chats');
    const offer = await waitFor(() => pB.eval(`!!document.querySelector('[data-community-action="push-on"]')`), 15000, 'turn-on offer').catch(() => false);
    check('Chats shows the "turn on" offer', offer === true);
    await shot(pB, 'chats-offer-en', '.cpush-hint');
    await click(pB, '[data-community-action="push-on"]');
    await waitFor(() => subsFor(B, devB) === 1, 15000, 'subscription row');
    check('this device is registered on the server', subsFor(B, devB) === 1);
    check('app shows notifications as on', (await pB.eval('pushState()')) === 'on');
    check('language stored: en', sqlVal(`select lang from public.push_subscriptions where endpoint = ${lit(devB.endpoint)}`) === 'en');
    await rendered(pB);
    check('the offer disappears once on', await pB.eval(`!document.querySelector('[data-community-action="push-on"]')`));
    await view(pB, 'profile');
    check('Profile: switch is on', await pB.eval(`!!document.getElementById('community-push') && document.getElementById('community-push').checked`));
    await shot(pB, 'profile-on-en', '#community-push-card');

    if ((await pB.eval('communityVersion')) >= 6) {
      section('reminders (0012): water, meals, workout');
      await waitFor(() => pB.eval(`!!document.getElementById('rem-water-on')`), 20000, 'reminders card').catch(() => {});
      check('the reminders card is shown once notifications are on', await pB.eval(`!!document.getElementById('rem-water-on') && !!document.getElementById('rem-workout-time')`));
      check('reminders are ON by default and were saved automatically (phone time zone)',
        sqlVal(`select water_on and meals_on and workout_on and tz = ${lit(await pB.eval('Intl.DateTimeFormat().resolvedOptions().timeZone'))} from public.push_reminders where user_id = ${lit(B.id)}`) === 't'
        && await pB.eval(`document.getElementById('rem-water-on').checked && document.getElementById('rem-meals-on').checked && document.getElementById('rem-workout-on').checked`));
      await pB.eval(`(document.getElementById('rem-meals-on').checked = false, true)`);
      await click(pB, '[data-community-action="rem-save"]');
      await waitFor(() => sqlVal(`select meals_on from public.push_reminders where user_id = ${lit(B.id)}`) === 'f', 10000, 'meals off');
      await pB.reload(); await pB.eval(HELPERS);
      await pB.eval(`(switchTab('komunita'), true)`);
      await waitFor(() => pB.eval(`!!communityProfile`), 30000, 'profile after reload');
      await view(pB, 'profile');
      await waitFor(() => pB.eval(`!!document.getElementById('rem-meals-on')`), 20000, 'reminders after restart');
      check('switching meals off stays off after a restart (defaults never re-applied)', sqlVal(`select meals_on from public.push_reminders where user_id = ${lit(B.id)}`) === 'f'
        && await pB.eval(`!document.getElementById('rem-meals-on').checked`));
      await pB.eval(`(() => {
        document.getElementById('rem-water-on').checked = true;
        document.getElementById('rem-water-every').value = '60';
        document.getElementById('rem-water-from').value = '07:30';
        document.getElementById('rem-water-to').value = '20:00';
        document.getElementById('rem-meals-on').checked = true;
        document.getElementById('rem-meal-0').value = '08:15'; document.getElementById('rem-meal-1').value = '13:00'; document.getElementById('rem-meal-2').value = '';
        document.getElementById('rem-workout-on').checked = true;
        document.getElementById('rem-workout-time').value = '18:30';
        return true; })()`);
      await click(pB, '#community-reminders .crem-day[data-day="1"]');   // Po (bolo zapnuté) → vypnúť
      await click(pB, '#community-reminders .crem-day[data-day="2"]');   // Ut → zapnúť
      await click(pB, '[data-community-action="rem-save"]');
      await waitFor(() => sqlVal(`select water_on from public.push_reminders where user_id = ${lit(B.id)}`) === 't', 15000, 'reminders saved');
      const row = sqlVal(`select tz || '|' || water_every || '|' || to_char(water_from, 'HH24:MI') || '|' || to_char(water_to, 'HH24:MI') || '|' || meals_on || '|' || array_to_string(meal_times, ',') || '|' || workout_on || '|' || array_to_string(array(select x from unnest(workout_days) x order by x), ',') || '|' || to_char(workout_time, 'HH24:MI') from public.push_reminders where user_id = ${lit(B.id)}`);
      check('saved on the server with the phone time zone', row === (await pB.eval('Intl.DateTimeFormat().resolvedOptions().timeZone')) + '|60|07:30|20:00|true|08:15:00,13:00:00|true|2,3,5|18:30', row);
      check('confirmation shown', (await bodyText(pB)).includes(await pB.eval(`t('rem.saved')`)));
      await view(pB, 'feed'); await view(pB, 'profile');
      await waitFor(() => pB.eval(`!!document.getElementById('rem-water-every')`), 20000, 'reminders reopened');
      check('saved values come back after reopening', await pB.eval(`document.getElementById('rem-water-every').value === '60' && document.getElementById('rem-meal-0').value === '08:15'
        && document.getElementById('rem-workout-time').value === '18:30' && document.querySelector('.crem-day[data-day="2"]').classList.contains('active') && !document.querySelector('.crem-day[data-day="1"]').classList.contains('active')`));
      await pB.eval(`(document.getElementById('rem-water-from').value = '22:00', document.getElementById('rem-water-to').value = '06:00', true)`);
      await click(pB, '[data-community-action="rem-save"]');
      check('"from" after "to" is refused with a clear message', (await bodyText(pB)).includes(await pB.eval(`t('rem.errInvalid')`))
        && sqlVal(`select to_char(water_from, 'HH24:MI') from public.push_reminders where user_id = ${lit(B.id)}`) === '07:30');
      await view(pB, 'profile');
      await shot(pB, 'reminders-en', '#community-reminders');
      for (const lang of ['sk', 'es', 'pt-BR', 'fr', 'ar']) {
        await pB.eval(`(setLang(${J(lang)}), renderCommunity(), true)`);
        await rendered(pB);
        const txt = await pB.eval(`document.getElementById('community-reminders').innerText`);
        check(lang + ': reminders card translated', !/rem\./.test(txt) && txt.includes(await pB.eval(`t('rem.save')`)), txt.slice(0, 80));
      }
      await pB.eval(`(setLang('sk'), renderCommunity(), true)`);
      await rendered(pB);
    }
    await pB.eval(`(setLang('sk'), true)`);
    await waitFor(() => sqlVal(`select lang from public.push_subscriptions where endpoint = ${lit(devB.endpoint)}`) === 'sk', 15000, 'lang sk');
    check('changing the app language updates the notification language', true);

    section('a message reaches the friend');
    await pB.eval(`(switchTab('dnes'), true)`);
    const pA = await browser('A', { dev: devA, permission: 'granted' });
    await signIn(pA, A);
    await pA.eval(`(communityOpenChat(${J(conv)}), true)`);
    await rendered(pA);
    const msg = 'see you at the gym ' + L.runTag;
    await waitFor(() => pA.eval(`!!document.getElementById('community-chat-text')`), 30000, 'chat box');
    await pA.eval(`(() => { const el = document.getElementById('community-chat-text'); el.value = ${J(msg)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await click(pA, '[data-community-action="chat-send"]');
    await waitFor(() => forDevice(devB).length >= 1, 20000, 'push to B');
    const got = forDevice(devB);
    check('exactly one push for the friend\'s device', got.length === 1, String(got.length));
    let payload = null;
    try { payload = decrypt(devB, got[0].body); } catch (e) { payload = { error: String(e) }; }
    check('notification text (Slovak, name only)', payload && payload.body === 'Nová správa od ' + A.name, J(payload));
    check('the message text is not in the notification', !J(payload).includes(msg));
    check('the sender gets nothing', forDevice(devA).length === 0);

    section('the service worker shows it; tapping opens the chat');
    await pB.c.send('ServiceWorker.enable');
    await waitFor(() => pB.regs.some((r) => r.scopeURL === BASE && !r.isDeleted), 10000, 'sw registration');
    const regId = pB.regs.filter((r) => r.scopeURL === BASE && !r.isDeleted).pop().registrationId;
    await pB.c.send('ServiceWorker.deliverPushMessage', { origin: ORIGIN, registrationId: regId, data: J(payload) });
    const shown = await waitFor(() => pB.eval(`navigator.serviceWorker.getRegistration().then((r) => r.getNotifications()).then((ns) => ns.length ? ns.map((n) => ({ title: n.title, body: n.body, tag: n.tag, conv: n.data && n.data.conv })) : null)`), 10000, 'notification');
    check('notification shown: GymQuest, name, one per chat (tag)', shown.length === 1 && shown[0].title === 'GymQuest' && shown[0].body === payload.body
      && shown[0].tag === 'gq-chat-' + conv && shown[0].conv === conv, J(shown));
    await pB.eval(`(navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'OPEN_CHAT', conv: ${J(conv)} } })), true)`);
    await waitFor(() => pB.eval(`communityView === 'chat' && !!document.getElementById('community-chat-msgs')`), 30000, 'chat opened');
    await wait(500);
    check('tap: Community opens on that chat', await pB.eval(`activeTab === 'komunita' && communityView === 'chat' && communityChatId === ${J(conv)}`));
    check('the chat shows the message', (await bodyText(pB)).includes(msg));
    await wait(500);
    check('opening the chat clears its notification', (await pB.eval(`navigator.serviceWorker.getRegistration().then((r) => r.getNotifications()).then((ns) => ns.length)`)) === 0);
    await pB.navigate(BASE + '?chat=' + conv);
    await pB.eval(HELPERS);
    await waitFor(() => pB.eval(`communityView === 'chat' && communityChatId === ${J(conv)} && !!document.getElementById('community-chat-msgs')`), 30000, 'chat from url');
    check('start from a notification (?chat=) opens the chat', true);
    check('the address is cleaned', (await pB.eval('location.search')) === '');
    await pB.eval(`(communityGoBack(), true)`);
    await rendered(pB);
    check('Back goes to the chat list', (await pB.eval('communityView')) === 'chats');

    section('languages');
    await view(pB, 'profile');
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await pB.eval(`(setLang(${J(lang)}), renderCommunity(), true)`);
      await rendered(pB);
      const txt = await pB.eval(`document.getElementById('community-push-card') ? document.getElementById('community-push-card').innerText : ''`);
      check(lang + ': notification card translated', txt.length > 20 && !/push\./.test(txt) && txt.includes(await pB.eval(`t('push.switch')`)), txt.slice(0, 80));
    }
    await pB.eval(`(setLang('en'), true)`);

    section('turn off, on again, sign out');
    await view(pB, 'profile');
    await click(pB, '#community-push');
    await waitFor(() => subsFor(B) === 0, 15000, 'unsubscribed');
    check('switch off: removed from the server', subsFor(B) === 0);
    check('switch off: browser subscription cancelled', (await pB.eval(`window.__pushLog.includes('unsubscribe') && localStorage.getItem('gymquest_push') === null`)) === true);
    await rendered(pB);
    await click(pB, '#community-push');
    await waitFor(() => subsFor(B, devB) === 1, 15000, 'on again');
    check('switch on again from Profile', subsFor(B, devB) === 1);
    await pB.eval('window.__gq.signOut()');
    await pB.ready();
    check('sign-out removes this device from the server', subsFor(B) === 0);
    check('sign-out clears the device setting', (await pB.eval(`localStorage.getItem('gymquest_push')`)) === null);

    section('blocked, unsupported, iPhone without Home Screen');
    const pC = await browser('C', { dev: devC, permission: 'denied' });
    await signIn(pC, C);
    await view(pC, 'profile');
    check('blocked: Profile explains how to allow, no switch', await pC.eval(`!document.getElementById('community-push') && document.getElementById('community-push-card').innerText.includes(t('push.denied'))`));
    await view(pC, 'chats');
    check('blocked: no offer in Chats', await pC.eval(`!document.querySelector('[data-community-action="push-on"]')`));
    const pD = await browser('D', { dev: devC, mode: 'none', ua: IPHONE_UA });
    await signIn(pD, C);
    await view(pD, 'chats');
    check('iPhone in Safari: Chats explains Add to Home Screen', (await bodyText(pD)).includes(await pD.eval(`t('push.homeScreen')`)));
    await view(pD, 'profile');
    await shot(pD, 'profile-iphone-safari-en', '#community-push-card');
    check('iPhone in Safari: Profile explains Add to Home Screen, no switch', await pD.eval(`!document.getElementById('community-push') && document.getElementById('community-push-card').innerText.includes(t('push.homeScreen'))`));
    const pE = await browser('E', { dev: devC, mode: 'none' });
    await signIn(pE, C);
    await view(pE, 'profile');
    check('desktop browser without Push: "not supported" note', await pE.eval(`document.getElementById('community-push-card').innerText.includes(t('push.unsupported'))`));

    section('fallback when 0010 is rolled back');
    const undone = L.rollbackFrom(10);
    reapplyLater = undone;
    sql(`notify pgrst, 'reload schema';`);
    await wait(1500);
    await pA.reload();
    await pA.eval(HELPERS);
    await pA.eval(`(switchTab('komunita'), true)`);
    await waitFor(() => pA.eval(`!!communityProfile && communityVersion === 3`), 30000, 'version 3');
    await view(pA, 'profile');
    check('no notification card without 0010', await pA.eval(`!document.getElementById('community-push-card')`));
    await view(pA, 'chats');
    check('no offer in Chats without 0010', await pA.eval(`!document.querySelector('[data-community-action="push-on"]')`));
    const before = received.length;
    await pA.eval(`(communityOpenChat(${J(conv)}), true)`);
    await rendered(pA);
    await waitFor(() => pA.eval(`!!document.getElementById('community-chat-text')`), 30000, 'chat box after rollback');
    await pA.eval(`(() => { const el = document.getElementById('community-chat-text'); el.value = 'after rollback'; return true; })()`);
    await click(pA, '[data-community-action="chat-send"]');
    await wait(1500);
    check('messages still send, no push attempted', (await bodyText(pA)).includes('after rollback') && received.length === before);
    L.reapply(undone); reapplyLater = null;
    check('0010 (and later) re-applied', sqlVal('select public.community_social_version()') === undone.versionBefore);

    section('no errors');
    for (const [name, p] of pages) {
      check(name + ': no exceptions', p.errors.length === 0, J(p.errors));
      /* 400 z reminders_set je zámerne neplatné uloženie („od“ po „do“) v teste pripomienok. */
      const errs = p.logs.filter((l) => !/favicon|127\.0\.0\.1:54321\/(auth|rest)\/v1\/.*(400|401|404)/.test(l) && !/status of 400 .*rpc\/reminders_set/.test(l));
      check(name + ': no console errors', errs.length === 0, J(errs));
    }
  } catch (e) {
    check('test error', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | '));
  } finally {
    if (reapplyLater) { L.reapply(reapplyLater); console.log('  (migrations re-applied after an error)'); }
    for (const b of browsers) b.killHard(true);
    mock.close();
    await server.close();
  }
  console.log('\n==== checks: ' + L.results.pass + ' passed, ' + L.results.fail + ' failed ====');
  process.exit(L.results.fail ? 1 : 0);
})().catch((e) => { console.error(e); for (const b of browsers) b.killHard(true); process.exit(2); });
