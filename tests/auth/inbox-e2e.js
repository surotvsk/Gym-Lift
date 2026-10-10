/* GymQuest account emails — end-to-end check with a REAL, user-authorized inbox (manual, step by step).
   The emails are triggered through the normal GymQuest UI (headless Chrome); a person checks the inbox
   (and spam) and clicks the links in their own browser. This script never generates or prints links.

   Env: GQ_INBOX_EMAIL  the one authorized test address (must be approved by the project owner)
        GQ_CREDS_DIR    where cred-inbox.json (password) is kept — outside git
        GQ_GENLINK      helper command that prints the address's non-secret Auth timestamps (-InboxStatus)
        GQ_PROTECTED_IDS accounts that must never be touched
        GQ_BASE         app URL (default http://localhost:8124/, must be in the Auth redirect allow list)
   Steps (run in order, waiting for the human between them):
     serve            keep the local app running on :8124 while links are clicked
     signup           new account through the sign-up form            -> person checks inbox + spam
     resend           "Resend confirmation email" (after the 60 s cooldown) -> person checks, clicks links
     verify-confirmed account confirmed; normal sign-in works
     reset            "Forgot password" -> send reset link; writes the new password to type -> person clicks
     verify-reset     old password refused, new one works; normal sign-in works
     status           print non-secret timestamps */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { startServer, Browser, readPublicConfig, waitFor } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = process.env.GQ_BASE || 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-auth-work');
const EMAIL = process.env.GQ_INBOX_EMAIL;
const CREDS = process.env.GQ_CREDS_DIR && path.join(process.env.GQ_CREDS_DIR, 'cred-inbox.json');
const PROTECTED = String(process.env.GQ_PROTECTED_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
let failures = 0;
function check(name, cond, detail) {
  if (!cond) failures++;
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (cond || detail === undefined ? '' : '  -> ' + String(JSON.stringify(detail)).slice(0, 400)));
  return !!cond;
}
/* GQ_GENLINK: a PowerShell script (Windows) or a Node script (*.js, e.g. for a local test stack). */
function genlinkExec(cmd, args, opts) {
  return /\.c?js$/i.test(cmd)
    ? execFileSync(process.execPath, [cmd].concat(args), opts)
    : execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cmd].concat(args), opts);
}
function status() {
  const out = genlinkExec(process.env.GQ_GENLINK, ['-InboxStatus', EMAIL], { encoding: 'utf8' });
  const s = JSON.parse(out.trim().split(/\r?\n/).pop());
  if (s.exists && PROTECTED.includes(s.id)) throw new Error('refusing protected account');
  return s;
}
const readCreds = () => JSON.parse(fs.readFileSync(CREDS, 'utf8'));
const writeCreds = (c) => fs.writeFileSync(CREDS, JSON.stringify(c));
function typablePassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  return 'Gqtest-' + Array.from(crypto.randomBytes(8), (b) => abc[b % abc.length]).join('');
}
async function passwordLogin(cfg, email, password) {
  const r = await fetch(cfg.url + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: cfg.anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json().catch(() => ({}));
  return j.user ? j.user.id : null;
}
const show = (s) => console.log('  status: ' + JSON.stringify({ created: s.created_at, confirmation_sent: s.confirmation_sent_at, confirmed: s.email_confirmed_at, recovery_sent: s.recovery_sent_at, last_sign_in: s.last_sign_in_at }));

let browser = null;
async function page() {
  fs.mkdirSync(path.join(WORK, 'profiles'), { recursive: true });
  browser = new Browser('inbox-' + Date.now().toString(36), 9690, path.join(WORK, 'profiles'));
  const p = await browser.launch();
  await p.navigate(BASE);
  await p.eval(`(document.getElementById('modal-setup').hidden = true, true)`);
  await p.eval(`(async () => { state.settings.communityOptIn = true; persistState(); communityOpen();
    for (let i = 0; i < 200 && !document.getElementById('community-email'); i++) await new Promise((r) => setTimeout(r, 50)); return true; })()`);
  return p;
}
const fill = (p, email, password) => p.eval(`(() => { document.getElementById('community-email').value = ${JSON.stringify(email)}; document.getElementById('community-password').value = ${JSON.stringify(password)}; return true; })()`);
const communityMsg = (p) => p.eval(`(document.getElementById('community-status') || {}).textContent || ''`);
const T = (p, key) => p.eval(`t(${JSON.stringify(key)})`);
const click = (p, sel) => p.eval(`(document.querySelector(${JSON.stringify(sel)}).click(), true)`);

const steps = {
  async serve() {
    await startServer(PORT, { new: REPO });
    console.log('serving ' + REPO + ' on ' + BASE + ' (Ctrl+C to stop)');
    await new Promise(() => {});
  },
  async status() { show(status()); },
  async signup() {
    const before = status();
    if (!check('address has no account yet (a genuinely new signup)', !before.exists)) return;
    const creds = { email: EMAIL, password: typablePassword(), id: null };
    writeCreds(creds);
    const p = await page();
    await fill(p, EMAIL, creds.password);
    const at = new Date().toISOString();
    await click(p, '[data-community-action="signup"]');
    await waitFor(() => communityMsg(p).then((m) => m.length > 0), 30000, 'signup message');
    const m = await communityMsg(p);
    check('UI shows the neutral "confirmation link is on its way / check spam" message', m === (await T(p, 'auth.signUpRequested')), m);
    check('no session before confirmation', await p.eval('syncSessionUser().then((u) => u === null)'));
    check('email kept in the form for a resend', (await p.eval(`document.getElementById('community-email').value`)) === EMAIL);
    const btn = await p.eval(`(() => { const b = document.querySelector('[data-community-action="resend-confirm"]'); return { disabled: b.disabled, text: b.textContent }; })()`);
    check('"Resend confirmation email" button present and cooling down', btn.disabled && /\d/.test(btn.text), btn);
    const after = status();
    creds.id = after.id || null;
    writeCreds(creds);
    check('request accepted: account created, unconfirmed, confirmation_sent_at set', after.exists && !after.email_confirmed_at && !!after.confirmation_sent_at, after);
    console.log('  signup requested at ' + at); show(after);
  },
  async resend() {
    const s = status();
    if (!check('account exists and is still unconfirmed', s.exists && !s.email_confirmed_at, s)) return;
    const wait = 61 - (Date.now() - Date.parse(s.confirmation_sent_at)) / 1000;
    if (wait > 0) { console.log('  cooldown: wait ' + Math.ceil(wait) + ' s and run again'); failures++; return; }
    const p = await page();
    await fill(p, EMAIL, '');
    const at = new Date().toISOString();
    await click(p, '[data-community-action="resend-confirm"]');
    await waitFor(() => communityMsg(p).then((m) => m.length > 0), 30000, 'resend message');
    const m = await communityMsg(p);
    check('UI shows the neutral "new confirmation link sent if unconfirmed account exists" message', m === (await T(p, 'auth.resendRequested')), m);
    const after = status();
    check('request accepted: confirmation_sent_at advanced, still unconfirmed', Date.parse(after.confirmation_sent_at) > Date.parse(s.confirmation_sent_at) && !after.email_confirmed_at, after);
    console.log('  resend requested at ' + at); show(after);
  },
  async 'verify-confirmed'() {
    const cfg = readPublicConfig(REPO);
    const c = readCreds();
    const s = status();
    check('account is confirmed (email_confirmed_at set)', !!s.email_confirmed_at, s);
    check('confirmed after the resend (link from the newest email)', !!s.email_confirmed_at && Date.parse(s.email_confirmed_at) >= Date.parse(s.confirmation_sent_at), s);
    check('password sign-in returns the intended account', (await passwordLogin(cfg, c.email, c.password)) === c.id);
    const p = await page();
    await fill(p, c.email, c.password);
    try { await p.eval(`communitySignIn().then(() => true)`); } catch (e) { /* workspace switch reload */ }
    await p.ready();
    check('normal GymQuest sign-in works and binds the account workspace', (await p.eval(`syncSessionUser().then((u) => u && u.id)`)) === c.id && (await p.eval('wsSlot.owner')) === c.id);
    show(s);
  },
  async reset() {
    const c = readCreds();
    const s = status();
    if (!check('account exists', s.exists)) return;
    const p = await page();
    await fill(p, EMAIL, '');
    await click(p, '[data-community-action="forgot"]');
    await waitFor(() => p.eval(`!!document.getElementById('auth-email') && document.getElementById('auth-email').value === ${JSON.stringify(EMAIL)}`), 15000, 'reset form prefilled');
    const at = new Date().toISOString();
    await click(p, '[data-auth-action="send-reset"]');
    await waitFor(() => p.eval(`authCallbackState.view === 'sent' || !(document.getElementById('auth-status') || {}).hidden`), 30000, 'reset response');
    check('UI shows the neutral "reset link on its way / check spam" view', await p.eval(`authCallbackState.view === 'sent'`), await p.eval('authCallbackState'));
    const after = status();
    check('request accepted: recovery_sent_at set/advanced', !!after.recovery_sent_at && (!s.recovery_sent_at || Date.parse(after.recovery_sent_at) > Date.parse(s.recovery_sent_at)), after);
    c.newPassword = typablePassword();
    writeCreds(c);
    fs.writeFileSync(path.join(process.env.GQ_CREDS_DIR, 'NEW-PASSWORD-to-type.txt'), c.newPassword + '\r\n');
    console.log('  reset requested at ' + at); show(after);
  },
  async 'verify-reset'() {
    const cfg = readPublicConfig(REPO);
    const c = readCreds();
    if (!c.newPassword) throw new Error('run reset first');
    const s = status();
    const oldOk = (await passwordLogin(cfg, c.email, c.password)) === c.id;
    const newOk = (await passwordLogin(cfg, c.email, c.newPassword)) === c.id;
    check('new password signs in, old one no longer does', newOk && !oldOk, { newOk, oldOk });
    if (newOk) { c.password = c.newPassword; delete c.newPassword; writeCreds(c); fs.rmSync(path.join(process.env.GQ_CREDS_DIR, 'NEW-PASSWORD-to-type.txt'), { force: true }); }
    const p = await page();
    await fill(p, c.email, c.password);
    try { await p.eval(`communitySignIn().then(() => true)`); } catch (e) { /* workspace switch reload */ }
    await p.ready();
    check('normal GymQuest sign-in with the new password', (await p.eval(`syncSessionUser().then((u) => u && u.id)`)) === c.id);
    show(s);
  },
};

(async () => {
  const step = process.argv[2];
  if (!steps[step]) throw new Error('step: ' + Object.keys(steps).join(' | '));
  if (!EMAIL || !CREDS || !process.env.GQ_GENLINK) throw new Error('GQ_INBOX_EMAIL, GQ_CREDS_DIR and GQ_GENLINK are required');
  let server = null;
  if (step !== 'serve' && step !== 'status' && !process.env.GQ_BASE && !process.env.GQ_SERVER_RUNNING) server = await startServer(PORT, { new: REPO });
  try { await steps[step](); } catch (e) { failures++; console.log('  ERROR ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
  if (browser) { try { await browser.closeGraceful(); } catch (e) { browser.killHard(true); } }
  if (server) await server.close();
  console.log(failures ? '==== ' + failures + ' problem(s)' : '==== ok');
  process.exit(failures ? 1 : 0);
})();
