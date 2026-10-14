/* GymQuest r2 concepts — shared working sheets (plan editor, library, rest timer, finish, history,
   calendar day, body, food, photos, activities, achievements, settings, Community chat / posts /
   friends / Top 20). Every concept draws its own main screens and opens these for the deeper
   flows, so every feature of the app works in every design. Each design themes the kit through
   CSS variables (--k-bg, --k-fg, --k-acc …), see kit.css. */
window.Kit = (function () {
  'use strict';
  const G = window.GQ2, esc = G.esc;
  let root = document.body;
  const stack = [];

  /* ---------- icons (24×24 line icons, stroke = currentColor) ---------- */
  const P = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
    dumbbell: '<path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1.2-3.5 3.6-5 6.5-5s5.3 1.5 6.5 5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2 .6 3.3 2.2 4 5"/>',
    heart: '<path d="M12 20s-7.5-4.6-9.2-9.3C1.7 7.5 3.7 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.3 0 5.3 3 4.2 6.2C19.5 15.4 12 20 12 20Z"/>',
    comment: '<path d="M20.5 11.5a8.5 8 0 0 1-12.3 7.2L3.5 20l1.4-4A8.5 8 0 1 1 20.5 11.5Z"/>',
    send: '<path d="M21 3 10 14M21 3l-6.5 18-4.5-7-7-4.5L21 3Z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.5-4.5"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2.5H4L6 16Z"/><path d="M10 21h4"/>',
    flame: '<path d="M12 21c4 0 7-2.7 7-6.8 0-4.4-3.4-6.6-4.6-10.2-.8 2.7-2.2 4-3.6 4.8.2-1.7-.3-3.6-1.4-4.8C7.6 7.2 5 9.9 5 14.2 5 18.3 8 21 12 21Z"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    play: '<path d="M7 4.5v15l12-7.5-12-7.5Z"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>', back: '<path d="m15 5-7 7 7 7"/>', up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>',
    trophy: '<path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0V4Z"/><path d="M7.5 6H4.5c0 3 1.5 4.5 3.3 4.8M16.5 6h3c0 3-1.5 4.5-3.3 4.8M12 13.5V17M8.5 20.5h7M9.5 17h5v3.5h-5z"/>',
    droplet: '<path d="M12 3.5s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11Z"/>',
    utensils: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1.5-3 4-3 7v4h3"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3"/>',
    repeat: '<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 12V10a4 4 0 0 1 4-4h13M7 21.5 3.5 18 7 14.5"/><path d="M20.5 12v2a4 4 0 0 1-4 4h-13"/>',
    swap: '<path d="M7 4 3.5 7.5 7 11M3.5 7.5h13M17 13l3.5 3.5L17 20M20.5 16.5h-13"/>',
    camera: '<path d="M4 7.5h3.2L9 5h6l1.8 2.5H20a1.5 1.5 0 0 1 1.5 1.5v9.5A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5V9A1.5 1.5 0 0 1 4 7.5Z"/><circle cx="12" cy="13.5" r="3.6"/>',
    chat: '<path d="M4 5.5h16v11H9l-5 4v-15Z"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9.5 2.5h5"/>',
    share: '<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12v7.5h14V12"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    book: '<path d="M4 4.5h6a2 2 0 0 1 2 2V20a2 2 0 0 0-2-2H4V4.5ZM20 4.5h-6a2 2 0 0 0-2 2V20a2 2 0 0 1 2-2h6V4.5Z"/>',
    scale: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8.5 9a5 5 0 0 1 7 0l-2.3 2.6a1.6 1.6 0 0 0-2.4 0L8.5 9Z"/>',
    run: '<circle cx="14" cy="4.5" r="1.8"/><path d="m8 21 3-6 3 2v5M6 11l3-3h4l2 4 3 1M11 15l-1.5-3"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 2.5-2.5L20 19"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>', upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14"/>',
    star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8L12 3.5Z"/>',
    medal: '<circle cx="12" cy="15" r="5.5"/><path d="M8.5 10.5 6 3h4l2 4.5M15.5 10.5 18 3h-4l-2 4.5"/>',
    bolt: '<path d="M13 2.5 4.5 13.5H11L10 21.5l8.5-11H12l1-8Z"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.5h.01"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8"/>',
    flag: '<path d="M5 21V4M5 4.5h11l-2 4 2 4H5"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4M18.7 18.7l-1.4-1.4M6.7 6.7 5.3 5.3"/>',
    smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14c.8 1.3 2 2 3.5 2s2.7-.7 3.5-2M9 9.5h.01M15 9.5h.01"/>',
    reply: '<path d="M9.5 6 4 11.5 9.5 17M4 11.5h10a6 6 0 0 1 6 6V19"/>', pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
  };
  const icon = (n, cls) => '<svg class="kico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (P[n] || '') + '</svg>';

  /* ---------- small builders ---------- */
  const h = (s) => esc(s);
  const avatar = (k, size) => { const p = G.person(k); return '<span class="k-av" style="--av:' + p.color + (size ? ';--s:' + size + 'px' : '') + '">' + h(p.name.slice(0, 1)) + '</span>'; };
  const btn = (label, act, cls, data) => '<button type="button" class="k-btn ' + (cls || '') + '" data-k="' + act + '"' + (data ? Object.keys(data).map((k) => ' data-' + k + '="' + h(data[k]) + '"').join('') : '') + '>' + label + '</button>';
  const row = (main, sub, right, act, data) => { const tag = act ? 'button' : 'div'; return '<' + tag + (act ? ' type="button"' : '') + ' class="k-row' + (act ? '' : ' static') + '" ' + (act ? 'data-k="' + act + '"' : '') + (data ? Object.keys(data).map((k) => ' data-' + k + '="' + h(data[k]) + '"').join('') : '') + '><span class="k-row-main"><b>' + main + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span>' + (right != null ? '<span class="k-row-r">' + right + '</span>' : '') + '</' + tag + '>'; };
  const sw = (on, act, data) => '<button type="button" role="switch" aria-checked="' + !!on + '" class="k-sw' + (on ? ' on' : '') + '" data-k="' + act + '"' + (data ? Object.keys(data).map((k) => ' data-' + k + '="' + h(data[k]) + '"').join('') : '') + '><i></i></button>';
  const seg = (opts, cur, act) => '<div class="k-seg">' + opts.map(([v, l]) => '<button type="button" data-k="' + act + '" data-v="' + h(v) + '" class="' + (String(v) === String(cur) ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
  const wlist = (e) => { const w = e.weights || []; if (!w.length || !Math.max(...w)) return 'BW'; return new Set(w).size > 1 ? w.map((x) => G.fmtW(x, true)).join(' · ') + ' ' + G.unit() : G.fmtW(w[0]); };
  const empty = (t) => '<p class="k-empty">' + t + '</p>';
  const sec = (t, right) => '<div class="k-sec"><span>' + t + '</span>' + (right || '') + '</div>';

  /* ---------- charts (plain SVG, theme colours via currentColor / CSS vars) ---------- */
  function line(vals, o) {
    o = Object.assign({ w: 320, h: 120, pad: 14, dots: true, fill: true, labels: null }, o || {});
    if (!vals.length) return '<svg class="k-chart" viewBox="0 0 ' + o.w + ' ' + o.h + '"></svg>';
    const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
    const x = (i) => o.pad + (vals.length === 1 ? (o.w - 2 * o.pad) / 2 : i * (o.w - 2 * o.pad) / (vals.length - 1));
    const y = (v) => o.h - o.pad - (v - min) / span * (o.h - 2 * o.pad - (o.labels ? 10 : 0));
    const pts = vals.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
    return '<svg class="k-chart" viewBox="0 0 ' + o.w + ' ' + o.h + '" preserveAspectRatio="none" role="img" aria-label="' + h(o.aria || 'chart') + '">'
      + (o.fill ? '<polygon points="' + x(0) + ',' + (o.h - o.pad) + ' ' + pts + ' ' + x(vals.length - 1) + ',' + (o.h - o.pad) + '" class="k-chart-fill"/>' : '')
      + '<polyline points="' + pts + '" class="k-chart-line" fill="none"/>'
      + (o.dots ? vals.map((v, i) => '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="' + (i === vals.length - 1 ? 4 : 2.5) + '" class="k-chart-dot"/>').join('') : '')
      + (o.labels ? '<text x="' + x(vals.length - 1) + '" y="' + (y(vals[vals.length - 1]) - 8) + '" text-anchor="end" class="k-chart-t">' + h(o.labels(vals[vals.length - 1])) + '</text>' : '')
      + '</svg>';
  }
  function bars(vals, o) {
    o = Object.assign({ w: 320, h: 110, gap: 6, labels: [] }, o || {});
    const max = Math.max(1, ...vals), bw = (o.w - o.gap * (vals.length - 1)) / vals.length, lh = o.labels.length ? 14 : 0;
    return '<svg class="k-chart" viewBox="0 0 ' + o.w + ' ' + o.h + '" role="img" aria-label="' + h(o.aria || 'bar chart') + '">' + vals.map((v, i) => { const bh = Math.max(2, v / max * (o.h - lh - 4)); return '<rect x="' + (i * (bw + o.gap)) + '" y="' + (o.h - lh - bh) + '" width="' + bw + '" height="' + bh + '" rx="3" class="k-col' + (i === vals.length - 1 ? ' last' : '') + '"/>' + (o.labels[i] ? '<text x="' + (i * (bw + o.gap) + bw / 2) + '" y="' + (o.h - 2) + '" text-anchor="middle" class="k-chart-t">' + h(o.labels[i]) + '</text>' : ''); }).join('') + '</svg>';
  }
  function ring(pct, o) {
    o = Object.assign({ size: 120, stroke: 10 }, o || {});
    const r = (o.size - o.stroke) / 2, c = 2 * Math.PI * r;
    return '<svg class="k-ring" width="' + o.size + '" height="' + o.size + '" viewBox="0 0 ' + o.size + ' ' + o.size + '"><circle cx="' + o.size / 2 + '" cy="' + o.size / 2 + '" r="' + r + '" stroke-width="' + o.stroke + '" class="k-ring-bg" fill="none"/><circle cx="' + o.size / 2 + '" cy="' + o.size / 2 + '" r="' + r + '" stroke-width="' + o.stroke + '" class="k-ring-fg" fill="none" stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + (c * (1 - Math.max(0, Math.min(100, pct)) / 100)) + '" transform="rotate(-90 ' + o.size / 2 + ' ' + o.size / 2 + ')"/></svg>';
  }

  /* ---------- sheet stack ---------- */
  function mount(el) { root = el; root.classList.add('k-root'); }
  function sheet(o) {
    const el = document.createElement('div');
    el.className = 'k-layer' + (o.full ? ' k-full' : '') + (o.center ? ' k-center' : '');
    el.innerHTML = '<div class="k-scrim" data-k="close"></div><section class="k-sheet" role="dialog" aria-modal="true" aria-label="' + h(o.title || '') + '"><header class="k-head">' + (o.back === false ? '' : '<button type="button" class="k-x" data-k="close" aria-label="Close">' + icon(o.full ? 'back' : 'x') + '</button>') + '<h2>' + h(o.title || '') + '</h2>' + (o.action || '') + '</header><div class="k-body"></div></section>';
    root.appendChild(el);
    const me = { el, o, body: el.querySelector('.k-body'), close: () => close(me), render: () => draw(me) };
    stack.push(me);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]'); if (!b || !el.contains(b)) return;
      const k = b.dataset.k; if (k === 'close') { e.preventDefault(); return close(me); }
      if (o.on && o.on[k]) { e.preventDefault(); o.on[k](b, e, me); }
    });
    el.addEventListener('change', (e) => { if (o.change) o.change(e.target, me); });
    el.addEventListener('input', (e) => { if (o.input) o.input(e.target, me); });
    draw(me);
    requestAnimationFrame(() => el.classList.add('in'));
    const f = el.querySelector('[autofocus]'); if (f) setTimeout(() => f.focus(), 60);
    return me;
  }
  function draw(me) {
    if (!me.o.render) { if (me.o.html != null) me.body.innerHTML = me.o.html; return; }
    const st = me.body.scrollTop; me.body.innerHTML = me.o.render(me); me.body.scrollTop = st;
    if (me.o.after) me.o.after(me);
  }
  function close(me) { const i = stack.indexOf(me); if (i < 0) return; stack.splice(i, 1); me.el.classList.remove('in'); setTimeout(() => me.el.remove(), 180); if (me.o.onClose) me.o.onClose(); }
  function closeAll() { stack.slice().forEach(close); }
  G.on((what) => {
    stack.forEach((me) => {
      if (!me.o.live) return;
      if (what === 'tick' && !me.o.tick) return;
      if (me.el.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      draw(me);
    });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) close(stack[stack.length - 1]); });

  function confirm(text, ok, o) {
    o = o || {};
    return new Promise((res) => {
      let done = false;
      const me = sheet({ title: o.title || 'Are you sure?', center: true, html: '<p class="k-p">' + h(text) + '</p><div class="k-actions">' + btn('Cancel', 'no', 'ghost') + btn(h(ok || 'OK'), 'yes', o.danger ? 'danger' : 'primary') + '</div>',
        on: { yes: () => { done = true; me.close(); res(true); }, no: () => { done = true; me.close(); res(false); } }, onClose: () => { if (!done) res(false); } });
    });
  }
  function toast(text, action) {
    const t = document.createElement('div'); t.className = 'k-toast'; t.innerHTML = '<span>' + h(text) + '</span>' + (action ? '<button type="button">' + h(action.label) + '</button>' : '');
    root.appendChild(t); requestAnimationFrame(() => t.classList.add('in'));
    if (action) t.querySelector('button').onclick = () => { action.fn(); t.remove(); };
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, action ? 5000 : 2600);
  }
  const num = (v, d) => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? (d == null ? 0 : d) : n; };

  /* ============ PLANS ============ */
  function planEditor(id) {
    const orig = id ? G.plan(id) : null;
    const d = orig ? G.clone(orig) : { id: G.uid('plan'), name: '', builtin: false, location: 'gym', exercises: [] };
    const me = sheet({ title: orig ? 'Edit plan' : 'New plan', full: true,
      action: btn('Save', 'save', 'primary sm'),
      render: () => '<label class="k-field"><span>Plan name</span><input id="k-pname" value="' + h(d.name) + '" placeholder="e.g. Upper body" maxlength="60"></label>'
        + (orig ? '<div class="k-inline"><span class="k-mute">Position in rotation</span>' + btn('‹', 'pleft', 'ghost sm') + btn('›', 'pright', 'ghost sm') + '</div>' : '')
        + sec('Exercises (' + d.exercises.length + ')')
        + (d.exercises.length ? d.exercises.map((e, i) => '<div class="k-exed">'
          + '<div class="k-exed-top"><input class="k-exname" data-i="' + i + '" value="' + h(e.name) + '" aria-label="Exercise name"' + (e.custom ? '' : ' readonly') + '>'
          + btn(icon('up'), 'exup', 'icon', { i }) + btn(icon('down'), 'exdown', 'icon', { i }) + btn(icon('trash'), 'exdel', 'icon', { i }) + '</div>'
          + '<div class="k-exed-nums"><label>Sets<input type="number" inputmode="numeric" min="1" max="12" data-f="sets" data-i="' + i + '" value="' + e.sets + '"></label>'
          + '<label>Reps<input type="number" inputmode="numeric" min="1" max="100" data-f="reps" data-i="' + i + '" value="' + e.reps + '"></label>'
          + '<label>' + G.unit() + '<input type="text" inputmode="decimal" data-f="weight" data-i="' + i + '" value="' + G.toU(e.weight) + '"></label></div>'
          + '<div class="k-exed-opts"><span class="k-mute">To failure:</span>' + Array.from({ length: e.sets }, (_, s) => '<button type="button" class="k-chip' + (e.failSets.includes(s + 1) ? ' on' : '') + '" data-k="fail" data-i="' + i + '" data-s="' + (s + 1) + '">' + (s + 1) + '</button>').join('')
          + '<label class="k-check"><input type="checkbox" data-f="unilateral" data-i="' + i + '"' + (e.unilateral ? ' checked' : '') + '> One side at a time</label></div></div>').join('') : empty('No exercises yet. Add some below.'))
        + '<div class="k-grid2">' + btn(icon('book') + ' From library', 'addlib', 'ghost') + btn(icon('list') + ' From my plans', 'addplans', 'ghost') + '</div>'
        + '<div class="k-inline"><input id="k-custom" placeholder="Your own exercise name"> ' + btn('Add', 'addcustom', 'ghost sm') + '</div>'
        + (orig ? '<hr class="k-hr">' + btn(icon('trash') + ' Delete plan', 'pdel', 'danger block') : ''),
      input: (t) => {
        if (t.id === 'k-pname') d.name = t.value;
        const i = +t.dataset.i; if (isNaN(i)) return;
        if (t.classList.contains('k-exname')) d.exercises[i].name = t.value;
        const f = t.dataset.f;
        if (f === 'sets') { d.exercises[i].sets = Math.max(1, Math.min(12, Math.round(num(t.value, 1)))); }
        if (f === 'reps') d.exercises[i].reps = Math.max(1, Math.round(num(t.value, 1)));
        if (f === 'weight') d.exercises[i].weight = G.fromU(Math.max(0, num(t.value)));
      },
      change: (t) => { const i = +t.dataset.i; if (t.dataset.f === 'unilateral') d.exercises[i].unilateral = t.checked; if (t.dataset.f === 'sets') me.render(); },
      on: {
        save: () => { if (!d.name.trim()) { toast('Give the plan a name'); return; } d.name = d.name.trim(); G.savePlan(d); me.close(); toast('Plan saved'); },
        exup: (b) => { const i = +b.dataset.i; if (i > 0) { [d.exercises[i - 1], d.exercises[i]] = [d.exercises[i], d.exercises[i - 1]]; me.render(); } },
        exdown: (b) => { const i = +b.dataset.i; if (i < d.exercises.length - 1) { [d.exercises[i + 1], d.exercises[i]] = [d.exercises[i], d.exercises[i + 1]]; me.render(); } },
        exdel: (b) => { d.exercises.splice(+b.dataset.i, 1); me.render(); },
        fail: (b) => { const e = d.exercises[+b.dataset.i], s = +b.dataset.s; e.failSets = e.failSets.includes(s) ? e.failSets.filter((x) => x !== s) : e.failSets.concat(s); me.render(); },
        addlib: () => library({ pick: (id) => { d.exercises.push(G.newExercise(id)); me.render(); toast('Added ' + G.LIBMAP[id].name); } }),
        addplans: () => pickFromPlans((list) => { list.forEach((e) => d.exercises.push(Object.assign(G.clone(e), { uid: G.uid('e') }))); me.render(); }, d.id),
        addcustom: () => { const v = me.el.querySelector('#k-custom').value.trim(); if (!v) return; d.exercises.push(G.newExercise(null, v)); me.render(); },
        pleft: () => { G.movePlan(d.id, -1); toast('Moved earlier in the rotation'); },
        pright: () => { G.movePlan(d.id, 1); toast('Moved later in the rotation'); },
        pdel: () => confirm('Delete “' + (d.name || 'this plan') + '”? Past workouts stay in your history.', 'Delete', { danger: true }).then((y) => { if (y) { G.deletePlan(d.id); me.close(); toast('Plan deleted'); } }),
      } });
    return me;
  }
  function pickFromPlans(cb, exceptId, title) {
    const picked = new Set();
    const all = []; G.plans().forEach((p) => { if (p.id !== exceptId) p.exercises.forEach((e) => all.push({ p, e })); });
    const me = sheet({ title: title || 'Add from your plans', full: true, action: btn('Add', 'ok', 'primary sm'),
      render: () => G.plans().filter((p) => p.id !== exceptId).map((p) => sec(h(p.name)) + p.exercises.map((e) => '<label class="k-row k-pick"><input type="checkbox" data-u="' + e.uid + '"' + (picked.has(e.uid) ? ' checked' : '') + '><span class="k-row-main"><b>' + h(e.name) + '</b><small>' + e.sets + ' × ' + e.reps + (e.weight ? ' · ' + G.fmtW(e.weight) : '') + '</small></span></label>').join('')).join(''),
      change: (t) => { if (t.dataset.u) { if (t.checked) picked.add(t.dataset.u); else picked.delete(t.dataset.u); } },
      on: { ok: () => { if (!picked.size) { toast('Pick at least one exercise'); return; } cb(all.filter((x) => picked.has(x.e.uid)).map((x) => x.e)); me.close(); } } });
    return me;
  }
  function fullBody() {
    return pickFromPlans((list) => { const p = G.newPlan('Full body', list.map((e) => Object.assign(G.clone(e), { uid: G.uid('e') }))); toast('Full body plan created'); planEditor(p.id); }, null, 'Full Body builder');
  }
  function plansManager() {
    return sheet({ title: 'Manage plans', full: true, live: true, action: btn(icon('plus'), 'new', 'icon'),
      render: () => '<p class="k-mute">The order is your rotation. The next recommended workout follows it.</p>' + G.plans().map((p, i) => '<div class="k-mrow"><span class="k-mrow-n">' + (i + 1) + '</span><span class="k-row-main"><b>' + h(p.name) + (G.recommended() === p ? ' ✦' : '') + '</b><small>' + p.exercises.length + ' exercises · about ' + G.planMinutes(p) + ' min</small></span>' + btn(icon('up'), 'up', 'icon', { id: p.id }) + btn(icon('down'), 'down', 'icon', { id: p.id }) + btn(icon('edit'), 'edit', 'icon', { id: p.id }) + '</div>').join('')
        + '<div class="k-grid2">' + btn(icon('plus') + ' New plan', 'new', 'ghost') + btn(icon('grid') + ' Full Body builder', 'fb', 'ghost') + '</div>',
      on: { up: (b) => G.movePlan(b.dataset.id, -1), down: (b) => G.movePlan(b.dataset.id, 1), edit: (b) => planEditor(b.dataset.id), new: () => planEditor(null), fb: () => fullBody() } });
  }

  /* ============ LIBRARY ============ */
  function library(o) {
    o = o || {};
    const f = { q: '', muscle: o.muscle || '', loc: '', difficulty: '' };
    const me = sheet({ title: o.title || (o.pick ? 'Add an exercise' : 'Exercise library'), full: true, live: true,
      render: () => {
        const list = G.libFilter(f); const eq = G.state.settings.equipment;
        const alts = o.alts ? o.alts.map((id) => G.LIBMAP[id]).filter(Boolean) : [];
        return '<label class="k-search">' + icon('search') + '<input id="k-q" type="search" placeholder="Search 48 exercises" value="' + h(f.q) + '"></label>'
          + '<div class="k-chips">' + ['', ...G.MUSCLES, 'fullBody'].map((m) => '<button type="button" class="k-chip' + (f.muscle === m ? ' on' : '') + '" data-k="mus" data-v="' + m + '">' + (m ? G.MUSCLE_LABEL[m] : 'All') + '</button>').join('') + '</div>'
          + '<div class="k-chips">' + [['', 'Anywhere'], ['gym', 'Gym'], ['home', 'Home'], ['outdoor', 'Outdoors']].map(([v, l]) => '<button type="button" class="k-chip' + (f.loc === v ? ' on' : '') + '" data-k="loc" data-v="' + v + '">' + l + '</button>').join('')
          + [['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']].map(([v, l]) => '<button type="button" class="k-chip' + (f.difficulty === v ? ' on' : '') + '" data-k="dif" data-v="' + v + '">' + l + '</button>').join('') + '</div>'
          + row('My equipment', eq.length ? eq.map((x) => G.EQUIP_LABEL[x]).join(', ') : 'Not set: showing everything', icon('chevron'), 'equip')
          + (alts.length ? sec('Suggested replacements') + alts.map(item).join('') : '')
          + sec(list.length + ' exercises') + (list.length ? list.map(item).join('') : empty('Nothing matches.') + btn('Reset filters', 'resetf', 'ghost block'));
      },
      input: (t) => { if (t.id === 'k-q') { f.q = t.value; clearTimeout(me._t); me._t = setTimeout(() => { me.render(); const q = me.el.querySelector('#k-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 180); } },
      on: {
        mus: (b) => { f.muscle = b.dataset.v; me.render(); }, loc: (b) => { f.loc = b.dataset.v; me.render(); }, dif: (b) => { f.difficulty = f.difficulty === b.dataset.v ? '' : b.dataset.v; me.render(); },
        resetf: () => { Object.assign(f, { q: '', muscle: '', loc: '', difficulty: '' }); me.render(); },
        equip: () => equipment(), open: (b) => exercise(b.dataset.id, o.pick ? { pick: (id) => { o.pick(id); me.close(); } } : {}),
        add: (b) => { o.pick(b.dataset.id); me.close(); },
      } });
    function item(e) {
      return '<div class="k-lib"><button type="button" class="k-lib-main" data-k="open" data-id="' + e.id + '">' + (e.poster ? '<img src="' + G.img(e.id) + '" alt="" loading="lazy">' : '<span class="k-lib-ph">' + icon('dumbbell') + '</span>') + '<span class="k-row-main"><b>' + h(e.name) + '</b><small>' + G.MUSCLE_LABEL[e.primary] + ' · ' + e.difficulty + ' · ' + e.locations.map((l) => G.LOC_LABEL[l]).join(', ') + '</small></span></button>' + (o.pick ? btn(icon('plus'), 'add', 'icon acc', { id: e.id }) : '') + '</div>';
    }
    return me;
  }
  function exercise(id, o) {
    o = o || {}; const e = G.LIBMAP[id]; if (!e) return;
    const v = G.video(id); const pr = G.records().list.find((r) => r.id === id); const series = G.liftSeries(id);
    return sheet({ title: e.name, full: true,
      render: () => (v ? '<video class="k-video" controls playsinline muted loop preload="metadata" poster="' + v.poster + '"><source src="' + v.webm + '" type="video/webm"><source src="' + v.mp4 + '" type="video/mp4"></video>' : e.poster ? '<img class="k-video" src="' + G.img(id) + '" alt="' + h(e.name) + ' demonstration">' : '<div class="k-video k-noimg">' + icon('image') + '<span>Demonstration unavailable</span></div>')
        + '<div class="k-tags"><span>Primary: ' + G.MUSCLE_LABEL[e.primary] + '</span>' + (e.secondary.length ? '<span>Also: ' + e.secondary.map((m) => G.MUSCLE_LABEL[m]).join(', ') + '</span>' : '') + '<span>' + e.difficulty + '</span><span>' + (e.equipment.length ? e.equipment.map((x) => G.EQUIP_LABEL[x]).join(', ') : 'No equipment') + '</span><span>' + e.locations.map((l) => G.LOC_LABEL[l]).join(' · ') + '</span></div>'
        + sec('How to do it') + '<p class="k-p">' + h(e.how) + '</p>' + sec('Common mistakes') + '<p class="k-p">' + h(e.mistakes) + '</p>'
        + (pr ? sec('Your best') + '<p class="k-p"><b>' + G.fmtW(pr.kg) + '</b> on ' + G.fmtShort(pr.date) + '</p>' + (series.length > 1 ? line(series.map((s) => s.kg), { h: 90 }) : '') : '')
        + sec('Similar exercises') + G.alternatives(id).map((a) => row(h(a.name), G.MUSCLE_LABEL[a.primary] + ' · ' + (a.equipment.length ? a.equipment.map((x) => G.EQUIP_LABEL[x]).join(', ') : 'no equipment'), icon('chevron'), 'alt', { id: a.id })).join('')
        + (o.pick ? '<div class="k-sticky">' + btn(o.pickLabel || 'Add to plan', 'pick', 'primary block') + '</div>' : ''),
      on: { alt: (b) => exercise(b.dataset.id, o), pick: (b, ev, me) => { o.pick(id); me.close(); } } });
  }
  function equipment() {
    return sheet({ title: 'My equipment', live: true,
      render: () => { const eq = G.state.settings.equipment; return '<p class="k-mute">Tell GymQuest what you have. Bodyweight exercises always stay available. “No equipment” shows only exercises that need nothing.</p>'
        + G.EQUIP.map((x) => '<button type="button" class="k-row" data-k="t" data-v="' + x + '"><span class="k-row-main"><b>' + G.EQUIP_LABEL[x] + '</b></span><span class="k-row-r">' + (eq.includes(x) ? icon('check', 'acc') : '') + '</span></button>').join('')
        + btn('Full home gym', 'home', 'ghost block') + (eq.length ? btn('Clear', 'clear', 'ghost block') : ''); },
      on: { t: (b) => G.toggleEquipment(b.dataset.v), home: () => G.toggleEquipment('homeGym'), clear: () => G.set('equipment', []) } });
  }

  /* ============ LIVE WORKOUT HELPERS ============ */
  function setEditor(i, j) {
    const s0 = G.sess(); if (!s0) return; const e = s0.exercises[i];
    return sheet({ title: e.name + ' · set ' + (j + 1), live: true,
      render: () => { const s = G.sess() && G.sess().exercises[i] && G.sess().exercises[i].sets[j]; if (!s) return empty('This set is gone.'); return '<div class="k-stepper"><span>Weight</span>' + btn('−', 'wm', 'round') + '<input id="k-w" inputmode="decimal" value="' + G.toU(s.w) + '"><b>' + G.unit() + '</b>' + btn('+', 'wp', 'round') + '</div>'
        + '<div class="k-stepper"><span>Reps</span>' + btn('−', 'rm', 'round') + '<input id="k-r" inputmode="numeric" value="' + s.r + '"><b>reps</b>' + btn('+', 'rp', 'round') + '</div>'
        + '<p class="k-mute">A new weight also applies to the following sets until you change one of them. Your plan stays the same.</p>'
        + '<label class="k-check big"><input type="checkbox" id="k-f"' + (s.fail ? ' checked' : '') + '> Taken to failure' + (s.planFail ? ' <small>(planned)</small>' : '') + '</label>'
        + btn(s.done ? 'Mark as not done' : 'Mark set done', 'done', 'primary block'); },
      change: (t) => { if (t.id === 'k-w') G.setWeight(i, j, G.fromU(num(t.value))); if (t.id === 'k-r') G.setReps(i, j, num(t.value)); if (t.id === 'k-f') G.toggleFail(i, j); },
      on: { wm: () => G.bumpWeight(i, j, -1), wp: () => G.bumpWeight(i, j, 1), rm: () => { const s = G.sess().exercises[i].sets[j]; G.setReps(i, j, s.r - 1); }, rp: () => { const s = G.sess().exercises[i].sets[j]; G.setReps(i, j, s.r + 1); }, done: (b, ev, me) => { G.toggleSet(i, j); me.close(); } } });
  }
  function replace(i) {
    const e = G.sess() && G.sess().exercises[i]; if (!e) return;
    return library({ title: 'Replace ' + e.name, alts: (G.LIBMAP[e.id] || {}).alts || [], muscle: (G.LIBMAP[e.id] || {}).primary || '',
      pick: (id) => { G.replaceExercise(i, id); toast('Replaced for this workout. Your plan is unchanged.'); } });
  }
  function rest() {
    let mins = Math.floor(G.state.lastCustomRest / 60), secs = G.state.lastCustomRest % 60, managing = false;
    const me = sheet({ title: 'Rest timer', live: true, tick: true,
      render: () => {
        const r = G.rest();
        if (managing) return G.state.restPresets.map((p, k) => '<div class="k-mrow"><input class="k-pl" data-id="' + p.id + '" value="' + h(p.label) + '" aria-label="Preset name"><input class="k-ps" type="number" min="5" max="3600" data-id="' + p.id + '" value="' + p.sec + '" aria-label="Seconds"><small>s</small>' + btn(icon('up'), 'pu', 'icon', { id: p.id }) + btn(icon('trash'), 'pd', 'icon', { id: p.id }) + '</div>').join('') + btn(icon('plus') + ' Add preset', 'padd', 'ghost block') + btn('Done', 'mdone', 'primary block');
        return (r ? '<div class="k-rest ' + (r.done ? 'over' : '') + '">' + ring(r.pct, { size: 170, stroke: 12 }) + '<div class="k-rest-t"><b>' + (r.done ? 'Done' : r.text) + '</b><small>' + (r.done ? 'Rest time is over.' : 'resting') + '</small></div></div><div class="k-grid3">' + btn('+15 s', 'add15', 'ghost') + btn('+30 s', 'add30', 'ghost') + btn(r.done ? 'Close' : 'Stop', 'stop', 'primary') + '</div>' : '')
          + sec('Presets', btn('Edit', 'manage', 'link')) + '<div class="k-grid3">' + G.state.restPresets.map((p) => btn('<b>' + G.clock(p.sec * 1000) + '</b><small>' + h(p.label) + '</small>', 'go', 'tile', { s: p.sec, l: p.label })).join('') + '</div>'
          + sec('Custom time') + '<div class="k-inline"><input id="k-cm" type="number" min="0" max="60" value="' + mins + '" aria-label="Minutes"> min <input id="k-cs" type="number" min="0" max="59" value="' + secs + '" aria-label="Seconds"> s ' + btn('Start', 'custom', 'primary sm') + btn('Save', 'csave', 'ghost sm') + '</div>'
          + '<p class="k-mute">Sound when the rest ends: <b>' + (G.state.settings.sound ? 'on (' + G.state.settings.soundLength + ')' : 'off') + '</b>. Change it in Settings.</p>';
      },
      input: (t) => { if (t.id === 'k-cm') mins = num(t.value); if (t.id === 'k-cs') secs = num(t.value); },
      change: (t) => { if (t.classList.contains('k-pl')) { const p = G.state.restPresets.find((x) => x.id === t.dataset.id); G.presetSave(Object.assign({}, p, { label: t.value })); } if (t.classList.contains('k-ps')) { const p = G.state.restPresets.find((x) => x.id === t.dataset.id); G.presetSave(Object.assign({}, p, { sec: Math.max(5, Math.min(3600, Math.round(num(t.value, 60)))) })); } },
      on: {
        go: (b) => G.startRest(+b.dataset.s, b.dataset.l), stop: () => { G.stopRest(); }, add15: () => G.addRest(15), add30: () => G.addRest(30),
        custom: () => { const t = Math.min(3600, Math.max(5, Math.round(mins * 60 + secs))); G.state.lastCustomRest = t; G.startRest(t, 'Custom'); },
        csave: () => { const t = Math.min(3600, Math.max(5, Math.round(mins * 60 + secs))); G.presetSave({ label: 'Custom', sec: t }); toast('Saved as a preset'); },
        manage: () => { managing = true; me.render(); }, mdone: () => { managing = false; me.render(); },
        pu: (b) => G.presetMove(b.dataset.id, -1), pd: (b) => confirm('Delete this preset for good?', 'Delete', { danger: true }).then((y) => y && G.presetDelete(b.dataset.id)),
        padd: () => G.presetSave({ label: 'New', sec: 75 }),
      } });
    return me;
  }
  function finish(o) {
    o = o || {}; const p = G.progress();
    if (!G.sess()) return;
    let note = '';
    const me = sheet({ title: 'Finish workout', center: !o.full,
      render: () => '<p class="k-p">' + p.done + ' of ' + p.total + ' sets done in ' + G.clock(p.elapsed) + '. You earn <b>' + p.xp + ' XP</b>.</p>' + (p.done < p.total ? '<p class="k-mute">Unfinished sets are not counted. You can still go back.</p>' : '')
        + '<label class="k-field"><span>Note (optional)</span><textarea id="k-note" rows="2" placeholder="How did it go?"></textarea></label>'
        + '<div class="k-actions">' + btn('Back to workout', 'close', 'ghost') + btn('Finish', 'fin', 'primary') + '</div>' + btn('Discard this workout', 'discard', 'link danger'),
      input: (t) => { if (t.id === 'k-note') note = t.value; },
      on: {
        fin: () => { const r = G.finish(note); me.close(); summary(r); if (o.after) o.after(r); },
        discard: () => confirm('Discard this workout? Nothing is saved to your history.', 'Discard', { danger: true }).then((y) => { if (y) { G.cancel(); me.close(); toast('Workout discarded'); } }),
      } });
    return me;
  }
  function summary(r) {
    if (!r) return;
    const w = r.workout;
    return sheet({ title: 'Workout saved', center: true,
      render: () => '<div class="k-sum"><b class="k-big">+' + w.xp + ' XP</b><span>' + h(w.planName) + ' · ' + w.minutes + ' min · ' + r.sets + ' sets</span></div>'
        + (r.levelUp ? '<div class="k-banner">' + icon('star') + ' Level ' + r.levelUp + ' reached</div>' : '')
        + (r.prs.length ? sec('New records') + r.prs.map((x) => row(h(x.name), 'was ' + G.fmtW(x.prev), '<b>' + G.fmtW(x.kg) + '</b>')).join('') : '')
        + (r.unlocked.length ? sec('Unlocked') + r.unlocked.map((a) => row(a.icon + ' ' + h(a.name), h(a.desc), '+' + a.xp + ' XP')).join('') : '')
        + '<div class="k-actions">' + btn(icon('share') + ' Share to Community', 'share', 'ghost') + btn('Done', 'close', 'primary') + '</div>',
      on: { share: (b, ev, me) => { me.close(); composer({ workout: w }); } } });
  }

  /* ============ HISTORY / CALENDAR ============ */
  function workoutView(id) {
    return sheet({ title: 'Workout', live: true,
      render: () => { const w = G.workout(id); if (!w) return empty('This workout was deleted.'); return '<div class="k-sum"><b class="k-big">' + h(w.planName) + '</b><span>' + G.fmtDate(w.date, true) + ' · ' + w.minutes + ' min · +' + w.xp + ' XP</span></div>'
        + w.exercises.map((e) => row(h(e.name) + (e.replaces ? ' <small>(replaced ' + h(e.replaces) + ')</small>' : ''), e.setsDone + '/' + e.sets + ' sets × ' + e.reps + (e.failDone && e.failDone.length ? ' · failure on ' + e.failDone.join(', ') : '') + (e.unilateral ? ' · each side' : ''), wlist(e))).join('')
        + (w.note ? sec('Note') + '<p class="k-p">' + h(w.note) + '</p>' : '')
        + '<div class="k-grid3">' + btn(icon('edit') + ' Edit', 'edit', 'ghost') + btn(icon('share') + ' Share', 'share', 'ghost') + btn(icon('trash') + ' Delete', 'del', 'ghost danger') + '</div>'; },
      on: {
        edit: () => editWorkout(id), share: () => pickFriend((k) => { G.shareWorkoutTo(k, id); toast('Sent to ' + G.person(k).name); }),
        del: (b, ev, me) => confirm('Delete this workout? Counts, streak, XP and records are recalculated.', 'Delete', { danger: true }).then((y) => { if (y) { G.deleteWorkout(id); me.close(); toast('Workout deleted', { label: 'Undo', fn: G.undoDelete }); } }),
      } });
  }
  function editWorkout(id) {
    const w = G.clone(G.workout(id));
    const me = sheet({ title: 'Edit workout', full: true, action: btn('Save', 'save', 'primary sm'),
      render: () => '<label class="k-field"><span>Date</span><input type="date" id="k-d" value="' + w.date + '" max="' + G.today() + '"></label><label class="k-field"><span>Duration (min)</span><input type="number" id="k-m" value="' + w.minutes + '"></label>'
        + w.exercises.map((e, i) => '<div class="k-exed"><b>' + h(e.name) + '</b><div class="k-exed-nums"><label>Sets done<input type="number" data-i="' + i + '" data-f="setsDone" value="' + e.setsDone + '" min="0" max="' + e.sets + '"></label><label>Reps<input type="number" data-i="' + i + '" data-f="reps" value="' + e.reps + '"></label><label>' + G.unit() + '<input data-i="' + i + '" data-f="w" inputmode="decimal" value="' + G.toU(G.maxW(e)) + '"></label></div></div>').join('')
        + '<label class="k-field"><span>Note</span><textarea id="k-n" rows="2">' + h(w.note) + '</textarea></label><p class="k-mute">Changing the weight replaces the per-set weights with one weight.</p>',
      input: (t) => { if (t.id === 'k-d') w.date = t.value; if (t.id === 'k-m') w.minutes = num(t.value, w.minutes); if (t.id === 'k-n') w.note = t.value; const i = +t.dataset.i; if (!isNaN(i)) { const e = w.exercises[i]; if (t.dataset.f === 'w') e._w = G.fromU(num(t.value)); else e[t.dataset.f] = Math.max(0, Math.round(num(t.value))); } },
      on: { save: () => { G.updateWorkout(id, { date: w.date, minutes: w.minutes, note: w.note, exercises: w.exercises }); me.close(); toast('Workout updated'); } } });
    return me;
  }
  function historyList() {
    return sheet({ title: 'History', full: true, live: true,
      render: () => { const t = G.totals(); return '<div class="k-stats">' + [['This week', t.week], ['This month', t.month], ['All time', t.all]].map(([l, x]) => '<div><small>' + l + '</small><b>' + x.workouts + '</b><small>' + x.minutes + ' min · ' + x.sets + ' sets</small></div>').join('') + '</div>'
        + G.history().map((w) => row(h(w.planName), G.fmtDate(w.date) + ' · ' + w.minutes + ' min · ' + w.exercises.reduce((s, e) => s + e.setsDone, 0) + ' sets', '+' + w.xp + ' XP', 'w', { id: w.id })).join('') || empty('No workouts yet.'); },
      on: { w: (b) => workoutView(b.dataset.id) } });
  }
  function dayView(date) {
    return sheet({ title: G.fmtDate(date, true), live: true,
      render: () => { const d = G.day(date); return '<p class="k-tagline k-st-' + d.status + '">' + { done: 'Trained', missed: 'No workout recorded', future: 'Coming up' }[d.status] + '</p>'
        + d.workouts.map((w) => row(h(w.planName), w.minutes + ' min · ' + w.exercises.map((e) => h(e.name)).join(', '), '+' + w.xp + ' XP', 'w', { id: w.id })).join('')
        + d.activities.map((a) => row(G.ACT_LABEL[a.kind], a.minutes + ' min' + (a.km ? ' · ' + a.km + ' km' : ''), '')).join('')
        + (d.achievements.length ? sec('Unlocked that day') + d.achievements.map((a) => row(a.icon + ' ' + h(a.name), h(a.desc), '')).join('') : '')
        + (!d.workouts.length && !d.activities.length ? empty(d.status === 'future' ? 'Nothing planned yet.' : 'Rest day.') : ''); },
      on: { w: (b) => workoutView(b.dataset.id) } });
  }
  function calendar() {
    const t = G.parse(G.today()); let y = t.getFullYear(), m = t.getMonth();
    return sheet({ title: 'Calendar', full: true, live: true,
      render: () => { const M = G.month(y, m); return '<div class="k-calnav">' + btn(icon('back'), 'prev', 'icon') + '<b>' + M.title + '</b>' + btn(icon('chevron'), 'next', 'icon') + btn('Today', 'today', 'ghost sm') + '</div>'
        + '<div class="k-cal">' + G.WD.map((d) => '<span class="k-cal-h">' + d.slice(0, 2) + '</span>').join('') + M.days.map((d) => '<button type="button" class="k-cal-d s-' + d.status + (d.today ? ' today' : '') + (d.out ? ' out' : '') + '" data-k="day" data-d="' + d.date + '"><span>' + d.n + '</span>' + (d.out ? '<small>' + d.mon + '</small>' : '') + (d.count > 1 ? '<i>' + d.count + '</i>' : '') + '</button>').join('') + '</div>'
        + '<div class="k-legend"><span class="s-done">Trained</span><span class="s-missed">No workout</span><span class="s-future">Upcoming</span><span class="today">Today</span></div>'; },
      on: { prev: (b, ev, me) => { m--; if (m < 0) { m = 11; y--; } me.render(); }, next: (b, ev, me) => { m++; if (m > 11) { m = 0; y++; } me.render(); }, today: (b, ev, me) => { y = t.getFullYear(); m = t.getMonth(); me.render(); }, day: (b) => dayView(b.dataset.d) } });
  }
  function records() {
    return sheet({ title: 'Personal records', full: true,
      render: () => { const r = G.records(); return r.list.map((x) => row(h(x.name), 'Set on ' + G.fmtShort(x.date) + (x.prev ? ' · was ' + G.fmtW(x.prev) : ''), '<b>' + G.fmtW(x.kg) + '</b>', 'ex', { id: x.id })).join('') || empty('Finish a workout with weights to set records.'); },
      on: { ex: (b) => exercise(b.dataset.id) } });
  }
  function achievements() {
    return sheet({ title: 'Achievements', full: true, live: true,
      render: () => { const X = G.xp(); const list = G.achievements(); const cats = [['milestones', 'Workouts'], ['consistency', 'Consistency'], ['records', 'Records'], ['customization', 'Your plans'], ['dedication', 'Dedication'], ['milestone', '5 kg milestones']];
        return '<div class="k-sum"><b class="k-big">Level ' + X.level + '</b><span>' + X.total + ' XP · ' + G.levelTitle(X.level) + ' · ' + (X.need - X.into) + ' XP to level ' + (X.level + 1) + '</span><div class="k-bar"><i style="width:' + X.pct + '%"></i></div></div>'
          + '<p class="k-mute">Every workout gives 20 XP plus 2 XP per completed set. 100 XP per level.</p>'
          + cats.map(([c, l]) => { const a = list.filter((x) => x.category === c); return a.length ? sec(l + ' · ' + a.filter((x) => x.got).length + '/' + a.length) + '<div class="k-ach">' + a.map((x) => '<div class="' + (x.got ? 'got' : '') + '"><span>' + x.icon + '</span><b>' + h(x.name) + '</b><small>' + (x.got ? (x.date ? G.fmtShort(x.date) : 'Unlocked') + (x.xp ? ' · +' + x.xp + ' XP' : '') : x.have + ' / ' + x.need) + '</small>' + (x.got ? '' : '<i style="--p:' + x.progress + '%"></i>') + '</div>').join('') + '</div>' : ''; }).join(''); } });
  }

  /* ============ BODY / FOOD / PHOTOS / ACTIVITY ============ */
  function body() {
    let field = 'weight';
    return sheet({ title: 'Body', full: true, live: true, action: btn(icon('plus'), 'add', 'icon'),
      render: () => { const ser = G.bodySeries(field); const meta = G.BODY_FIELDS.find((f) => f[0] === field);
        return '<div class="k-chips">' + G.BODY_FIELDS.map(([k, l]) => '<button type="button" class="k-chip' + (k === field ? ' on' : '') + '" data-k="f" data-v="' + k + '">' + l + '</button>').join('') + '</div>'
          + '<div class="k-stats">' + G.BODY_FIELDS.slice(0, 3).map(([k, l, u]) => { const L = G.bodyLatest(k); return '<div><small>' + l + '</small><b>' + (L ? L.value : '—') + '</b><small>' + (L && L.change != null ? (L.change > 0 ? '+' : '') + L.change + ' ' + u : u) + '</small></div>'; }).join('') + '</div>'
          + (ser.length > 1 ? line(ser.map((s) => s.v), { aria: meta[1] + ' trend', labels: (v) => v + ' ' + meta[2] }) : empty('Log two entries to see a trend.'))
          + '<p class="k-mute">Daily changes are mostly water and food. Look at the trend over weeks, measured at the same time of day.</p>'
          + sec('Entries') + G.bodySorted().slice().reverse().map((b) => '<div class="k-mrow"><span class="k-row-main"><b>' + G.fmtShort(b.date) + '</b><small>' + G.BODY_FIELDS.filter(([k]) => b[k] != null).map(([k, l, u]) => l + ' ' + b[k] + ' ' + u).join(' · ') + (b.note ? ' · ' + h(b.note) : '') + '</small></span>' + btn(icon('trash'), 'del', 'icon', { id: b.id }) + '</div>').join('')
          + sec('Calorie estimate (optional)', sw(G.state.settings.showCalories, 'cal')) + (G.state.settings.showCalories ? calories() : '');
      },
      change: (t) => { if (t.dataset.c) { G.state.calorie[t.dataset.c] = t.type === 'number' ? num(t.value) : t.value; G.changed('body'); } },
      on: { f: (b, ev, me) => { field = b.dataset.v; me.render(); }, add: () => bodyEntry(), del: (b) => confirm('Delete this entry?', 'Delete', { danger: true }).then((y) => y && G.deleteBody(b.dataset.id)), cal: () => G.set('showCalories', !G.state.settings.showCalories) } });
  }
  function calories() {
    const c = G.state.calorie, e = G.calorieEstimate();
    return '<div class="k-exed-nums"><label>Age<input type="number" data-c="age" value="' + c.age + '"></label><label>Height cm<input type="number" data-c="height" value="' + c.height + '"></label><label>Sex<select data-c="sex"><option value="male"' + (c.sex === 'male' ? ' selected' : '') + '>Male</option><option value="female"' + (c.sex === 'female' ? ' selected' : '') + '>Female</option></select></label></div>'
      + '<label class="k-field"><span>Activity</span><select data-c="activity">' + [[1.2, 'Mostly sitting'], [1.375, 'Light'], [1.55, 'Moderate'], [1.725, 'Very active']].map(([v, l]) => '<option value="' + v + '"' + (+c.activity === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>'
      + (e ? '<div class="k-sum"><b class="k-big">' + e.low + '–' + e.high + ' kcal</b><span>estimated daily energy use (Mifflin-St Jeor, ±10 %)</span></div><p class="k-mute">An estimate for adults, not a target. It never suggests losing or gaining weight.</p>' : '<p class="k-mute">Needs an adult age, a height and a body weight entry.</p>');
  }
  function bodyEntry() {
    const d = { date: G.today() };
    const me = sheet({ title: 'New measurement', action: btn('Save', 'save', 'primary sm'),
      html: '<label class="k-field"><span>Date</span><input type="date" data-b="date" value="' + d.date + '" max="' + G.today() + '"></label><div class="k-exed-nums">' + G.BODY_FIELDS.map(([k, l, u]) => '<label>' + l + ' (' + u + ')<input inputmode="decimal" data-b="' + k + '" placeholder="—"></label>').join('') + '</div><label class="k-field"><span>Note</span><input data-b="note" placeholder="optional"></label>',
      input: (t) => { const k = t.dataset.b; if (!k) return; d[k] = k === 'date' || k === 'note' ? t.value : (t.value === '' ? null : num(t.value)); },
      on: { save: () => { if (!G.BODY_FIELDS.some(([k]) => d[k] != null)) { toast('Enter at least one value'); return; } G.addBody(d); me.close(); toast('Measurement saved'); } } });
    return me;
  }
  function food() {
    return sheet({ title: 'Food', full: true, live: true, action: btn(icon('plus'), 'add', 'icon'),
      render: () => { const f = G.foodDay(); const e = G.calorieEstimate();
        return '<div class="k-stats"><div><small>Today</small><b>' + f.kcal + '</b><small>kcal' + (e && G.state.settings.showCalories ? ' · est. use ' + e.low + '–' + e.high : '') + '</small></div><div><small>Protein</small><b>' + f.p + '</b><small>g</small></div><div><small>Carbs · fat</small><b>' + f.c + '·' + f.f + '</b><small>g</small></div></div>'
          + '<p class="k-mute">Your own numbers. There is no food database and nothing here is verified nutrition data.</p>'
          + (f.items.length ? f.items.map((x) => '<div class="k-mrow"><span class="k-row-main"><b>' + h(x.name) + '</b><small>' + h(x.meal) + ' · ' + x.kcal + ' kcal' + (x.p ? ' · ' + x.p + ' g protein' : '') + '</small></span>' + btn(icon('trash'), 'del', 'icon', { id: x.id }) + '</div>').join('') : empty('Nothing logged today.'))
          + sec('Saved foods') + G.state.foods.map((x) => row(h(x.name), x.kcal + ' kcal', icon('plus'), 'quick', { id: x.id })).join(''); },
      on: { add: () => foodEntry(), del: (b) => G.deleteFood(b.dataset.id), quick: (b) => { const x = G.state.foods.find((f) => f.id === b.dataset.id); G.logFood({ name: x.name, kcal: x.kcal, p: x.p, c: x.c, f: x.f }); toast('Logged ' + x.name); } } });
  }
  function foodEntry() {
    const d = { name: '', kcal: 0, p: 0, c: 0, f: 0, meal: 'Snack' }; let saveIt = true;
    const me = sheet({ title: 'Log food', action: btn('Save', 'save', 'primary sm'),
      html: '<label class="k-field"><span>Food or meal</span><input data-x="name" autofocus></label><div class="k-exed-nums"><label>kcal<input type="number" data-x="kcal"></label><label>Protein g<input type="number" data-x="p"></label><label>Carbs g<input type="number" data-x="c"></label><label>Fat g<input type="number" data-x="f"></label></div><label class="k-field"><span>Meal</span><select data-x="meal"><option>Breakfast</option><option>Lunch</option><option>Dinner</option><option selected>Snack</option></select></label><label class="k-check"><input type="checkbox" id="k-sv" checked> Save for next time</label>',
      input: (t) => { const k = t.dataset.x; if (k) d[k] = k === 'name' || k === 'meal' ? t.value : num(t.value); }, change: (t) => { if (t.id === 'k-sv') saveIt = t.checked; if (t.dataset.x === 'meal') d.meal = t.value; },
      on: { save: () => { if (!d.name.trim()) { toast('Name the food'); return; } G.logFood(d, saveIt); me.close(); toast('Logged'); } } });
    return me;
  }
  function photos() {
    return sheet({ title: 'Progress photos', full: true, live: true,
      render: () => '<p class="k-mute">Photos stay on this device. Same light, same pose, every few weeks.</p><label class="k-btn primary block k-file">' + icon('camera') + ' Add a photo<input type="file" accept="image/*" id="k-ph"></label>'
        + (G.state.photos.length ? '<div class="k-photos">' + G.state.photos.slice().reverse().map((p) => '<figure><img src="' + p.src + '" alt="Progress photo ' + p.date + '"><figcaption>' + G.fmtShort(p.date) + btn(icon('trash'), 'del', 'icon', { id: p.id }) + '</figcaption></figure>').join('') + '</div>' : empty('No photos yet.')),
      change: (t) => { if (t.id === 'k-ph' && t.files[0]) G.addPhoto(t.files[0]).then(() => toast('Photo saved')).catch(() => toast('Could not read that image')); },
      on: { del: (b) => confirm('Delete this photo?', 'Delete', { danger: true }).then((y) => y && G.deletePhoto(b.dataset.id)) } });
  }
  function activity() {
    let km = '';
    return sheet({ title: 'Activities', full: true, live: true, tick: true,
      render: () => { const a = G.state.liveActivity;
        return (a ? '<div class="k-rest"><div class="k-rest-t"><b>' + G.clock(Date.now() - a.started) + '</b><small>' + G.ACT_LABEL[a.kind] + ' in progress</small></div></div><div class="k-inline"><input id="k-km" inputmode="decimal" placeholder="Distance km (optional)" value="' + h(km) + '">' + btn(icon('stop') + ' Stop', 'stop', 'primary') + '</div>'
          : '<div class="k-grid3">' + ['run', 'walk', 'cycle'].map((k) => btn(icon('run') + '<b>' + G.ACT_LABEL[k] + '</b>', 'go', 'tile', { k })).join('') + '</div><p class="k-mute">Starts a live timer. Activities give XP: 10 plus 1 per 5 minutes.</p>')
          + sec('Recent') + (G.state.activities.slice().reverse().map((x) => '<div class="k-mrow"><span class="k-row-main"><b>' + G.ACT_LABEL[x.kind] + '</b><small>' + G.fmtDate(x.date) + ' · ' + x.minutes + ' min' + (x.km ? ' · ' + x.km + ' km' : '') + '</small></span>' + btn(icon('trash'), 'del', 'icon', { id: x.id }) + '</div>').join('') || empty('No activities yet.')); },
      input: (t) => { if (t.id === 'k-km') km = t.value; },
      on: { go: (b) => G.startActivity(b.dataset.k), stop: () => { G.stopActivity(num(km)); km = ''; toast('Activity saved'); }, del: (b) => G.deleteActivity(b.dataset.id) } });
  }

  /* ============ COMMUNITY ============ */
  function chats() {
    return sheet({ title: 'Messages', full: true, live: true, action: btn(icon('plus'), 'new', 'icon'),
      render: () => (G.state.community.notifications ? '' : '<div class="k-banner">' + icon('bell') + ' Get a notification when a friend writes. ' + btn('Turn on', 'notif', 'link') + '</div>')
        + G.chats().map((c) => '<button type="button" class="k-row" data-k="open" data-p="' + c.key + '">' + avatar(c.key) + '<span class="k-row-main"><b>' + h(c.person.name) + '</b><small>' + (c.last ? (c.last.from === 'me' ? 'You: ' : '') + h(c.last.text || ('Shared ' + (c.last.share ? c.last.share.type + ' “' + c.last.share.name + '”' : ''))) : '') + '</small></span><span class="k-row-r">' + (c.unread ? '<i class="k-dot">' + c.unread + '</i>' : c.last ? G.timeAgo(c.last.ts) : '') + '</span></button>').join(''),
      on: { open: (b) => chat(b.dataset.p), new: () => pickFriend((k) => chat(k)), notif: () => { G.setCommunity('notifications', true); toast('Notifications on for this device'); } } });
  }
  function chat(k) {
    let replyTo = null, text = '';
    const me = sheet({ title: G.person(k).name, full: true, live: true,
      render: () => '<div class="k-thread">' + G.thread(k).map((m) => '<div class="k-msg ' + (m.from === 'me' ? 'me' : 'them') + '" data-k="msg" data-id="' + m.id + '">' + (m.replyTo ? '<small class="k-rep">↪ ' + h(m.replyTo) + '</small>' : '')
        + (m.share ? '<div class="k-share"><small>' + (m.share.type === 'plan' ? 'Plan' : 'Workout') + '</small><b>' + h(m.share.name) + '</b>' + m.share.lines.map((l) => '<span>' + h(l) + '</span>').join('') + (m.share.type === 'plan' && m.from !== 'me' && m.share.exercises ? btn('Save plan', 'saveplan', 'link', { id: m.id }) : '') + '</div>' : '<span>' + h(m.text) + '</span>')
        + '<time>' + G.hhmm(m.ts) + '</time>' + (m.react && Object.keys(m.react).length ? '<em>' + Object.values(m.react).join('') + '</em>' : '') + '</div>').join('') + '</div>'
        + '<div class="k-compose">' + (replyTo ? '<div class="k-replying">Replying to “' + h(replyTo.text || replyTo.share.name) + '” ' + btn(icon('x'), 'noreply', 'icon') + '</div>' : '') + '<div class="k-inline">' + btn(icon('share'), 'sharemenu', 'icon') + '<input id="k-msg" placeholder="Message" value="' + h(text) + '" autocomplete="off">' + btn(icon('send'), 'send', 'icon acc') + '</div></div>',
      after: (m) => { const t = m.el.querySelector('.k-thread'); if (t) m.body.scrollTop = m.body.scrollHeight; },
      input: (t) => { if (t.id === 'k-msg') text = t.value; },
      on: {
        send: () => { if (!text.trim()) return; G.send(k, replyTo ? { text: text.trim(), replyTo: replyTo.text || replyTo.share.name } : text.trim()); text = ''; replyTo = null; },
        msg: (b) => { const m = G.thread(k).find((x) => x.id === b.dataset.id); if (!m) return; const s = sheet({ title: 'Message', center: true, html: '<div class="k-reacts">' + ['❤️', '😂', '👍', '😮', '💪', '🔥'].map((e) => '<button type="button" data-k="r" data-e="' + e + '">' + e + '</button>').join('') + '</div>' + btn(icon('reply') + ' Reply', 'rep', 'ghost block'),
          on: { r: (bb) => { G.react(k, m.id, bb.dataset.e); s.close(); }, rep: () => { replyTo = m; s.close(); me.render(); } } }); },
        noreply: () => { replyTo = null; me.render(); },
        saveplan: (b) => { const m = G.thread(k).find((x) => x.id === b.dataset.id); const p = G.savePlanFrom(m.share); toast('Saved “' + p.name + '” to your plans'); },
        sharemenu: () => { const s = sheet({ title: 'Share a plan or workout', render: () => sec('Plans') + G.plans().map((p) => row(h(p.name), p.exercises.length + ' exercises', icon('send'), 'sp', { id: p.id })).join('') + sec('Recent workouts') + G.history().slice(0, 4).map((w) => row(h(w.planName), G.fmtDate(w.date), icon('send'), 'sw', { id: w.id })).join(''),
          on: { sp: (bb) => { G.sharePlanTo(k, bb.dataset.id); s.close(); }, sw: (bb) => { G.shareWorkoutTo(k, bb.dataset.id); s.close(); } } }); },
      } });
    me.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'k-msg') { e.preventDefault(); me.o.on.send(); } });
    return me;
  }
  function pickFriend(cb) {
    const s = sheet({ title: 'Choose a friend', render: () => G.state.community.friends.map((k) => '<button type="button" class="k-row" data-k="p" data-p="' + k + '">' + avatar(k) + '<span class="k-row-main"><b>' + h(G.person(k).name) + '</b><small>@' + h(G.person(k).handle) + '</small></span></button>').join(''), on: { p: (b) => { s.close(); cb(b.dataset.p); } } });
    return s;
  }
  function postView(id) {
    let text = '';
    return sheet({ title: 'Post', full: true, live: true,
      render: () => { const p = G.state.community.posts.find((x) => x.id === id); if (!p) return empty('Deleted.'); return postCard(p, true) + sec('Comments') + (p.comments.map((c) => '<div class="k-cmt">' + avatar(c.who, 28) + '<span><b>' + h(G.person(c.who).name) + '</b> ' + h(c.text) + '</span></div>').join('') || empty('No comments yet.'))
        + '<div class="k-compose"><div class="k-inline"><input id="k-c" placeholder="Add a comment" value="' + h(text) + '">' + btn(icon('send'), 'c', 'icon acc') + '</div></div>'; },
      input: (t) => { if (t.id === 'k-c') text = t.value; },
      on: { c: () => { G.comment(id, text); text = ''; }, like: () => G.like(id), saveplan: () => { const p = G.state.community.posts.find((x) => x.id === id); const np = G.savePlanFrom({ name: p.plan.name, exercises: p.plan.exercises.map(([eid, s, r]) => [eid, s, r, 0]) }); toast('Saved “' + np.name + '”'); }, del: (b, ev, me) => confirm('Delete your post?', 'Delete', { danger: true }).then((y) => { if (y) { G.deletePost(id); me.close(); } }) } });
  }
  function postCard(p, full) {
    const who = G.person(p.who);
    return '<article class="k-post"><header>' + avatar(p.who) + '<span class="k-row-main"><b>' + h(who.name) + '</b><small>@' + h(who.handle) + ' · ' + G.timeAgo(p.ts) + '</small></span>' + (p.who === 'me' && full ? btn(icon('trash'), 'del', 'icon') : '') + '</header>'
      + (p.text ? '<p>' + h(p.text) + '</p>' : '')
      + (p.pr ? '<div class="k-share"><small>New record</small><b>' + h(p.pr.lift) + ' ' + p.pr.kg + ' kg</b><span>was ' + p.pr.prev + ' kg</span></div>' : '')
      + (p.workout ? '<div class="k-share"><small>Workout · ' + p.workout.minutes + ' min · ' + p.workout.sets + ' sets</small><b>' + h(p.workout.plan) + '</b>' + p.workout.lines.map((l) => '<span>' + h(l) + '</span>').join('') + '</div>' : '')
      + (p.plan ? '<div class="k-share"><small>Shared plan</small><b>' + h(p.plan.name) + '</b>' + p.plan.exercises.map(([id, s, r]) => '<span>' + h((G.LIBMAP[id] || {}).name || id) + ' ' + s + ' × ' + r + '</span>').join('') + (full ? btn('Save to my plans', 'saveplan', 'link') : '') + '</div>' : '')
      + (p.photo ? '<img class="k-post-img" src="' + p.photo + '" alt="">' : p.img && G.img(p.img) ? '<img class="k-post-img" src="' + G.img(p.img) + '" alt="" loading="lazy">' : '')
      + '<footer>' + btn(icon('heart', p.liked ? 'fill' : '') + ' ' + p.likes, 'like', 'link' + (p.liked ? ' on' : ''), { id: p.id, do: 'like', arg: p.id }) + '<span>' + icon('comment') + ' ' + p.comments.length + '</span></footer></article>';
  }
  function composer(attach) {
    attach = attach || {}; let text = attach.workout ? 'Done: ' + attach.workout.planName + '.' : '';
    const me = sheet({ title: 'New post', action: btn('Post', 'post', 'primary sm'),
      render: () => '<textarea id="k-pt" class="k-area" rows="4" placeholder="What did you train?" autofocus>' + h(text) + '</textarea>'
        + (attach.workout ? '<div class="k-share"><small>Attached workout</small><b>' + h(attach.workout.planName) + '</b><span>' + attach.workout.minutes + ' min · ' + attach.workout.exercises.reduce((s, e) => s + e.setsDone, 0) + ' sets</span></div>' : '')
        + (attach.photo ? '<img class="k-post-img" src="' + attach.photo + '" alt="">' : '<label class="k-btn ghost block k-file">' + icon('image') + ' Add a photo<input type="file" accept="image/*" id="k-pp"></label>')
        + '<p class="k-mute">Visible to Community members. Moderated. Be kind.</p>',
      input: (t) => { if (t.id === 'k-pt') text = t.value; },
      change: (t) => { if (t.id === 'k-pp' && t.files[0]) { const r = new FileReader(); r.onload = () => { const im = new Image(); im.onload = () => { const k = Math.min(1, 720 / im.width); const c = document.createElement('canvas'); c.width = im.width * k; c.height = im.height * k; c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); attach.photo = c.toDataURL('image/jpeg', 0.7); me.render(); }; im.src = r.result; }; r.readAsDataURL(t.files[0]); } },
      on: { post: () => { if (!text.trim() && !attach.photo && !attach.workout) { toast('Write something first'); return; } G.post(text.trim(), attach); me.close(); toast('Posted'); } } });
    return me;
  }
  function leaderboard() {
    return sheet({ title: 'Top 20 this week', full: true, live: true,
      render: () => { const L = G.leaderboard(); return '<p class="k-mute">XP from workouts and activities, at most 300 a day and 1,000 a week. Only name, level and XP are shown.</p>'
        + L.top.map((r) => '<div class="k-lb' + (r.me ? ' me' : '') + '"><span class="k-lb-n">' + r.rank + '</span>' + avatar(r.key) + '<span class="k-row-main"><b>' + h(r.person.name) + (r.me ? ' (you)' : '') + '</b><small>Level ' + r.person.level + '</small></span><b>' + r.xp + ' XP</b></div>').join('')
        + (L.me && L.me.rank > 20 ? '<div class="k-lb me"><span class="k-lb-n">' + L.me.rank + '</span>' + avatar('me') + '<span class="k-row-main"><b>You</b></span><b>' + L.me.xp + '</b></div>' : '')
        + (L.me ? '' : '<p class="k-mute">You are hidden from the leaderboard.</p>')
        + row('Show me on the leaderboard', '', sw(G.state.community.showOnBoard, 'vis')); },
      on: { vis: () => G.setCommunity('showOnBoard', !G.state.community.showOnBoard) } });
  }
  function friends() {
    let q = '';
    return sheet({ title: 'Friends', full: true, live: true,
      render: () => { const C = G.state.community;
        return (C.requests.length ? sec('Requests') + C.requests.map((k) => '<div class="k-mrow">' + avatar(k) + '<span class="k-row-main"><b>' + h(G.person(k).name) + '</b><small>@' + h(G.person(k).handle) + '</small></span>' + btn('Accept', 'acc', 'primary sm', { p: k }) + btn('Decline', 'dec', 'ghost sm', { p: k }) + '</div>').join('') : '')
          + sec('Your friends · ' + C.friends.length) + C.friends.map((k) => '<div class="k-mrow">' + avatar(k) + '<span class="k-row-main"><b>' + h(G.person(k).name) + '</b><small>Level ' + G.person(k).level + '</small></span>' + btn(icon('chat'), 'msg', 'icon', { p: k }) + btn(icon('x'), 'rm', 'icon', { p: k }) + '</div>').join('')
          + sec('Find people') + '<label class="k-search">' + icon('search') + '<input id="k-fq" placeholder="Name or @handle" value="' + h(q) + '"></label>'
          + (q ? G.searchPeople(q).filter((p) => !C.friends.includes(p.key)).map((p) => '<div class="k-mrow">' + avatar(p.key) + '<span class="k-row-main"><b>' + h(p.name) + '</b><small>@' + h(p.handle) + '</small></span>' + btn('Add', 'add', 'ghost sm', { p: p.key }) + '</div>').join('') || empty('No one found.') : ''); },
      change: (t, me) => { if (t.id === 'k-fq') { q = t.value; me.render(); } },
      on: { acc: (b) => G.acceptFriend(b.dataset.p), dec: (b) => G.declineFriend(b.dataset.p), msg: (b) => chat(b.dataset.p), add: (b) => { G.addFriend(b.dataset.p); toast('Friend added'); }, rm: (b) => confirm('Remove ' + G.person(b.dataset.p).name + ' from friends?', 'Remove', { danger: true }).then((y) => y && G.removeFriend(b.dataset.p)) } });
  }
  function profile() {
    return sheet({ title: 'Community profile', full: true, live: true,
      render: () => { const C = G.state.community, X = G.xp(), pr = G.state.profile;
        return '<div class="k-prof">' + avatar('me', 64) + '<div><b class="k-big">' + h(pr.name) + '</b><small>@' + h(pr.handle) + ' · Level ' + X.level + '</small></div></div>'
          + '<label class="k-field"><span>Name</span><input data-pf="name" value="' + h(pr.name) + '"></label><label class="k-field"><span>Bio</span><input data-pf="bio" value="' + h(pr.bio) + '"></label>'
          + sec('Top achievements') + (C.showTopAch ? '<div class="k-ach">' + G.topAchievements().map((a) => '<div class="got"><span>' + a.icon + '</span><b>' + h(a.name) + '</b><small>+' + a.xp + ' XP</small></div>').join('') + '</div>' : '<p class="k-mute">Hidden from others.</p>')
          + row('Show my top achievements', '', sw(C.showTopAch, 'tog', { f: 'showTopAch' })) + row('Show me on the leaderboard', '', sw(C.showOnBoard, 'tog', { f: 'showOnBoard' }))
          + row('Notifications on this device', 'A friend’s message, even when GymQuest is closed', sw(C.notifications, 'tog', { f: 'notifications' }))
          + sec('Reminders') + (C.notifications ? '' : '<p class="k-mute">Reminders need notifications on.</p>') + C.reminders.map((r) => row(h(r.label), h(r.detail), sw(r.on, 'rem', { r: r.kind }))).join('')
          + sec('Community') + row('Community', 'Turn off to hide every online feature', sw(C.on, 'tog', { f: 'on' })); },
      change: (t) => { if (t.dataset.pf) G.setProfile({ [t.dataset.pf]: t.value }); },
      on: { tog: (b) => G.setCommunity(b.dataset.f, !G.state.community[b.dataset.f]), rem: (b) => G.toggleReminder(b.dataset.r) } });
  }

  /* ============ SETTINGS ============ */
  function settings() {
    return sheet({ title: 'Settings', full: true, live: true,
      render: () => { const s = G.state.settings, w = G.weekInfo();
        return sec('Language') + '<select class="k-select" data-s="lang">' + [['en', 'English'], ['sk', 'Slovenčina'], ['es', 'Español'], ['pt-BR', 'Português (Brasil)'], ['fr', 'Français'], ['ar', 'العربية']].map(([v, l]) => '<option value="' + v + '"' + (s.lang === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select><p class="k-mute">The concepts are written in English only. The real app keeps all six languages, including right-to-left Arabic.</p>'
          + sec('Weekly goal') + '<div class="k-seg">' + [1, 2, 3, 4, 5, 6, 7].map((n) => '<button type="button" data-k="goal" data-v="' + n + '" class="' + (s.weeklyGoal === n ? 'on' : '') + '">' + n + '</button>').join('') + '</div>'
          + row('Excuse this week', 'Ill or busy? The streak is kept, not extended', sw(w.excused, 'exc'))
          + sec('Units') + seg([['kg', 'kg'], ['lb', 'lb']], s.units, 'unit')
          + sec('Rest timer sound') + row('Gong when the rest ends', 'Off by default', sw(s.sound, 'snd')) + seg([['short', 'Short'], ['standard', 'Standard'], ['long', 'Long']], s.soundLength, 'len') + btn('Test sound', 'test', 'ghost block' + (s.sound ? '' : ' disabled'))
          + sec('Account') + row('Account sync', s.sync ? 'Synced · saved on this device' : 'Off · saved on this device', sw(s.sync, 'sync')) + row('Community profile', '', icon('chevron'), 'prof')
          + sec('Your data') + row('Automatic backup', 'While this device does not sync. Last: ' + G.fmtShort(G.state.lastBackup), sw(s.autoBackup, 'ab'))
          + '<div class="k-grid2">' + btn(icon('download') + ' Export', 'exp', 'ghost') + '<label class="k-btn ghost k-file">' + icon('upload') + ' Import<input type="file" accept="application/json,.json" id="k-imp"></label></div>'
          + (G.state.demo ? btn('Remove demo data', 'nodemo', 'ghost block') : btn('Load demo data', 'demo', 'ghost block'))
          + btn('Reset all data', 'reset', 'danger block')
          + '<p class="k-mute">GymQuest concept r2 · data is stored only in this browser, separately from the real app.</p>';
      },
      change: (t) => { if (t.dataset.s === 'lang') { G.set('lang', t.value); toast('Language saved (concepts show English)'); } if (t.id === 'k-imp' && t.files[0]) confirm('Replace everything here with the backup?', 'Import').then((y) => { if (y) G.importJSON(t.files[0]).then(() => toast('Backup imported')).catch((e) => toast(e.message || 'Import failed')); }); },
      on: {
        goal: (b) => G.setGoal(+b.dataset.v), exc: () => G.toggleExcused(), unit: (b) => G.set('units', b.dataset.v), snd: () => G.set('sound', !G.state.settings.sound), len: (b) => G.set('soundLength', b.dataset.v),
        test: () => { if (!G.state.settings.sound) { toast('Turn the sound on first'); return; } if (!G.gong()) toast('Sound could not be played. Check your device sound settings.'); },
        sync: () => G.set('sync', !G.state.settings.sync), ab: () => G.set('autoBackup', !G.state.settings.autoBackup), prof: () => profile(), exp: () => { G.exportJSON(); toast('Backup file saved'); },
        demo: () => { G.resetAll(false); toast('Demo data loaded'); }, nodemo: () => confirm('Remove the demo workouts, measurements and food? Plans stay.', 'Remove', { danger: true }).then((y) => y && G.removeDemo()),
        reset: () => confirm('Reset all data? Plans, history, XP and settings go back to the start.', 'Continue', { danger: true }).then((y) => y && confirm('This cannot be undone. Export a backup first if you might need it.', 'Reset everything', { danger: true, title: 'Last check' })).then((y) => { if (y) { G.resetAll(true); closeAll(); toast('All data reset'); } }),
      } });
  }


  /* ---------- Kit.app: tabs, re-render on change, live clocks, shared actions ----------
     Designs give render functions per screen. Elements with data-do="action" (+ data-arg) run the
     shared actions below; data-live="elapsed|rest|restpct|activity" are refreshed every second. */
  const ACTIONS = {
    start: (a) => G.start(a), select: (a) => G.selectPlan(a), log: () => G.logNext(),
    set: (a) => { const [i, j, side] = String(a).split(':'); G.toggleSet(+i, +j, side); },
    wplus: (a) => { const [i, j] = String(a).split(':').map(Number); G.bumpWeight(i, j, 1); },
    wminus: (a) => { const [i, j] = String(a).split(':').map(Number); G.bumpWeight(i, j, -1); },
    cur: (a) => G.setCurrent(+a), prev: () => G.sess() && G.setCurrent(G.sess().cur - 1), next: () => G.sess() && G.setCurrent(G.sess().cur + 1),
    addset: (a) => G.addSet(+a), rmset: (a) => G.removeSet(+a), fail: (a) => { const [i, j] = String(a).split(':').map(Number); G.toggleFail(i, j); },
    rest: (a) => G.startRest(+a || 90), reststop: () => G.stopRest(), restadd: (a) => G.addRest(+a || 15),
    finish: () => finish(), discard: () => confirm('Discard this workout? Nothing is saved to your history.', 'Discard', { danger: true }).then((y) => { if (y) { G.cancel(); toast('Workout discarded'); } }),
    like: (a) => G.like(a), excuse: () => G.toggleExcused(), goal: (a) => G.setGoal(+a), unit: (a) => G.set('units', a),
    actstart: (a) => G.startActivity(a || 'run'), react: (a) => { const [k, id, e] = String(a).split('|'); G.react(k, id, e); },
  };
  function app(o) {
    const el = o.root; mount(el);
    let cur = o.initial || Object.keys(o.screens)[0];
    const scroller = () => el.querySelector('[data-scroll]');
    function render(keepScroll) {
      const sc = scroller(); const top = sc ? sc.scrollTop : 0;
      el.querySelectorAll('[data-screen]').forEach((s) => { const on = s.dataset.screen === cur; s.hidden = !on; if (on && o.screens[cur]) s.innerHTML = o.screens[cur](s); });
      el.querySelectorAll('[data-tab]').forEach((b) => { const on = b.dataset.tab === cur; b.classList.toggle('is-active', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
      if (o.chrome) o.chrome(cur);
      if (sc && keepScroll) sc.scrollTop = top;
      live();
      if (o.after) o.after(cur);
    }
    function live() {
      const p = G.progress(), r = G.rest(), a = G.state.liveActivity;
      el.querySelectorAll('[data-live]').forEach((n) => {
        const k = n.dataset.live;
        if (k === 'elapsed') n.textContent = G.sess() ? G.clock(p.elapsed) : '0:00';
        else if (k === 'rest') n.textContent = r ? (r.done ? (n.dataset.done || 'Go') : r.text) : (n.dataset.idle || '');
        else if (k === 'restpct') n.style.setProperty('--p', r ? r.pct.toFixed(1) : 0);
        else if (k === 'activity') n.textContent = a ? G.clock(Date.now() - a.started) : '';
        else if (k === 'clock') n.textContent = G.hhmm(Date.now());
      });
      if (o.tick) o.tick();
    }
    function go(name) { if (!o.screens[name]) return; cur = name; render(false); const sc = scroller(); if (sc) sc.scrollTop = 0; }
    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]'); if (t && el.contains(t) && !t.closest('.k-layer')) { e.preventDefault(); go(t.dataset.tab); return; }
      const d = e.target.closest('[data-do]'); if (d && el.contains(d) && !d.closest('.k-layer')) {
        e.preventDefault(); e.stopPropagation(); const f = (o.actions && o.actions[d.dataset.do]) || ACTIONS[d.dataset.do]; if (f) f(d.dataset.arg, d, e);
      }
    });
    let pending = 0;
    G.on((what) => {
      if (what === 'tick') { live(); return; }
      if (what === 'restDone') toast('Rest time is over.');
      if (el.querySelector('[data-screen]:not([hidden])') && el.querySelector('[data-screen]:not([hidden])').contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
      cancelAnimationFrame(pending); pending = requestAnimationFrame(() => render(true));
    });
    render(false);
    return { go, render, get current() { return cur; } };
  }

  /* ---------- a menu with every flow, for designs that want a "more" screen ---------- */
  const MENU = [
    ['Plans', 'list', plansManager], ['Exercise library', 'book', () => library()], ['Rest timer', 'timer', rest], ['Calendar', 'calendar', calendar], ['History', 'clock', historyList],
    ['Records', 'trophy', records], ['Achievements', 'medal', achievements], ['Body', 'scale', body], ['Food', 'utensils', food], ['Progress photos', 'camera', photos], ['Activities', 'run', activity],
    ['Messages', 'chat', chats], ['Friends', 'users', friends], ['Top 20', 'star', leaderboard], ['New post', 'edit', () => composer()], ['Community profile', 'user', profile], ['Settings', 'settings', settings],
  ];
  function menu(title) {
    return sheet({ title: title || 'Everything', full: true, render: () => MENU.map(([l, ic], i) => '<button type="button" class="k-row" data-k="m" data-i="' + i + '"><span class="k-ic">' + icon(ic) + '</span><span class="k-row-main"><b>' + l + '</b></span>' + icon('chevron') + '</button>').join(''), on: { m: (b) => MENU[+b.dataset.i][2]() } });
  }

  /* ---------- global wiring: any element with data-open="flow" opens that flow ---------- */
  const FLOWS = { plans: plansManager, newplan: () => planEditor(null), editplan: (a) => planEditor(a || G.selected().id), fullbody: fullBody, library: () => library(), equipment, rest, finish: () => finish(), calendar, history: historyList, records, achievements, body, bodyentry: bodyEntry, food, foodentry: foodEntry, photos, activity, chats, chat: (a) => chat(a || 'anna'), friends, leaderboard, post: () => composer(), postview: (a) => postView(a), profile, settings, menu: () => menu(), workout: (a) => workoutView(a), day: (a) => dayView(a), exercise: (a) => exercise(a), replace: (a) => replace(+a), set: (a) => { const [i, j] = String(a).split(':').map(Number); setEditor(i, j); } };
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-open]'); if (!b) return;
    const f = FLOWS[b.dataset.open]; if (f) { e.preventDefault(); f(b.dataset.arg); }
  });

  return { app, ACTIONS, mount, sheet, confirm, toast, icon, avatar, btn, row, sw, seg, sec, empty, line, bars, ring, num, closeAll,
    planEditor, pickFromPlans, fullBody, plansManager, library, exercise, equipment, setEditor, replace, rest, finish, summary,
    workoutView, editWorkout, historyList, dayView, calendar, records, achievements, body, bodyEntry, food, foodEntry, photos, activity,
    wlist, chats, chat, pickFriend, postView, postCard, composer, leaderboard, friends, profile, settings, menu, FLOWS };
})();
