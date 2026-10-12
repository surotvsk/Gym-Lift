'use strict';
/* GymQuest — Community invitation window (v58, once a day since v59) in real headless Chrome. Needs only a configured
   community-config.js (the LOCAL stack config); no database writes, no accounts.

     GQ_COMMUNITY_CONFIG=<local config js> node tests/social/ui-invite.js

   Checks: a brand-new user is not invited right away, a due invite appears after start (once per calendar
   day), every way to close it works and postpones it to the next day, Join enables Community and opens its tab, nothing shows while
   a dialog is open, the test harness never sees it unless asked, all six languages, RTL. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser, waitFor } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-invite');
const SHOTS = path.join(WORK, 'shots');
const DAY = 24 * 60 * 60 * 1000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? ' — ' + JSON.stringify(info) : '')); }
}

const shown = (p) => p.eval(`!document.getElementById('modal-community-invite').hidden`);
const lastAt = (p) => p.eval(`Number(localStorage.getItem('gymquest_community_invite')) || 0`);
const setLast = (p, ms) => p.eval(`(localStorage.setItem('gymquest_community_invite', String(${ms})), true)`);
async function load(p) {
  await p.reload();
  /* úvodné nastavenie (prázdna história) sa zatvorí hneď, ešte pred oneskorením pozvánky */
  await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); return true; })()`);
}
const afterDelay = () => wait(5000);

(async () => {
  if (!process.env.GQ_COMMUNITY_CONFIG) throw new Error('GQ_COMMUNITY_CONFIG required');
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('invite-' + Date.now().toString(36), 9890, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const errors = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/127\.0\.0\.1:54321|favicon/.test(e.entry.url || '')) errors.push(e.entry.text + ' ' + (e.entry.url || '')); });
  try {
    await p.navigate(BASE);
    check('Community is configured (local config)', await p.eval('communityConfigured()'));

    console.log('test harness without the flag');
    await setLast(p, 1);
    await load(p);
    await afterDelay();
    check('no invite under __GQ_TEST__ unless requested', !(await shown(p)));

    await p.eval(`(sessionStorage.setItem('gq_test_invite', '1'), true)`);

    console.log('brand-new user');
    await p.eval(`(localStorage.removeItem('gymquest_community_invite'), true)`);
    await load(p);
    check('history is empty', (await p.eval('state.history.length')) === 0);
    await afterDelay();
    check('new user: no invite on the first day', !(await shown(p)));
    const deferred = await lastAt(p);
    check('new user: first invite scheduled from now', Math.abs(Date.now() - deferred) < 60000, deferred);

    console.log('due invite');
    await setLast(p, Date.now() - 3 * DAY - 1000);
    await load(p);
    check('not shown before the start delay', !(await shown(p)));
    await afterDelay();
    check('due invite shown after start', await shown(p));
    check('invite time recorded when shown', Date.now() - (await lastAt(p)) < 10000);
    check('no change to synced state (device-only key)', await p.eval(`!('communityInvite' in state.settings) && !JSON.stringify(syncScope(state)).includes('community_invite')`));
    check('focusable buttons present', await p.eval(`['btn-community-invite-join','btn-community-invite-later','btn-community-invite-close'].every((id) => !!document.getElementById(id))`));

    await p.eval(`(document.getElementById('btn-community-invite-later').click(), true)`);
    check('"Not now" closes it', !(await shown(p)));
    await load(p);
    await afterDelay();
    check('not shown again the same day', !(await shown(p)));
    await p.eval(`(localStorage.setItem('gymquest_community_invite', String(Math.max(new Date().setHours(0, 0, 1, 0), Date.now() - 3600000))), true)`);
    await load(p);
    await afterDelay();
    check('not shown when it was already shown earlier today', !(await shown(p)));
    await p.eval(`(() => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(23, 59, 0, 0); localStorage.setItem('gymquest_community_invite', String(d.getTime())); return true; })()`);
    await load(p);
    await afterDelay();
    check('shown again on the next calendar day (even < 24 h later)', await shown(p));
    await p.eval(`(closeCommunityInvite(), true)`);
    await setLast(p, Date.now() + 2 * DAY);
    await load(p);
    await afterDelay();
    check('device clock moved back: shown, not stuck for days', await shown(p));
    await p.eval(`(closeCommunityInvite(), true)`);

    for (const [how, js] of [
      ['✕', `document.getElementById('btn-community-invite-close').click()`],
      ['Esc', `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`],
      ['tap outside', `document.getElementById('modal-community-invite').click()`],
    ]) {
      await setLast(p, Date.now() - 4 * DAY);
      await load(p);
      await afterDelay();
      const was = await shown(p);
      await p.eval('(' + js + ', true)');
      check('closes with ' + how, was && !(await shown(p)));
    }
    await setLast(p, Date.now() - 4 * DAY);
    await load(p);
    await afterDelay();
    await p.eval(`(document.querySelector('#modal-community-invite .modal').click(), true)`);
    check('tap inside the window does not close it', await shown(p));
    await p.eval(`(closeCommunityInvite(), true)`);

    console.log('blocked while a dialog is open, shown on return');
    await setLast(p, Date.now() - 4 * DAY);
    await load(p);
    await p.eval(`(openLanguagePicker(), true)`);
    await afterDelay();
    check('not shown over an open dialog', !(await shown(p)));
    await p.eval(`(hideLanguagePicker(), true)`);
    await p.eval(`(document.dispatchEvent(new Event('visibilitychange')), true)`);
    await afterDelay();
    check('shown after returning to the app', await shown(p));
    await p.eval(`(closeCommunityInvite(), true)`);

    console.log('not on the Community tab');
    await setLast(p, Date.now() - 4 * DAY);
    await load(p);
    await p.eval(`(switchTab('komunita'), true)`);
    await afterDelay();
    check('not shown on the Community tab', !(await shown(p)));
    await p.eval(`(switchTab('dnes'), true)`);

    console.log('languages');
    await setLast(p, Date.now() - 4 * DAY);
    await load(p);
    await afterDelay();
    const titles = {};
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await p.eval(`(setLang(${JSON.stringify(lang)}), true)`);
      const r = await p.eval(`(() => { const m = document.getElementById('modal-community-invite');
        const txt = (id) => (document.getElementById(id) || {}).textContent || '';
        return { title: txt('community-invite-title'), text: m.querySelector('p').textContent, join: txt('btn-community-invite-join'),
          later: txt('btn-community-invite-later'), aria: document.getElementById('btn-community-invite-close').getAttribute('aria-label'),
          keys: [t('community.inviteTitle'), t('community.inviteText'), t('community.inviteJoin'), t('community.inviteLater')],
          dir: document.documentElement.dir }; })()`);
      titles[lang] = r.title;
      check(lang + ': texts come from the dictionary', r.title === r.keys[0] && r.text === r.keys[1] && r.join === r.keys[2] && r.later === r.keys[3] && !/community\./.test(r.title + r.text + r.join + r.later), r);
      check(lang + ': close button has a label', !!r.aria && r.aria !== 'common.close', r.aria);
      if (lang === 'ar') {
        const side = await p.eval(`(() => { const c = document.getElementById('btn-community-invite-close').getBoundingClientRect();
          const m = document.querySelector('#modal-community-invite .modal').getBoundingClientRect(); return c.left < m.left + m.width / 2; })()`);
        check('ar: right-to-left, close button on the left', r.dir === 'rtl' && side);
      }
    }
    check('six different titles', new Set(Object.values(titles)).size === 6, titles);
    for (const [lang, w] of [['en', 390], ['ar', 390], ['fr', 320], ['sk', 1024]]) {
      await p.eval(`(setLang(${JSON.stringify(lang)}), true)`);
      await p.c.send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 2, mobile: w < 500 });
      await wait(300);
      const fits = await p.eval(`(() => { const m = document.querySelector('#modal-community-invite .modal').getBoundingClientRect();
        const bs = Array.from(document.querySelectorAll('#modal-community-invite button')).map((x) => x.getBoundingClientRect());
        return m.left >= 0 && m.right <= innerWidth && bs.every((r) => r.left >= m.left - 1 && r.right <= m.right + 1 && r.height >= 40); })()`);
      check(lang + ' @' + w + 'px: window and buttons fit, tap targets ≥ 40px', fits);
      const shot = await p.c.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SHOTS, 'invite-' + lang + '-' + w + '.png'), Buffer.from(shot.data, 'base64'));
    }
    await p.c.send('Emulation.clearDeviceMetricsOverride');
    await p.eval(`(setLang('en'), true)`);

    console.log('join');
    await p.eval(`(document.getElementById('btn-community-invite-join').click(), true)`);
    await wait(1500);
    const j = await p.eval(`({ hidden: document.getElementById('modal-community-invite').hidden, tab: activeTab, opt: state.settings.communityOptIn,
      form: !!document.getElementById('community-email') })`);
    check('Join closes the window, turns Community on and opens the sign-in form', j.hidden && j.tab === 'komunita' && j.opt === true && j.form, j);
    await p.eval(`(switchTab('dnes'), true)`);
    await setLast(p, Date.now() - 10 * DAY);
    await load(p);
    await afterDelay();
    check('members are never invited', !(await shown(p)) && (await p.eval('state.settings.communityOptIn')) === true);
    await p.eval(`(communityDisable(), true)`);
    await load(p);
    await afterDelay();
    check('turning Community off makes the invite due again (old record)', await shown(p));

    check('no exceptions', p.errors.length === 0, p.errors);
    check('no console errors (except the local stack)', errors.length === 0, errors);
  } finally {
    b.killHard(true);
    await server.close();
  }
  console.log('\n' + pass + '/' + (pass + fail) + ' passed; screenshots in ' + SHOTS);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
