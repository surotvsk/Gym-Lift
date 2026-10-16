'use strict';
/* GymQuest — sharing a finished workout from the Calendar (v68), in real headless Chrome against
   the LOCAL test stack (disposable local users only, never production).

     GQ_COMMUNITY_CONFIG=<local config js> node tests/social/ui-dayshare.js

   Checks: the day window of a workout offers "Share to Community" and "Send to a friend";
   the friend list shows only friends; sending creates one chat message with the workout
   (per-side exercise and per-set reps included) and the friend sees the card with
   "2 sets per side"; "Open chat" goes to that chat; "Share to Community" opens the composer
   with the workout attached and the post goes to review; no friends → a clear note;
   6 languages; 390 px; no console errors. */
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
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-social-dayshare');
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
  if (Number(sqlVal('select public.community_social_version()')) < 5) throw new Error('0011 must be applied');
  if (!process.env.GQ_COMMUNITY_CONFIG) throw new Error('GQ_COMMUNITY_CONFIG required');
  fs.mkdirSync(PROFILES, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await startServer(PORT, { new: REPO });
  const A = await member('a', 'ada'), B = await member('b', 'ben'), C = await member('c', 'cyd'), Z = await member('z', 'zoe');
  const req = await A.c.from('friend_requests').insert({ from_id: A.id, to_id: B.id }).select('id').single();
  await B.c.rpc('accept_friend_request', { p_request: req.data.id });
  const req2 = await A.c.from('friend_requests').insert({ from_id: A.id, to_id: C.id }).select('id').single();
  await C.c.rpc('accept_friend_request', { p_request: req2.data.id });
  const phone = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
  try {
    const pA = await device('A');
    await signIn(pA, A);
    /* Hotový tréning v histórii: jednostranný cvik (2 série na stranu, obe strany hotové) a zmenené opakovania. */
    const day = await pA.eval(`(() => {
      const d = todayISO();
      state.history.push({ id: 'w-dayshare', planId: 'p-x', planName: 'Arms day', date: d, xp: 40, note: '', durationSeconds: 1800,
        exercises: [{ name: 'Dumbbell curl', sets: 2, reps: 15, weight: 8, setsDone: 4, unilateral: true, startSide: 'left',
            sidesDone: { left: [1, 2], right: [1, 2] }, sidesFailure: { left: [], right: [] }, actualFailureSets: [], plannedFailureSets: [] },
          { name: 'Chest press', sets: 3, reps: 10, weight: 30, setsDone: 3, setReps: [10, 8, 8], actualFailureSets: [], plannedFailureSets: [] }] });
      reconcileAchievements(); saveState(); return d; })()`);
    await pA.c.send('Emulation.setDeviceMetricsOverride', phone);

    section('calendar day window: share buttons');
    await pA.eval(`(switchTab('kalendar'), openDay(${J(day)}), true)`);
    await wait(500);
    check('the workout in the day window has "Share to Community" and "Send to a friend"', await pA.eval(`(() => {
      const b = document.querySelector('#modal-day .day-share'); return !!b && b.querySelector('.day-share-community').textContent === t('share.resultButton') && b.querySelector('.day-share-friend').textContent === t('share.toFriend'); })()`));
    check('the day window shows the per-side exercise and the per-set reps', await pA.eval(`(() => { const x = document.getElementById('modal-day').innerText; return x.includes(tPlural('unilateral.setsPerSide', 2)) && x.includes('3 × 10/8/8'); })()`));
    await click(pA, '#modal-day .day-share-friend');
    await waitFor(() => pA.eval(`document.querySelectorAll('#modal-day .day-share-to').length > 0`), 15000, 'friend list');
    const names = await pA.eval(`Array.from(document.querySelectorAll('#modal-day .day-share-to')).map((b) => b.textContent).sort()`);
    check('the friend list shows exactly the friends (not other members)', J(names) === J([B.name, C.name].sort()), names);
    await shot(pA, 'day-share-friends', '#modal-day .day-share');
    await pA.c.send('Emulation.setDeviceMetricsOverride', phone);
    check('390 px: day window has no horizontal overflow', await pA.eval(`(() => { const m = document.querySelector('#modal-day .modal'); return m.scrollWidth <= m.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1; })()`));
    await click(pA, `#modal-day .day-share-to[data-user="${B.id}"]`);
    await waitFor(() => pA.eval(`!!document.querySelector('#modal-day .day-share-sent')`), 15000, 'sent');
    check('"Sent to ben" shown', (await pA.eval(`document.querySelector('#modal-day .day-share-sent').textContent`)).includes(B.name));
    const conv = sqlVal(`select c.id from public.conversations c where (c.user_a = ${lit(A.id)} and c.user_b = ${lit(B.id)}) or (c.user_a = ${lit(B.id)} and c.user_b = ${lit(A.id)})`);
    check('exactly one message with the workout went to ben', sqlVal(`select count(*) from public.messages where conversation_id = ${lit(conv)} and attachment->>'kind' = 'workout'`) === '1');
    const att = JSON.parse(sqlVal(`select attachment::text from public.messages where conversation_id = ${lit(conv)}`));
    check('the shared item carries the per-side flag and the reps per set', att.exercises[0].u === true && att.exercises[0].d === 4 && J(att.exercises[1].sr) === J([10, 8, 8]), att.exercises);
    check('nothing was sent to cyd', sqlVal(`select count(*) from public.messages m join public.conversations c on c.id = m.conversation_id where ${lit(C.id)} in (c.user_a, c.user_b)`) === '0');
    await shot(pA, 'day-share-sent', '#modal-day .day-share');
    await pA.c.send('Emulation.setDeviceMetricsOverride', phone);
    check('"Open chat" button labelled', (await pA.eval(`document.querySelector('#modal-day .day-share-open').textContent`)) === 'Open chat');
    await click(pA, '#modal-day .day-share-open');
    await chatShown(pA);
    check('"Open chat" closes the day window and opens the chat with ben', await pA.eval(`document.getElementById('modal-day').hidden && activeTab === 'komunita' && communityView === 'chat' && communityChatId === ${J(conv)}`));
    check('A sees the workout card in the chat', await pA.eval(`!!document.querySelector('#community-chat-msgs .cshare-card[data-kind="workout"]')`));

    const pB = await device('B');
    await signIn(pB, B);
    await pB.c.send('Emulation.setDeviceMetricsOverride', phone);
    await pB.eval(`(communityOpenChat(${J(conv)}), true)`);
    await rendered(pB);
    await chatShown(pB);
    const cardB = await pB.eval(`(document.querySelector('#community-chat-msgs .cshare-card[data-kind="workout"]') || {}).innerText || ''`);
    check('ben sees "2 sets per side", not "4/2 sets"', cardB.includes('2 sets per side · 15 reps · 8 kg') && !cardB.includes('4/2'), cardB);
    check('ben sees the changed reps "10/8/8"', cardB.includes('3/3 sets · 10/8/8 reps · 30 kg'), cardB);
    check('the chat still offers "Share a plan or workout" (texts not mixed up)', (await pB.eval(`(document.querySelector('[data-community-action="chat-share-open"]') || {}).textContent`)) === 'Share a plan or workout');
    await shot(pB, 'friend-card', '#community-chat-msgs .cshare-card');
    const before = await pB.eval('Object.keys(state.plans).length');
    await click(pB, '#community-chat-msgs .cshare-card[data-kind="workout"] [data-community-action="save-shared"]');
    const saved = await pB.eval(`Object.values(state.plans).find((p) => p.customName === 'Arms day')`);
    check('ben saves it to his plans: the curl stays "one side at a time", 2 sets per side', (await pB.eval('Object.keys(state.plans).length')) === before + 1 && saved
      && saved.exercises[0].unilateral === true && saved.exercises[0].sets === 2 && !saved.exercises[1].unilateral, saved);
    check('in his workout the saved plan shows "2 sets per side" with Left/Right rows', await pB.eval(`(() => { switchTab('trening'); selectedPlan = Object.values(state.plans).find((p) => p.customName === 'Arms day').id; renderTrening();
      const ex = document.querySelectorAll('#exercise-list .exercise')[0]; return ex.innerText.includes(tPlural('unilateral.setsPerSide', 2)) && ex.querySelectorAll('.set-item.side-row').length === 4; })()`));

    section('Share to Community from the calendar');
    await pA.c.send('Emulation.setDeviceMetricsOverride', phone);
    await pA.eval(`(switchTab('kalendar'), openDay(${J(day)}), true)`);
    await wait(400);
    await click(pA, '#modal-day .day-share-community');
    await rendered(pA);
    check('the composer opens with this workout attached and a text', await pA.eval(`document.getElementById('modal-day').hidden && communityView === 'compose' && !!document.querySelector('.cshare-draft .cshare-card[data-kind="workout"]') && document.getElementById('community-compose-text').value.includes('Arms day')`));
    await click(pA, '[data-community-action="compose-publish"]');
    await waitFor(() => sqlVal(`select count(*) from public.post_attachments a join public.posts p on p.id = a.post_id where p.user_id = ${lit(A.id)} and a.data->>'name' = 'Arms day'`) === '1', 15000, 'post');
    check('the post with the workout went to review (pending)', sqlVal(`select p.status from public.posts p join public.post_attachments a on a.post_id = p.id where p.user_id = ${lit(A.id)} and a.data->>'name' = 'Arms day'`) === 'pending');

    section('no friends');
    const pZ = await device('Z');
    await signIn(pZ, Z);
    await pZ.eval(`(() => { state.history.push({ id: 'w-z', planId: 'p-z', planName: 'Legs', date: todayISO(), xp: 30, note: '',
      exercises: [{ name: 'Squat', sets: 3, reps: 5, weight: 100, setsDone: 3, actualFailureSets: [], plannedFailureSets: [] }] }); saveState(); return true; })()`);
    await pZ.eval(`(switchTab('kalendar'), openDay(todayISO()), true)`);
    await wait(400);
    await click(pZ, '#modal-day .day-share-friend');
    await waitFor(() => pZ.eval(`(document.querySelector('#modal-day .day-share-friends') || {}).innerText !== t('community.loading')`), 15000, 'no friends');
    check('without friends the picker says so', (await pZ.eval(`document.querySelector('#modal-day .day-share-friends').innerText`)) === (await pZ.eval(`t('share.noFriends')`)));

    section('languages');
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await pZ.eval(`(setLang(${J(lang)}), closeDay(), switchTab('kalendar'), openDay(todayISO()), true)`);
      await wait(200);
      await click(pZ, '#modal-day .day-share-friend');
      await waitFor(() => pZ.eval(`(document.querySelector('#modal-day .day-share-friends') || {}).innerText === t('share.noFriends')`), 15000, 'note ' + lang);
      const txt = await pZ.eval(`document.querySelector('#modal-day .day-share').innerText`);
      check(lang + ': share buttons and note translated', !/share\.|community\./.test(txt) && txt.includes(await pZ.eval(`t('share.toFriend')`)) && txt.includes(await pZ.eval(`t('share.resultButton')`)), txt);
      if (lang === 'ar') { await shot(pZ, 'day-share-ar', '#modal-day .day-share'); }
    }
    await pZ.eval(`(setLang('en'), closeDay(), true)`);

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
