'use strict';
/* GymQuest — exercise demonstration videos stop when their window closes (bug fix v65).
   Real headless Chrome, no accounts.   node tests/app/media-close.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-media');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, info) => { if (ok) pass++; else fail++; console.log((ok ? '  PASS ' : '  FAIL ') + n + (!ok && info !== undefined ? '  -> ' + JSON.stringify(info) : '')); };

(async () => {
  const cfg = path.join(WORK, 'cfg.js'); fs.mkdirSync(WORK, { recursive: true });
  fs.writeFileSync(cfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = cfg;
  const server = await startServer(8124, { new: REPO });
  const b = new Browser('media-' + Date.now().toString(36), 9905, path.join(WORK, 'profiles'));
  const p = await b.launch();
  await p.c.send('Emulation.setAutoplayPolicy', { autoplayPolicy: 'no-user-gesture-required' }).catch(() => {});
  try {
    await p.navigate('http://localhost:8124/');
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); return true; })()`);
    await wait(3000);   // štart appky (načítanie vlastných médií) prekreslí okno cviku – počká sa naň
    const playing = () => p.eval(`Array.from(document.querySelectorAll('#modal-exercise video')).some((v) => !v.paused)`);
    const play = async () => {
      await p.eval(`(openLibrary(), openExerciseSheet('bench-press'), true)`);
      await wait(800);
      const ok = await p.eval(`(async () => { const v = document.querySelector('#modal-exercise video'); if (!v) return 'no video'; v.muted = false; v.volume = 1; try { await v.play(); } catch (e) { return 'play failed: ' + e; } return !v.paused; })()`);
      return ok;
    };
    let r = await play();
    check('the bench press video plays in the exercise window', r === true, r);
    await wait(400);
    check('the same video element is still playing before closing (no re-render)', (await playing()) === true);
    await p.eval(`(closeExerciseSheet(), true)`); await wait(200);
    check('closing the exercise window stops the video', (await playing()) === false);
    r = await play();
    await p.eval(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)`); await wait(200);
    check('closing with Esc stops it too', (await playing()) === false, r);
    r = await play();
    await p.eval(`(closeLibrary(), true)`); await wait(200);
    check('closing the whole library stops it', (await playing()) === false, r);
    r = await play();
    await p.eval(`(() => { const t = document.querySelector('#modal-exercise .media-track'); if (t) t.scrollLeft = t.clientWidth; return true; })()`); await wait(500);
    const slides = await p.eval(`document.querySelectorAll('#modal-exercise .media-track > *').length`);
    if (slides > 1) check('swiping to another slide stops the video', (await playing()) === false);
    else check('(one slide only: swipe not applicable)', true);
    check('no exceptions', p.errors.length === 0, p.errors);
  } catch (e) {
    check('test error', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  } finally { b.killHard(true); await server.close(); }
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
