'use strict';
/* GymQuest — pripomienky v2 (0019) v appke: voda vo vybraných časoch, až 6 časov jedla, vlastné pripomienky.
   Headless Chrome, falošný Capacitor (LocalNotifications) a falošný Supabase klient (RPC), bez siete.

     GQ_TEST_PORT=8173 node tests/app/reminders-v2.js

   Kontroluje: verzia servera < 11 = dnešná karta a dnešné telo reminders_set (bez nových kľúčov); verzia 11 =
   prepínač režimu vody, pridať/odobrať časy (limity 12 / 6 / 10), vlastné pripomienky (text, čas, dni),
   rozpracované úpravy prežijú prekreslenie, neplatný vlastný text sa neodošle, text sa nikdy nevloží ako HTML,
   telo reminders_set, naplánované lokálne upozornenia (nové druhy so stabilnými ID v 1000–3999), všetkých 6 jazykov,
   dotykové plochy ≥ 44 px, polia ≥ 16 px, bez pretečenia pri 320 px aj 130 % textu (ar), snímky.
   Snímky: SHOTS (predvolene ../claude-code/phase8/task5). */
const fs = require('fs');
const path = require('path');
const { counter, startServerOnce, openApp, closeAll, nativeCalls, clearNativeCalls } = require('../android/lib-native');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const t = counter();
const check = t.check;
const SHOTS = process.env.SHOTS || path.resolve(__dirname, '../../../claude-code/phase8/task5');
const ME = '11111111-2222-3333-4444-555555555555';
const SERVER = { water_on: true, water_every: 120, water_from: '08:00', water_to: '21:00', meals_on: true, meal_times: ['08:00', '12:30', '18:30'],
  workout_on: true, workout_days: [1, 3, 5], workout_time: '17:00', tz: 'Europe/Bratislava', saved: true };

(async () => {
  const server = await startServerOnce(require('os').tmpdir());
  try {
    fs.mkdirSync(SHOTS, { recursive: true });
    const { p, errors } = await openApp({ name: 'remv2', debugPort: 9941, native: true, lang: 'en',
      returns: { 'LocalNotifications.checkPermissions': { display: 'granted' }, 'LocalNotifications.getPending': { notifications: [] } } });
    const ev = (s) => p.eval(s);
    const shot = async (name) => { const r = await p.c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64')); };
    const view = (w, h) => p.c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h || 900, deviceScaleFactor: 2, mobile: true });
    await ev(`(localStorage.setItem('gymquest_tutorial','{"v":1,"status":"done","at":0}'), true)`);
    await wait(800);
    /* falošný server: reminders_get / reminders_set si pamätá posledný objekt (ako skutočný server s "absent = keep") */
    await ev(`(() => {
      window.__rpc = [];
      window.__store = ${JSON.stringify(SERVER)};
      window.__fakeSb = { rpc: async (fn, args) => {
        window.__rpc.push({ fn, args: JSON.parse(JSON.stringify(args || {})) });
        if (fn === 'reminders_get') return { data: window.__store };
        if (fn === 'reminders_set') { window.__store = Object.assign({}, window.__store, args.p, { saved: true }); return { data: window.__store }; }
        return { data: null };
      } };
      communityClient = () => window.__fakeSb;
      communityProfile = { id: ${JSON.stringify(ME)} };
      pushDeviceWrite({ uid: ${JSON.stringify(ME)} });
      nativeNotifPerm = 'granted';
      const scr = document.getElementById('screen-komunita');
      const box = document.createElement('div'); box.id = 'rem-test-box'; box.className = 'community'; scr.appendChild(box);
      renderCommunity = async () => { box.innerHTML = remindersCardHtml() + '<p id="rem-msg">' + esc(communityMessage || '') + '</p>'; };
      setThemePref('light');
      switchTab('komunita');
      Array.from(scr.children).forEach((c) => { if (c !== box) c.hidden = true; });
      return true; })()`);
    const render = async () => { await ev(`(renderCommunity(), true)`); await wait(60); };
    const click = async (sel) => { const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`); await wait(80); return r; };
    const set = (sel, v) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; return true; })()`);
    const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
    const lastRpc = (fn) => ev(`(window.__rpc.filter((r) => r.fn === ${JSON.stringify(fn)}).pop() || {}).args`);

    /* ---- starší server (verzia 10): dnešná karta ---- */
    await ev(`(communityVersion = 10, remindersData = ${JSON.stringify(SERVER)}, true)`);
    await render();
    check('v10 server: today’s card (3 meal inputs, no mode chips, no add buttons, no own reminders)',
      await count('#community-reminders input[id^="rem-meal-"]') === 3 && await count('.crem-mode') === 0 && await count('.crem-add') === 0 && await count('.crem-own') === 0);
    await click('[data-community-action="rem-save"]'); await wait(150);
    let a = await lastRpc('reminders_set');
    check('v10 server: reminders_set carries only the old key set (nothing new is sent)', a && !('water_mode' in a.p) && !('water_times' in a.p) && !('custom' in a.p)
      && a.p.meal_times.length === 3 && a.p.water_every === 120, a && Object.keys(a.p));

    /* ---- verzia 11 ---- */
    await ev(`(communityVersion = 11, remindersData = ${JSON.stringify(SERVER)}, remindersDraft = null, window.__rpc = [], true)`);
    await render();
    check('v11: mode chips, meal add button, own-reminders section (empty state)', await count('.crem-mode') === 2 && await count('[data-community-action="rem-meal-add"]') === 1
      && await count('[data-community-action="rem-own-add"]') === 1 && await count('.crem-empty') === 1 && await count('.crem-own') === 0);
    check('v11: interval mode shows every / from / to, no time rows', await count('#rem-water-every') === 1 && await count('input[id^="rem-wt-"]') === 0
      && await ev(`document.querySelector('.crem-mode.active').dataset.mode`) === 'interval');
    await click('.crem-mode[data-mode="times"]');
    check('"At set times": every/from/to hidden, add-time button, no rows yet', await count('#rem-water-every') === 0 && await count('[data-community-action="rem-wt-add"]') === 1 && await count('input[id^="rem-wt-"]') === 0);
    await click('[data-community-action="rem-wt-add"]'); await click('[data-community-action="rem-wt-add"]'); await click('[data-community-action="rem-wt-add"]');
    await set('#rem-wt-0', '07:45'); await set('#rem-wt-1', '10:03'); await set('#rem-wt-2', '15:47');
    await click('[data-community-action="rem-wt-add"]');   // 4th – the 3 typed values must survive the re-render
    check('typed times survive adding a row (draft)', await ev(`['rem-wt-0','rem-wt-1','rem-wt-2','rem-wt-3'].map((i) => document.getElementById(i).value).join(',')`) === '07:45,10:03,15:47,12:00');
    await click('[data-community-action="rem-wt-del"][data-i="3"]');
    await click('[data-community-action="rem-wt-del"][data-i="0"]');
    check('removing rows works (07:45 and the extra 12:00 are gone)', await ev(`Array.from(document.querySelectorAll('input[id^="rem-wt-"]')).map((e) => e.value).join(',')`) === '10:03,15:47');
    await click('.crem-mode[data-mode="interval"]'); await click('.crem-mode[data-mode="times"]');
    check('switching modes back and forth keeps the times', await ev(`Array.from(document.querySelectorAll('input[id^="rem-wt-"]')).map((e) => e.value).join(',')`) === '10:03,15:47');
    for (let i = 0; i < 12; i++) await click('[data-community-action="rem-wt-add"]');
    check('water times are capped at 12 (add button gone)', await count('input[id^="rem-wt-"]') === 12 && await count('[data-community-action="rem-wt-add"]') === 0);
    for (let i = 11; i >= 2; i--) await click('[data-community-action="rem-wt-del"][data-i="' + i + '"]');
    // meals
    for (let i = 0; i < 5; i++) await click('[data-community-action="rem-meal-add"]');
    check('meals are capped at 6 (add button gone)', await count('input[id^="rem-meal-"]') === 6 && await count('[data-community-action="rem-meal-add"]') === 0);
    await click('[data-community-action="rem-meal-del"][data-i="5"]'); await click('[data-community-action="rem-meal-del"][data-i="4"]');
    await set('#rem-meal-3', '21:15');
    // own reminders
    await click('[data-community-action="rem-own-add"]');
    check('adding an own reminder: row with text, time, 7 day chips (all on), focus in the text field',
      await count('.crem-own') === 1 && await count('.crem-own .crem-oday.active') === 7 && await ev(`document.activeElement && document.activeElement.id`) === 'rem-c-text-0');
    await set('#rem-c-text-0', '  Take   creatine ');
    await click('[data-community-action="rem-own-add"]');
    await set('#rem-c-text-1', '<b>Stretch</b> "now" & <img src=x onerror=window.__pwned=1>');
    await set('#rem-c-time-1', '21:30');
    const ownDay = (row, d) => ev(`(() => { document.querySelectorAll('.crem-own')[${row}].querySelector('.crem-oday[data-day="${d}"]').click(); return true; })()`);
    for (const d of [6, 7]) await ownDay(1, d);
    check('weekday chips toggle (aria-pressed)', await ev(`document.querySelectorAll('.crem-own')[1].querySelectorAll('.crem-oday.active').length`) === 5
      && await ev(`document.querySelectorAll('.crem-own')[1].querySelector('.crem-oday[data-day="6"]').getAttribute('aria-pressed')`) === 'false');
    await click('[data-community-action="rem-wt-add"]');   // any re-render: own rows must survive too
    check('own-reminder edits survive a re-render', await ev(`document.getElementById('rem-c-text-0').value`) === '  Take   creatine '
      && await ev(`document.getElementById('rem-c-time-1').value`) === '21:30' && await count('.crem-own') === 2);
    await click('[data-community-action="rem-wt-del"][data-i="2"]');
    check('HTML in the text is only text: no element created, value kept', await count('#community-reminders b') === 0 && await count('#community-reminders img') === 0
      && await ev(`window.__pwned === undefined`) && await ev(`document.getElementById('rem-c-text-1').value`) === '<b>Stretch</b> "now" & <img src=x onerror=window.__pwned=1>');
    // invalid: empty text → nothing sent
    await click('[data-community-action="rem-own-add"]');
    await ev(`(window.__rpc = [], true)`);
    await click('[data-community-action="rem-save"]'); await wait(100);
    check('an own reminder without text is not sent; error shown; edits kept', (await ev(`window.__rpc.filter((r) => r.fn === 'reminders_set').length`)) === 0
      && /text/i.test(await ev(`document.getElementById('rem-msg').textContent`)) && await count('.crem-own') === 3 && await ev(`document.getElementById('rem-c-text-0').value`) !== '');
    await click('[data-community-action="rem-own-del"][data-i="2"]');
    await clearNativeCalls(p);
    await click('[data-community-action="rem-save"]'); await wait(300);
    a = await lastRpc('reminders_set');
    check('save: payload has water_mode "times" with only valid times and the old keys', a && a.p.water_mode === 'times' && JSON.stringify(a.p.water_times) === '["10:03","15:47"]'
      && a.p.water_on === true && a.p.meals_on === true && JSON.stringify(a.p.workout_days) === '[1,3,5]' && a.p.workout_time === '17:00' && typeof a.p.tz === 'string' && a.p.water_every === 120, a && JSON.stringify(a.p));
    check('save: meal times as typed (4 rows: 08:00, 12:30, 18:30, 21:15)', JSON.stringify(a.p.meal_times) === '["08:00","12:30","18:30","21:15"]', JSON.stringify(a.p.meal_times));
    check('save: own reminders — ids kept, text trimmed and collapsed (plain, HTML untouched), days sorted',
      a.p.custom.length === 2 && /^[A-Za-z0-9_-]{1,40}$/.test(a.p.custom[0].id) && a.p.custom[0].text === 'Take creatine' && a.p.custom[0].time === '09:00' && a.p.custom[0].days.length === 7
      && a.p.custom[1].text === '<b>Stretch</b> "now" & <img src=x onerror=window.__pwned=1>'.slice(0, 60) && JSON.stringify(a.p.custom[1].days) === '[1,2,3,4,5]' && a.p.custom[1].time === '21:30', JSON.stringify(a.p.custom));
    check('draft cleared after saving; message "saved"', await ev(`remindersDraft === null`) && /saved/i.test(await ev(`document.getElementById('rem-msg').textContent`)));
    const sched = (await nativeCalls(p, 'LocalNotifications', 'schedule')).pop();
    const list = sched ? sched.args[0].notifications : [];
    const byKind = (lo, hi) => list.filter((n) => n.id >= lo && n.id < hi);
    check('native: water at set times → ids 1000, 1001 at 10:03 and 15:47', byKind(1000, 2000).length === 2 && byKind(1000, 2000)[0].schedule.on.hour === 10 && byKind(1000, 2000)[0].schedule.on.minute === 3
      && byKind(1000, 2000)[1].schedule.on.hour === 15 && byKind(1000, 2000)[1].schedule.on.minute === 47, JSON.stringify(byKind(1000, 2000).map((n) => [n.id, n.schedule.on])));
    check('native: 4 meals (2000–2003), workout Mon/Wed/Fri', byKind(2000, 3000).length === 4 && byKind(3000, 3100).length === 3);
    const own = byKind(3100, 3200);
    check('native: own reminders — daily one (id 3100, no weekday) and 5 weekday ones (3109–3113) with the user text as body',
      own.length === 6 && own[0].id === 3100 && !own[0].schedule.on.weekday && own[0].body === 'Take creatine' && own.slice(1).every((n) => n.body === '<b>Stretch</b> "now" & <img src=x onerror=window.__pwned=1>'.slice(0, 60))
      && JSON.stringify(own.slice(1).map((n) => n.id)) === '[3109,3110,3111,3112,3113]' && JSON.stringify(own.slice(1).map((n) => n.schedule.on.weekday)) === '[2,3,4,5,6]', JSON.stringify(own.map((n) => [n.id, n.schedule.on.weekday])));
    check('native: all ids unique and inside 1000–3999', new Set(list.map((n) => n.id)).size === list.length && list.every((n) => n.id >= 1000 && n.id < 4000));

    /* limity vlastných pripomienok */
    await ev(`(remindersDraft = null, remindersData = Object.assign({}, window.__store, { custom: Array.from({ length: 10 }, (_, i) => ({ id: 'q' + i, text: 'n' + i, time: '08:00', days: [1] })) }), true)`);
    await render();
    check('10 own reminders: add button gone', await count('.crem-own') === 10 && await count('[data-community-action="rem-own-add"]') === 0);
    await click('[data-community-action="rem-own-del"][data-i="9"]');
    check('after deleting one the add button is back', await count('[data-community-action="rem-own-add"]') === 1);

    /* ---- jazyky, rozmery, snímky ---- */
    const FULL = { water_on: true, water_every: 120, water_from: '08:00', water_to: '21:00', water_mode: 'times', water_times: ['07:45', '10:03', '15:47'],
      meals_on: true, meal_times: ['08:00', '12:30', '18:30', '21:15'], workout_on: true, workout_days: [1, 3, 5], workout_time: '17:00', saved: true,
      custom: [{ id: 'a1', text: 'Take creatine', time: '09:00', days: [1, 2, 3, 4, 5, 6, 7] }, { id: 'a2', text: 'Stretch for 10 minutes', time: '21:30', days: [1, 2, 3, 4, 5] }] };
    const KEYS = ['waterMode', 'modeInterval', 'modeTimes', 'waterTimeN', 'addTime', 'removeTime', 'addMeal', 'removeMeal', 'own', 'ownNone', 'addOwn', 'ownText', 'ownPlaceholder', 'ownTime', 'ownDays', 'removeOwn', 'errOwn', 'errInvalid2'];
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await ev(`(setLang(${JSON.stringify(lang)}), remindersDraft = null, remindersData = ${JSON.stringify(FULL)}, true)`);
      await render();
      const miss = await ev(`${JSON.stringify(KEYS)}.filter((k) => { const v = t('rem.' + k, { n: 1 }); return !v || v === 'rem.' + k; })`);
      check(lang + ': all 18 new strings present', miss.length === 0, miss);
      check(lang + ': dir ' + (lang === 'ar' ? 'rtl' : 'ltr'), await ev(`document.documentElement.dir`) === (lang === 'ar' ? 'rtl' : 'ltr'));
    }
    const geometry = async (label) => {
      const g = await ev(`(() => {
        const card = document.getElementById('community-reminders'), cr = card.getBoundingClientRect();
        const tap = Array.from(card.querySelectorAll('button, input[type="time"], input[type="text"], select, input[type="checkbox"]')).filter((e) => e.type !== 'checkbox');
        const small = tap.filter((e) => { const r = e.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).map((e) => e.id || e.className || e.tagName);
        const fs = tap.filter((e) => e.matches('input[type="text"], input[type="time"]')).filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.id);
        const out = tap.filter((e) => { const r = e.getBoundingClientRect(); return r.right > cr.right + 1 || r.left < cr.left - 1; }).map((e) => e.id || e.className);
        return { small, fs, out, sw: card.scrollWidth, cw: card.clientWidth, docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
      })()`);
      check(label + ': every button / field ≥ 44 px', g.small.length === 0, g.small.slice(0, 6));
      check(label + ': text and time fields ≥ 16 px', g.fs.length === 0, g.fs.slice(0, 6));
      check(label + ': nothing overflows the card or the page', g.out.length === 0 && g.sw <= g.cw + 1 && !g.docOverflow, JSON.stringify(g));
    };
    await ev(`(setLang('en'), setThemePref('light'), true)`);
    await view(393); await render();
    await geometry('en light 393');
    await ev(`(document.getElementById('community-reminders').scrollIntoView(), true)`);
    await shot('card-en-light-393.png');
    await ev(`(setLang('sk'), setThemePref('dark'), true)`);
    await render(); await geometry('sk dark 393');
    await ev(`(document.getElementById('community-reminders').scrollIntoView(), true)`);
    await shot('card-sk-dark-393.png');
    await ev(`(setLang('ar'), setThemePref('light'), true)`);
    await view(320); await render(); await geometry('ar light 320');
    await ev(`(document.getElementById('community-reminders').scrollIntoView(), true)`);
    await shot('card-ar-320.png');
    await ev(`(document.documentElement.style.fontSize = '130%', true)`);
    await render(); await geometry('ar light 320 text 130 %');
    await ev(`(setLang('fr'), true)`);
    await render(); await geometry('fr light 320 text 130 %');
    await ev(`(document.documentElement.style.fontSize = '', setLang('en'), true)`);
    await view(393); await render();
    await ev(`(document.getElementById('community-reminders').scrollIntoView(), true)`);
    // full-height capture of the card (en light 393) for the report
    const box = await ev(`(() => { const r = document.getElementById('community-reminders').getBoundingClientRect(); return { x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height }; })()`);
    const full = await p.c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 1 } });
    fs.writeFileSync(path.join(SHOTS, 'card-en-light-393-full.png'), Buffer.from(full.data, 'base64'));
    check('no console errors', errors.length === 0, errors.slice(0, 5));
  } catch (e) {
    check('no exception in test', false, String(e && e.stack || e));
  } finally {
    closeAll();
    server.close();
    console.log(`\n${t.pass} passed, ${t.fail} failed`);
    process.exit(t.fail ? 1 : 0);
  }
})();
