/* GymQuest r3 concepts — small helpers on top of the r2 engine (../r2/core.js + ../r2/kit.js).
   Every r3 design draws its own screens; these helpers only hand out the pieces every design needs:
   the list of feature entry points, the live workout's sets with the right data-do / data-arg
   (one side at a time included), the per-exercise tools and the app wiring. Data is the same
   sample account as round 2 (localStorage key gymquest-concepts-r2), so a workout logged in any
   of the 160 working designs shows up in all of them. */
window.R3 = (function () {
  'use strict';
  const G = window.GQ2, K = window.Kit, e = G.esc;

  /* [data-open, icon, label, short description, group] */
  const ALL = [
    ['plans', 'list', 'Plans', 'Order, edit, delete', 'train'],
    ['newplan', 'plus', 'New plan', 'Start from empty', 'train'],
    ['fullbody', 'grid', 'Full Body builder', 'Pick muscles, get a plan', 'train'],
    ['library', 'book', 'Exercise library', '48 exercises with videos', 'train'],
    ['rest', 'timer', 'Rest timer', 'Presets and your own time', 'train'],
    ['history', 'clock', 'History', 'Edit, delete, undo', 'log'],
    ['calendar', 'calendar', 'Calendar', 'Every day you trained', 'log'],
    ['records', 'trophy', 'Records', 'Best lifts and milestones', 'log'],
    ['achievements', 'medal', 'Achievements', 'XP, levels, badges', 'log'],
    ['body', 'scale', 'Body', 'Weight and measurements', 'body'],
    ['food', 'utensils', 'Food', 'Calories and meals', 'body'],
    ['photos', 'camera', 'Progress photos', 'Before and after', 'body'],
    ['activity', 'run', 'Run, walk, ride', 'Cardio outside the gym', 'body'],
    ['leaderboard', 'star', 'Top 20', 'This week’s most active', 'social'],
    ['chats', 'chat', 'Messages', 'Chats with friends', 'social'],
    ['friends', 'users', 'Friends', 'Requests and search', 'social'],
    ['post', 'edit', 'New post', 'Share a workout or a thought', 'social'],
    ['profile', 'user', 'Profile and reminders', 'What friends see', 'social'],
    ['settings', 'settings', 'Settings', 'Goal, units, sound, backup', 'set'],
  ];
  const pick = (groups) => { const g = groups.split(' '); return ALL.filter((x) => g.includes(x[4])); };
  /* links('train log', (l) => '<button ' + l.attr + '>' + l.label + '</button>') */
  const links = (groups, fmt) => pick(groups).map((x, n) => fmt({ open: x[0], icon: x[1], label: x[2], sub: x[3], group: x[4], n, attr: 'data-open="' + x[0] + '"' })).join('');

  /* sets of exercise i in the live session: done, next, side for one-side-at-a-time, ready attributes */
  function sets(x, i) {
    const nj = x.sets.findIndex((s) => !s.done);
    return x.sets.map((st, j) => {
      const side = x.unilateral && !st.done ? (st.L ? 'R' : 'L') : '';
      return { j, st, done: st.done, next: j === nj, side, half: x.unilateral && (st.L || st.R) && !st.done,
        w: G.fmtW(st.w), wb: G.fmtW(st.w, true), r: st.r, fail: st.planFail || st.fail,
        attr: 'data-do="set" data-arg="' + i + ':' + j + (side ? ':' + side : '') + '"',
        edit: 'data-open="set" data-arg="' + i + ':' + j + '"',
        label: side ? (side === 'L' ? 'Left' : 'Right') : st.done ? 'Done' : 'Log' };
    });
  }
  const exDone = (x) => x.sets.every((s) => s.done);
  const cmp = (s, x) => (x.replaces ? 'Replaces ' + e(x.replaces) : G.compare(s.planId, x.id, Math.max(...x.sets.map((y) => y.w)), x.reps).text);
  /* per-exercise tools: add a set, replace, exercise details, start a rest */
  const tools = (i, x, fmt) => [['addset', 'plus', 'Add set', 'data-do="addset" data-arg="' + i + '"'], ['replace', 'swap', 'Replace', 'data-open="replace" data-arg="' + i + '"'], ['exercise', 'info', 'How to', 'data-open="exercise" data-arg="' + x.id + '"'], ['rest', 'timer', 'Rest 90 s', 'data-do="rest" data-arg="90"']]
    .map(([k, ic, l, attr]) => fmt({ k, icon: ic, label: l, attr })).join('');
  /* the next plans in the rotation after the recommended one */
  function upcoming(n) { const p = G.plans(), r = G.recommended(); if (!p.length) return []; const i = Math.max(0, p.indexOf(r)); return Array.from({ length: Math.min(n || p.length, p.length) }, (_, k) => p[(i + k) % p.length]); }
  const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
  const pad = (n, l) => String(n).padStart(l || 2, '0');

  /* K.app with a "go to the workout screen after start" default */
  function app(o) {
    const actions = Object.assign({}, o.actions || {});
    let a = null;
    if (o.train && !actions.start) actions.start = (arg) => { G.start(arg); if (a) a.go(o.train); };
    a = K.app(Object.assign({}, o, { actions }));
    return a;
  }
  return { ALL, pick, links, sets, exDone, cmp, tools, upcoming, pct, pad, app };
})();
