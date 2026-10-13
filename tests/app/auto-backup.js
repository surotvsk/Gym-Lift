'use strict';
/* GymQuest — automatic backup without a switch (v64), in real headless Chrome against the LOCAL stack.
   It is always on while the device does not sync to an account (guest, or sync turned off) and
   off while account sync protects the data.

     GQ_COMMUNITY_CONFIG=<local config> GQ_CREDS_DIR=<dir with cred-a.json> node tests/app/auto-backup.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser, waitFor } = require('../sync/lib');
const HELPERS = require('../sync/helpers');

const REPO = path.resolve(__dirname, '..', '..');
const BASE = 'http://localhost:8124/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-backup');
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}
/* 5 hotových tréningov a posledná ponuka pred 8 dňami → záloha je "na rade", ak je aktívna. */
const makeDue = `(() => { for (let i = 0; i < 5; i++) window.__gq.addWorkout('ab' + i + Date.now(), todayISO());
  state.settings.autoBackupOfferedAt = Date.now() - 8 * 86400000; state.settings.autoBackupWorkoutCount = 0; saveState(); hideBackupStrip(); backupDismissed = false; return true; })()`;
const settingsState = (p) => p.eval(`(() => { openSettings(); const r = { text: document.getElementById('auto-backup-state').textContent,
  hint: document.querySelector('[data-i18n="settings.autoBackupHint"]').textContent, switchGone: !document.getElementById('btn-auto-backup'),
  saveNow: !!document.getElementById('btn-backup-now') }; document.getElementById('modal-settings').hidden = true; refreshUpdateBanner(); return r; })()`);

(async () => {
  if (!process.env.GQ_COMMUNITY_CONFIG || !process.env.GQ_CREDS_DIR) throw new Error('GQ_COMMUNITY_CONFIG and GQ_CREDS_DIR required');
  const cred = JSON.parse(fs.readFileSync(path.join(process.env.GQ_CREDS_DIR, 'cred-a.json'), 'utf8'));
  const server = await startServer(8124, { new: REPO });
  const b = new Browser('backup-' + Date.now().toString(36), 9871 + 30, path.join(WORK, 'profiles'));
  let p = await b.launch();
  let b2 = null;
  const warns = [];
  p.c.on('Runtime.consoleAPICalled', (e) => { if (e.type === 'warning' || e.type === 'error') warns.push((e.args || []).map((a) => a.value).join(' ')); });
  try {
    await p.navigate(BASE);
    await p.eval(HELPERS);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);

    console.log('== guest (no account sync)');
    let st = await settingsState(p);
    check('Settings: no on/off switch any more', st.switchGone, st);
    check('Settings: status "On" and the new explanation', st.text === 'On' && /not syncing to an account/.test(st.hint), st);
    check('Save backup now is still there', st.saveNow);
    check('automatic backup is active for a guest', await p.eval('autoBackupActive()'));
    await p.eval(makeDue);
    check('a due backup is detected', await p.eval('backupDue()'));
    await p.eval('(refreshBackupOffer(), true)');
    await wait(300);
    check('the backup is made / offered (strip shown, offer recorded)', await p.eval(`!document.getElementById('backup-banner').hidden && Date.now() - state.settings.autoBackupOfferedAt < 60000`));
    check('not again right away (once per 7 days)', await p.eval(`(hideBackupStrip(), refreshBackupOffer(), document.getElementById('backup-banner').hidden)`));

    console.log('== signed in with account sync');
    /* Nový prehliadač bez hosťovských údajov (inak sa appka pri prihlásení pýta, či ich pripojiť k účtu). */
    b.killHard(true);
    b2 = new Browser('backup2-' + Date.now().toString(36), 9871 + 31, path.join(WORK, 'profiles'));
    p = await b2.launch();
    p.c.on('Runtime.consoleAPICalled', (e) => { if (e.type === 'warning' || e.type === 'error') warns.push((e.args || []).map((a) => a.value).join(' ')); });
    await p.navigate(BASE);
    await p.eval(HELPERS);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); return true; })()`);
    await p.eval('window.__gq.signIn(' + J(cred.email) + ',' + J(cred.password) + ')');
    await p.ready();
    await p.eval(HELPERS);
    await waitFor(() => p.eval('!!(wsSlot && wsSlot.owner)'), 30000, 'account workspace');
    await p.eval(`(setLang('en'), true)`);
    st = await settingsState(p);
    check('Settings says it is not needed (sync protects the data)', st.text === 'Not needed – your data syncs to your account' && st.switchGone, st);
    check('automatic backup is not active while syncing', (await p.eval('autoBackupActive()')) === false);
    await p.eval(makeDue);
    check('no backup file even when 5 workouts and 7 days have passed', (await p.eval('backupDue()')) === false
      && await p.eval(`(refreshBackupOffer(), document.getElementById('backup-banner').hidden)`));
    check('Save backup now still works manually', await p.eval(`typeof saveBackupNow === 'function' && !!document.getElementById('btn-backup-now')`));

    console.log('== signed in, account sync turned off');
    await p.eval(`(syncMetaUpdate((x) => { x.disabled = true; }), true)`);
    check('with sync off, automatic backup is active again', await p.eval('autoBackupActive()'));
    st = await settingsState(p);
    check('Settings shows "On" again', st.text === 'On', st);
    await p.eval(makeDue);
    check('a due backup is offered again', await p.eval(`(refreshBackupOffer(), !document.getElementById('backup-banner').hidden)`));
    await p.eval(`(syncMetaUpdate((x) => { x.disabled = false; }), hideBackupStrip(), true)`);

    console.log('== languages');
    for (const lang of ['sk', 'es', 'pt-BR', 'fr', 'ar']) {
      await p.eval(`(setLang(${J(lang)}), true)`);
      st = await settingsState(p);
      check(lang + ': status and explanation translated', st.text === (await p.eval(`t('backup.coveredBySync')`)) && st.hint === (await p.eval(`t('settings.autoBackupHint')`)) && !/backup\.|settings\./.test(st.text + st.hint), st);
    }
    check('no "missing element" warning for the removed switch', !warns.some((w) => /btn-auto-backup/.test(w)), warns);
    check('no exceptions', p.errors.length === 0, p.errors);
  } catch (e) {
    check('test error', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  } finally {
    b.killHard(true);
    if (b2) b2.killHard(true);
    await server.close();
  }
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
