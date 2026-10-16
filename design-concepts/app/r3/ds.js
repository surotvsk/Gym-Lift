/* GymQuest r3 concepts 051–100 — component builders for ds.css. Each returns an HTML string with
   the right data-do / data-open hooks; designs compose them into their own layouts. */
window.DS = (function () {
  'use strict';
  const G = window.GQ2, K = window.Kit, I = K.icon, e = G.esc;
  const ICONS = new Set(['home', 'dumbbell', 'plus', 'minus', 'chart', 'user', 'users', 'heart', 'comment', 'send', 'search', 'bell', 'flame', 'check', 'x', 'clock', 'play', 'stop', 'more', 'chevron', 'back', 'up', 'down', 'trophy', 'droplet', 'utensils', 'calendar', 'settings', 'repeat', 'swap', 'camera', 'chat', 'grid', 'list', 'timer', 'share', 'edit', 'trash', 'book', 'scale', 'run', 'image', 'download', 'upload', 'star', 'medal', 'bolt', 'info', 'target', 'flag', 'sun', 'smile', 'reply', 'pin']);
  const ic = (x) => (ICONS.has(x) ? I(x) : x);
  const btn = (label, attr, v) => '<button class="ds-btn ' + (v || 'primary') + '" ' + attr + '>' + label + '</button>';
  const item = (icon, label, sub, attr, cls, right) => '<button class="ds-item ' + (cls || '') + '" ' + attr + '>' + (icon != null ? '<span class="ds-ic">' + ic(icon) + '</span>' : '') + '<span class="ds-tx">' + label + (sub ? '<small>' + sub + '</small>' : '') + '</span>' + (right != null ? '<span class="ds-r">' + right + '</span>' : I('chevron')) + '</button>';
  const link = (l) => item(l.icon, l.label, l.sub, l.attr);
  const links = (groups) => R3.links(groups, link);
  const h2 = (t, small) => '<h2 class="ds-h2">' + t + (small ? '<small>' + small + '</small>' : '') + '</h2>';
  const stat = (v, l) => '<div class="ds-stat"><b>' + v + '</b><small>' + l + '</small></div>';
  const stats = (arr) => '<div class="ds-stats" style="--n:' + arr.length + '">' + arr.map(([v, l]) => stat(v, l)).join('') + '</div>';
  const prog = (pct) => '<div class="ds-prog" role="progressbar" aria-valuenow="' + Math.round(pct) + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + Math.max(0, Math.min(100, pct)) + '%"></i></div>';
  const week = () => { const w = G.weekInfo(); return '<div class="ds-week">' + w.days.map((d) => '<button class="ds-day' + (d.done ? ' done' : '') + (d.today ? ' today' : '') + '" data-open="day" data-arg="' + d.date + '" aria-label="' + d.d + ' ' + d.n + (d.done ? ', trained' : '') + '">' + d.d.slice(0, 2) + '<b>' + d.n + '</b></button>').join('') + '</div>'; };
  const chips = (x, i, o) => { o = o || {}; const ss = R3.sets(x, i); return '<div class="ds-chips">' + ss.map((q) => '<button class="ds-chip' + (q.done ? ' done' : q.next ? ' next' : '') + (q.half ? ' half' : '') + '" ' + q.attr + ' aria-label="' + e(x.name) + ', set ' + (q.j + 1) + ', ' + q.w + ' × ' + q.r + (q.done ? ', done' : '') + '">' + (q.side ? q.side + ' ' : '') + q.wb + '×' + q.r + (q.fail ? ' F' : '') + '</button>').join('') + (o.full === false ? '' : ss.map((q) => '<button class="ds-chip tool" ' + q.edit + '>Edit ' + (q.j + 1) + '</button>').join('') + R3.tools(i, x, (t) => '<button class="ds-chip tool" ' + t.attr + '>' + t.label + '</button>')) + '</div>'; };
  const plans = (o) => { o = o || {}; const r = G.recommended(), s = G.sess(); return G.plans().map((p, n) => item(o.icon ? o.icon(p, n) : (p === r ? 'star' : 'dumbbell'), e(p.name) + (p === r ? ' · next' : ''), p.exercises.length + ' exercises · ' + G.planMinutes(p) + ' min', 'data-do="select" data-arg="' + p.id + '"', p === G.selected() ? 'on' : '')).join('')
    + (G.selected() && !s ? '<div class="ds-row2">' + btn('Start ' + e(G.selected().name), 'data-do="start" data-arg="' + G.selected().id + '"', 'primary') + btn('Edit plan', 'data-open="editplan" data-arg="' + G.selected().id + '"', 'ghost') + '</div>' : ''); };
  const startCta = (o) => { o = o || {}; const r = G.recommended(), s = G.sess(); return s ? btn((o.resume || 'Continue') + ' · ' + e(s.planName), 'data-tab="' + o.tab + '"', 'primary') : r ? btn((o.start || 'Start') + ' ' + e(r.name), 'data-do="start" data-arg="' + r.id + '"', 'primary') : btn('Create a plan', 'data-open="newplan"', 'primary'); };
  const excuse = (v) => { const w = G.weekInfo(); return btn(w.excused ? 'This week is excused · undo' : 'Excuse this week', 'data-do="excuse"', v || 'ghost'); };
  /* the live workout in one of five layouts */
  function session(o) {
    o = o || {}; const s = G.sess();
    if (!s) return (o.empty || h2('No workout running')) + G.plans().map((p) => item('play', 'Start ' + e(p.name), p.exercises.length + ' exercises', 'data-do="start" data-arg="' + p.id + '"')).join('');
    const p = G.progress(), v = o.variant || 'list';
    const head = (o.head !== false ? stats([['<span data-live="elapsed"></span>', 'time'], [p.done + '/' + p.total, 'sets'], ['<span data-live="rest" data-idle="–" data-done="0:00"></span>', 'rest']]) + prog(p.pct) : '') + btn(o.logLabel || 'Log the next set', 'data-do="log"', 'primary');
    let body = '';
    if (v === 'focus') {
      const i = Math.min(s.cur, s.exercises.length - 1), x = s.exercises[i];
      body = '<div class="ds-card"><div class="ds-sub">Exercise ' + (i + 1) + ' of ' + s.exercises.length + '</div><div class="ds-h1">' + e(x.name) + '</div><div class="ds-sub">' + R3.cmp(s, x) + '</div>' + chips(x, i) + '<div class="ds-row2">' + btn('Previous', 'data-do="prev"', 'ghost') + btn('Next', 'data-do="next"', 'ghost') + '</div></div>'
        + h2('Up next') + s.exercises.map((y, k) => item(R3.exDone(y) ? 'check' : k === i ? 'play' : String(k + 1), e(y.name), y.sets.filter((z) => z.done).length + ' of ' + y.sets.length + ' sets', 'data-do="cur" data-arg="' + k + '"', k === i ? 'on' : R3.exDone(y) ? 'done' : '')).join('');
    } else if (v === 'cards') {
      body = s.exercises.map((x, i) => '<div class="ds-card' + (i === s.cur ? ' cur' : '') + '"><button class="ds-item ' + (i === s.cur ? 'on' : R3.exDone(x) ? 'done' : '') + '" style="background:none;padding:0;min-height:0" data-do="cur" data-arg="' + i + '"><span class="ds-ic">' + (R3.exDone(x) ? I('check') : i + 1) + '</span><span class="ds-tx">' + e(x.name) + '<small>' + R3.cmp(s, x) + '</small></span></button>' + chips(x, i, { full: i === s.cur }) + '</div>').join('');
    } else if (v === 'table') {
      body = s.exercises.map((x, i) => '<div class="ds-plain">' + item(R3.exDone(x) ? 'check' : String(i + 1), e(x.name), R3.cmp(s, x), 'data-do="cur" data-arg="' + i + '"', i === s.cur ? 'on' : R3.exDone(x) ? 'done' : '', x.sets.filter((z) => z.done).length + '/' + x.sets.length) + '</div>' + chips(x, i, { full: i === s.cur })).join('');
    } else if (v === 'timeline') {
      body = '<div class="ds-tl">' + s.exercises.map((x, i) => '<div class="ds-tl-i ' + (R3.exDone(x) ? 'done' : i === s.cur ? 'on' : '') + '">' + item(null, e(x.name), R3.cmp(s, x), 'data-do="cur" data-arg="' + i + '"', i === s.cur ? 'on' : '') + chips(x, i, { full: i === s.cur }) + '</div>').join('') + '</div>';
    } else {
      body = s.exercises.map((x, i) => item(R3.exDone(x) ? 'check' : String(i + 1), e(x.name), R3.cmp(s, x), 'data-do="cur" data-arg="' + i + '"', i === s.cur ? 'on' : R3.exDone(x) ? 'done' : '') + chips(x, i, { full: i === s.cur })).join('');
    }
    return (o.title === false ? '' : '<div class="ds-h1">' + e(s.planName) + '</div>') + head + body
      + btn(o.finishLabel || 'Finish workout · +' + p.xp + ' XP', 'data-do="finish"', 'good') + '<div class="ds-row2">' + btn('Rest timer', 'data-open="rest"', 'quiet') + btn('Discard', 'data-do="discard"', 'ghost') + '</div>';
  }
  const historyList = (n) => G.history().slice(0, n || 6).map((w) => item('clock', e(w.planName), G.fmtDate(w.date) + ' · ' + w.minutes + ' min', 'data-open="workout" data-arg="' + w.id + '"', '', '+' + w.xp + ' XP')).join('');
  const recordList = (n) => G.records().list.slice(0, n || 3).map((r) => item('trophy', e(r.name), 'personal best', 'data-open="records"', '', G.fmtW(r.kg))).join('');
  const feed = () => G.feed().map((p) => '<div class="ds-post" data-open="postview" data-arg="' + p.id + '">' + K.postCard(p) + '</div>').join('');
  const level = () => { const x = G.xp(); return item('medal', 'Level ' + x.level + ' · ' + G.levelTitle(x.level), x.total + ' XP · achievements', 'data-open="achievements"'); };
  const everything = () => item('more', 'Everything', 'Every feature in one list', 'data-open="menu"');
  /* standard tabs for the non-workout screens */
  const logScreen = (title) => '<div class="ds-h1">' + (title || 'Progress') + '</div><div class="ds-sub">' + G.totals().all.workouts + ' workouts so far</div>' + historyList(6) + h2('Records') + recordList(3) + h2('More') + links('log body');
  const socialScreen = (title) => '<div class="ds-h1">' + (title || 'Community') + '</div>' + links('social') + h2('Feed') + feed();
  const moreScreen = (title) => '<div class="ds-h1">' + (title || 'You') + '</div>' + level() + links('set') + everything();
  const nav = (tabs, cls) => '<nav class="ds-nav ' + (cls || '') + '">' + tabs.map(([k, icon, l]) => '<button data-tab="' + k + '">' + (icon ? I(icon) : '') + l + '</button>').join('') + '</nav>';
  /* design boot: screens + nav built from one list */
  function boot(o) {
    const app = document.getElementById('app');
    app.insertAdjacentHTML(o.navFirst ? 'afterbegin' : 'beforeend', nav(o.tabs, o.nav));
    return R3.app({ root: app, train: o.train, screens: o.screens, chrome: o.chrome, tick: o.tick, actions: o.actions });
  }
  return { ic, btn, item, link, links, h2, stat, stats, prog, week, chips, plans, startCta, excuse, session, historyList, recordList, feed, level, everything, logScreen, socialScreen, moreScreen, nav, boot };
})();
