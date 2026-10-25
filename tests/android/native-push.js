'use strict';
/* GymQuest Android — message alerts through FCM (headless Chrome + fake Capacitor + fake Supabase).

     node tests/android/native-push.js

   Turning notifications on asks Android for permission, registers with FCM and stores the token
   with push_fcm_register (language of the app), then reminders are scheduled; denied permission
   leaves it off with the existing "denied" note and no server call; a server without 0016
   (missing function) hides the switch; signing out / switching off unregisters the token on the
   server and in FCM and cancels reminders; a new FCM token (refresh) is re-registered; language
   change re-registers; tapping an alert opens that chat; the web path still uses Web Push. */
const { counter, startServerOnce, openApp, closeAll, nativeCalls, clearNativeCalls, fireNative } = require('./lib-native');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const t = counter();
const check = t.check;
const ME = '11111111-2222-3333-4444-555555555555';
const CONV = '0b7f3c1e-1111-4222-8333-944445555666';
const TOK = 'fcm-token-1:APA91b' + 'x'.repeat(40);
const TOK2 = 'fcm-token-2:APA91b' + 'y'.repeat(40);

const FAKE_SB = `(() => {
  window.__rpc = []; window.__rpcMissing = false;
  window.__fakeSb = { rpc: async (fn, args) => {
    window.__rpc.push({ fn, args });
    if (window.__rpcMissing && /^push_fcm_/.test(fn)) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + fn } };
    return { data: null, error: null };
  } };
  communityClient = () => window.__fakeSb;
  communityVersion = 6;
  communityProfile = { id: ${JSON.stringify(ME)} };
  window.__opened = []; pushOpenChat = (c) => window.__opened.push(c);
  renderCommunity = () => {};
  return true; })()`;
const rpcs = (p, fn) => p.eval(`window.__rpc.filter((r) => r.fn === ${JSON.stringify(fn)})`);

(async () => {
  const server = await startServerOnce(require('os').tmpdir());
  try {
    const { p, errors } = await openApp({ name: 'npush', debugPort: 9941, native: true,
      returns: { 'PushNotifications.requestPermissions': { receive: 'granted' }, 'LocalNotifications.checkPermissions': { display: 'granted' },
        'LocalNotifications.getPending': { notifications: [] } } });
    await wait(1000);
    await p.eval(FAKE_SB);

    check('messages channel created', (await nativeCalls(p, 'PushNotifications', 'createChannel')).some((c) => c.args[0].id === 'messages'));
    check('native: push available without a VAPID key', await p.eval(`pushAvailable() === true`));
    check('state off before enabling', await p.eval(`pushState() === 'off'`));

    /* zapnutie */
    await p.eval(`(remindersData = { water_on: true, water_every: 120, water_from: '08:00', water_to: '20:00', meals_on: false, meal_times: [], workout_on: false, workout_days: [], workout_time: '17:00', saved: true }, true)`);
    await clearNativeCalls(p);
    await p.eval(`(window.__en = pushEnable(), true)`);
    await wait(200);
    check('permission requested, then FCM register()', (await nativeCalls(p, 'PushNotifications', 'requestPermissions')).length === 1
      && (await nativeCalls(p, 'PushNotifications', 'register')).length === 1);
    await fireNative(p, 'PushNotifications', 'registration', { value: TOK });
    await p.eval(`window.__en`);
    const reg = await rpcs(p, 'push_fcm_register');
    check('token stored on the server in the app language', reg.length === 1 && reg[0].args.p_token === TOK && reg[0].args.p_lang === 'en', reg);
    check('device record {uid, fcm}', await p.eval(`JSON.stringify(pushDeviceRead()) === JSON.stringify({ uid: ${JSON.stringify(ME)}, fcm: ${JSON.stringify(TOK)} })`));
    check('state on', await p.eval(`pushState() === 'on'`));
    check('no Web Push used', (await rpcs(p, 'push_subscribe')).length === 0);
    check('reminders scheduled after enabling', (await nativeCalls(p, 'LocalNotifications', 'schedule')).length >= 1);

    /* nový token od FCM */
    await p.eval(`(window.__rpc = [], true)`);
    await fireNative(p, 'PushNotifications', 'registration', { value: TOK2 });
    await wait(200);
    const re = await rpcs(p, 'push_fcm_register');
    check('refreshed FCM token re-registered', re.length === 1 && re[0].args.p_token === TOK2, re);
    check('device record updated', await p.eval(`pushDeviceRead().fcm === ${JSON.stringify(TOK2)}`));

    /* zmena jazyka → znova s novým jazykom */
    await p.eval(`(window.__rpc = [], true)`);
    await p.eval(`(window.__rf = pushRefresh(window.__fakeSb, ${JSON.stringify(ME)}), true)`);
    await wait(200);
    await fireNative(p, 'PushNotifications', 'registration', { value: TOK2 });
    await p.eval(`window.__rf`);
    check('pushRefresh re-registers the token', (await rpcs(p, 'push_fcm_register')).length >= 1);

    /* relácia iného účtu sa stratila bez odhlásenia → nový účet: starý token sa zruší */
    await p.eval(`(pushDeviceWrite({ uid: 'aaaaaaaa-0000-0000-0000-000000000000', fcm: ${JSON.stringify(TOK)} }), true)`);
    await clearNativeCalls(p);
    await p.eval(`pushRefresh(window.__fakeSb, ${JSON.stringify(ME)})`);
    check('device left registered for another account: FCM token deleted, record cleared',
      (await nativeCalls(p, 'PushNotifications', 'unregister')).length === 1 && await p.eval(`pushDeviceRead() === null`));
    await p.eval(`(pushDeviceWrite({ uid: ${JSON.stringify(ME)}, fcm: ${JSON.stringify(TOK2)} }), true)`);

    /* ťuknutie na upozornenie */
    await fireNative(p, 'PushNotifications', 'pushNotificationActionPerformed', { actionId: 'tap', notification: { data: { type: 'chat', conv: CONV } } });
    check('tap opens that chat', JSON.stringify(await p.eval(`window.__opened`)) === JSON.stringify([CONV]));
    await fireNative(p, 'PushNotifications', 'pushNotificationActionPerformed', { actionId: 'tap', notification: { data: { type: 'other' } } });
    check('other data ignored', (await p.eval(`window.__opened.length`)) === 1);

    /* odhlásenie / vypnutie */
    await p.eval(`(window.__rpc = [], true)`);
    await clearNativeCalls(p);
    await p.eval(`pushDisable(window.__fakeSb)`);
    const un = await rpcs(p, 'push_fcm_unregister');
    check('sign-out: token unregistered on the server', un.length === 1 && un[0].args.p_token === TOK2, un);
    check('sign-out: FCM unregister()', (await nativeCalls(p, 'PushNotifications', 'unregister')).length === 1);
    check('sign-out: device record cleared, state off', await p.eval(`pushDeviceRead() === null && pushState() === 'off'`));
    check('sign-out: reminders cancelled path ran', (await nativeCalls(p, 'LocalNotifications', 'getPending')).length >= 1
      && (await nativeCalls(p, 'LocalNotifications', 'schedule')).length === 0);

    /* odmietnuté povolenie */
    await p.eval(`(window.__nativeReturns['PushNotifications.requestPermissions'] = { receive: 'denied' }, window.__rpc = [], true)`);
    await clearNativeCalls(p);
    await p.eval(`pushEnable()`);
    check('denied: no register, no server call', (await nativeCalls(p, 'PushNotifications', 'register')).length === 0 && (await rpcs(p, 'push_fcm_register')).length === 0);
    check('denied: state denied, note shown in the card', await p.eval(`pushState() === 'denied' && pushCardHtml().includes(t('push.denied'))`));
    await p.eval(`(window.__nativeReturns['PushNotifications.requestPermissions'] = { receive: 'granted' }, nativeNotifPerm = 'prompt', true)`);

    /* server bez 0016 */
    await p.eval(`(window.__rpcMissing = true, window.__rpc = [], true)`);
    await p.eval(`(window.__en = pushEnable(), true)`);
    await wait(200);
    await fireNative(p, 'PushNotifications', 'registration', { value: TOK });
    await p.eval(`window.__en`);
    check('server without 0016: switch hidden, state off', await p.eval(`pushAvailable() === false && pushCardHtml() === '' && pushState() === 'off'`));
    check('server without 0016: FCM unregistered again', (await nativeCalls(p, 'PushNotifications', 'unregister')).length >= 1);

    check('no console errors', errors.length === 0, errors.slice(0, 5));
    closeAll();

    const web = await openApp({ name: 'npush-web', debugPort: 9942 });
    await wait(800);
    check('web: pushState uses the browser path', await web.p.eval(`['off', 'unsupported', 'denied', 'homescreen'].includes(pushState())`));
    check('web: no errors', web.errors.length === 0, web.errors);
  } catch (e) {
    check('no exception in test', false, String(e && e.stack || e));
  } finally {
    closeAll();
    server.close();
    console.log(`\n${t.pass} passed, ${t.fail} failed`);
    process.exit(t.fail ? 1 : 0);
  }
})();
