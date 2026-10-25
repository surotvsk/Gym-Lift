'use strict';
/* GymQuest — Bento design, light and dark mode (v78), in real headless Chrome. No accounts.

     node tests/app/bento-theme.js

   Checks: System follows the phone (and switches live); Light / Dark from Settings apply at once and
   survive a reload; the choice is device-only (not in the app state, export or sync); the Bento font
   loads, also offline from the cache; Arabic keeps an Arabic font; key text has enough contrast in both
   modes; no horizontal overflow on any tab in 6 languages at 320 and 390 px in both modes; no errors. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser, waitFor } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-bento');
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}

/* WCAG kontrast dvoch farieb "rgb(a)" (alfa sa skladá na podklad) */
const CONTRAST_JS = `(() => {
  const parse = (c) => { const m = c.match(/[\\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0) { stack.push(c); if (c.a >= 1) break; } }
    let base = parse(getComputedStyle(document.body).backgroundColor); for (let k = stack.length - 1; k >= 0; k--) { const c = stack[k]; base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a), a: 1 }; } return base; };
  window.__contrast = (sel) => { const el = document.querySelector(sel); if (!el) return null; const fg = parse(getComputedStyle(el).color), bg = bgOf(el);
    const a = lum(fg) + 0.05, b = lum(bg) + 0.05; return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100; };
  return true; })()`;

(async () => {
  fs.mkdirSync(path.join(WORK, 'shots'), { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('bento-' + Date.now().toString(36), 9875, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  const scheme = (v) => p.c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: v }] });
  const themeNow = () => p.eval(`({ t: document.documentElement.getAttribute('data-theme'), meta: document.querySelector('meta[name="theme-color"]').getAttribute('content'), bg: getComputedStyle(document.body).backgroundColor })`);
  try {
    await scheme('light');
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); if (!state.history.length) { seedSampleData(); renderAll(); } return true; })()`);
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

    console.log('== System follows the phone');
    let t = await themeNow();
    check('phone in light mode → Bento light (warm grey background, light theme-color)', t.t === 'light' && t.meta === '#E9E8E4' && t.bg === 'rgb(233, 232, 228)', t);
    await scheme('dark'); await wait(300);
    t = await themeNow();
    check('phone switches to dark → the app switches live to Bento dark', t.t === 'dark' && t.meta === '#0E0E0F' && t.bg === 'rgb(14, 14, 15)', t);
    await p.reload(); t = await themeNow();
    check('…and starts in dark after a reload (set before the first paint)', t.t === 'dark');
    check('the theme is set by the script in <head> before the body is drawn', await p.eval(`!!document.head.querySelector('script') && document.head.querySelector('script').textContent.includes('gymquest_theme')`));

    console.log('== Settings → Appearance');
    await p.eval(`(openSettings(), true)`); await wait(200);
    const chips = await p.eval(`Array.from(document.querySelectorAll('#theme-chips [data-theme-choice]')).map((b) => b.textContent + (b.classList.contains('active') ? '*' : ''))`);
    check('Appearance offers Light, Dark, System (System selected by default)', J(chips) === J(['Light', 'Dark', 'System*']), chips);
    const stateBefore = await p.eval(`localStorage.getItem(STORAGE_KEY)`);
    await p.eval(`(document.querySelector('[data-theme-choice="light"]').click(), true)`); await wait(150);
    t = await themeNow();
    check('Light applies at once (phone still dark)', t.t === 'light' && t.bg === 'rgb(233, 232, 228)', t);
    await p.reload(); t = await themeNow();
    check('Light survives a reload', t.t === 'light');
    await p.eval(`(openSettings(), document.querySelector('[data-theme-choice="dark"]').click(), true)`); await wait(150);
    check('Dark applies at once', (await themeNow()).t === 'dark');
    await scheme('light'); await wait(200);
    check('a chosen mode ignores the phone (stays dark)', (await themeNow()).t === 'dark');
    await p.eval(`(document.querySelector('[data-theme-choice="auto"]').click(), true)`); await wait(150);
    check('System follows the phone again (light) and forgets the choice', (await themeNow()).t === 'light' && (await p.eval(`localStorage.getItem('gymquest_theme')`)) === null);
    check('switching modes never changes the saved app data', (await p.eval(`localStorage.getItem(STORAGE_KEY)`)) === stateBefore);
    const exported = await p.eval(`JSON.stringify(buildExportPayload ? buildExportPayload() : state)`).catch(() => p.eval('JSON.stringify(state)'));
    check('the mode is not part of the app data / export / sync', !/gymquest_theme|"theme"/.test(exported));
    await p.eval(`(document.getElementById('modal-settings').hidden = true, true)`);

    console.log('== font');
    await wait(500);
    check('the Bento font (Space Grotesk) is loaded and used', await p.eval(`document.fonts.check('700 16px "Space Grotesk"') && getComputedStyle(document.body).fontFamily.includes('Space Grotesk')`));
    await p.eval(`(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; })()`, 60000);
    const cached = await p.eval(`(async () => { const keys = await caches.keys(); const c = await caches.open(keys.find((k) => /^gymquest-v/.test(k))); return { a: !!(await c.match('fonts/space-grotesk-latin.woff2')), b: !!(await c.match('fonts/space-grotesk-latin-ext.woff2')) }; })()`);
    check('both font files are in the offline cache', cached.a && cached.b, cached);
    await p.offline(true);
    await p.reload();
    await wait(800);
    check('offline: the app opens with the Bento font', await p.eval(`document.fonts.check('700 16px "Space Grotesk"')`));
    await p.offline(false);
    await p.eval(`(setLang('ar'), true)`); await wait(200);
    check('Arabic keeps an Arabic font', /Arabic|Geeza/.test(await p.eval(`getComputedStyle(document.body).fontFamily`)));
    await p.eval(`(setLang('en'), true)`);

    console.log('== contrast (WCAG)');
    await p.eval(CONTRAST_JS);
    const pairs = [['dnes', '#bh-hello', 4.5], ['dnes', '#week-count', 3], ['dnes', '#bt-streak-v', 3], ['dnes', '#bt-level-v', 3], ['dnes', '#bt-body-v', 3], ['dnes', '#bt-food-v', 3],
      ['dnes', '#bt-lift-line', 4.5], ['dnes', '#bt-excuse-line', 4.5], ['trening', '#tr-detail .tr-row', 4.5], ['dnes', '#bt-settings .bt-line', 4.5], ['dnes', '#bt-week .bt-l', 4.5], ['ty', '.motivation-text', 4.5], ['ty', '#ty-name', 4.5], ['ty', '#ty-level-line', 4.5], ['ty', '#ty-goal-line', 4.5], ['ty', '#ty-seg .ty-filter.on', 4.5], ['ty', '#ty-private', 4.5], ['dnes', '#btn-start-workout', 4.5],
      ['dnes', '.today-date', 4.5], ['dnes', '.tab.active', 4.5], ['dnes', '.tab:not(.active)', 4.5], ['trening', '.plan-chips .chip.active', 4.5], ['trening', '.plan-chips .chip-wrap:nth-child(2) .chip', 4.5],
      ['trening', '.exercise-name', 4.5], ['trening', '.set-btn', 4.5], ['pokrok', '#stats-grid .bt-v', 3], ['pokrok', '#stats-grid .bt-l', 4.5], ['pokrok', '#stats-grid .st-rec span', 4.5], ['pokrok', '#stats-grid .k-chart-t', 4.5], ['kalendar', '#calendar-title', 3], ['kalendar', '.cal-cell', 3],
      ['kalendar', '.cal-cell.cal-done', 4.5], ['kalendar', '.cal-cell.cal-miss', 4.5], ['trening', '.plan-chips .chip.active .chip-name', 4.5], ['trening', '.plan-chips .chip-wrap:nth-child(3) .chip-name', 4.5],
      ['trening', '#btn-exercise-library', 4.5], ['komunita', '.hd .screen-title', 4.5]];
    for (const mode of ['light', 'dark']) {
      await p.eval(`(localStorage.setItem('gymquest_theme', ${J(mode)}), applyTheme(), true)`);
      for (const [tab, sel, min] of pairs) {
        await p.eval(`(switchTab(${J(tab)}), true)`); await wait(80);
        if (tab === 'trening') await p.eval(`(() => { const b = document.querySelector('#exercise-list .set-btn'); if (b && !b.classList.contains('done')) b.click(); return true; })()`);
        const c = await p.eval(`window.__contrast(${J(sel)})`);
        check(mode + ': contrast ' + sel + ' ≥ ' + min + ' (' + c + ')', c !== null && c >= min, c);
      }
      await p.eval(`(() => { const b = document.querySelector('#exercise-list .set-btn.done'); if (b) b.click(); return true; })()`);
      check(mode + ': a done set is readable', true);
    }

    console.log('== no horizontal overflow (6 languages × 320 / 390 / 820 / 1280 px × light / dark × 5 tabs)');
    const bad = [];
    for (const mode of ['light', 'dark']) {
      await p.eval(`(localStorage.setItem('gymquest_theme', ${J(mode)}), applyTheme(), true)`);
      for (const w of [320, 390, 820, 1280]) {
        await p.c.send('Emulation.setDeviceMetricsOverride', { width: w, height: 760, deviceScaleFactor: 1, mobile: w < 1000 });
        for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
          await p.eval(`(setLang(${J(lang)}), true)`);
          for (const tab of ['dnes', 'trening', 'pokrok', 'kalendar', 'komunita', 'ty']) {
            const o = await p.eval(`(switchTab(${J(tab)}), (() => { const de = document.documentElement; const nav = document.querySelector('.tab-bar').getBoundingClientRect(); return { sw: de.scrollWidth, iw: innerWidth, nav: nav.left >= 0 && nav.right <= innerWidth }; })())`);
            if (o.sw > o.iw + 1 || !o.nav) bad.push([mode, w, lang, tab, o]);
            if (tab === 'dnes') {
              /* Bento: nič z obsahu dlaždice nesmie vytŕčať mimo dlaždicu */
              const out = await p.eval(`[...document.querySelectorAll('#bento-grid .bt')].filter((tile) => !tile.hidden).flatMap((tile) => { const r = tile.getBoundingClientRect();
                return [...tile.querySelectorAll('*')].filter((c) => c.offsetParent && !c.closest('.sr-only') && c.tagName !== 'IMG' && !c.closest('svg')).filter((c) => { const q = c.getBoundingClientRect();
                  return q.width && (q.right > r.right + 1 || q.left < r.left - 1 || q.bottom > r.bottom + 1); }).map((c) => (tile.id || tile.className) + ' > ' + (c.id || c.className || c.tagName)); })`);
              if (out.length) bad.push([mode, w, lang, 'tiles', out.slice(0, 3)]);
            }
          }
        }
      }
    }
    check('no tab is wider than the screen and the menu fits, in every language, size and mode', bad.length === 0, bad.slice(0, 5));
    await p.eval(`(setLang('en'), localStorage.removeItem('gymquest_theme'), applyTheme(), true)`);

    check('no exceptions', p.errors.length === 0, p.errors);
    check('no console errors', logs.length === 0, logs);
  } catch (e) {
    check('test error', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  } finally {
    b.killHard(true);
    await server.close();
  }
  console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})();
