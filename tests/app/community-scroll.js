'use strict';
/* Community: zvislá stránka a listy, nezávislá galéria, dlhý text a priblíženie.
   Iba syntetický hosť a falošné dátové rozhranie; žiadne účty ani screenshoty.
   GQ_PWA=1 navyše nainštaluje a odstráni iba lokálnu PWA vo vlastnom čerstvom profile. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const J = JSON.stringify;
const REPO = path.resolve(__dirname, '../..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8346;
const DEBUG = Number(process.env.GQ_DEBUG_PORT) || 9946;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = fs.mkdtempSync(path.join(process.env.GQ_WORK || os.tmpdir(), 'gq-community-scroll-'));
const cfg = path.join(WORK, 'community.empty.js');
fs.writeFileSync(cfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
process.env.GQ_COMMUNITY_CONFIG = cfg;
process.env.GQ_SCREENSHOTS = '0';
const { startServer, Browser, Page, waitFor } = require('../sync/lib');
let passed = 0, failed = 0;
function check(label, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (!ok && detail !== undefined ? ': ' + J(detail) : ''));
  if (ok) passed++; else failed++;
}
const FIXTURE = `(() => {
  const me = '00000000-0000-4000-8000-000000000116';
  const now = new Date().toISOString();
  const photos = [0,1,2].map(i => ({ image: 'scroll/' + i + '.jpg', thumb: 'scroll/' + i + '-thumb.jpg' }));
  const rows = Array.from({ length: 8 }, (_,i) => ({ post_id: 'scroll-' + i, author_id: 'scroll-author',
    author_name: 'LongUnbrokenCommunityMemberName32', author_avatar: null, activity_at: now,
    caption: 'https://example.invalid/' + 'long-path-'.repeat(90), photos, likes: 12, comments: 8 }));
  const query = table => {
    const q = { select: () => q, eq: () => q, in: () => q, order: () => q,
      maybeSingle: async () => ({ data: table === 'profiles' ? { id: me, username: 'Scroll lab', role: 'user' } : null }),
      then: resolve => Promise.resolve({ data: [], count: 0 }).then(resolve) };
    return q;
  };
  const channel = { on: () => channel, subscribe: () => channel };
  const sb = {
    auth: { getSession: async () => ({ data: { session: { user: { id: me } } } }) },
    from: query, channel: () => channel, removeChannel: () => {},
    storage: { from: () => ({ createSignedUrls: async paths => ({ data: paths.map(p => ({ path: p, signedUrl: '/body-anatomy.webp' })) }) }) },
    rpc: async fn => {
      if (fn === 'community_social_version') return { data: 3 };
      if (fn === 'has_age_consent') return { data: true };
      if (fn === 'community_feed') return { data: rows };
      if (fn === 'post_comments_list') return { data: Array.from({ length: 8 }, (_,i) => ({ id: 'comment-' + i,
        user_id: 'scroll-author', username: 'CommentMember', body: 'LongComment'.repeat(70), created_at: now })) };
      if (fn === 'leaderboard_top') return { data: [{ pos: 1, user_id: me, username: 'LongMember'.repeat(3), xp: 100, level: 2 }] };
      if (fn === 'leaderboard_me') return { data: { hidden: false } };
      return { data: null };
    }
  };
  communityConfigured = () => true;
  communityClient = () => sb;
  state.settings.communityOptIn = true;
  setLang('en');
  return true;
})()`;
const FIT = `(() => {
  const root = document.documentElement, screen = document.getElementById('screen-komunita');
  const sheet = screen.classList.contains('sheet-open') ? document.getElementById('community-body') : null;
  const head = (sheet || screen).querySelector(sheet ? '.csub-head, .k-head' : '.chd');
  const hb = head && head.getBoundingClientRect();
  const controls = Array.from((sheet || screen).querySelectorAll('button:not([hidden]), textarea'))
    .filter(el => el.getClientRects().length && !el.closest('.community-photos, .lb-scroll, [hidden]'));
  return { documentFits: root.scrollWidth <= root.clientWidth + 1,
    sheetFits: !sheet || sheet.scrollWidth <= sheet.clientWidth + 1,
    headerFits: !hb || hb.left >= -1 && hb.right <= innerWidth + 1,
    controlsFit: controls.every(el => { const b = el.getBoundingClientRect(); return b.left >= -1 && b.right <= innerWidth + 1; }),
    x: scrollX, y: sheet ? sheet.scrollTop : scrollY };
})()`;
/* PWA je dôveryhodná browser-level doména dostupná iba cez debugovací pipe.
   Rovnaký Page adaptér ako pri bežných testoch, iba iný CDP transport. */
function pipeConnection(proc) {
  const events = new EventEmitter(), pending = new Map();
  let sequence = 0, buffer = '', closed = false;
  function stop(error) {
    if (closed) return;
    closed = true;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); }
    pending.clear();
    events.removeAllListeners();
  }
  proc.once('error', stop);
  proc.once('exit', () => stop(new Error('Chrome pipe exited')));
  proc.stdio[3].on('error', stop);
  proc.stdio[4].on('error', stop);
  proc.stdio[4].setEncoding('utf8');
  proc.stdio[4].on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\0')) !== -1) {
      const json = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      let message;
      try { message = JSON.parse(json); } catch (error) { stop(error); return; }
      if (message.id) {
        const p = pending.get(message.id);
        if (!p) continue;
        pending.delete(message.id); clearTimeout(p.timer);
        if (message.error) p.reject(new Error(message.error.message));
        else p.resolve(message.result || {});
      } else {
        events.emit((message.sessionId || '') + ':' + message.method, message.params);
      }
    }
  });
  function session(sessionId) {
    return {
      send(method, params = {}, timeoutMs = 180000) {
        if (closed) return Promise.reject(new Error('Chrome pipe closed'));
        return new Promise((resolve, reject) => {
          const id = ++sequence;
          const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, timeoutMs);
          pending.set(id, { resolve, reject, timer });
          const message = { id, method, params };
          if (sessionId) message.sessionId = sessionId;
          proc.stdio[3].write(JSON.stringify(message) + '\0');
        });
      },
      on(method, listener) { events.on((sessionId || '') + ':' + method, listener); },
    };
  }
  return Object.assign(session(''), { session, close() { stop(new Error('Chrome pipe closed')); proc.stdio[3].end(); } });
}

/* Skutočné touch udalosti s medzikrokmi po snímkach; syntetické CDP gestá
   v headless prehliadači doručili iba začiatok/koniec, bez pohybu. */
async function touchGesture(p, contacts, steps = 12) {
  const frame = () => p.eval(`new Promise(resolve => requestAnimationFrame(() => resolve(true)))`);
  const points = fraction => contacts.map((c, i) => ({ id: i + 1, x: c.x + c.dx * fraction, y: c.y + c.dy * fraction }));
  await frame();
  await p.c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(0) });
  for (let i = 1; i <= steps; i++) {
    await p.c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(i / steps) });
    await frame();
  }
  await p.c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await frame(); await frame();
}

(async () => {
  const server = await startServer(PORT, { new: REPO });
  const browser = new Browser('community-scroll', DEBUG, path.join(WORK, 'profiles'));
  let p, rootClient, installed = false;
  try {
    if (process.env.GQ_PWA === '1') {
      if (!process.env.GQ_CHROME) throw new Error('GQ_PWA=1 requires the explicit GQ_CHROME test binary');
      fs.mkdirSync(browser.dir, { recursive: true });
      browser.proc = spawn(process.env.GQ_CHROME, [
        '--headless=new', '--user-data-dir=' + browser.dir, '--remote-debugging-pipe', '--no-first-run',
        '--no-default-browser-check', '--disable-features=Translate,MediaRouter', '--password-store=basic',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank',
      ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
      browser.exited = new Promise(resolve => browser.proc.once('exit', resolve));
      rootClient = pipeConnection(browser.proc);
      await rootClient.send('Browser.getVersion');
      await rootClient.send('PWA.install', { manifestId: BASE, installUrlOrBundleUrl: BASE });
      installed = true;
      await rootClient.send('PWA.changeAppUserSettings', { manifestId: BASE, displayMode: 'standalone' });
      await rootClient.send('PWA.launch', { manifestId: BASE });
      /* launch môže vrátiť vonkajší tab target; Page doména patrí jeho page targetu. */
      const target = await waitFor(async () => {
        const { targetInfos } = await rootClient.send('Target.getTargets');
        return targetInfos.find(t => t.type === 'page' && t.url.startsWith(BASE));
      }, 10000, 'installed PWA page target');
      const attached = await rootClient.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      p = new Page(browser, rootClient.session(attached.sessionId));
      browser.page = p;
      await p.init();
      await p.navigate(BASE);
      check('actually launched installed standalone PWA (not a navigator shim)', await p.eval(`matchMedia('(display-mode: standalone)').matches`));
    } else {
      p = await browser.launch();
      await p.navigate(BASE);
    }
    await p.c.send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1', platform: 'iPhone' });
    await p.reload();
    check('iPhone-specific app CSS is exercised without a navigator shim', await p.eval(`document.documentElement.classList.contains('ios')`));
    await p.c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    await p.c.send('Page.bringToFront');
    await p.c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    const click = selector => p.eval(`(() => { const el = document.querySelector(${J(selector)}); if (!el) throw Error('Missing '+${J(selector)}); el.click(); return true; })()`);
    await p.eval(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); return true; })()`);
    await p.eval(FIXTURE);
    await click('[data-tab="komunita"]');
    await waitFor(() => p.eval(`document.querySelectorAll('#community-feed .cpost').length === 8`), 10000, 'real feed renderer');
    const showFeed = () => p.eval(`(async () => { communityView = 'feed'; await renderCommunity(); scrollTo({top:0,behavior:'instant'}); return true; })()`);
    for (const width of [320, 390, 430, 1024]) {
      await p.c.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 700 });
      for (const lang of ['en', 'sk', 'es', 'pt-BR', 'fr', 'ar']) {
        await p.eval(`(setLang(${J(lang)}), true)`);
        await showFeed();
        const fit = await p.eval(FIT);
        check(width + '/' + lang + ': long-name/URL feed and header fit without clipping controls', fit.documentFits && fit.headerFits && fit.controlsFit, fit);
      }
    }
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await p.eval(`(setLang('en'), true)`); await showFeed();
    await touchGesture(p, [{ x: 200, y: 600, dx: 90, dy: -300 }]);
    let fit = await p.eval(FIT);
    check('diagonal touch scrolls page vertically without sideways drift', fit.y > 20 && Math.abs(fit.x) < 1, fit);
    await p.eval(`(document.querySelector('.community-photos').scrollIntoView({block:'center'}), true)`);
    const gallery = await p.eval(`(() => { const el = document.querySelector('.community-photos'), b = el.getBoundingClientRect(); return { x: b.x + b.width/2, y: Math.max(100,Math.min(700,b.y+b.height/2)), left: el.scrollLeft, width: b.width, scroll: el.scrollWidth }; })()`);
    await touchGesture(p, [{ x: gallery.x, y: gallery.y, dx: -gallery.width * .75, dy: 0 }]);
    const afterGallery = await p.eval(`({left:document.querySelector('.community-photos').scrollLeft,x:scrollX})`);
    check('photo gallery still accepts a real horizontal swipe independently of the page', gallery.scroll > gallery.width && Math.abs(afterGallery.left - gallery.left) > 20 && Math.abs(afterGallery.x) < 1, { gallery, afterGallery });
    await p.eval(`(document.querySelector('.community-photos').scrollTo({left:100000,behavior:'instant'}), true)`);
    const beforeEdge = await p.eval(`scrollY`);
    await touchGesture(p, [{ x: gallery.x, y: gallery.y, dx: -90, dy: -220 }]);
    check('diagonal gesture at gallery edge retains vertical page scrolling and zero page X', await p.eval(`scrollY > ${beforeEdge} + 10 && Math.abs(scrollX) < 1`));
    await showFeed();
    await click('#community-feed .cpost [data-community-action="comments"]');
    await waitFor(() => p.eval(`!!document.getElementById('community-comment-text')`), 10000, 'comments sheet');
    for (const lang of ['en', 'ar']) {
      await p.eval(`(setLang(${J(lang)}), true)`);
      await p.eval(`(async () => { await renderCommunity(); document.getElementById('community-body').scrollTo(0,0); return true; })()`);
      fit = await p.eval(FIT);
      check(lang + ': fixed comments sheet and composer fit narrow viewport', fit.documentFits && fit.sheetFits && fit.headerFits && fit.controlsFit, fit);
    }
    await touchGesture(p, [{ x: 200, y: 600, dx: 70, dy: -300 }]);
    check('fixed sheet accepts diagonal vertical touch without X scroll', await p.eval(`(() => { const el = document.getElementById('community-body'); return el.scrollTop > 20 && Math.abs(el.scrollLeft) < 1 && Math.abs(scrollX) < 1; })()`));
    await click('#community-body [data-community-action="back"]');
    await waitFor(() => p.eval(`communityView === 'feed' && !!document.querySelector('#community-feed .cpost')`), 10000, 'Back to feed');
    check('Back restores the real feed rather than trapping the fixed sheet', await p.eval(`!document.getElementById('screen-komunita').classList.contains('sheet-open')`));
    await click('#btn-cnew');
    await waitFor(() => p.eval(`!!document.getElementById('community-compose-text')`), 10000, 'post composer');
    fit = await p.eval(FIT);
    check('post composer, privacy choices and actions remain reachable', fit.documentFits && fit.controlsFit, fit);
    await touchGesture(p, [{ x: 120, y: 300, dx: -60, dy: 0 }, { x: 280, y: 300, dx: 60, dy: 0 }], 20);
    check('two-finger accessibility pinch zoom remains enabled', await p.eval(`visualViewport.scale > 1.05`));
    check('no runtime exceptions', p.errors.length === 0, p.errors);
  } catch (error) { check('scenario completes', false, String(error.stack || error)); }
  finally {
    if (installed && rootClient) { try { await rootClient.send('PWA.uninstall', { manifestId: BASE }); } catch (error) { check('remove only the disposable local PWA', false, String(error)); } }
    if (rootClient) rootClient.close();
    browser.killHard(true); await server.close();
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exitCode = failed ? 1 : 0;
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
