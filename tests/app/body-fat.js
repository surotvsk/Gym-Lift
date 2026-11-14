'use strict';
/* GymQuest — kalkulačka telesného tuku (US Navy) uložená ako dátumované meranie. Headless Chrome, bez siete.

     GQ_TEST_PORT=8171 node tests/app/body-fat.js

   Kontroluje: vzorec (očakávané hodnoty sa počítajú v teste zo vzorca zo zadania), živý výsledok v UI,
   odmietnutie nemožných vstupov, uloženie / úpravu / zmazanie, doplnenie existujúceho merania v ten deň,
   profil (výška, pohlavie), imperiálne jednotky, súhrn + história + graf, 6 jazykov (ar RTL, 320 px),
   a prežitie nových polí cez starý normalizér (zrkadlo settings.measureExtra).
   Snímky: SHOTS (predvolene ../claude-code/phase8/task2). */
const fs = require('fs');
const path = require('path');
const { counter, startServerOnce, openApp, closeAll } = require('../android/lib-native');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const t = counter();
const check = t.check;
const SHOTS = process.env.SHOTS || path.resolve(__dirname, '../../../claude-code/phase8/task2');

/* Nezávislá implementácia vzorca zo zadania (cm, log10). */
const navyMale = (h, n, w) => 495 / (1.0324 - 0.19077 * Math.log10(w - n) + 0.15456 * Math.log10(h)) - 450;
const navyFemale = (h, n, w, hp) => 495 / (1.29579 - 0.35004 * Math.log10(w + hp - n) + 0.22100 * Math.log10(h)) - 450;
const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);

(async () => {
  const server = await startServerOnce(require('os').tmpdir());
  try {
    fs.mkdirSync(SHOTS, { recursive: true });
    const { p, errors } = await openApp({ name: 'bodyfat', debugPort: 9938, native: false, lang: 'en' });
    const ev = (s) => p.eval(s);
    await ev(`(localStorage.setItem('gymquest_tutorial','{"v":1,"status":"done","at":0}'), true)`);
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 900, deviceScaleFactor: 2, mobile: true });
    await ev(`(switchTab('pokrok'), setPokrokView('body'), setThemePref('light'), true)`);
    await wait(400);
    /* Vyplní pole kalkulačky tak, ako by písal používateľ (input udalosti). */
    const fill = (o) => ev(`(() => { const o = ${JSON.stringify(o)};
      for (const k of Object.keys(o)) { const el = document.getElementById('bf-' + k); el.value = o[k]; el.dispatchEvent(new Event('input', { bubbles: true })); }
      return true; })()`);
    const result = () => ev(`document.getElementById('bf-result').textContent`);
    const saveDisabled = () => ev(`document.getElementById('btn-bf-save').disabled`);
    const click = (id) => ev(`(document.getElementById(${JSON.stringify(id)}).click(), true)`);

    check('card is on the Body screen', await ev(`!!document.getElementById('bodyfat-card') && !document.getElementById('bodyfat-card').hidden`));
    check('empty: prompt to fill in, Save disabled', /Fill in/.test(await result()) && await saveDisabled());
    check('no hip field for an unset/male sex', await ev(`document.getElementById('bf-hip').closest('.field').hidden`));

    /* --- vzorec: muž --- */
    const m = navyMale(180, 38, 85);
    await fill({ sex: 'male', height: '180', neck: '38', waist: '85' });
    check('male 180/38/85: UI shows ' + r1(m) + ' % (formula)', (await result()).includes(r1(m) + ' %'), await result());
    check('male: Save enabled, hip hidden', !(await saveDisabled()) && await ev(`document.getElementById('bf-hip').closest('.field').hidden`));

    /* --- vzorec: žena --- */
    const f = navyFemale(165, 32, 75, 100);
    await fill({ sex: 'female', height: '165', neck: '32', waist: '75', hip: '100' });
    check('female 165/32/75/100: UI shows ' + r1(f) + ' % (formula)', (await result()).includes(r1(f) + ' %'), await result());
    check('female: hip field visible', !(await ev(`document.getElementById('bf-hip').closest('.field').hidden`)));
    await fill({ hip: '' });
    check('female without hip: prompt, Save disabled', /Fill in/.test(await result()) && await saveDisabled());

    /* --- nemožné vstupy --- */
    await fill({ sex: 'male', neck: '90', waist: '85' });
    check('waist <= neck: clear message, Save disabled', /Waist must be larger than neck/.test(await result()) && await saveDisabled(), await result());
    await fill({ sex: 'female', hip: '10', neck: '120', waist: '50' });
    check('female waist + hip <= neck: message', /Waist must be larger than neck/.test(await result()) && await saveDisabled(), await result());
    await fill({ sex: 'male', neck: '20', waist: '300', height: '150' });
    check('result above 60 %: out-of-range message, Save disabled', /outside 3–60/.test(await result()) && await saveDisabled(), await result());
    await fill({ sex: 'male', neck: '60', waist: '62', height: '200' });
    check('result below 3 %: out-of-range message', /outside 3–60/.test(await result()) && await saveDisabled(), await result());
    await fill({ sex: 'male', neck: '-5', waist: '85', height: '180' });
    check('negative neck treated as empty (no result)', /Fill in/.test(await result()) && await saveDisabled());

    /* --- uloženie --- */
    await fill({ date: '2026-11-01', sex: 'male', height: '180', neck: '38', waist: '85' });
    check('no profile yet before Save', await ev(`state.profile.heightCm === null && state.profile.sex === null`));
    await ev(`(document.getElementById('btn-bf-save').focus(), true)`);   // ako skutočný ťuk: fokus ostane v karte, karta sa neprekreslí
    await click('btn-bf-save'); await wait(300);
    let ms = JSON.parse(await ev(`JSON.stringify(state.measurements)`));
    check('Save creates one dated measurement with neck, waist and bodyFatPct', ms.length === 1 && ms[0].date === '2026-11-01' && ms[0].neckCm === 38 && ms[0].waistCm === 85 && ms[0].bodyFatPct === Math.round(m * 10) / 10 && ms[0].hipCm === null, ms);
    check('Save wrote height and sex to the profile', await ev(`state.profile.heightCm === 180 && state.profile.sex === 'male'`));
    check('"Saved" message shown', /Saved to the measurement from/.test(await ev(`document.getElementById('bf-msg').textContent`)) && !(await ev(`document.getElementById('bf-msg').hidden`)));
    check('after Save the "will be updated" note is refreshed (not stale)', !(await ev(`document.getElementById('bf-updates').hidden`)) && /1/.test(await ev(`document.getElementById('bf-updates').textContent`)), await ev(`document.getElementById('bf-updates').textContent`));
    check('summary row shows body fat and neck', /Body fat/.test(await ev(`document.getElementById('body-summary').textContent`)) && /Neck/.test(await ev(`document.getElementById('body-summary').textContent`)));
    check('summary shows the body fat value with %', (await ev(`document.getElementById('body-summary').textContent`)).includes(r1(m) + ' %'), await ev(`document.getElementById('body-summary').textContent`));
    const hist = await ev(`document.getElementById('body-history').textContent`);
    check('history lists Body fat ' + r1(m) + ' and Neck 38.0 cm', hist.includes('Body fat ' + r1(m)) && hist.includes('Neck 38.0 cm') && hist.includes('Waist 85.0 cm'), hist);
    check('chart chips include Neck and Body fat', await ev(`[...document.querySelectorAll('#body-metric-chips .metric-chip')].map((c) => c.textContent).join('|')`) === 'Waist|Neck|Body fat');

    /* --- ďalší deň (graf potrebuje 2 body) a doplnenie existujúceho dňa --- */
    await fill({ date: '2026-11-08', sex: 'male', height: '180', neck: '37', waist: '83' });
    await click('btn-bf-save'); await wait(300);
    check('a second date adds a second measurement', await ev(`state.measurements.length === 2`));
    await ev(`(setPokrokView('body'), true)`);
    await ev(`(document.querySelector('#body-metric-chips [data-field="bodyFatPct"]').click(), true)`); await wait(200);
    check('chart for Body fat draws a line with a % range', await ev(`!!document.querySelector('#body-chart svg') && /%/.test(document.getElementById('body-chart-range').textContent)`), await ev(`document.getElementById('body-chart-range').textContent`));
    await ev(`(document.activeElement && document.activeElement.blur(), renderPokrok(), true)`);
    await fill({ date: '2026-11-08', sex: 'male', height: '180', neck: '36', waist: '84' });
    check('an existing date shows the "will be updated" note', !(await ev(`document.getElementById('bf-updates').hidden`)));
    await click('btn-bf-save'); await wait(300);
    ms = JSON.parse(await ev(`JSON.stringify(state.measurements)`));
    check('saving on an existing date updates that measurement (no duplicate)', ms.length === 2 && ms.filter((x) => x.date === '2026-11-08').length === 1 && ms.find((x) => x.date === '2026-11-08').neckCm === 36 && ms.find((x) => x.date === '2026-11-08').waistCm === 84, ms);
    /* doplnenie nezmaže inú hodnotu toho istého dňa */
    await ev(`(state.measurements.find((x) => x.date === '2026-11-08').weightKg = 80, saveState(), true)`);
    await ev(`(document.activeElement && document.activeElement.blur(), renderPokrok(), true)`);
    await fill({ date: '2026-11-08', sex: 'male', height: '180', neck: '36', waist: '84' });
    await click('btn-bf-save'); await wait(300);
    check('saving keeps other fields of that day (weight 80)', await ev(`state.measurements.find((x) => x.date === '2026-11-08').weightKg === 80`));

    /* --- úprava a zmazanie cez existujúce UI --- */
    const editId = await ev(`state.measurements.find((x) => x.date === '2026-11-08').id`);
    await ev(`(openMeasureModal(${JSON.stringify(editId)}), true)`);
    check('manual modal has Neck and Body fat fields prefilled', await ev(`document.getElementById('m-neckCm').value === '36' && document.getElementById('m-bodyFatPct').value !== ''`));
    await ev(`(document.getElementById('m-bodyFatPct').value = '14.5', document.getElementById('m-neckCm').value = '35', document.getElementById('btn-measure-save').click(), true)`); await wait(200);
    check('editing in the modal updates bodyFatPct and neck', await ev(`(() => { const x = state.measurements.find((y) => y.id === ${JSON.stringify(editId)}); return x.bodyFatPct === 14.5 && x.neckCm === 35; })()`));
    await ev(`(openMeasureModal(${JSON.stringify(editId)}), document.getElementById('m-bodyFatPct').value = '75', document.getElementById('btn-measure-save').click(), true)`); await wait(100);
    check('body fat 75 % in the modal is rejected (3–60)', await ev(`!document.getElementById('measure-error').hidden && /Body fat/.test(document.getElementById('measure-error').textContent)`));
    await ev(`(document.getElementById('btn-measure-cancel').click(), true)`);
    await ev(`(openMeasureModal(${JSON.stringify(editId)}), document.getElementById('m-bodyFatPct').value = '', document.getElementById('m-neckCm').value = '', document.getElementById('btn-measure-save').click(), true)`); await wait(200);
    check('clearing the fields in the modal really removes them (no mirror resurrection)', await ev(`(() => { const x = state.measurements.find((y) => y.id === ${JSON.stringify(editId)}); return !x.bodyFatPct && !x.neckCm && !(state.settings.measureExtra || {})[x.id]; })()`));
    await ev(`(requestDeleteMeasurement(${JSON.stringify(editId)}), true)`);
    await ev(`(document.querySelector('#modal-generic .btn-danger, #modal-generic .btn-primary').click(), true)`); await wait(200);
    check('delete removes the measurement and its mirror entry', await ev(`state.measurements.length === 1 && !(state.settings.measureExtra || {})[${JSON.stringify(editId)}]`));

    /* --- imperiálne jednotky --- */
    await ev(`(setBodyUnits('imperial'), true)`); await wait(200);
    check('imperial: labels are in', await ev(`document.querySelector('label[for="bf-neck"]').textContent.includes('(in)') && document.querySelector('label[for="bf-height"]').textContent.includes('(in)')`));
    const inch = (cm) => String(Math.round(cm / 2.54 * 10) / 10);
    check('imperial: prefilled from latest measurement and profile', await ev(`document.getElementById('bf-neck').value === ${JSON.stringify(inch(38))} && document.getElementById('bf-height').value === ${JSON.stringify(inch(180))}`));
    await fill({ date: '2026-11-09', sex: 'male', height: '70', neck: '14.5', waist: '33' });
    const cm = (inches) => Math.round(inches * 2.54 * 100) / 100;
    const mi = navyMale(cm(70), cm(14.5), cm(33));
    check('imperial 70/14.5/33 in: result equals the formula on the cm values (' + r1(mi) + ')', (await result()).includes(r1(mi) + ' %'), await result());
    await click('btn-bf-save'); await wait(300);
    ms = JSON.parse(await ev(`JSON.stringify(state.measurements)`));
    const sv = ms.find((x) => x.date === '2026-11-09');
    check('imperial: stored values are canonical cm', sv && sv.neckCm === cm(14.5) && sv.waistCm === cm(33) && sv.bodyFatPct === Math.round(mi * 10) / 10, sv);
    check('imperial: history shows inches and % without conversion', (await ev(`document.getElementById('body-history').textContent`)).includes('Body fat ' + r1(mi)) && (await ev(`document.getElementById('body-history').textContent`)).includes('Neck 14.5 in'));
    await ev(`(setBodyUnits('metric'), true)`);

    /* --- starý normalizér: nové polia prežijú cez zrkadlo --- */
    const oldRoundTrip = await ev(`(() => {
      const snap = JSON.parse(JSON.stringify(state));
      /* simulácia cleanMeasurement z v105: iba pôvodných 8 polí + note */
      const OLD = ['weightKg', 'waistCm', 'chestCm', 'armLeftCm', 'armRightCm', 'thighLeftCm', 'thighRightCm', 'hipCm'];
      snap.measurements = snap.measurements.map((m) => { const o = { id: m.id, date: m.date }; for (const f of OLD) o[f] = m[f] === undefined ? null : m[f]; o.note = m.note; return o; });
      const lost = snap.measurements.every((m) => m.bodyFatPct === undefined && m.neckCm === undefined);
      const back = migrateV2toV3(snap);
      const orig = state.measurements;
      return { lost, mirror: !!snap.settings.measureExtra, same: JSON.stringify(back.measurements.map((m) => [m.id, m.neckCm, m.bodyFatPct, m.waistCm])) === JSON.stringify(orig.map((m) => [m.id, m.neckCm, m.bodyFatPct, m.waistCm])), n: orig.length };
    })()`);
    check('old normalizer drops the new fields from records (premise)', oldRoundTrip.lost);
    check('settings.measureExtra mirror survives and migrateV2toV3 restores neckCm/bodyFatPct exactly', oldRoundTrip.mirror && oldRoundTrip.same && oldRoundTrip.n === 2, oldRoundTrip);
    check('old records without new fields stay byte-identical (no null keys added)', await ev(`JSON.stringify(cleanMeasurement({ id: 'x', date: '2026-01-02', weightKg: 80, note: '' })) === JSON.stringify({ id: 'x', date: '2026-01-02', weightKg: 80, waistCm: null, chestCm: null, armLeftCm: null, armRightCm: null, thighLeftCm: null, thighRightCm: null, hipCm: null, note: '' })`));
    check('mirror pruned when the measurement is gone (old client deleted it)', await ev(`(() => { const s = JSON.parse(JSON.stringify(state)); s.measurements = []; return migrateV2toV3(s).settings.measureExtra === undefined; })()`));

    /* --- persistuje po reloade --- */
    await p.reload(); await p.ready();
    check('survives a reload (fields on records + mirror)', await ev(`state.measurements.some((m) => m.bodyFatPct > 0 && m.neckCm > 0) && Object.keys(state.settings.measureExtra || {}).length === state.measurements.filter((m) => m.bodyFatPct || m.neckCm).length`));

    /* --- 6 jazykov, svetlý/tmavý, 320 px, ar RTL --- */
    const keys = ['body.f.neck', 'body.f.bodyFat', 'bodyfat.title', 'bodyfat.intro', 'bodyfat.date', 'bodyfat.fill', 'bodyfat.result', 'bodyfat.errNeck', 'bodyfat.errOut', 'bodyfat.save', 'bodyfat.saved', 'bodyfat.updates'];
    const seen = new Set();
    for (const lang of ['sk', 'en', 'es', 'pt-BR', 'fr', 'ar']) {
      await ev(`(setLang(${JSON.stringify(lang)}), true)`);
      const strs = JSON.parse(await ev(`JSON.stringify(${JSON.stringify(keys)}.map((k) => t(k, { pct: '1', date: 'd' })))`));
      check(lang + ': all ' + keys.length + ' new strings exist and are non-empty', strs.every((s, i) => s && s !== keys[i]), strs);
      seen.add(strs[2]);
      check(lang + ': card title rendered', await ev(`document.querySelector('#bodyfat-card .card-title').textContent === t('bodyfat.title')`));
    }
    check('title differs between the 6 languages', seen.size === 6, [...seen]);
    const layout = (tag) => ev(`(() => { const c = document.getElementById('bodyfat-card');
      const ins = [...c.querySelectorAll('input, select, button')].filter((e) => !e.closest('[hidden]'));
      return { sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth, cr: c.getBoundingClientRect().right, vr: innerWidth,
        small: ins.filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.id), font: ins.filter((e) => e.tagName !== 'BUTTON' && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.id),
        dir: document.documentElement.dir }; })()`);
    const shot = async (name) => { const el = await ev(`(() => { const r = document.getElementById('bodyfat-card').getBoundingClientRect(); return { y: r.top + scrollY, h: r.height }; })()`);
      await ev(`(document.getElementById('bodyfat-card').scrollIntoView({ block: 'start' }), (() => { for (let e = document.getElementById('bodyfat-card').parentElement; e; e = e.parentElement) { if (e.scrollHeight > e.clientHeight && /auto|scroll/.test(getComputedStyle(e).overflowY)) { e.scrollTop -= 90; return; } } window.scrollBy(0, -90); })(), true)`); await wait(200);
      if (process.env.GQ_SCREENSHOTS === '0') return;
      const r = await p.c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64')); };
    for (const [lang, theme, w, file] of [['en', 'light', 393, 'calculator-en-light-393.png'], ['sk', 'dark', 393, 'calculator-sk-dark-393.png'], ['ar', 'light', 320, 'calculator-ar-320.png'], ['en', 'dark', 320, null]]) {
      await p.c.send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 2, mobile: true });
      await ev(`(setLang(${JSON.stringify(lang)}), setThemePref(${JSON.stringify(theme)}), setBodyUnits('metric'), true)`); await wait(250);
      await ev(`(document.activeElement && document.activeElement.blur(), switchTab('pokrok'), setPokrokView('body'), true)`); await wait(200);
      check(lang + '/' + theme + '/' + w + ': card is really visible', await ev(`document.getElementById('bodyfat-card').offsetHeight > 100`));
      await fill({ date: '2026-11-10', sex: 'female', height: '165', neck: '32', waist: '75', hip: '100' });
      const L = await layout();
      const tag = lang + '/' + theme + '/' + w;
      check(tag + ': no horizontal overflow, card inside viewport', L.sw <= L.vw && L.cr <= L.vr + 0.5, L);
      check(tag + ': touch targets >= 44 px, text fields >= 16 px', L.small.length === 0 && L.font.length === 0, L);
      check(tag + ': dir ' + (lang === 'ar' ? 'rtl' : 'ltr'), L.dir === (lang === 'ar' ? 'rtl' : 'ltr'), L.dir);
      check(tag + ': labelled inputs (every field has a label)', await ev(`[...document.querySelectorAll('#bodyfat-box input, #bodyfat-box select')].every((e) => document.querySelector('label[for="' + e.id + '"]'))`));
      if (file) await shot(file);
    }
    /* 130 % text: nič netečie mimo */
    await p.c.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 800, deviceScaleFactor: 2, mobile: true });
    await ev(`(document.documentElement.style.fontSize = '130%', true)`); await wait(200);
    check('130 %: card visible', await ev(`document.getElementById('bodyfat-card').offsetHeight > 100`));
    const big = await layout();
    check('130 % text at 320 px: no horizontal overflow', big.sw <= big.vw, big);
    await ev(`(document.documentElement.style.fontSize = '', true)`);

    check('no page errors', errors.length === 0, errors);
  } catch (e) { check('suite ran without exception', false, String(e && e.stack || e)); }
  finally { closeAll(); server.close && server.close(); }
  console.log('\nPASS ' + t.pass + '  FAIL ' + t.fail);
  process.exit(t.fail ? 1 : 0);
})();
