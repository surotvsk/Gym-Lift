'use strict';
/* GymQuest — train together with a friend (v72, migration 0014), two phones in real headless Chrome
   against the LOCAL test stack (disposable local users only, never production).

     GQ_COMMUNITY_CONFIG=<local config js> node tests/social/ui-train.js

   Flow: ada opens Workout → "Train with a friend" → picks ben (with her plan) → ben gets a chat
   message and an invitation on Workout and Today → joins with ada's plan → both see each other's
   live summary (exercise, sets, last set) → cheers → ada finishes (history "Trained with ben",
   ben sees "finished") → ben finishes → the session ends by itself; declining; the feature is
   hidden on an older server (0014 rolled back); 6 languages; 390 px; no console errors. */
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
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-social-train');
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
  if (Number(sqlVal('select public.community_social_version()')) < 7) throw new Error('0014 must be applied');
  if (!process.env.GQ_COMMUNITY_CONFIG) throw new Error('GQ_COMMUNITY_CONFIG required');
  fs.mkdirSync(PROFILES, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await startServer(PORT, { new: REPO });
  const A = await member('a', 'ada'), B = await member('b', 'ben'), C = await member('c', 'cyd');
  for (const [x, y] of [[A, B], [A, C]]) {
    const req = await x.c.from('friend_requests').insert({ from_id: x.id, to_id: y.id }).select('id').single();
    await y.c.rpc('accept_friend_request', { p_request: req.data.id });
  }
  const phone = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
  const tileShown = (p) => p.eval(`!document.getElementById('btn-train-tile').hidden`);
  const box = (p) => p.eval(`(() => { const b = document.getElementById('train-box'); return b && !b.hidden ? b.innerText : ''; })()`);
  const today = (p) => p.eval(`(() => { const b = document.getElementById('train-today'); return b && !b.hidden ? b.innerText : ''; })()`);
  const sessRow = () => { const r = sql(`select status || '|' || coalesce(plan->>'name', '-') from public.train_sessions where host_id = ${lit(A.id)} order by created_at desc limit 1`).split('\n')[0]; return r; };
  let reapplyLater = null;
  try {
    const pA = await device('A'); await signIn(pA, A);
    const pB = await device('B'); await signIn(pB, B);
    await pA.c.send('Emulation.setDeviceMetricsOverride', phone);
    await pB.c.send('Emulation.setDeviceMetricsOverride', phone);
    await pA.eval(`(() => {
      state.plans['tp'] = { id: 'tp', builtin: false, customName: 'Push day', location: null,
        exercises: [{ id: 'bench-press', name: 'Bench press', builtin: true, sets: 3, reps: 8, weight: 60 }, { name: 'Cable flyes', sets: 2, reps: 12, weight: 15 }] };
      if (!state.planOrder.includes('tp')) state.planOrder.push('tp');
      selectedPlan = 'tp'; saveState(); switchTab('trening'); renderTrening(); return true; })()`);

    section('Bento Today (signed in)');
    await pA.eval(`(switchTab('dnes'), true)`);
    await waitFor(() => pA.eval(`document.querySelectorAll('#bt-friends-avs .k-av').length === 2`), 20000, 'friend avatars');
    check('Today greets by username and shows both friends on the Friends tile', (await pA.eval(`document.getElementById('bh-hello').textContent`)) === 'Hi, ' + A.name
      && (await pA.eval(`document.getElementById('bt-friends-l').textContent`)) === 'Friends');
    await shot(pA, 'bento-today-signed-in');
    await pA.c.send('Emulation.setDeviceMetricsOverride', phone);
    await pA.eval(`(switchTab('trening'), true)`);

    section('inviting');
    /* Bento: „Trénovať s priateľom" je dlaždica medzi akciami Tréningu; panel pod ňou je v pokoji skrytý */
    await waitFor(() => tileShown(pA), 20000, 'train tile');
    check('Workout shows the "Train with a friend" tile (and no idle panel)', (await pA.eval(`document.getElementById('btn-train-tile').textContent`)).includes('Train with a friend') && (await box(pA)) === '');
    await click(pA, '[data-train-action="open"]');
    await waitFor(() => pA.eval(`document.querySelectorAll('[data-train-action="invite"]').length === 2`), 15000, 'friend list');
    check('the picker lists only friends (ben, cyd) and offers to send the plan (checked)', J((await pA.eval(`Array.from(document.querySelectorAll('[data-train-action="invite"]')).map((b) => b.textContent).sort()`))) === J([B.name, C.name].sort())
      && await pA.eval(`document.getElementById('train-share-plan').checked && document.querySelector('.train-share-plan').textContent.includes('Push day')`));
    await shot(pA, 'train-picker', '#train-box');
    await pA.c.send('Emulation.setDeviceMetricsOverride', phone);
    await click(pA, `[data-train-action="invite"][data-user="${B.id}"]`);
    await waitFor(() => box(pA).then((x) => x.includes('Waiting for')), 15000, 'waiting');
    check('the invitation is saved with the plan', sessRow() === 'invited|Push day', sessRow());
    check('ada sees "Waiting for ben to join…" with a time limit and Cancel', (await box(pA)).includes('Waiting for ' + B.name) && (await box(pA)).includes('min') && (await box(pA)).includes('Cancel invitation'));
    const conv = sqlVal(`select id from public.conversations where user_a = ${lit([A.id, B.id].sort()[0])} and user_b = ${lit([A.id, B.id].sort()[1])}`);
    check('ben also gets a chat message with the plan card', sqlVal(`select count(*) from public.messages where conversation_id = ${lit(conv)} and sender_id = ${lit(A.id)} and body like '%train together%' and attachment->>'kind' = 'plan'`) === '1');

    section('joining');
    await pB.eval(`(switchTab('dnes'), true)`);
    await waitFor(() => today(pB).then((x) => x.includes('wants to train with you')), 30000, 'invite on Today');
    check('ben sees the invitation on Today', (await today(pB)).includes(A.name + ' wants to train with you'));
    await shot(pB, 'train-invite-today', '#train-today');
    await pB.c.send('Emulation.setDeviceMetricsOverride', phone);
    await pB.eval(`(switchTab('trening'), true)`);
    await waitFor(() => box(pB).then((x) => x.includes('Join')), 10000, 'invite on Workout');
    check('…and on Workout, with "Use ada\'s plan" (checked), Join and Not now', (await box(pB)).includes('Push day') && (await box(pB)).includes('Not now') && await pB.eval(`document.getElementById('train-use-plan').checked`));
    await click(pB, '[data-train-action="join"]');
    await waitFor(() => box(pB).then((x) => x.includes('Training with')), 15000, 'active B');
    check('the session is active', sessRow() === 'active|Push day', sessRow());
    check('ben got a copy of ada\'s plan, selected', await pB.eval(`(() => { const p = getPlan(selectedPlan); return !!p && p.customName === 'Push day' && p.exercises.length === 2; })()`));
    check('ben sees "Training with ada", cheers, End and the privacy note', (await box(pB)).includes('Training with ' + A.name) && (await pB.eval(`document.querySelectorAll('.train-cheer').length`)) === 4
      && (await box(pB)).includes('sees your current exercise'));
    await waitFor(() => box(pA).then((x) => x.includes('Training with')), 30000, 'active A');
    check('ada sees that ben joined', (await box(pA)).includes('Training with ' + B.name) && (await box(pA)).includes(B.name + ' joined'));

    section('live progress');
    await pA.eval(`(() => { const ex = document.querySelectorAll('#exercise-list .exercise')[0]; ex.querySelectorAll('.set-btn')[0].click(); return true; })()`);
    await pA.eval(`(() => { const e = getPlan('tp').exercises[0]; setSetReps(e, 1, '6'); setSetWeight(e, 1, '62.5'); renderTrening(); document.querySelectorAll('#exercise-list .exercise')[0].querySelectorAll('.set-btn')[1].click(); return true; })()`);
    await waitFor(() => box(pB).then((x) => x.includes('2 of 5 sets')), 30000, 'ada progress on B');
    const seenB = await box(pB);
    check('ben sees ada\'s exercise (in his language), "2 of 5 sets" and her last set "6 × 62.5 kg"', seenB.includes('Bench press') && seenB.includes('2 of 5 sets') && seenB.includes('last 6 × 62.5 kg'), seenB);
    const stored = JSON.parse(sqlVal(`select data::text from public.train_progress where user_id = ${lit(A.id)}`));
    check('only the small summary is shared (plan, ex, exId, done, total, last)', J(Object.keys(stored).sort()) === J(['done', 'ex', 'exId', 'last', 'plan', 'total']), stored);
    await shot(pB, 'train-active-b', '#train-box');
    await pB.c.send('Emulation.setDeviceMetricsOverride', phone);
    check('390 px: the panel fits (no horizontal overflow)', await pB.eval(`document.documentElement.scrollWidth <= innerWidth + 1`));

    section('cheers');
    await click(pB, '.train-cheer[data-emoji="💪"]');
    check('ben: "💪 sent to ada"', (await box(pB)).includes('💪 sent to ' + A.name));
    await waitFor(() => box(pA).then((x) => x.includes('sends you 💪')), 30000, 'cheer on A');
    check('ada sees "ben sends you 💪"', (await box(pA)).includes(B.name + ' sends you 💪'));
    await shot(pA, 'train-cheer-a', '#train-box');
    await pA.c.send('Emulation.setDeviceMetricsOverride', phone);

    section('finishing');
    await pA.eval(`(finishWorkout(), confirmFinish(), true)`);
    await wait(500);
    const h = await pA.eval(`state.history[state.history.length - 1]`);
    check('ada\'s workout is saved with "trainedWith: ben"', h.trainedWith === B.name, h.trainedWith);
    await pA.eval(`(document.getElementById('modal-result').hidden = true, switchTab('pokrok'), setPokrokView('progress'), true)`);
    check('Progress history shows "Trained with ben"', (await pA.eval(`document.body.innerText`)).includes('Trained with ' + B.name));
    check('the Calendar day shows it too', await pA.eval(`(() => { openDay(todayISO()); const x = document.getElementById('modal-day').innerText; closeDay(); return x; })()`).then((x) => x.includes('Trained with ' + B.name)));
    await waitFor(() => box(pB).then((x) => x.includes('finished the workout')), 30000, 'ada finished on B');
    check('ben sees "ada · finished the workout ✓"', (await box(pB)).includes('finished the workout ✓'));
    await pB.eval(`(() => { const ex = document.querySelectorAll('#exercise-list .exercise')[0]; ex.querySelectorAll('.set-btn')[0].click(); finishWorkout(); confirmFinish(); document.getElementById('modal-result').hidden = true; switchTab('trening'); return true; })()`);
    check('ben\'s workout is saved with "trainedWith: ada"', (await pB.eval(`state.history[state.history.length - 1].trainedWith`)) === A.name);
    await waitFor(() => Promise.resolve(sessRow().startsWith('ended|')), 40000, 'auto end');
    check('both finished → the session ended by itself', sessRow().startsWith('ended|'), sessRow());
    await waitFor(() => tileShown(pB), 30000, 'B back to tile');
    check('ben\'s "Train with a friend" tile is back, with "Training together with ada has ended."', (await box(pB)).includes('has ended'));

    section('declining');
    await pA.eval(`(switchTab('trening'), true)`);
    await waitFor(() => tileShown(pA), 30000, 'A tile again');
    if (!(await pA.eval(`!!document.querySelector('[data-train-action="invite"]')`))) await click(pA, '[data-train-action="open"]');
    await waitFor(() => pA.eval(`!!document.querySelector('[data-train-action="invite"]')`), 15000, 'picker again');
    await click(pA, `[data-train-action="invite"][data-user="${B.id}"]`);
    await waitFor(() => box(pB).then((x) => x.includes('Not now')), 30000, 'second invite on B');
    await click(pB, '[data-train-action="decline"]');
    check('ben declines → the invitation is gone for him', sessRow().startsWith('declined|') && !(await box(pB)).includes('Not now'), sessRow());
    await waitFor(() => box(pA).then((x) => x.includes('no longer valid')), 30000, 'A told');
    check('ada is told the invitation is no longer valid', (await box(pA)).includes('The invitation for ' + B.name + ' is no longer valid.'));

    section('languages');
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await pA.eval(`(setLang(${J(lang)}), switchTab('trening'), renderTrening(), true)`);
      /* Bento: nápis „Trénovať s priateľom" je na dlaždici v Tréningu, panel pod ňou nesie len stav (napr. neplatná pozvánka) */
      const txt = (await box(pA)) + ' ' + (await pA.eval(`document.getElementById('btn-train-tile').innerText`));
      check(lang + ': tile and panel translated', !/train\.|bento\.|community\./.test(txt) && txt.includes(await pA.eval(`t('train.open')`)) && txt.includes(await pA.eval(`t('bento.trainLine')`)), txt);
    }
    await pA.eval(`(setLang('ar'), true)`);
    await shot(pA, 'train-ar', '#train-box');
    await pA.eval(`(setLang('en'), true)`);

    section('older server (0014 rolled back)');
    const undone = L.rollbackFrom(14);
    reapplyLater = undone;
    await wait(1500);
    const pC = await device('C'); await signIn(pC, C);
    await pC.eval(`(switchTab('trening'), true)`);
    await wait(1500);
    check('without 0014 the feature is hidden (no panel), Workout works', (await pC.eval(`document.getElementById('train-box').hidden && !!document.getElementById('exercise-list')`)));
    L.reapply(undone); reapplyLater = null;
    check('0014 re-applied (version ' + undone.versionBefore + ')', sqlVal('select public.community_social_version()') === undone.versionBefore);

    section('no errors');
    for (const [name, p] of pages) {
      check(name + ': no exceptions', p.errors.length === 0, J(p.errors));
      const errs = p.logs.filter((l) => !/favicon|127\.0\.0\.1:54321\/(auth|rest|functions)\/v1\/.*(400|401|404)/.test(l));
      check(name + ': no console errors', errs.length === 0, J(errs));
    }
  } catch (e) {
    check('test error', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | '));
  } finally {
    if (reapplyLater) { L.reapply(reapplyLater); console.log('  (0014 re-applied after an error)'); }
    for (const b of browsers) b.killHard(true);
    await server.close();
  }
  console.log('\n==== checks: ' + L.results.pass + ' passed, ' + L.results.fail + ' failed ====');
  process.exit(L.results.fail ? 1 : 0);
})().catch((e) => { console.error(e); for (const b of browsers) b.killHard(true); process.exit(2); });
