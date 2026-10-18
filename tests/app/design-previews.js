'use strict';
/* GymQuest — design previews in Settings (v73), in real headless Chrome. No accounts (empty Community
   config).

     node tests/app/design-previews.js

   Checks: Settings → App design → Design previews lists the current GymQuest (in use) and the 11
   previews with thumbnails; each preview opens full screen inside the app (same page, iframe), its
   page loads with its own styles and scripts and no errors, exercise media paths resolve; "Back to
   the app" and Esc close it and stop the preview; previews never touch the app's data; 6 languages;
   RTL; 390 px. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser, waitFor } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-designs');
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}

(async () => {
  fs.mkdirSync(path.join(WORK, 'shots'), { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('designs-' + Date.now().toString(36), 9874, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon|fonts\.(googleapis|gstatic)\.com/.test((e.entry.url || '') + e.entry.text)) logs.push(e.entry.text + ' ' + (e.entry.url || '')); });
  const phone = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
  const shot = async (name) => { const s = await p.c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(WORK, 'shots', name + '.png'), Buffer.from(s.data, 'base64')); };
  try {
    await p.navigate(BASE);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); return true; })()`);
    await p.c.send('Emulation.setDeviceMetricsOverride', phone);
    await p.eval(`(() => { state.history.push({ id: 'keep-me', planId: 'push', planName: 'Push', date: todayISO(), xp: 20, note: '', exercises: [] }); saveState(); return true; })()`);
    const appBefore = await p.eval(`localStorage.getItem(STORAGE_KEY)`);

    console.log('== Settings entry and picker');
    await p.eval(`(openSettings(), true)`);
    await wait(300);
    check('Settings has "App design" with a "Design previews" button', await p.eval(`(() => { const b = document.getElementById('btn-design-previews'); return !!b && b.textContent === 'Design previews' && b.closest('.setting-block').innerText.includes('App design'); })()`));
    await p.eval(`(document.getElementById('btn-design-previews').click(), true)`);
    await wait(600);
    const items = await p.eval(`Array.from(document.querySelectorAll('#design-grid .design-item')).map((b) => ({ id: b.dataset.design, name: b.querySelector('.design-name').textContent, meta: b.querySelector('.design-meta').textContent }))`);
    check('the picker lists the current GymQuest first (in use) and the 24 previews', items.length === 25 && items[0].id === 'current' && items[0].meta.includes('In use')
      && J(items.slice(1).map((x) => x.name)) === J(['Periwinkle', 'Pastel Planner', 'Soft Rings', 'Violet Studio', 'Lilac Player', 'Clay', 'Bloom', 'Bento', 'Bento Trends', 'Bento Dashboard', 'Bento Mint', 'Bento Ocean Light', 'Bento Ocean Dark', 'Bento Sunset Light', 'Bento Sunset Dark', 'Bento Forest Light', 'Bento Forest Dark', 'Bento Berry Light', 'Bento Berry Dark', 'Bento Mono Light', 'Bento Mono Dark', 'Atlas', 'Isometric', 'Mint']), items);
    check('the 10 Bento colourways are labelled light / dark mode', items.filter((x) => /^Bento (Ocean|Sunset|Forest|Berry|Mono) (Light|Dark)$/.test(x.name)).every((x) => x.meta === 'Bento · ' + (/Light$/.test(x.name) ? 'light' : 'dark') + ' mode')
      && items.filter((x) => /^Bento (Ocean|Sunset|Forest|Berry|Mono) /.test(x.name)).length === 10, items);
    check('the three Bento + Mint variants are labelled "Bento + Mint"', items.filter((x) => /^Bento (Trends|Dashboard|Mint)$/.test(x.name)).every((x) => x.meta === 'Bento + Mint'), items);
    await waitFor(() => p.eval(`Array.from(document.querySelectorAll('#design-grid img.design-thumb')).every((i) => { i.loading = 'eager'; return i.complete && i.naturalWidth > 0; })`), 15000, 'thumbnails');
    check('all 24 thumbnails load', true);
    /* Výber je vyšší ako displej: musí sa dať posunúť prstom až k poslednému dizajnu a k Zavrieť. */
    const geo = () => p.eval(`(() => { const m = document.querySelector('#modal-designs .modal'), r = m.getBoundingClientRect();
      const last = Array.from(document.querySelectorAll('#design-grid .design-item')).pop().getBoundingClientRect();
      const close = document.getElementById('btn-designs-close').getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, scrollTop: Math.round(m.scrollTop), scrollable: m.scrollHeight > m.clientHeight + 1,
        lastBottom: Math.round(last.bottom), closeTop: Math.round(close.top), closeBottom: Math.round(close.bottom) }; })()`);
    let g = await geo();
    check('390 px: the picker window fits the screen and scrolls inside', g.top >= 0 && g.bottom <= g.vh && g.scrollable, g);
    check('…the Close button is always reachable (pinned at the bottom, on screen)', g.closeTop >= 0 && g.closeBottom <= g.vh, g);
    /* posun gestom (headless Chrome nevie syntetizovať dotykový posun; na telefóne posúva prst tú istú oblasť) */
    for (let k = 0, prevTop = -1; k < 30; k++) {   // až na koniec zoznamu, nech je akokoľvek dlhý
      await p.c.send('Input.synthesizeScrollGesture', { x: 195, y: 600, yDistance: -800, speed: 3000, gestureSourceType: 'mouse' });
      const top = await p.eval(`document.querySelector('#modal-designs .modal').scrollTop`);
      if (top === prevTop) break;
      prevTop = top;
    }
    await wait(400);
    g = await geo();
    check('scrolling moves the picker down to the last design (Mint)', g.scrollTop > 200 && g.lastBottom <= g.closeTop + 2 && g.lastBottom > g.top, g);
    check('the last design can be tapped after scrolling', await p.eval(`(() => { const el = document.querySelector('#design-grid [data-design="mint"]'), r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 40)); return !!hit && el.contains(hit); })()`));
    await shot('picker-390-scrolled');
    await p.eval(`(document.querySelector('#modal-designs .modal').scrollTop = 0, true)`);
    check('390 px: the picker has no horizontal overflow', await p.eval(`(() => { const m = document.querySelector('#modal-designs .modal'); return m.scrollWidth <= m.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1; })()`));
    await shot('picker-390');

    console.log('== every preview opens inside the app');
    for (const it of items.slice(1)) {
      await p.eval(`(document.querySelector('#design-grid [data-design="${it.id}"]').click(), true)`);
      await waitFor(() => p.eval(`(() => { const f = document.getElementById('design-view-frame'); const d = f.contentDocument; return !document.getElementById('design-view').hidden && !!d && d.readyState === 'complete' && /design-concepts\\/app\\//.test(f.contentWindow.location.pathname); })()`), 20000, 'preview ' + it.id);
      await wait(900);
      const r = await p.eval(`(() => { const f = document.getElementById('design-view-frame'), d = f.contentDocument;
        const css = Array.from(d.styleSheets).filter((s) => { try { return !!s.cssRules; } catch (e) { return false; } }).length;
        const imgs = Array.from(d.querySelectorAll('img')).filter((i) => /\\/media\\//.test(i.src));
        return { title: document.getElementById('design-view-title').textContent, top: d.title, css, bodyText: d.body.innerText.length,
          media: imgs.length, mediaBroken: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src).slice(0, 3),
          rect: f.getBoundingClientRect().height, bar: document.querySelector('.design-view-bar').getBoundingClientRect().height }; })()`);
      check(it.name + ': opens full screen with its own page, styles and content', r.title === 'Preview: ' + it.name && r.css >= 2 && r.bodyText > 50 && r.rect > 600, r);
      check(it.name + ': exercise images (if any) load', r.mediaBroken.length === 0, r);
      if (/^bento-(ocean|sunset|forest|berry|mono)-/.test(it.id)) {
        const lum = await p.eval(`(() => { const d = document.getElementById('design-view-frame').contentDocument; const c = getComputedStyle(d.getElementById('app')).backgroundColor.match(/\\d+/g).map(Number); return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; })()`);
        check(it.name + ': background matches its mode', /dark$/.test(it.id) ? lum < 0.15 : lum > 0.8, lum);
      }
      if (/^bento-(trends|dashboard|mint)$/.test(it.id)) {
        const ch = await p.eval(`(() => { const d = document.getElementById('design-view-frame').contentDocument; return { spark: d.querySelectorAll('svg.bm-spark polyline').length, area: d.querySelectorAll('svg.bm-area polyline').length, bars: d.querySelectorAll('svg.bm-bars rect').length, donut: d.querySelectorAll('svg.bm-donut').length }; })()`);
        check(it.name + ': shows Mint charts in its Bento tiles', ch.spark + ch.area + ch.bars + ch.donut >= 4, ch);
        if (it.id === 'bento-dashboard') {
          await p.eval(`(document.getElementById('design-view-frame').contentDocument.querySelector('[data-do="metric"][data-arg="xp"]').click(), true)`);
          await wait(400);
          check('Bento Dashboard: the big chart switches to XP', (await p.eval(`document.getElementById('design-view-frame').contentDocument.querySelector('.hero .l').textContent`)) === 'Last 8 weeks · XP');
        }
      }
      if (['periwinkle', 'clay', 'mint', 'bento-trends', 'bento-dashboard', 'bento-mint'].includes(it.id)) await shot('preview-' + it.id);
      await p.eval(`(document.getElementById('btn-design-view-close').click(), true)`);
      await wait(200);
      check(it.name + ': "Back to the app" closes it and stops the preview', await p.eval(`document.getElementById('design-view').hidden && document.getElementById('design-view-frame').getAttribute('src') === 'about:blank' && !document.documentElement.classList.contains('design-view-open')`));
    }
    await p.eval(`(document.querySelector('#design-grid [data-design="bento"]').click(), true)`);
    await wait(800);
    await p.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await wait(200);
    check('Esc closes a preview (the picker stays open)', await p.eval(`document.getElementById('design-view').hidden && !document.getElementById('modal-designs').hidden`));
    await p.eval(`(document.querySelector('#design-grid [data-design="current"]').click(), true)`);
    check('"Current GymQuest" closes the picker (nothing changes)', await p.eval(`document.getElementById('modal-designs').hidden`));
    check('the app\'s own data is untouched by the previews', (await p.eval(`localStorage.getItem(STORAGE_KEY)`)) === appBefore && await p.eval(`state.history.some((w) => w.id === 'keep-me')`));
    /* ukážky ukladajú vzorové dáta len pri zmene – overí sa, že jediný kľúč, ktorý môžu použiť, nie je kľúč appky */
    const keys = require('child_process').execSync("grep -rhoE \"localStorage\\.(get|set|remove)Item\\([^)]*\\)|const KEY = '[^']+'\" " + path.join(REPO, 'design-concepts', 'app')).toString().trim().split('\n');
    check('previews use only their own storage key (gymquest-concepts-r2), never the app\'s', keys.includes("const KEY = 'gymquest-concepts-r2'") && keys.every((k) => /KEY/.test(k)), keys);

    console.log('== languages');
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await p.eval(`(setLang(${J(lang)}), openSettings(), openDesignPicker(), true)`);
      await wait(200);
      const tx = await p.eval(`({ s: document.getElementById('btn-design-previews').closest('.setting-block').innerText, m: document.getElementById('modal-designs').innerText, dir: document.documentElement.dir, open: t('designs.open') })`);
      check(lang + ': Settings entry and picker translated', !/designs\./.test(tx.s + tx.m) && tx.s.includes(tx.open), tx);
      if (lang === 'ar') { check('ar: right-to-left', tx.dir === 'rtl'); await shot('picker-ar'); }
      await p.eval(`(closeDesignPicker(), true)`);
    }
    await p.eval(`(setLang('en'), true)`);

    check('no exceptions (app and previews)', p.errors.length === 0, p.errors);
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
