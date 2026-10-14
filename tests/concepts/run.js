/* GymQuest r2 design concepts: every design must really work. Real headless Chrome, no network
   outside 127.0.0.1, no accounts. For each design it checks:
     - no exceptions or console errors on load and while clicking through every tab,
     - every feature is reachable from the design's own screens (data-open / data-do entry points),
     - a full workout works through the design's own buttons: start, log sets, finish → history +1,
     - every shared flow (plan editor, library, rest timer, calendar, body, food, chat, settings …) opens and renders,
   and saves a thumbnail of the first screen to design-concepts/r2/thumbs/.
   Usage:  node tests/concepts/run.js            # all designs
           node tests/concepts/run.js "^0[1-5]"  # regex filter on file names */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser, waitFor } = require('../sync/lib');

const REPO = path.resolve(__dirname, '..', '..');
const DIR = path.join(REPO, 'design-concepts', 'r2');
const THUMBS = path.join(DIR, 'thumbs');
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-concepts-work');
const PORT = 8131;
const BASE = 'http://localhost:' + PORT + '/design-concepts/r2/';
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NEED_OPEN = ['plans', 'library', 'rest', 'calendar', 'history', 'records', 'achievements', 'body', 'food', 'photos', 'activity', 'chats', 'friends', 'leaderboard', 'post', 'profile', 'settings'];
const NEED_DO = ['start', 'finish', 'select', 'excuse'];
const FLOWS = ['plans', 'newplan', 'editplan', 'fullbody', 'library', 'equipment', 'rest', 'calendar', 'history', 'records', 'achievements', 'body', 'bodyentry', 'food', 'foodentry', 'photos', 'activity', 'chats', 'chat', 'friends', 'leaderboard', 'post', 'profile', 'settings', 'menu', 'exercise:bench-press'];

(async () => {
  fs.mkdirSync(THUMBS, { recursive: true });
  const files = fs.readdirSync(DIR).filter((f) => /^\d\d-.*\.html$/.test(f) && (!filter || filter.test(f))).sort();
  const srv = await startServer(PORT, { new: REPO });
  const b = new Browser('concepts-' + Date.now().toString(36), 9851, path.join(WORK, 'profiles'));
  const p = await b.launch();
  await p.c.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  /* every innerHTML write is checked for a <button> inside a <button> (invalid HTML the parser silently splits) */
  await p.c.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const d = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    Object.defineProperty(Element.prototype, 'innerHTML', { configurable: true, get() { return d.get.call(this); }, set(v) {
      if (typeof v === 'string' && v.indexOf('<button') >= 0) { let depth = 0; const re = new RegExp('<(' + '/' + '?)button[ >]', 'g'); let m; while ((m = re.exec(v))) { depth += m[1] ? -1 : 1; if (depth > 1) { console.error('nested button: ' + v.slice(Math.max(0, m.index - 120), m.index + 60)); break; } } }
      d.set.call(this, v); } });
  })();` });
  const results = [];
  for (const f of files) {
    const res = { file: f, fails: [] };
    const fail = (m) => { res.fails.push(m); };
    try {
      p.errors = []; p.console = [];
      await p.navigate(BASE + f, { noReady: true });
      await p.eval("localStorage.removeItem('gymquest-concepts-r2'); true");
      await p.navigate(BASE + f, { noReady: true });
      await waitFor(() => p.eval("!!(window.GQ2 && window.Kit && document.querySelector('[data-screen]:not([hidden])') && document.querySelector('[data-screen]:not([hidden])').innerHTML.length > 50)"), 15000, 'render ' + f);
      await sleep(700);
      /* thumbnail of the first screen */
      const rect = await p.eval("(() => { const r = document.querySelector('.device').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()");
      const shot = await p.c.send('Page.captureScreenshot', { format: 'jpeg', quality: 72, clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 300 / rect.w } });
      fs.writeFileSync(path.join(THUMBS, f.replace('.html', '.jpg')), Buffer.from(shot.data, 'base64'));
      /* walk every tab, collect entry points */
      const found = await p.eval(`(async () => {
        const opens = new Set(), dos = new Set();
        const grab = () => { document.querySelectorAll('#app [data-open]').forEach((n) => opens.add(n.dataset.open)); document.querySelectorAll('#app [data-do]').forEach((n) => dos.add(n.dataset.do)); };
        const tabs = [...new Set([...document.querySelectorAll('#app [data-tab]')].map((t) => t.dataset.tab))];
        const views = async () => { const seen = new Set(); for (let k = 0; k < 8; k++) { const v = [...document.querySelectorAll('#app [data-do="view"]')].find((n) => !seen.has(n.dataset.arg)); if (!v) break; seen.add(v.dataset.arg); v.click(); await new Promise((r) => setTimeout(r, 120)); grab(); } };
        for (const t of tabs) { const btn = document.querySelector('#app [data-tab="' + t + '"]'); btn.click(); await new Promise((r) => setTimeout(r, 120)); grab(); await views(); }
        // with a workout running, the screens show the session controls
        GQ2.start(GQ2.recommended().id); await new Promise((r) => setTimeout(r, 150));
        for (const t of tabs) { document.querySelector('#app [data-tab="' + t + '"]').click(); await new Promise((r) => setTimeout(r, 120)); grab(); }
        GQ2.cancel(); await new Promise((r) => setTimeout(r, 100));
        document.querySelector('#app [data-tab="' + tabs[0] + '"]').click();
        return { opens: [...opens], dos: [...dos], tabs };
      })()`);
      const missOpen = NEED_OPEN.filter((x) => !found.opens.includes(x));
      const missDo = NEED_DO.filter((x) => !found.dos.includes(x));
      if (!found.dos.includes('set') && !found.dos.includes('log')) missDo.push('set|log');
      if (missOpen.length) fail('missing entry points: ' + missOpen.join(', '));
      if (missDo.length) fail('missing actions: ' + missDo.join(', '));
      /* a full workout through the design's own buttons */
      const flow = await p.eval(`(async () => {
        const w = (ms) => new Promise((r) => setTimeout(r, ms || 150));
        const shown = (n) => n.getClientRects().length > 0 && !n.closest('.k-layer') && !n.closest('[hidden]');
        const clk = (n) => n.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        const vis = (sel) => [...document.querySelectorAll(sel)].find(shown);
        const before = GQ2.state.history.length;
        const tabs = [...new Set([...document.querySelectorAll('#app [data-tab]')].map((t) => t.dataset.tab))];
        let start = null;
        for (const t of tabs) { document.querySelector('#app [data-tab="' + t + '"]').click(); await w(); start = vis('[data-do="start"]'); if (start) break; }
        if (!start) return { err: 'no visible start button' };
        clk(start); await w(250);
        if (!GQ2.sess()) return { err: 'start did not start a workout' };
        let logged = 0;
        for (let k = 0; k < 4; k++) {
          let s = null;
          for (const t of [null, ...tabs]) { if (t) { document.querySelector('#app [data-tab="' + t + '"]').click(); await w(); } s = vis('[data-do="log"]') || [...document.querySelectorAll('[data-do="set"]')].find((n) => shown(n) && !/:[LR]$/.test(n.dataset.arg || '') && !n.classList.contains('on') && !n.classList.contains('done')) || vis('[data-do="set"]'); if (s) break; }
          if (!s) return { err: 'no visible set / log button' };
          const d0 = GQ2.progress().done; clk(s); await w(200);
          if (GQ2.progress().done !== d0) logged++;
        }
        if (!logged) return { err: 'logging a set changed nothing' };
        let fin = null;
        for (const t of [null, ...tabs]) { if (t) { document.querySelector('#app [data-tab="' + t + '"]').click(); await w(); } fin = vis('[data-do="finish"]'); if (fin) break; }
        if (!fin) return { err: 'no visible finish button' };
        clk(fin); await w(300);
        const ok = document.querySelector('.k-layer [data-k="fin"]'); if (!ok) return { err: 'finish sheet did not open' };
        ok.click(); await w(400);
        const after = GQ2.state.history.length;
        Kit.closeAll(); await w(250);
        return { logged, saved: after === before + 1 };
      })()`);
      if (flow.err) fail('workout: ' + flow.err); else if (!flow.saved) fail('workout: finish did not save to history');
      /* every shared flow opens */
      const fl = await p.eval(`(async () => {
        const bad = [];
        for (const f of ${JSON.stringify(FLOWS)}) { const [k, a] = f.split(':'); try { Kit.FLOWS[k](a); await new Promise((r) => setTimeout(r, 60)); const l = document.querySelectorAll('.k-layer'); if (!l.length || l[l.length - 1].querySelector('.k-body').innerHTML.length < 20) bad.push(f); } catch (e) { bad.push(f + ' ' + e.message); } Kit.closeAll(); await new Promise((r) => setTimeout(r, 30)); }
        await new Promise((r) => setTimeout(r, 250));
        return bad;
      })()`);
      if (fl.length) fail('flows: ' + fl.join(', '));
      /* rest timer through the design + horizontal overflow check */
      const misc = await p.eval(`(async () => {
        GQ2.startRest(3); await new Promise((r) => setTimeout(r, 3600));
        const done = GQ2.rest() && GQ2.rest().done; GQ2.stopRest();
        const app = document.getElementById('app'); const over = [...app.querySelectorAll('[data-screen]:not([hidden]) *')].filter((n) => { const r = n.getBoundingClientRect(); const a = app.getBoundingClientRect(); if (!(r.width > 0 && r.right > a.right + 2 && getComputedStyle(n).position !== 'absolute')) return false; for (let q = n.parentElement; q && q !== app; q = q.parentElement) { const ox = getComputedStyle(q).overflowX; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return false; } return true; }).length;
        return { done, over };
      })()`);
      if (!misc.done) fail('rest timer did not complete');
      if (misc.over > 3) fail('content wider than the phone (' + misc.over + ' elements)');
      const cerr = p.console.filter((c) => /^error/.test(c) && !/favicon|ERR_|404/.test(c));
      if (p.errors.length) fail('exceptions: ' + p.errors.slice(0, 3).join(' | '));
      if (cerr.length) fail('console errors: ' + cerr.slice(0, 3).join(' | '));
    } catch (e) { fail('crash: ' + e.message); }
    results.push(res);
    console.log((res.fails.length ? 'FAIL ' : 'PASS ') + f + (res.fails.length ? '\n     - ' + res.fails.join('\n     - ') : ''));
  }
  const bad = results.filter((r) => r.fails.length);
  console.log('\n' + (results.length - bad.length) + ' / ' + results.length + ' designs passed');
  await b.closeGraceful();
  srv.close && srv.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
