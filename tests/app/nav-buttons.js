'use strict';
/* GymQuest Android — 3-button navigation: the tab bar is docked full-width on the system buttons.
   Headless Chrome + fake Capacitor (GymBars.navMode answers 'buttons' / 'gesture').

     GQ_TEST_PORT=8170 node tests/app/nav-buttons.js

   Checks: JS sets html.nav-buttons only for mode 'buttons' (startup, resume); the bar spans the viewport
   width and its bottom = viewport bottom (393 / 320 px, light / dark, ar); the update banner, finish bar and
   page content clear it; no horizontal overflow; touch targets >= 44 px; without the class the pill is unchanged.
   Screenshots go to SHOTS (default ../claude-code/phase8/task1). */
const fs = require('fs');
const path = require('path');
const { counter, startServerOnce, openApp, closeAll, fireNative } = require('../android/lib-native');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const t = counter();
const check = t.check;
const SHOTS = process.env.SHOTS || path.resolve(__dirname, '../../../claude-code/phase8/task1');

(async () => {
  const server = await startServerOnce(require('os').tmpdir());
  try {
    fs.mkdirSync(SHOTS, { recursive: true });
    const { p, errors } = await openApp({ name: 'navbtn', debugPort: 9936, native: true, returns: { 'GymBars.navMode': { mode: 'buttons' } } });
    await p.eval(`(localStorage.setItem('gymquest_tutorial','{"v":1,"status":"done","at":0}'), true)`);
    await wait(800);
    check('startup: mode buttons -> html.nav-buttons', await p.eval(`document.documentElement.classList.contains('nav-buttons')`));

    await p.eval(`(window.__nativeReturns['GymBars.navMode'] = { mode: 'gesture' }, true)`);
    await fireNative(p, 'App', 'resume', {});
    await wait(300);
    check('resume: mode gesture -> class removed', !(await p.eval(`document.documentElement.classList.contains('nav-buttons')`)));
    await p.eval(`(window.__nativeReturns['GymBars.navMode'] = { mode: 'buttons' }, true)`);
    await fireNative(p, 'App', 'resume', {});
    await wait(300);
    check('resume: mode buttons -> class set again', await p.eval(`document.documentElement.classList.contains('nav-buttons')`));

    const geo = () => p.eval(`(() => {
      const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, h: b.height, w: b.width, cs: getComputedStyle(e) }; };
      const bar = r('.tab-bar'); const tabs = [...document.querySelectorAll('.tab-bar .tab')].map((e) => e.getBoundingClientRect());
      const main = getComputedStyle(document.querySelector('.app-main'));
      const out = { vw: document.documentElement.clientWidth, vh: innerHeight, sw: document.documentElement.scrollWidth,
        bar: { l: bar.l, r: bar.r, t: bar.t, b: bar.b, h: bar.h, radius: bar.cs.borderTopLeftRadius, bg: bar.cs.backgroundColor, top: bar.cs.borderTopWidth },
        tabMin: Math.min(...tabs.map((x) => Math.min(x.width, x.height))), tabsInside: tabs.every((x) => x.left >= bar.l - 0.5 && x.right <= bar.r + 0.5),
        mainPad: parseFloat(main.paddingBottom) };
      return out; })()`);
    const stickyGeo = () => p.eval(`(() => {
      const ub = document.getElementById('update-banner') || document.querySelector('.update-banner');
      const fb = document.getElementById('finish-bar'); const tb = document.getElementById('timer-bar');
      const bar = document.querySelector('.tab-bar').getBoundingClientRect().top;
      const bot = (e) => { if (!e) return null; const was = e.hidden; e.hidden = false; const b = e.getBoundingClientRect().bottom; e.hidden = was; return b; };
      return { bar, ub: bot(ub), fb: bot(fb), tb: bot(tb) }; })()`);

    for (const lang of ['en', 'ar']) {
      await p.eval(`(setLang('${lang}'), true)`);
      for (const theme of ['light', 'dark']) {
        await p.eval(`(setThemePref('${theme}'), true)`);
        for (const w of [393, 320]) {
          await p.c.send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 2, mobile: true });
          await wait(250);
          const g = await geo();
          const tag = lang + '/' + theme + '/' + w;
          check(tag + ': bar spans the viewport width', Math.abs(g.bar.l) < 0.5 && Math.abs(g.bar.r - g.vw) < 0.5, g.bar);
          check(tag + ': bar bottom = viewport bottom', Math.abs(g.bar.b - g.vh) < 0.5, g.bar);
          check(tag + ': square corners, solid background, top border', g.bar.radius === '0px' && !/rgba\(.*, 0\)$/.test(g.bar.bg) && g.bar.top === '1px', g.bar);
          check(tag + ': tabs inside the bar, targets >= 44 px', g.tabsInside && g.tabMin >= 44, g.tabMin);
          check(tag + ': no horizontal overflow', g.sw <= g.vw, g);
          check(tag + ': page content clears the bar', g.mainPad >= g.bar.h, g.mainPad);
          const s = await stickyGeo();
          for (const k of ['ub', 'fb', 'tb']) if (s[k] !== null) check(tag + ': ' + k + ' sits above the bar', s[k] <= s.bar + 0.5, s);
          if (process.env.GQ_SCREENSHOTS !== '0' && (lang === 'en' || w === 393)) {
            const r = await p.c.send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(path.join(SHOTS, `docked-${lang}-${theme}-${w}.png`), Buffer.from(r.data, 'base64'));
          }
        }
      }
    }

    /* lišty (aktualizácia / záloha) nesmú zakryť posledný obsah v 3-tlačidlovom režime */
    await p.eval(`(window.__nativeReturns['GymBars.navMode'] = { mode: 'buttons' }, switchTab('trening'), true)`);
    await fireNative(p, 'App', 'resume', {});
    const lastClear = (id) => p.eval(`(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      const bn = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
      const main = document.querySelector('.app-main');
      let bottom = 0;
      for (const e of main.querySelectorAll('*')) {
        if (e.closest('.update-banner, .backup-banner')) continue;
        const cs = getComputedStyle(e); if (cs.position === 'fixed' || cs.position === 'sticky') continue;
        const r = e.getBoundingClientRect(); if (!r.height || !r.width || cs.visibility === 'hidden') continue;
        bottom = Math.max(bottom, r.bottom);
      }
      return JSON.stringify({ bottom, bannerTop: bn.top, bannerH: bn.height, pad: parseFloat(getComputedStyle(main).paddingBottom) }); })()`).then(JSON.parse);
    for (const w of [393, 320]) {
      await p.c.send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 2, mobile: true });
      await wait(250);
      /* bez lišty: posledný obsah je nad dockovaným barom */
      const barTop = await p.eval(`document.querySelector('.tab-bar').getBoundingClientRect().top`);
      await p.eval(`(window.scrollTo(0, document.documentElement.scrollHeight), true)`);
      const nb = await p.eval(`(() => { let b = 0; for (const e of document.querySelectorAll('.app-main *')) { const cs = getComputedStyle(e); if (cs.position === 'fixed' || cs.position === 'sticky') continue; const r = e.getBoundingClientRect(); if (r.height && r.width) b = Math.max(b, r.bottom); } return b; })()`);
      check(w + ': no banner: last content clears the docked bar', nb <= barTop + 0.5, { nb, barTop });
      await p.eval(`(document.getElementById('update-banner').hidden = false, document.body.classList.add('has-update-banner'), true)`);
      await wait(150);
      let c = await lastClear('update-banner');
      check(w + ': update banner: last content fully above the banner', c.bottom <= c.bannerTop + 0.5, c);
      await p.eval(`(document.getElementById('update-banner').hidden = true, document.body.classList.remove('has-update-banner'), showBackupStrip('due', 'gymquest-backup.json', false), true)`);
      await wait(150);
      c = await lastClear('backup-banner');
      check(w + ': backup banner: last content fully above the banner', c.bottom <= c.bannerTop + 0.5, c);
      await p.eval(`(hideBackupStrip(), true)`);
    }

    /* v relácii: posledný riadok série sa nezasunie pod lepivé lišty (--bar-bottom) */
    const cssPad = await p.eval(`(() => { const el = document.getElementById('screen-trening'); const cl = el.classList.contains('in-session'); el.classList.add('in-session'); document.documentElement.style.setProperty('--sticky-bottom', '200px'); const v = parseFloat(getComputedStyle(el).paddingBottom); const bb = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar-bottom')); document.documentElement.style.removeProperty('--sticky-bottom'); if (!cl) el.classList.remove('in-session'); return JSON.stringify({ v, bb }); })()`).then(JSON.parse);
    check('in-session padding subtracts --bar-bottom (72 px in 3-button mode): 200 - 72 - 2 = 126', Math.abs(cssPad.v - 126) < 0.5 && cssPad.bb === 72, cssPad);

    /* bez triedy sa nič nemení: plávajúca pilulka */
    await p.eval(`(window.__nativeReturns['GymBars.navMode'] = { mode: 'gesture' }, setLang('en'), true)`);
    await fireNative(p, 'App', 'resume', {});
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 800, deviceScaleFactor: 2, mobile: true });
    await wait(250);
    const g = await geo();
    check('without class: floating pill (not full width, gap below, rounded)', g.bar.r - g.bar.l < g.vw - 20 && g.vh - g.bar.b > 10 && g.bar.radius !== '0px', g.bar);

    /* web (bez natívneho Capacitoru) triedu nikdy nenastaví */
    const web = await openApp({ name: 'navweb', debugPort: 9937, native: false });
    await wait(500);
    check('web: no nav-buttons class', !(await web.p.eval(`document.documentElement.classList.contains('nav-buttons')`)));
    check('no page errors', errors.length === 0 && web.errors.length === 0, errors.concat(web.errors));
  } catch (e) { check('suite ran without exception', false, String(e && e.stack || e)); }
  finally { closeAll(); server.close && server.close(); }
  console.log('\nPASS ' + t.pass + '  FAIL ' + t.fail);
  process.exit(t.fail ? 1 : 0);
})();
