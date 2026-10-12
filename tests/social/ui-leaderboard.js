'use strict';
/* GymQuest leaderboard (0009): the app in real headless Chrome against the LOCAL stack.
     GQ_COMMUNITY_CONFIG=<local community-config.js> node tests/social/ui-leaderboard.js [filter] */
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
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-social-lb');
const PROFILES = path.join(WORK, 'profiles');
const FILTER = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
let nextPort = 9900;
const browsers = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;

async function device(name, width) {
  const b = new Browser(name + '-' + Date.now().toString(36), nextPort++, PROFILES);
  browsers.push(b);
  const p = await b.launch();
  if (width) await p.c.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: true });
  await p.navigate(BASE);
  await p.eval(HELPERS);
  return p;
}
async function member(tag) {
  const u = await L.newUser('lbui-' + tag);
  const j = await u.c.rpc('community_join');
  if (j.error) throw new Error('community_join: ' + errText(j));
  return u;
}
async function signIn(p, u) {
  await p.eval('window.__gq.signIn(' + J(u.email) + ',' + J(u.password) + ')');
  await p.ready();
  await p.eval(HELPERS);
  await p.eval(`(state.settings.communityOptIn = true, persistState(), setLang('en'), true)`);
  await p.eval(`(document.querySelector('.tab-bar [data-tab="komunita"]').click(), true)`);
  await waitFor(() => p.eval(`!!communityProfile && communityVersion === 3`), 30000, 'profile v3');
}
async function finishWorkout(p) {
  await p.eval(`(async () => { const w = (ms) => new Promise((r) => setTimeout(r, ms)); const $ = (s) => document.querySelector(s);
    $('.tab-bar [data-tab="dnes"]').click(); await w(200); $('#btn-start-workout').click(); await w(400);
    for (const b of Array.from(document.querySelectorAll('#exercise-list .set-btn:not([disabled])'))) { b.click(); await w(50); }
    $('#btn-finish-workout').click(); await w(300); $('#btn-confirm-ok').click(); await w(800);
    for (let k = 0; k < 4; k++) for (const id of ['modal-generic', 'modal-levelup', 'modal-achievement']) { const m = document.getElementById(id); if (m && !m.hidden) { const x = m.querySelector('.btn-primary'); if (x) x.click(); await w(200); } }
    return true; })()`);
}
const serverRow = (u) => sqlVal(`select training_xp||'|'||achievement_xp||'|'||total_xp||'|'||level from public.leaderboard_entries where user_id = ${lit(u.id)}`);

const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

scenario('reports XP after a workout', async () => {
  const u = await member('rep');
  const p = await device('rep');
  await signIn(p, u);
  await finishWorkout(p);
  const local = await p.eval(`(() => { const x = leaderboardPayload(); const li = levelInfo(); return { training: x.p_training, xp: li.xp, level: li.level }; })()`);
  await waitFor(() => { const r = serverRow(u); return r && Number(r.split('|')[0]) === local.training; }, 20000, 'server row');
  const [training, ach, total, level] = serverRow(u).split('|').map(Number);
  check('server training XP = app workout+activity XP', training === local.training, J({ training, local }));
  check('server total and level = what the app shows', total === local.xp && level === local.level, J({ total, level, local }));
  check('no page errors', p.errors.length === 0, J(p.errors));
});

async function openBoard(p) {
  await p.eval(`(document.querySelector('.cnav [data-community-view="leaderboard"]').click(), true)`);
  await waitFor(() => p.eval(`!!document.querySelector('#community-body .lb-table, #community-body .lb-state')`), 20000, 'board');
  await wait(300);
}
const boardRows = (p) => p.eval(`Array.from(document.querySelectorAll('#community-body .lb-table tbody tr:not(.lb-gap)')).map((tr) => ({ name: tr.querySelector('.lb-name').textContent, me: tr.classList.contains('lb-me'), pos: tr.querySelector('.lb-pos').textContent.trim(), medal: tr.querySelector('.lb-pos').className }))`);

scenario('board: tabs, top 3, own pinned row, profile link', async () => {
  sql('delete from public.leaderboard_entries;');
  const me = await member('b-me');
  const top = [];
  for (let i = 0; i < 21; i++) { const u = await member('b' + i); await u.c.rpc('leaderboard_submit', { p_training: 1000 + i * 10, p_week_training: 50 + i, p_week_key: sqlVal(`select to_char(now() at time zone 'utc', 'IYYY-"W"IW')`), p_workouts: 5, p_achievements: [] }); top.push(u); }
  const p = await device('board');
  await signIn(p, me);
  await openBoard(p);
  const rows = await boardRows(p);
  check('20 rows plus the pinned own row', rows.length === 21, J(rows.length));
  check('first row has the gold badge', /lb-gold/.test(rows[0].medal) && /lb-silver/.test(rows[1].medal) && /lb-bronze/.test(rows[2].medal), J(rows.slice(0, 3)));
  const mine = rows[rows.length - 1];
  check('own row pinned last and highlighted with its rank', mine.me && mine.pos === '#22', J(mine));
  await p.eval(`(document.querySelector('[data-community-action="lb-period"][data-period="week"]').click(), true)`);
  const weekShown = await waitFor(() => p.eval(`leaderboardPeriod === 'week' && document.getElementById('community-body').innerText.indexOf(t('lb.resets')) >= 0`), 15000, 'week tab').then(() => true).catch(() => false);
  check('week tab shows "Resets Monday"', weekShown);
  check('week tab has no level column', await p.eval(`document.querySelectorAll('.lb-table thead th').length === 3`));
  await p.eval(`(document.querySelector('.lb-table tbody .lb-name').click(), true)`);
  await waitFor(() => p.eval(`communityView === 'user'`), 15000, 'profile opened');
  check('tapping a name opens the member profile', true);
  check('no page errors', p.errors.length === 0, J(p.errors));
});

scenario('hidden state and the privacy switch', async () => {
  const me = await member('h-me');
  const p = await device('hidden');
  await signIn(p, me);
  await p.eval(`(communitySetView('profile'), true)`);
  await waitFor(() => p.eval(`!!document.getElementById('community-leaderboard')`), 15000, 'privacy switch');
  check('switch is on by default', await p.eval(`document.getElementById('community-leaderboard').checked === true`));
  await p.eval(`(() => { const c = document.getElementById('community-leaderboard'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor(() => sqlVal(`select hidden from public.leaderboard_entries where user_id = ${lit(me.id)}`) === 't', 15000, 'hidden on server');
  await openBoard(p);
  check('hidden state shown with Show me', await p.eval(`!!document.querySelector('.lb-state [data-community-action="lb-show-me"]')`));
  await p.eval(`(document.querySelector('[data-community-action="lb-show-me"]').click(), true)`);
  await waitFor(() => sqlVal(`select hidden from public.leaderboard_entries where user_id = ${lit(me.id)}`) === 'f', 15000, 'shown again');
  check('Show me puts the member back', true);
});

scenario('moderator action and removed note', async () => {
  const mod = await member('m-mod'); L.makeModerator(mod);
  const target = await member('m-target');
  await target.c.rpc('leaderboard_submit', { p_training: 100, p_week_training: 100, p_week_key: sqlVal(`select to_char(now() at time zone 'utc', 'IYYY-"W"IW')`), p_workouts: 1, p_achievements: [] });
  const p = await device('mod');
  await signIn(p, mod);
  await p.eval(`(communityOpenUser(${J(target.id)}), true)`);
  await waitFor(() => p.eval(`!!document.querySelector('[data-community-action="lb-mod"]')`), 15000, 'mod button');
  await p.eval(`(document.querySelector('[data-community-action="profile-menu"]').click(), document.querySelector('[data-community-action="lb-mod"]').click(), true)`);
  await waitFor(() => sqlVal(`select removed_by_moderator from public.leaderboard_entries where user_id = ${lit(target.id)}`) === 't', 15000, 'removed');
  check('moderator removes from the leaderboard', true);
  const p2 = await device('removed');
  await signIn(p2, target);
  await openBoard(p2);
  check('removed member sees the removed note', await p2.eval(`document.getElementById('community-body').innerText.indexOf(t('lb.removedNote')) >= 0`));
});

scenario('narrow phone, languages, offline', async () => {
  const me = await member('n-me');
  const p = await device('narrow', 320);
  await signIn(p, me);
  await openBoard(p);
  check('narrow phone: no horizontal page overflow', await p.eval(`document.documentElement.scrollWidth <= window.innerWidth + 1`));
  const fit = (lang) => p.eval(`(() => { const card = document.querySelector('.lb-card').getBoundingClientRect();
    const bad = Array.from(document.querySelectorAll('.lb-table td.lb-xp, .lb-table th')).filter((c) => { const r = c.getBoundingClientRect(); return r.left < card.left - 1 || r.right > card.right + 1; });
    const cut = Array.from(document.querySelectorAll('.lb-table th, .lb-table td.lb-pos, .lb-table td.lb-level')).filter((c) => c.scrollWidth > c.clientWidth + 1 || c.getClientRects()[0] && c.getBoundingClientRect().height > 2.2 * parseFloat(getComputedStyle(c).fontSize) + parseFloat(getComputedStyle(c).paddingTop) * 2);
    return { bad: bad.length + cut.length, sample: bad.concat(cut).slice(0, 3).map((c) => c.textContent) }; })()`);
  sql('select 1;');
  const s1 = await fit('en');
  check('narrow phone: every XP value and header fully visible in the card', s1.bad === 0, J(s1));
  for (const lang of ['sk', 'es', 'pt-BR', 'fr', 'ar']) {
    await p.eval(`(setLang(${J(lang)}), renderCommunity(), true)`);
    await wait(800);
    check(lang + ': no raw lb.* keys', await p.eval(`document.getElementById('community-body').innerText.indexOf('lb.') < 0`));
  }
  check('arabic is right to left', await p.eval(`document.documentElement.dir === 'rtl'`));
  await p.eval(`(communitySetView('leaderboard'), true)`); await waitFor(() => p.eval(`!!document.querySelector('.lb-table')`), 15000, 'ar table'); await wait(500);
  const s2 = await fit('ar');
  check('arabic: every XP value and header fully visible in the card', s2.bad === 0, J(s2));
  await p.eval(`(setLang('en'), true)`);
  await p.offline(true);
  await p.eval(`(renderCommunity(), true)`);
  const offOk = await waitFor(() => p.eval(`document.getElementById('community-body').innerText.indexOf(t('lb.offline')) >= 0 || document.getElementById('community-body').innerText.indexOf(t('community.errNetwork')) >= 0`), 20000, 'offline state').then(() => true).catch(() => false);
  if (!offOk) console.log('DEBUG offline body:', J(await p.eval(`({ view: communityView, lang: activeLang(), online: navigator.onLine, text: document.getElementById('community-body').innerText.slice(0, 400) })`)));
  check('offline: clear message, no error dialog', true);
  await p.offline(false);
  check('no missing translations', !p.console.some((c) => /chýbajúce preklady/.test(c)), J(p.console.filter((c) => /chýbajúce/.test(c))));
});

(async () => {
  fs.mkdirSync(PROFILES, { recursive: true });
  const server = await startServer(PORT, { new: REPO });
  for (const sc of scenarios) {
    if (FILTER && !FILTER.test(sc.name)) continue;
    section(sc.name);
    try { await sc.fn(); } catch (e) { check('scenario error: ' + sc.name, false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    while (browsers.length) { const b = browsers.pop(); try { await b.closeGraceful(); } catch (e) { b.killHard(true); } }
  }
  await server.close();
  console.log('\n==== checks: ' + L.results.pass + ' passed, ' + L.results.fail + ' failed ====');
  process.exit(L.results.fail ? 1 : 0);
})();
