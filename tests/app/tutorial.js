'use strict';
/* GymQuest — engine návodu (v102, úloha 1): zvýraznenie sedí na cieli, chýbajúci cieľ ukáže ilustráciu,
   Späť/Ďalej/Preskočiť/×/Esc/Android Späť, pasca fokusu, bez animácií pri reduced motion, 320 px v ar
   a hlavne: návod nezmení state ani localStorage appky (okrem gymquest_tutorial). Reálny headless Chrome, bez siete.

     GQ_TEST_PORT=8190 node tests/app/tutorial.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, Browser } = require('../sync/lib');

const REPO = process.env.GQ_REPO || path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GQ_TEST_PORT) || 8124;
const BASE = 'http://localhost:' + PORT + '/';
const WORK = process.env.GQ_WORK || path.join(os.tmpdir(), 'gq-app-tutorial');
const J = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + (typeof info === 'string' ? info : J(info)) : '')); }
}

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  const emptyCfg = path.join(WORK, 'community-config.empty.js');
  fs.writeFileSync(emptyCfg, "window.GYMQUEST_COMMUNITY = { supabaseUrl: '', supabaseAnonKey: '' };\n");
  process.env.GQ_COMMUNITY_CONFIG = emptyCfg;
  const server = await startServer(PORT, { new: REPO });
  const b = new Browser('tutorial-' + Date.now().toString(36), 9893, path.join(WORK, 'profiles'));
  const p = await b.launch();
  const logs = [];
  await p.c.send('Log.enable');
  p.c.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && !/favicon/.test(e.entry.url || '')) logs.push(e.entry.text); });
  const ev = (x) => p.eval(x);
  const metrics = (w, h) => p.c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  const key = async (k, code, vk) => {
    await p.c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk });
    await p.c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  };
  const click = (id) => ev(`(document.getElementById(${J(id)}).click(), true)`);
  const open = () => ev(`tourOpen()`);
  const title = () => ev(`(document.getElementById('tour-title') || {}).textContent || ''`);
  /* odtlačok dát appky: celý state + všetky localStorage kľúče okrem gymquest_tutorial */
  const snap = () => ev(`JSON.stringify({ s: state, ls: Object.keys(localStorage).filter((k) => k !== 'gymquest_tutorial').sort().map((k) => [k, localStorage.getItem(k)]) })`);
  const geo = () => ev(`(() => {
    const sp = document.querySelector('.tour-spot'), c = document.getElementById('tour-card');
    const s = sp.getBoundingClientRect(), k = c.getBoundingClientRect();
    return { spotHidden: sp.hidden, s: [s.left, s.top, s.right, s.bottom], k: [k.left, k.top, k.right, k.bottom], H: innerHeight, W: innerWidth,
      place: c.dataset.place || '', over: c.scrollWidth > c.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1 };
  })()`);
  /* dummy kroky definujeme v stránke */
  const DEFS = `window.__t = {
    s1: { id: 's1', title: 'First', body: 'Body one', target: () => document.querySelector('#bento-grid > *') },
    s2: { id: 's2', title: 'Second', body: 'Body two', target: () => document.getElementById('no-such-element'),
          illus: () => { const d = document.createElement('div'); d.id = 'illus-id'; d.className = 'tile'; d.innerHTML = '<button id="illus-btn" class="btn">Add set</button><span id="x">42</span>'; return d; } },
  }; true`;
  try {
    await p.navigate(BASE);
    await ev(`(sessionStorage.setItem('gq_test_tour', '1'), true)`);   // harness môže nastaviť __GQ_TEST__: tu chceme skutočné správanie
    await metrics(393, 852);
    await p.c.send('Emulation.setFocusEmulationEnabled', { enabled: true });   // focusin sa v headless inak nespustí
    await ev(`(() => { const ok = document.getElementById('btn-setup-ok'); if (ok && !document.getElementById('modal-setup').hidden) ok.click(); setLang('en'); switchTab('dnes'); return true; })()`);
    await wait(300);
    const autoOnFirstSetup = await ev(`tourOpen()`);   // úloha 3: čerstvé zariadenie dostane návod po nastavení (podrobne nižšie)
    await ev(`(closeTour('yield'), localStorage.removeItem(TOUR_KEY), true)`);
    await ev(DEFS);
    await ev(`(() => { const o = document.createElement('button'); o.id = 'btn-opener'; o.textContent = 'opener'; document.getElementById('screen-dnes').prepend(o); return true; })()`);

    console.log('== zoznam API a vrstvenie');
    check('API exists', await ev(`typeof startTour === 'function' && typeof closeTour === 'function' && typeof tourOpen === 'function' && TOUR_KEY === 'gymquest_tutorial'`));
    check('no tour open at start', !(await open()));
    check('tour z-index above tab bar, finish bar, rest card and modals', await ev(`(() => {
      const probe = document.createElement('div'); probe.className = 'tour'; document.body.appendChild(probe);
      const z = (e) => parseInt(getComputedStyle(e).zIndex, 10) || 0;
      const r = z(probe); probe.remove();
      return r > z(document.querySelector('.tab-bar')) && r > z(document.getElementById('finish-bar')) && r > z(document.getElementById('timer-bar')) && r > z(document.getElementById('modal-rest'));
    })()`));

    console.log('== otvorenie, geometria, krok 1');
    const before = await snap();
    await ev(`(document.getElementById('btn-opener').focus(), true)`);
    await ev(`startTour([__t.s1, __t.s2], {})`);
    await wait(350);
    check('tourOpen() true', await open());
    check('dialog role, modal, labelled', await ev(`(() => { const r = document.getElementById('tour'); return r.getAttribute('role') === 'dialog' && r.getAttribute('aria-modal') === 'true' && document.getElementById(r.getAttribute('aria-labelledby')).textContent === 'First'; })()`));
    check('step 1 title and counter', (await title()) === 'First' && (await ev(`document.querySelector('.tour-count').textContent`)) === '1 of 2');
    check('Back hidden on step 1, Skip and Next visible, Next says Next', await ev(`document.getElementById('tour-back').hidden && !document.getElementById('tour-skip').hidden && document.getElementById('tour-next').textContent === 'Next'`));
    let g = await geo();
    const tr = await ev(`(() => { const r = document.querySelector('#bento-grid > *').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()`);
    const near = (a, bb, d) => a.every((v, i) => Math.abs(v - bb[i]) <= d);
    const expSpot = [Math.max(0, tr[0] - 6), Math.max(0, tr[1] - 6), Math.min(g.W, tr[2] + 6), Math.min(g.H, tr[3] + 6)];
    check('spotlight matches target rect (+6 px padding)', !g.spotHidden && near(g.s, expSpot, 1.5), { s: g.s, expSpot });
    check('card fully inside the viewport', g.k[0] >= 0 && g.k[1] >= 0 && g.k[2] <= g.W && g.k[3] <= g.H, g);
    check('card does not cover the target (above or below)', g.k[3] <= g.s[1] + 1 || g.k[1] >= g.s[3] - 1, g);
    check('illustration hidden for a real target', await ev(`document.querySelector('.tour-illus').hidden`));
    check('focus is inside the tour on open', await ev(`document.getElementById('tour').contains(document.activeElement)`));
    check('overlay covers the tab bar (hit test)', await ev(`(() => { const r = document.querySelector('.tab-bar').getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && document.getElementById('tour').contains(e); })()`));
    check('buttons >= 44 px', await ev(`Array.from(document.querySelectorAll('#tour button')).filter((x) => x.getClientRects().length).every((x) => { const r = x.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; })`));
    check('startTour while open is refused', (await ev(`startTour([__t.s1], {})`)) === false);

    console.log('== krok 2 (chýbajúci cieľ = ilustrácia), Späť');
    await click('tour-next'); await wait(300);
    check('step 2 title, Next says Done on last, Skip hidden, Back visible', (await title()) === 'Second' && await ev(`document.getElementById('tour-next').textContent === 'Done' && document.getElementById('tour-skip').hidden && !document.getElementById('tour-back').hidden`));
    check('missing target: spotlight hidden, screen dimmed', (await geo()).spotHidden && await ev(`document.getElementById('tour').classList.contains('tour-dim')`));
    check('illustration shown, aria-hidden, inert', await ev(`(() => { const i = document.querySelector('.tour-illus'); return !i.hidden && i.getAttribute('aria-hidden') === 'true' && !!i.querySelector('.tile') && i.firstElementChild.hasAttribute('inert'); })()`));
    check('illustration clone has no ids and no focusable controls', await ev(`(() => { const i = document.querySelector('.tour-illus'); return i.querySelectorAll('[id]').length === 0 && Array.from(i.querySelectorAll('button')).every((x) => x.tabIndex === -1); })()`));
    check('illustration: original node was not mutated (still has its id)', await ev(`__t.s2.illus().id === 'illus-id'`));
    g = await geo();
    check('card in viewport on illustration step', g.k[0] >= 0 && g.k[1] >= 0 && g.k[2] <= g.W && g.k[3] <= g.H, g);
    await click('tour-back'); await wait(200);
    check('Back returns to step 1 and focus is not lost', (await title()) === 'First' && await ev(`document.getElementById('tour').contains(document.activeElement)`));

    console.log('== pasca fokusu');
    check('Tab on the last control wraps to the first', await ev(`(() => {
      const f = Array.from(document.querySelectorAll('#tour button')).filter((x) => x.getClientRects().length);
      f[f.length - 1].focus();
      f[f.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      return document.activeElement === f[0];
    })()`));
    check('Shift+Tab on the first control wraps to the last', await ev(`(() => {
      const f = Array.from(document.querySelectorAll('#tour button')).filter((x) => x.getClientRects().length);
      f[0].focus();
      f[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
      return document.activeElement === f[f.length - 1];
    })()`));
    check('focus pushed into the app is pulled back', await ev(`(document.getElementById('btn-opener').focus(), document.getElementById('tour').contains(document.activeElement))`));

    console.log('== Skip a stav');
    await click('tour-skip'); await wait(100);
    check('Skip closes, tourOpen() false, overlay removed', !(await open()) && await ev(`!document.getElementById('tour')`));
    check('Skip stored as skipped', await ev(`JSON.parse(localStorage.gymquest_tutorial).status === 'skipped' && JSON.parse(localStorage.gymquest_tutorial).v === 1 && typeof JSON.parse(localStorage.gymquest_tutorial).at === 'string'`));
    check('focus returned to the opener (a visible button)', await ev(`document.activeElement === document.getElementById('btn-opener')`));
    check('closeTour when closed is a no-op', (await ev(`closeTour('skipped')`)) === false);

    console.log('== × , Esc, Android Späť, Done');
    await ev(`startTour([__t.s1, __t.s2], {})`); await wait(200);
    await click('tour-close'); await wait(50);
    check('× closes', !(await open()));
    await ev(`(document.getElementById('modal-measure').hidden = false, true)`);
    await ev(`startTour([__t.s1, __t.s2], {})`); await wait(200);
    await key('Escape', 'Escape', 27); await wait(100);
    check('Esc closes only the tour (modal underneath stays open)', !(await open()) && await ev(`!document.getElementById('modal-measure').hidden`));
    await ev(`(document.getElementById('modal-measure').hidden = true, true)`);
    await ev(`startTour([__t.s1, __t.s2], {})`); await wait(200);
    check('Android Back closes the tour', (await ev(`nativeBack()`)) === 'closed' && !(await open()));
    await ev(`startTour([__t.s1, __t.s2], {})`); await wait(200);
    await click('tour-next'); await wait(100); await click('tour-next'); await wait(100);
    check('Done closes and stores done', !(await open()) && await ev(`JSON.parse(localStorage.gymquest_tutorial).status === 'done'`));
    await ev(`startTour([__t.s1, __t.s2], {})`); await wait(200);
    await click('tour-skip'); await wait(50);
    check('a later Skip does not downgrade done to skipped', await ev(`JSON.parse(localStorage.gymquest_tutorial).status === 'done'`));
    await ev(`startTour([__t.s1], {})`); await wait(200);
    check('single step tour: Skip hidden, Done shown', await ev(`document.getElementById('tour-skip').hidden && document.getElementById('tour-next').textContent === 'Done'`));
    await ev(`closeTour('yield')`);
    check('close with another reason does not write', await ev(`JSON.parse(localStorage.gymquest_tutorial).status === 'done'`));

    console.log('== stav je nedotknutý (otvoriť / ďalej / zatvoriť, 2x; vrátane kroku s kartou)');
    await ev(`window.__t.s3 = { id: 's3', title: 'Tab', body: 'Tab step', tab: 'trening', target: () => document.querySelector('.tab-bar'), illus: null }; true`);
    const s0 = await snap();
    for (let i = 0; i < 2; i++) {
      await ev(`startTour([__t.s1, __t.s2, __t.s3], {})`); await wait(200);
      await click('tour-next'); await wait(100); await click('tour-next'); await wait(200);
      check('run ' + (i + 1) + ': tab step switched the tab', (await ev(`activeTab`)) === 'trening');
      await click('tour-back'); await click('tour-next'); await wait(100);
      await click('tour-close'); await wait(150);
      check('run ' + (i + 1) + ': original tab restored', (await ev(`activeTab`)) === 'dnes');
      check('run ' + (i + 1) + ': state + app localStorage byte-identical', (await snap()) === s0);
    }
    check('state not changed vs. before the first tour either', (await snap()) === before, 'differs from the very first snapshot (render side effects?)');
    check('tutorial key never inside state', await ev(`!JSON.stringify(state).includes('gymquest_tutorial')`));

    console.log('== cieľ skrytý / mimo obrazovky / obrovský');
    await ev(`(() => {
      const far = document.createElement('div'); far.id = 'far-target'; far.style.cssText = 'height:48px;margin-top:2400px;background:#888';
      document.getElementById('screen-dnes').appendChild(far);
      const hid = document.createElement('div'); hid.id = 'hid-target'; hid.style.display = 'none'; document.body.appendChild(hid);
      const big = document.createElement('div'); big.id = 'big-target'; big.style.cssText = 'height:2000px;background:#888'; document.getElementById('screen-dnes').appendChild(big);
      window.__t.far = { id: 'far', title: 'Far', body: 'Far target', target: () => document.getElementById('far-target') };
      window.__t.hid = { id: 'hid', title: 'Hidden', body: 'Hidden target', target: () => document.getElementById('hid-target'), illus: () => { const d = document.createElement('div'); d.textContent = 'ILLUS'; return d; } };
      window.__t.big = { id: 'big', title: 'Big', body: 'Huge target', target: () => document.getElementById('big-target') };
      window.scrollTo(0, 0); return true; })()`);
    await ev(`startTour([__t.far], {})`); await wait(300);
    g = await geo();
    check('off-screen target is scrolled into view and spotlighted', !g.spotHidden && g.s[1] >= 0 && g.s[3] <= g.H && g.s[3] - g.s[1] > 40, g);
    check('card visible next to the far target', g.k[1] >= 0 && g.k[3] <= g.H && (g.k[3] <= g.s[1] + 1 || g.k[1] >= g.s[3] - 1), g);
    await ev(`closeTour('yield')`);
    await ev(`startTour([__t.hid], {})`); await wait(200);
    check('display:none target falls back to the illustration', (await geo()).spotHidden && await ev(`document.querySelector('.tour-illus').textContent === 'ILLUS' && !document.querySelector('.tour-illus').hidden`));
    await ev(`closeTour('yield')`);
    await ev(`startTour([__t.big], {})`); await wait(300);
    g = await geo();
    check('huge target: spotlight clipped to viewport, card readable inside it', g.s[1] >= 0 && g.s[3] <= g.H && g.k[1] >= 0 && g.k[3] <= g.H && g.k[2] <= g.W, g);
    await ev(`closeTour('yield')`);
    await ev(`(['far-target', 'hid-target', 'big-target'].forEach((i) => document.getElementById(i).remove()), window.scrollTo(0, 0), true)`);

    console.log('== prepočet pri zmene veľkosti');
    await ev(`startTour([__t.s1], {})`); await wait(300);
    await metrics(320, 568); await wait(400);
    g = await geo();
    const tr2 = await ev(`(() => { const r = document.querySelector('#bento-grid > *').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()`);
    check('spotlight follows the target after resize to 320 px', near(g.s, [Math.max(0, tr2[0] - 6), Math.max(0, tr2[1] - 6), Math.min(g.W, tr2[2] + 6), Math.min(g.H, tr2[3] + 6)], 1.5), { s: g.s, tr2 });
    await ev(`closeTour('yield')`);

    console.log('== reduced motion');
    await p.c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await ev(`startTour([__t.s1], {})`); await wait(200);
    const tm = await ev(`['.tour-spot', '#tour-card'].map((s) => { const c = getComputedStyle(document.querySelector(s)); return [c.transitionProperty, c.transitionDuration]; })`);
    check('no transitions with reduced motion', tm.every((x) => x[0] === 'none' || /^0(\.0+)?m?s(, 0(\.0+)?m?s)*$/.test(x[1])), tm);
    await ev(`closeTour('yield')`);
    await p.c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await ev(`startTour([__t.s1, __t.s1], {})`); await wait(200);
    const dur = () => ev(`parseFloat(getComputedStyle(document.querySelector('.tour-spot')).transitionDuration)`);
    check('no spotlight transition on the first layout', (await dur()) === 0);
    await click('tour-next'); await wait(30);
    check('transition on between steps (control)', (await dur()) > 0);
    await wait(450);
    check('transition off again once the step has settled', (await dur()) === 0);
    await click('tour-back'); await wait(450);
    await metrics(360, 700); await wait(150);
    check('no transition on resize', (await dur()) === 0);
    await metrics(393, 852); await wait(100);
    await ev(`closeTour('yield')`);

    console.log('== posun stránky, jazyk, povolené karty');
    await ev(`(() => { const far = document.createElement('div'); far.id = 'far2'; far.style.cssText = 'height:48px;margin-top:2400px;background:#888'; document.getElementById('screen-dnes').appendChild(far);
      window.__t.far2 = { id: 'far2', title: 'Far2', body: 'x', target: () => document.getElementById('far2') };
      window.__t.vis = { id: 'vis', title: 'Vis', body: 'x', target: () => document.querySelector('.tab-bar') };
      window.__t.bad = { id: 'bad', title: 'Bad', body: 'x', tab: 'komunita', target: () => null }; document.getElementById('far2').style.marginBottom = '1500px'; window.scrollTo(0, 120); return true; })()`);
    await wait(100);
    await ev(`startTour([__t.vis], {})`); await wait(250);
    check('target already inside the safe area: page is not scrolled', (await ev(`Math.round(scrollY)`)) === 120);
    await ev(`closeTour('yield')`);
    await ev(`startTour([__t.far2], {})`); await wait(250);
    check('far target scrolls the page', (await ev(`scrollY`)) > 500);
    await ev(`closeTour('yield')`); await wait(100);
    check('scroll position restored on close', (await ev(`Math.round(scrollY)`)) === 120, await ev(`scrollY`));
    await ev(`(document.getElementById('far2').remove(), window.scrollTo(0, 0), true)`);
    await ev(`startTour([__t.bad], {})`); await wait(200);
    check('a step with a tab outside dnes/trening/pokrok does not switch tabs', (await ev(`activeTab`)) === 'dnes');
    await ev(`closeTour('yield')`);
    await ev(`startTour([__t.s1, __t.s2], {})`); await wait(200);
    await ev(`setLang('sk')`); await wait(100);
    check('setLang while the tour is open closes it', !(await open()) && await ev(`!document.getElementById('tour')`));
    await ev(`setLang('en')`); await wait(100);

    console.log('== 6 jazykov, 320 px (aj ar RTL), svetlá aj tmavá');
    const sA = await snap();
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      for (const theme of ['light', 'dark']) {
        await ev(`(setLang(${J(lang)}), setThemePref(${J(theme)}), switchTab('dnes'), true)`); await wait(150);
        await ev(`startTour([__t.s1, __t.s2], {})`); await wait(250);
        const r1 = await ev(`(() => ({ btn: Array.from(document.querySelectorAll('#tour .tour-btns .btn, #tour-close')).filter((x) => x.getClientRects().length).map((x) => x.textContent.trim() || x.getAttribute('aria-label')), count: document.querySelector('.tour-count').textContent, dir: document.documentElement.dir, aria: document.getElementById('tour-close').getAttribute('aria-label') }))()`);
        const g1 = await geo();
        const okLabels = r1.btn.every((x) => x && !/^tour\./.test(x)) && r1.count.includes('1') && !/\{/.test(r1.count) && !/^tour\./.test(r1.aria);
        check(lang + '/' + theme + ' step 1 at 320 px: labels translated, card in view, no overflow', okLabels && g1.k[0] >= 0 && g1.k[1] >= 0 && g1.k[2] <= g1.W && g1.k[3] <= g1.H && !g1.over, { r1, g1 });
        if (lang === 'ar') check('ar: rtl, caret/card in view', r1.dir === 'rtl' && g1.k[0] >= 0 && g1.k[2] <= g1.W);
        await click('tour-next'); await wait(250);
        const g2 = await geo();
        check(lang + '/' + theme + ' step 2 (illustration) at 320 px: card in view, no overflow, buttons >= 44 px', g2.k[0] >= 0 && g2.k[1] >= 0 && g2.k[2] <= g2.W && g2.k[3] <= g2.H && !g2.over && await ev(`Array.from(document.querySelectorAll('#tour button')).filter((x) => x.getClientRects().length).every((x) => { const r = x.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; })`), g2);
        await click('tour-next'); await wait(100);
      }
    }
    console.log('== skutočných 6 krokov: 6 jazykov, svetlá/tmavá, 393 px; 320 px (fr, ar, 130 %)');
    const KEYS = ['plan', 'start', 'sets', 'rest', 'finish', 'tabs'];
    check('TOUR_STEPS has the 6 steps in order', (await ev(`TOUR_STEPS.map((x) => x.id).join()`)) === 'plan,start,sets,rest,finish,tabs');
    check('all step keys exist in all 6 languages', await ev(`['sk','en','es','pt-BR','fr','ar'].every((l) => ${J(KEYS)}.every((k) => ['title','body'].every((f) => typeof I18N[l]['tour.' + k + '.' + f] === 'string' && I18N[l]['tour.' + k + '.' + f].length)))`));
    await ev(`(setLang('en'), setThemePref('light'), switchTab('dnes'), true)`); await wait(150);
    const sTour = await snap();
    const RUN = async (lang, theme, w, h, zoom, tag) => {
      await metrics(w, h);
      await ev(`(setLang(${J(lang)}), setThemePref(${J(theme)}), document.documentElement.style.fontSize = ${J(zoom || '')}, switchTab('dnes'), window.scrollTo(0, 0), true)`); await wait(200);
      const sh0 = await ev(`document.documentElement.scrollHeight`), kids0 = await ev(`document.body.children.length`);
      await ev(`startTour(TOUR_STEPS, {})`);
      for (let i = 0; i < 6; i++) {
        await wait(260);
        const r = await ev(`(() => { const r = document.getElementById('tour'), c = document.getElementById('tour-card');
          const txt = document.getElementById('tour-title').textContent + ' ' + document.getElementById('tour-body').textContent;
          const il = document.querySelector('.tour-illus');
          return { id: r.dataset.step, txt, bad: /\{|tour\.|undefined/.test(txt) || txt.length < 20, illus: !il.hidden && il.querySelectorAll('[id]').length === 0 && il.getAttribute('aria-hidden') === 'true',
            illH: !il.hidden ? il.getBoundingClientRect().height : 0, cardScroll: c.style.overflowY === 'auto' }; })()`);
        const g = await geo();
        const inView = g.k[0] >= 0 && g.k[1] >= 0 && g.k[2] <= g.W && g.k[3] <= g.H;
        const noCover = g.spotHidden || g.k[3] <= g.s[1] + 1 || g.k[1] >= g.s[3] - 1;
        const real = [0, 1, 3, 4, 5].includes(i);
        const info = { tag, i, r, g };
        check(tag + ' step ' + (i + 1) + ' ' + KEYS[i] + ': text ok, card in view, no overflow, does not cover target', r.id === KEYS[i] && !r.bad && inView && !g.over && noCover && !r.cardScroll, info);
        if (real) check(tag + ' step ' + (i + 1) + ': real element spotlighted', !g.spotHidden && g.s[2] - g.s[0] > 20 && g.s[3] - g.s[1] > 20, g);
        if ([2, 3, 4].includes(i)) check(tag + ' step ' + (i + 1) + ': illustration shown (aria-hidden, no ids)', r.illus, r);
        if (i === 2) check(tag + ' step 3: dimmed screen, no spotlight', g.spotHidden);
        await click('tour-next');
      }
      await wait(100);
      /* dočasná rezerva na konci stránky sa po zatvorení odstráni */
      const tail = await ev(`(() => { const l = document.body.lastElementChild; return { open: tourOpen(), sh: document.documentElement.scrollHeight, kids: document.body.children.length, spacer: !!l && l.getAttribute('aria-hidden') === 'true' && !l.id && !l.children.length && !l.textContent, y: scrollY }; })()`);
      check(tag + ': after Done the temporary spacer is gone (scrollHeight same, no trailing aria-hidden div)', !tail.open && tail.sh === sh0 && tail.kids === kids0 && !tail.spacer, { sh0, kids0, tail });
    };
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) for (const theme of ['light', 'dark']) await RUN(lang, theme, 393, 852, '', lang + '/' + theme + '/393');
    for (const lang of ['fr', 'ar']) for (const zoom of ['', '130%']) await RUN(lang, 'light', 320, 568, zoom, lang + '/320' + (zoom ? '/' + zoom : ''));
    await ev(`(document.documentElement.style.fontSize = '', true)`);
    await metrics(393, 852);
    await ev(`(setLang('en'), setThemePref('light'), switchTab('dnes'), true)`); await wait(150);
    const norm = (x) => { const o = JSON.parse(x); o.ls = o.ls.filter((e) => e[0] !== 'gymquest_theme' && !/^gymquest_sync/.test(e[0])); return o; };
    const nA = norm(sTour), nB = norm(await snap());
    const diffKeys = [...new Set([...Object.keys(nA.s), ...Object.keys(nB.s)])].filter((k) => J(nA.s[k]) !== J(nB.s[k])).concat(nA.ls.filter((e, k) => J(e) !== J(nB.ls[k])).map((e) => 'ls:' + e[0]));
    check('state byte-identical after the full real tours (theme/sync meta of the test excluded)', J(nA) === J(nB), diffKeys);
    check('i18n: all tour.* keys exist in all 6 languages', await ev(`['sk','en','es','pt-BR','fr','ar'].every((l) => ['tour.back','tour.next','tour.done','tour.skip','tour.close','tour.stepOf'].every((k) => typeof I18N[l][k] === 'string' && I18N[l][k].length))`));
    await ev(`(setLang('en'), setThemePref('light'), switchTab('dnes'), true)`); await wait(150);
    /* setLang/setThemePref v teste samy zapisujú gymquest_theme a synchronizačné metadáta – tie nie sú dielo návodu */
    const strip = (x) => { const o = JSON.parse(x); o.ls = o.ls.filter((e) => e[0] !== 'gymquest_theme' && !/^gymquest_sync/.test(e[0])); return J(o); };
    check('state + app localStorage identical after 12 full tours in 6 languages (language restored; theme/sync meta of the test own setLang excluded)', strip(await snap()) === strip(sA));

    console.log('== úloha 3: kedy sa ukáže (prvé spustenie, pozvánka, opakovanie, ustúpenie)');
    check('first setup of a fresh device auto-started the tour', autoOnFirstSetup === true);
    const fresh = async (keep) => {   // čisté zariadenie (voliteľne s hotovým návodom) a načítanie stránky
      await ev(`(localStorage.clear(), ${keep ? "localStorage.setItem('gymquest_tutorial', JSON.stringify({ v: 1, status: 'done', at: 'x' }))," : ''} true)`);
      await p.navigate(BASE); await wait(500);
      await metrics(393, 852);
    };
    await ev(`(closeTour('yield'), true)`);
    await fresh(false);
    check('setup sheet open: no tour yet', await ev(`!document.getElementById('modal-setup').hidden`) && !(await open()));
    await click('btn-setup-ok'); await wait(400);
    check('fresh guest: tour starts right after setup closes (step 1)', (await open()) && await ev(`document.getElementById('modal-setup').hidden && document.getElementById('tour').dataset.step === 'plan'`));
    check('no invitation card while the tour runs', await ev(`document.getElementById('tour-invite').hidden`));
    await click('tour-close'); await wait(100);
    check('closing stores skipped', await ev(`JSON.parse(localStorage.gymquest_tutorial).status === 'skipped'`));
    await p.navigate(BASE); await wait(500);
    check('after reload: no setup, no tour, no card (fresh, key present)', !(await open()) && await ev(`document.getElementById('modal-setup').hidden && document.getElementById('tour-invite').hidden`));
    await fresh(true);
    await click('btn-setup-ok'); await wait(400);
    check('fresh guest on a device that already finished the tour: no auto-start', !(await open()) && await ev(`JSON.parse(localStorage.gymquest_tutorial).status === 'done'`));
    await fresh(false);
    await click('btn-setup-ok'); await wait(400);
    for (let i = 0; i < 6; i++) { await click('tour-next'); await wait(120); }
    check('fresh guest: finishing stores done', !(await open()) && await ev(`JSON.parse(localStorage.gymquest_tutorial).status === 'done'`));

    /* existujúci používateľ: história, bez kľúča */
    const wk = (i) => ({ id: 'h' + i, date: '2025-01-0' + i, planId: 'push', planName: 'Push', xp: 0, note: '', exercises: [{ name: 'Bench', exId: 'bench-press', sets: 3, reps: 8, weight: 50, setsDone: 3 }] });
    const loadHist = () => ev(`(() => { const s = JSON.parse(JSON.stringify(state)); s.history = ${J([wk(1), wk(2)])}; s.activities = []; s.demo = false;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); loadState(); renderAll(); switchTab('dnes'); return true; })()`);
    const cardHidden = () => ev(`document.getElementById('tour-invite').hidden`);
    const xpHidden = () => ev(`document.getElementById('xp-note').hidden`);
    await ev(`(localStorage.removeItem('gymquest_tutorial'), localStorage.removeItem('gymquest_xp_note'), true)`);
    await loadHist(); await wait(200);
    check('existing user with the XP note pending: XP note first, invitation card not shown', !(await xpHidden()) && await cardHidden());
    await click('btn-xp-note'); await wait(100);
    check('after the XP note is dismissed the invitation card appears', (await xpHidden()) && !(await cardHidden()));
    check('card: text, Start and Not now (44 px)', await ev(`(() => { const c = document.getElementById('tour-invite'); const b = Array.from(c.querySelectorAll('button')); return /1-minute tour/.test(c.textContent) && b.map((x) => x.textContent).join() === 'Start,Not now' && b.every((x) => { const r = x.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }); })()`));
    check('never both at once', !(await ev(`!document.getElementById('xp-note').hidden && !document.getElementById('tour-invite').hidden`)));
    await click('btn-tour-later'); await wait(100);
    check('Not now hides the card and stores invited-dismissed', (await cardHidden()) && await ev(`JSON.parse(localStorage.gymquest_tutorial).status === 'invited-dismissed'`));
    await p.navigate(BASE); await wait(500);
    check('after reload the card stays hidden for good', await cardHidden());
    await ev(`(localStorage.removeItem('gymquest_tutorial'), renderAll(), true)`);
    check('card shows again when there is no key (existing user)', !(await cardHidden()));
    const before3 = await snap();
    await click('btn-tour-start'); await wait(300);
    check('Start opens the tour (card hidden)', (await open()) && await cardHidden());
    await click('tour-skip'); await wait(100);
    check('Skip on the invited tour: card gone, state untouched', (await cardHidden()) && (await snap()) === before3);
    await ev(`(localStorage.setItem('gymquest_xp_note', '1'), true)`);
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      check('invite/help keys exist in ' + lang, await ev(`['tour.invite','tour.invite.start','tour.invite.later','tour.help','tour.help.show','tour.help.busy'].every((k) => typeof I18N[${J(lang)}][k] === 'string' && I18N[${J(lang)}][k].length)`));
    }

    console.log('== Nastavenia → Pomoc');
    await ev(`(() => { const o = document.createElement('button'); o.id = 'btn-opener2'; o.textContent = 'opener'; document.getElementById('screen-dnes').prepend(o); return true; })()`);
    const openSet = () => ev(`(document.getElementById('btn-opener2').focus(), openSettings(), true)`);
    await openSet(); await wait(100);
    check('Help group exists with a 44 px button', await ev(`(() => { const b = document.getElementById('btn-tour-help'); const r = b.getBoundingClientRect(); return !b.disabled && b.textContent === 'Show the tour' && document.getElementById('set-help-t').textContent === 'Help' && r.height >= 44; })()`));
    await click('btn-tour-help'); await wait(300);
    check('replay: settings closed, tour opens at step 1', (await open()) && await ev(`document.getElementById('modal-settings').hidden && document.getElementById('tour').dataset.step === 'plan'`));
    await click('tour-close'); await wait(100);
    check('focus returns to whoever opened Settings', await ev(`document.activeElement === document.getElementById('btn-opener2')`), await ev(`document.activeElement.id + '/' + document.activeElement.tagName + '/' + document.hasFocus()`));
    check('replay works again and even after done', await (async () => { await ev(`localStorage.setItem('gymquest_tutorial', JSON.stringify({ v: 1, status: 'done', at: 'x' }))`); await openSet(); await click('btn-tour-help'); await wait(200); const o = await open(); await click('tour-close'); await wait(100); return o && await ev(`JSON.parse(localStorage.gymquest_tutorial).status === 'done'`); })());
    /* aktívny tréning: tlačidlo vypnuté s dôvodom, nič sa nespustí */
    await ev(`(ensureSession(), saveState(), renderAll(), true)`); await wait(100);
    await openSet(); await wait(100);
    check('active workout: Help button disabled and a hint shown', await ev(`document.getElementById('btn-tour-help').disabled && !document.getElementById('tour-help-busy').hidden && document.getElementById('tour-help-busy').textContent === 'Finish your workout first.'`));
    await ev(`(document.getElementById('btn-tour-help').click(), true)`); await wait(150);
    check('clicking the disabled button does nothing', !(await open()) && await ev(`!document.getElementById('modal-settings').hidden`));
    await click('btn-settings-close'); await wait(50);
    check('active workout: tourFirstRun / invitation never start', await ev(`(() => { localStorage.removeItem('gymquest_tutorial'); state.history = []; tourFirstRun(); const a = tourOpen(); state.history = [${J(wk(1))}]; renderAll(); return !a && document.getElementById('tour-invite').hidden && !tourOpen(); })()`));
    await ev(`(localStorage.setItem('gymquest_tutorial', JSON.stringify({ v: 1, status: 'done', at: 'x' })), true)`);
    await ev(`(state.activeSession = null, saveState(), renderAll(), true)`); await wait(100);
    await openSet(); await wait(100);
    check('after the workout the Help button works again', await ev(`!document.getElementById('btn-tour-help').disabled && document.getElementById('tour-help-busy').hidden`));
    await click('btn-settings-close'); await wait(50);

    console.log('== ustúpenie (yield)');
    const startT = async () => { await ev(`startTour(TOUR_STEPS, {})`); await wait(250); };
    const doneKey = `JSON.parse(localStorage.gymquest_tutorial).status === 'done'`;
    for (const id of ['modal-sync', 'modal-settings', 'modal-confirm', 'modal-setup', 'modal-generic', 'modal-rest']) {
      await startT();
      await ev(`(document.getElementById(${J(id)}).hidden = false, true)`); await wait(100);
      check('opening ' + id + ' closes the tour (yield, key unchanged)', !(await open()) && await ev(doneKey) && await ev(`!document.getElementById('tour')`));
      await ev(`(document.getElementById(${J(id)}).hidden = true, true)`);
    }
    await startT();
    await ev(`(document.getElementById('modal-measure').hidden = false, document.getElementById('modal-measure').hidden = true, true)`); await wait(100);
    await ev(`closeTour('yield')`);
    await startT();
    await ev(`(ensureSession(), true)`); await wait(100);
    check('a workout starting closes the tour', !(await open()));
    await ev(`(state.activeSession = null, saveState(), renderAll(), true)`);
    /* ponuka aktualizácie */
    await startT();
    await ev(`(swUpdateReady = true, refreshUpdateBanner(), true)`); await wait(100);
    check('update notice appearing closes the tour and the banner is visible', !(await open()) && await ev(`!document.getElementById('update-banner').hidden`));
    await ev(`(swUpdateReady = false, refreshUpdateBanner(), true)`);
    /* sync konflikt / odkazy: reálny dialóg sync sa otvára cez modal-sync; hore overené */
    await startT();
    check('Android Back closes the tour even with no modal open', (await ev(`nativeBack()`)) === 'closed' && !(await open()));
    check('while the tour runs backup offers are blocked', await (async () => { await startT(); const r = await ev(`backupBlocked()`); await ev(`closeTour('yield')`); return r === true; })());
    check('the tour never starts with a modal open (tourCanStart)', await ev(`(() => { document.getElementById('modal-measure').hidden = false; const r = tourCanStart(); document.getElementById('modal-measure').hidden = true; return !r && tourCanStart(); })()`));
    check('tutorial state never inside app state after all this', await ev(`!JSON.stringify(state).includes('gymquest_tutorial')`));

    console.log('== oprava 1: účet bez dát, test opt-out, aria, dialóg vytvorený neskôr');
    const resetAcct = () => ev(`(localStorage.removeItem('gymquest_tutorial'), localStorage.setItem('gymquest_xp_note', '1'), state.history = [], state.activities = [], state.demo = false, wsSlot.owner = 'test-owner', syncLoading = true, syncMetaUpdate((m) => { m.rev = null; }), renderAll(), true)`);
    await resetAcct();
    check('account workspace, first pull running: no invitation, no auto-start', await cardHidden() && !(await open()));
    await ev(`(syncLoading = false, syncMetaUpdate((m) => { m.rev = 0; }), renderTourInvite(), true)`);
    check('account workspace, first pull finished, no data/key: invitation shown, tour NOT auto-started', !(await cardHidden()) && !(await open()));
    await ev(`(localStorage.setItem('gymquest_tutorial', JSON.stringify({ v: 1, status: 'done', at: 'x' })), renderTourInvite(), true)`);
    check('account workspace with a done key: no invitation', await cardHidden());
    await ev(`(localStorage.removeItem('gymquest_tutorial'), state.history = [${J(wk(1))}], renderAll(), true)`);
    check('returning account with history: invitation per the usual rule', !(await cardHidden()));
    await ev(`(state.history = [], wsSlot.owner = null, renderAll(), true)`);
    check('guest workspace without data: no invitation (needs history or a finished account pull)', await cardHidden());
    await ev(`(syncMetaUpdate((m) => { m.rev = null; }), true)`);
    /* testovací opt-out */
    await ev(`(window.__GQ_TEST__ = {}, sessionStorage.removeItem('gq_test_tour'), localStorage.removeItem('gymquest_tutorial'), state.history = [${J(wk(1))}], renderAll(), true)`);
    check('__GQ_TEST__ without gq_test_tour: invitation hidden, tourFirstRun does nothing', await cardHidden() && await ev(`(() => { state.history = []; tourFirstRun(); const o = tourOpen(); state.history = [${J(wk(1))}]; return !o; })()`));
    await ev(`(sessionStorage.setItem('gq_test_tour', '1'), renderAll(), true)`);
    check('gq_test_tour=1 turns the real behaviour back on', !(await cardHidden()));
    await ev(`(delete window.__GQ_TEST__, sessionStorage.removeItem('gq_test_tour'), state.history = [], renderAll(), true)`);
    /* a11y + banner + neskôr vytvorený dialóg */
    await ev(`(ensureSession(), true)`);
    check('disabled Help button points at its hint via aria-describedby', await ev(`(openSettings(), document.getElementById('btn-tour-help').getAttribute('aria-describedby') === 'tour-help-busy')`));
    await ev(`(document.getElementById('btn-settings-close').click(), state.activeSession = null, saveState(), renderAll(), openSettings(), true)`);
    check('enabled Help button has no aria-describedby', await ev(`!document.getElementById('btn-tour-help').hasAttribute('aria-describedby')`));
    await ev(`(document.getElementById('btn-settings-close').click(), swUpdateReady = true, refreshUpdateBanner(), true)`);
    check('update notice visible: tourCanStart false (replay/first run do not start over it)', await ev(`updateBannerVisible() && !tourCanStart()`));
    await ev(`(swUpdateReady = false, refreshUpdateBanner(), true)`);
    await startT();
    await ev(`(() => { const d = document.createElement('div'); d.id = 'late-modal'; d.className = 'modal-backdrop'; d.innerHTML = '<div class="modal">x</div>'; document.body.appendChild(d); return true; })()`); await wait(100);
    check('a .modal-backdrop created after the tour started (e.g. "Use here") closes the tour', !(await open()));
    await ev(`(document.getElementById('late-modal').remove(), true)`);
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
