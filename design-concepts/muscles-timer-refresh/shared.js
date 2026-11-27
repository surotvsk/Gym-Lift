/* GymLift prototyp: spoločné funkcie (kreslenie tela, preklady, časovač, rám stránky).
   Nič nečíta z úložiska aplikácie (localStorage, IndexedDB); všetky hodnoty sú označená vzorka (fixture). */
(function (global) {
  'use strict';

  const FRONT_IMAGE = '../../body-anatomy.webp';
  const VIEWBOX = '0 0 572 1024';
  const MIRROR = 'translate(548 0) scale(-1 1)';

  /* Priesvitné oblasti na nezmenenom obrázku body-anatomy.webp: rovnaké cesty ako bodyMapSvg() v script.js. */
  const FRONT_PATHS = {
    chest: 'M188 207 C211 199 249 204 268 217 L270 260 C265 279 245 288 222 285 C196 284 180 268 179 246 C177 231 180 216 188 207Z',
    shoulders: 'M180 182 C150 178 132 198 129 224 C126 244 130 262 142 273 L160 252 C163 232 169 215 187 205 L207 193Z',
    biceps: 'M159 257 C146 273 138 298 137 321 C138 333 145 343 153 346 C166 333 175 313 178 292 L178 266 L168 252Z',
    triceps: 'M128 265 C118 287 116 311 114 330 L122 350 L132 326 C131 303 138 282 145 272 L140 261Z',
    core: 'M267 290 C248 292 226 287 205 281 L192 304 L196 343 L191 381 C194 414 218 444 249 461 L270 478 L270 291Z',
    thighs: 'M204 431 C177 459 164 504 160 554 C154 596 160 637 177 666 L185 688 L205 684 C229 642 236 596 237 552 C237 511 224 464 204 431Z',
    calves: 'M178 706 C156 737 146 774 149 805 C153 840 161 876 159 915 L176 926 C189 890 191 855 190 823 C191 785 181 746 178 706Z'
  };
  const FRONT_MUSCLES = ['chest', 'shoulders', 'biceps', 'triceps', 'core', 'thighs', 'calves'];
  const REAR_MUSCLES = ['back', 'shoulders', 'triceps', 'glutes', 'thighs', 'calves'];
  const ALL_MUSCLES = ['chest', 'shoulders', 'biceps', 'triceps', 'back', 'core', 'glutes', 'thighs', 'calves'];

  /* Vzorka regenerácie 0 až 100 (100 = oddýchnuté). Iba ilustračné, nie história používateľa. */
  const RECOVERY = Object.freeze({
    chest: 91, shoulders: 54, biceps: 47, triceps: 74, back: 28, core: 88, glutes: 41, thighs: 33, calves: 66
  });

  const I18N = {
    en: {
      proto: 'Prototype',
      protoNote: 'Design prototype · sample data · reads nothing from the app',
      themeBtn: 'Theme', langBtn: 'Language', themeAria: 'Switch light / dark theme', langAria: 'Switch English / Arabic',
      hubTitle: 'Muscle map and rest timer',
      hubLead: 'Three muscle-map variants and three rest-timer variants. Pick one in each group.',
      hubMuscles: 'Muscle map (front + rear)', hubRest: 'Rest timer',
      side: 'Body side', front: 'Front', back: 'Back', legend: 'Recovery legend', muscles: 'Muscles',
      rec0: 'Fresh', rec1: 'Ready', rec2: 'Tired', rec3: 'Worked',
      recovered: '{n}% recovered',
      tapHint: 'Tap a muscle on the figure or in the list to see its recovery.',
      fixtureNote: 'Sample recovery values for the prototype, not your history.',
      notThisSide: 'Not visible on this side of the body.',
      frontLabel: 'Front of the body, tap a muscle', rearLabel: 'Back of the body, tap a muscle',
      rearMissing: 'The rear drawing (body-rear.svg) could not be loaded. Open this page through a web server, not file://.',
      showFront: 'Show front', showBack: 'Show back',
      chainFront: 'Front muscles', chainBack: 'Back chain',
      'm.chest': 'Chest', 'm.shoulders': 'Shoulders', 'm.biceps': 'Biceps', 'm.triceps': 'Triceps', 'm.back': 'Back',
      'm.core': 'Core', 'm.glutes': 'Glutes', 'm.thighs': 'Thighs', 'm.quads': 'Thighs (quads)', 'm.hams': 'Thighs (hamstrings)', 'm.calves': 'Calves',
      'vm-a.t': 'Muscle map A · Front / Back toggle', 'vm-a.s': 'One large figure with a segmented switch.',
      'vm-b.t': 'Muscle map B · Paired figures', 'vm-b.s': 'Front and back side by side; a tap highlights the muscle on both.',
      'vm-c.t': 'Muscle map C · Rear focus', 'vm-c.s': 'Large back view, front as a small thumbnail you can swap in.',
      'vr-a.t': 'Rest timer A · Lime dock', 'vr-a.s': 'Expanded dock at the bottom, workout stays visible above.',
      'vr-b.t': 'Rest timer B · Big ring card', 'vr-b.s': 'One centered card with a large progress ring.',
      'vr-c.t': 'Rest timer C · High-contrast banner', 'vr-c.s': 'Sticky black banner with huge lime digits.',
      rest: 'Rest', setProgress: 'Set 3 of 4 done', nextUp: 'Next up', nextSet: 'Barbell row · set 4 · 8 × 60 kg',
      minus15: '−15 s', plus15: '+15 s', pause: 'Pause', resume: 'Resume', restart: 'Restart', skip: 'Skip',
      minus15Aria: 'Shorten rest by 15 seconds', plus15Aria: 'Add 15 seconds', collapse: 'Collapse', expand: 'Expand',
      over: 'Rest over', goNext: 'Time for the next set', ofTotal: 'of {t}',
      demoMark: 'Illustrative frozen time (demo=1). Press Resume for a real countdown.',
      stRunning: 'Rest running', stPaused: 'Rest paused', stDone: 'Rest over',
      sampleWorkout: 'Pull day', sampleTag: 'prototype sample',
      ex1: 'Barbell row', ex2: 'Lat pulldown', ex3: 'Romanian deadlift', ex4: 'Hip thrust', ex5: 'Standing calf raise',
      setsMeta: '{s} × {r} · {w}'
    },
    ar: {
      proto: 'نموذج أولي',
      protoNote: 'نموذج تصميم · بيانات تجريبية · لا يقرأ شيئاً من التطبيق',
      themeBtn: 'المظهر', langBtn: 'اللغة', themeAria: 'التبديل بين المظهر الفاتح والداكن', langAria: 'التبديل بين الإنجليزية والعربية',
      hubTitle: 'خريطة العضلات ومؤقت الراحة',
      hubLead: 'ثلاثة نماذج لخريطة العضلات وثلاثة لمؤقت الراحة. اختر واحداً من كل مجموعة.',
      hubMuscles: 'خريطة العضلات (أمام + خلف)', hubRest: 'مؤقت الراحة',
      side: 'جهة الجسم', front: 'أمام', back: 'خلف', legend: 'دليل التعافي', muscles: 'العضلات',
      rec0: 'مرتاحة', rec1: 'جاهزة', rec2: 'متعبة', rec3: 'مجهدة',
      recovered: 'تعافي {n}٪',
      tapHint: 'اضغط على عضلة في الرسم أو في القائمة لرؤية تعافيها.',
      fixtureNote: 'قيم تعافٍ تجريبية للنموذج وليست من سجلك.',
      notThisSide: 'غير ظاهرة في هذه الجهة من الجسم.',
      frontLabel: 'مقدمة الجسم، اضغط على عضلة', rearLabel: 'خلفية الجسم، اضغط على عضلة',
      rearMissing: 'تعذر تحميل رسم الجهة الخلفية (body-rear.svg). افتح الصفحة عبر خادم ويب وليس file://.',
      showFront: 'عرض الأمام', showBack: 'عرض الخلف',
      chainFront: 'العضلات الأمامية', chainBack: 'سلسلة الظهر',
      'm.chest': 'الصدر', 'm.shoulders': 'الكتفان', 'm.biceps': 'البايسبس', 'm.triceps': 'الترايسبس', 'm.back': 'الظهر',
      'm.core': 'الجذع', 'm.glutes': 'الأرداف', 'm.thighs': 'الفخذان', 'm.quads': 'الفخذان (الأمامية)', 'm.hams': 'الفخذان (الخلفية)', 'm.calves': 'السمانة',
      'vm-a.t': 'خريطة العضلات أ · تبديل أمام / خلف', 'vm-a.s': 'شكل كبير واحد مع مفتاح تبديل.',
      'vm-b.t': 'خريطة العضلات ب · شكلان متجاوران', 'vm-b.s': 'الأمام والخلف جنباً إلى جنب؛ الضغط يبرز العضلة في الاثنين.',
      'vm-c.t': 'خريطة العضلات ج · تركيز على الخلف', 'vm-c.s': 'عرض خلفي كبير والأمام كصورة مصغرة قابلة للتبديل.',
      'vr-a.t': 'مؤقت الراحة أ · لوحة ليمونية', 'vr-a.s': 'لوحة موسعة في الأسفل والتمرين ظاهر فوقها.',
      'vr-b.t': 'مؤقت الراحة ب · بطاقة حلقة كبيرة', 'vr-b.s': 'بطاقة واحدة في المنتصف مع حلقة تقدم كبيرة.',
      'vr-c.t': 'مؤقت الراحة ج · شريط عالي التباين', 'vr-c.s': 'شريط أسود ثابت بأرقام ليمونية ضخمة.',
      rest: 'راحة', setProgress: 'اكتملت المجموعة 3 من 4', nextUp: 'التالي', nextSet: 'تجديف بالبار · المجموعة 4 · 8 × 60 كغ',
      minus15: '−15 ث', plus15: '+15 ث', pause: 'إيقاف مؤقت', resume: 'متابعة', restart: 'إعادة', skip: 'تخطي',
      minus15Aria: 'تقصير الراحة 15 ثانية', plus15Aria: 'إضافة 15 ثانية', collapse: 'طي', expand: 'توسيع',
      over: 'انتهت الراحة', goNext: 'حان وقت المجموعة التالية', ofTotal: 'من {t}',
      demoMark: 'وقت مجمّد للتوضيح فقط (demo=1). اضغط متابعة لعدّ تنازلي حقيقي.',
      stRunning: 'الراحة جارية', stPaused: 'الراحة متوقفة مؤقتاً', stDone: 'انتهت الراحة',
      sampleWorkout: 'يوم السحب', sampleTag: 'عينة تجريبية',
      ex1: 'تجديف بالبار', ex2: 'سحب علوي', ex3: 'رفعة رومانية', ex4: 'دفع الورك', ex5: 'رفع السمانة واقفاً',
      setsMeta: '{s} × {r} · {w}'
    }
  };

  /* ---------- Parametre URL a stav ---------- */
  function readParams() {
    const q = new URLSearchParams(location.search);
    const pick = (k, ok, d) => { const v = (q.get(k) || '').toLowerCase(); return ok.indexOf(v) >= 0 ? v : d; };
    const total = parseInt(q.get('total') || '', 10);
    return {
      surface: pick('surface', ['muscles', 'rest'], ''),
      variant: pick('variant', ['a', 'b', 'c'], 'a'),
      theme: pick('theme', ['dark', 'light'], ''),
      lang: pick('lang', ['en', 'ar'], 'en'),
      view: pick('view', ['front', 'back'], 'front'),
      select: pick('select', ALL_MUSCLES, ''),
      demo: q.get('demo') === '1',
      bare: q.get('bare') === '1',
      total: Number.isFinite(total) ? Math.max(10, Math.min(600, total)) : 90
    };
  }
  const P = readParams();
  const S = {
    theme: P.theme || (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    lang: P.lang
  };

  function t(key, vars) {
    let s = (I18N[S.lang] && I18N[S.lang][key]) || I18N.en[key] || key;
    if (vars) for (const k in vars) s = s.split('{' + k + '}').join(String(vars[k]));
    return s;
  }
  function h(tag, attrs, kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : String(v));
      }
    }
    (kids || []).forEach((c) => { if (c !== null && c !== undefined) e.append(c); });
    return e;
  }

  /* ---------- Regenerácia ---------- */
  function recoveryClass(v) {
    const x = typeof v === 'number' && Number.isFinite(v) ? v : 100;
    return x >= 85 ? 'rec-0' : x >= 60 ? 'rec-1' : x >= 35 ? 'rec-2' : 'rec-3';
  }
  function statusKey(v) { return 'rec' + recoveryClass(v).slice(4); }
  function muscleName(m, view) {
    if (m === 'thighs' && view === 'front') return t('m.quads');
    if (m === 'thighs' && view === 'back') return t('m.hams');
    return t('m.' + m);
  }

  /* ---------- Kreslenie tela ---------- */
  let rearRoot = null;
  let rearPromise = null;
  /* Zadná kresba je jediný zdroj v body-rear.svg; načíta sa raz a vloží sa inline, aby sa dali oblasti farbiť. */
  function loadRear() {
    if (!rearPromise) {
      rearPromise = fetch('body-rear.svg')
        .then((r) => { if (!r.ok) throw new Error('body-rear.svg ' + r.status); return r.text(); })
        .then((txt) => {
          const doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
          if (doc.querySelector('parsererror')) throw new Error('body-rear.svg parse');
          rearRoot = doc.documentElement;
        });
    }
    return rearPromise;
  }

  function frontMarkup() {
    const pair = (d) => '<path class="f-tint" d="' + d + '"/><path class="f-tint" d="' + d + '" transform="' + MIRROR + '"/>';
    let s = '<svg class="gl-front" viewBox="' + VIEWBOX + '" xmlns="http://www.w3.org/2000/svg">'
      + '<image href="' + FRONT_IMAGE + '" width="572" height="1024"/>';
    FRONT_MUSCLES.forEach((m) => { s += '<g data-muscle="' + m + '">' + pair(FRONT_PATHS[m]) + '</g>'; });
    return s + '</svg>';
  }

  /* Nastaví triedu regenerácie, výber a popisky na každej skupine [data-muscle]. */
  function paint(svg, recovery, selected, view) {
    const v = view || svg.getAttribute('data-view');
    svg.querySelectorAll('[data-muscle]').forEach((g) => {
      const m = g.getAttribute('data-muscle');
      const val = recovery[m];
      g.classList.remove('rec-0', 'rec-1', 'rec-2', 'rec-3', 'is-selected');
      g.classList.add(recoveryClass(val));
      if (m === selected) g.classList.add('is-selected');
      g.setAttribute('aria-pressed', m === selected ? 'true' : 'false');
      g.setAttribute('aria-label', muscleName(m, v) + ', ' + t(statusKey(val)) + ', ' + t('recovered', { n: val }));
    });
  }

  /* Ručné zafarbenie jednej svalovej skupiny (color = null zruší). */
  function tint(svg, muscle, color, opacity) {
    svg.querySelectorAll('[data-muscle="' + muscle + '"]').forEach((g) => {
      if (color === null || color === undefined) { g.style.removeProperty('--c'); g.style.removeProperty('--o'); }
      else { g.style.setProperty('--c', color); g.style.setProperty('--o', String(opacity === undefined ? 0.7 : opacity)); }
    });
  }

  /* view: 'front' | 'back'. opts: { selected, onSelect(muscle), thumb }. Vráti SVG element alebo null. */
  function mountBody(host, view, recovery, opts) {
    const o = opts || {};
    host.replaceChildren();
    let svg;
    if (view === 'back') {
      if (!rearRoot) { host.append(h('p', { class: 'fig-error', text: t('rearMissing') })); return null; }
      svg = document.importNode(rearRoot, true);
      svg.removeAttribute('width'); svg.removeAttribute('height');
    } else {
      const tpl = document.createElement('template');
      tpl.innerHTML = frontMarkup();
      svg = tpl.content.firstElementChild;
    }
    svg.classList.add('gl-fig');
    svg.setAttribute('data-view', view);
    svg.removeAttribute('role'); svg.removeAttribute('aria-label');
    svg.querySelectorAll('title, desc').forEach((n) => n.remove());
    if (o.thumb) {
      svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    } else {
      svg.setAttribute('role', 'group');
      svg.setAttribute('aria-label', t(view === 'back' ? 'rearLabel' : 'frontLabel'));
      svg.querySelectorAll('[data-muscle]').forEach((g) => { g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button'); });
      if (o.onSelect) {
        svg.addEventListener('click', (e) => {
          const g = e.target.closest ? e.target.closest('[data-muscle]') : null;
          if (g) o.onSelect(g.getAttribute('data-muscle'));
        });
        svg.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          const g = e.target.closest ? e.target.closest('[data-muscle]') : null;
          if (g) { e.preventDefault(); o.onSelect(g.getAttribute('data-muscle')); }
        });
      }
    }
    host.append(svg);
    paint(svg, recovery, o.selected || null, view);
    return svg;
  }

  /* ---------- Časovač oddychu: skutočný lokálny deadline ---------- */
  function createTimer(totalSec, demo) {
    let base = totalSec * 1000;
    let total = base;
    let deadline = null;
    let left = base;
    let raf = 0;
    const subs = new Set();

    function snap() {
      let r = deadline === null ? left : deadline - Date.now();
      if (deadline !== null && r <= 0) { deadline = null; left = 0; r = 0; }
      r = Math.max(0, r);
      const state = deadline !== null ? 'running' : (r <= 0 ? 'done' : 'paused');
      return { state: state, ms: r, total: total, ratio: total ? Math.min(1, r / total) : 0, sec: Math.ceil(r / 1000) };
    }
    function emit() { const s = snap(); subs.forEach((f) => f(s)); return s; }
    function loop() { raf = 0; const s = emit(); if (s.state === 'running') raf = requestAnimationFrame(loop); }
    function kick() { if (!raf) raf = requestAnimationFrame(loop); }

    if (demo) left = Math.round(base * 47 / 90); /* zmrazený ilustračný čas 0:47 */
    else deadline = Date.now() + left;

    const api = {
      snapshot: snap,
      subscribe(fn) { subs.add(fn); fn(snap()); kick(); return () => subs.delete(fn); },
      toggle() {
        const s = snap();
        if (s.state === 'running') { left = s.ms; deadline = null; }
        else if (s.state === 'paused') { deadline = Date.now() + left; }
        else { total = base; left = base; deadline = Date.now() + left; }
        emit(); kick();
      },
      add(sec) {
        const s = snap();
        const d = sec * 1000;
        if (s.state === 'running') deadline += d;
        else { left = Math.max(0, left + d); if (s.state === 'done' && left > 0) deadline = Date.now() + left; }
        if (d > 0) total += d;
        emit(); kick();
      },
      skip() { deadline = null; left = 0; emit(); },
      restart() { total = base; left = base; deadline = Date.now() + left; emit(); kick(); }
    };
    document.addEventListener('visibilitychange', () => { emit(); kick(); });
    return api;
  }
  function fmt(sec) {
    const s = Math.max(0, sec | 0);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  /* ---------- Rám stránky ---------- */
  const G = {
    P: P, S: S, t: t, h: h, fmt: fmt, views: {},
    FRONT_MUSCLES: FRONT_MUSCLES, REAR_MUSCLES: REAR_MUSCLES, ALL_MUSCLES: ALL_MUSCLES, RECOVERY: RECOVERY,
    FRONT_PATHS: FRONT_PATHS, FRONT_IMAGE: FRONT_IMAGE,
    recoveryClass: recoveryClass, statusKey: statusKey, muscleName: muscleName,
    loadRear: loadRear, mountBody: mountBody, paint: paint, tint: tint, createTimer: createTimer
  };

  let sr = null;
  G.announce = function (text) { if (sr) { sr.textContent = ''; setTimeout(() => { sr.textContent = text; }, 30); } };

  function applyEnv() {
    const de = document.documentElement;
    de.setAttribute('data-theme', S.theme);
    de.setAttribute('lang', S.lang);
    de.setAttribute('dir', S.lang === 'ar' ? 'rtl' : 'ltr');
    if (P.bare) de.setAttribute('data-bare', ''); else de.removeAttribute('data-bare');
    document.title = 'GymLift prototype · ' + (P.surface ? t('v' + P.surface.charAt(0) + '-' + P.variant + '.t') : t('hubTitle'));
  }
  function syncUrl() {
    try {
      const u = new URL(location.href);
      u.searchParams.set('theme', S.theme);
      u.searchParams.set('lang', S.lang);
      history.replaceState(null, '', u);
    } catch (err) { /* URL sa nepodarilo upraviť, prototyp funguje ďalej */ }
  }

  let timer = null;
  let cleanup = null;
  function render() {
    if (cleanup) { cleanup(); cleanup = null; }
    applyEnv();
    const app = document.getElementById('app');
    app.replaceChildren();
    sr = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    const tools = h('div', { class: 'tools' }, [
      h('button', { class: 'btn', type: 'button', 'aria-label': t('themeAria'), text: (S.theme === 'dark' ? '☀ ' : '☾ ') + t('themeBtn'),
        onclick: () => { S.theme = S.theme === 'dark' ? 'light' : 'dark'; syncUrl(); render(); } }),
      h('button', { class: 'btn', type: 'button', 'aria-label': t('langAria'), text: S.lang === 'ar' ? 'English' : 'العربية',
        onclick: () => { S.lang = S.lang === 'ar' ? 'en' : 'ar'; syncUrl(); render(); } })
    ]);
    app.append(
      h('header', { class: 'gl-top' }, [h('span', { class: 'proto-badge', text: t('proto') }), tools]),
      h('p', { class: 'proto-note', text: t('protoNote') }),
      sr
    );
    const view = h('main', { class: 'view' });
    app.append(view);
    if (!P.surface) { hub(view); return; }
    const key = P.surface + '-' + P.variant;
    const fn = G.views[key];
    view.append(h('div', null, [
      h('h1', { class: 'view-title', text: t('v' + P.surface.charAt(0) + '-' + P.variant + '.t') }),
      h('p', { class: 'view-sub', text: t('v' + P.surface.charAt(0) + '-' + P.variant + '.s') })
    ]));
    if (fn) { const c = fn(view, { P: P, timer: timer }); if (typeof c === 'function') cleanup = c; }
  }

  function hub(view) {
    const link = (surface, v) => {
      const q = '?surface=' + surface + '&variant=' + v + '&theme=' + S.theme + '&lang=' + S.lang;
      const k = 'v' + surface.charAt(0) + '-' + v;
      return h('a', { href: q }, [h('b', { text: t(k + '.t') }), h('span', { text: t(k + '.s') })]);
    };
    view.append(
      h('div', null, [h('h1', { class: 'view-title', text: t('hubTitle') }), h('p', { class: 'view-sub', text: t('hubLead') })]),
      h('div', { class: 'hub' }, [
        h('h2', { text: t('hubMuscles') }), link('muscles', 'a'), link('muscles', 'b'), link('muscles', 'c'),
        h('h2', { text: t('hubRest') }), link('rest', 'a'), link('rest', 'b'), link('rest', 'c')
      ]),
      h('p', { class: 'fine' }, [
        'Query: ', h('code', { text: 'surface=muscles|rest&variant=a|b|c&theme=dark|light&lang=en|ar' }), ' · ',
        h('code', { text: 'view=front|back' }), ' (muscles A) · ', h('code', { text: 'select=back|glutes|…' }), ' · ',
        h('code', { text: 'demo=1' }), ' (rest: frozen 0:47) · ', h('code', { text: 'bare=1' }), ' (hide toggles) · ', h('code', { text: 'total=90' })
      ])
    );
  }

  /* Spustenie: načíta zadnú kresbu a predný obrázok, potom označí stránku ako pripravenú (data-ready) pre snímky obrazovky. */
  G.boot = async function () {
    if (P.surface === 'rest') timer = createTimer(P.total, P.demo);
    if (P.surface === 'muscles') {
      try { await loadRear(); } catch (err) { /* mountBody ukáže chybovú správu */ }
      await new Promise((res) => { const im = new Image(); im.onload = im.onerror = res; im.src = FRONT_IMAGE; });
    }
    render();
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (err) { /* písmo nie je nutné */ }
    document.documentElement.setAttribute('data-ready', '1');
  };

  global.GLProto = G;
})(window);
