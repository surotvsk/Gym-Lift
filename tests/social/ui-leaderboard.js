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
