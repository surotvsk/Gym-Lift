/* GymQuest r2 design concepts — shared working engine.
   Every r2 concept is a different face on this one engine, so every design really works:
   plans and rotation, a live workout with per-set weights, failure sets, one side at a time,
   replace an exercise, workout duration, rest timer with editable presets and a gong, history
   with edit / delete, records with 5 kg milestones, XP, levels, achievements, weekly goal,
   streaks and excused weeks, calendar, body measurements, food log, calorie estimate, progress
   photos, activities, exercise library with equipment filter, Community (feed, comments, chat
   with replies, reactions and sharing, friends, Top 20, reminders), export / import / reset.
   State lives in localStorage under its own key (never the real app's key) and is shared by all
   r2 concepts, so a workout logged in one design shows up in every other one. */
window.GQ2 = (function () {
  'use strict';
  const KEY = 'gymquest-concepts-r2';
  const LIB = window.GQ_LIB || [];
  const LIBMAP = Object.fromEntries(LIB.map((e) => [e.id, e]));
  const XP_BASE = 20, XP_SET = 2, XP_LEVEL = 100;
  const DAY = 86400000;

  /* ---------- dates ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => ymd(new Date());
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  function weekKey(s) {
    const d = typeof s === 'string' ? parse(s) : new Date(s.getFullYear(), s.getMonth(), s.getDate());
    const dn = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dn + 3);
    const ft = new Date(d.getFullYear(), 0, 4); const fdn = (ft.getDay() + 6) % 7; ft.setDate(ft.getDate() - fdn + 3);
    return d.getFullYear() + '-W' + pad(1 + Math.round((d - ft) / (7 * DAY)));
  }
  const monday = (s) => { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const WDL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const wdi = (s) => (parse(s).getDay() + 6) % 7;
  const fmtDate = (s, long) => { const d = parse(s); return long ? WDL[wdi(s)] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() : WD[wdi(s)] + ', ' + MON[d.getMonth()] + ' ' + d.getDate(); };
  const fmtShort = (s) => { const d = parse(s); return MON[d.getMonth()] + ' ' + d.getDate(); };
  function ago(s) {
    const n = Math.round((parse(today()) - parse(s)) / DAY);
    return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 7 ? n + ' days ago' : n < 14 ? 'last week' : Math.round(n / 7) + ' weeks ago';
  }
  const clock = (ms) => { ms = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(ms / 3600), m = Math.floor(ms / 60) % 60, s = ms % 60; return (h ? h + ':' + pad(m) : m) + ':' + pad(s); };
  const hhmm = (ts) => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };

  /* ---------- small helpers ---------- */
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let uidN = Date.now() % 100000;
  const uid = (p) => (p || 'x') + (++uidN).toString(36) + Math.random().toString(36).slice(2, 6);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const round = (n, s) => Math.round(n / s) * s;

  /* ---------- seed data ---------- */
  const PEOPLE = {
    anna: { name: 'Anna', handle: 'anna_lifts', color: '#C46A4A', level: 14 },
    tomas: { name: 'Tomáš', handle: 'tomas.k', color: '#4A7C6F', level: 16 },
    lucia: { name: 'Lucia', handle: 'lucia.runs', color: '#7A5C99', level: 11 },
    peter: { name: 'Peter', handle: 'peto_gym', color: '#B08A3E', level: 18 },
    eva: { name: 'Eva', handle: 'evafit', color: '#4E6E9E', level: 9 },
    jakub: { name: 'Jakub', handle: 'kubo.strong', color: '#8E4F6B', level: 7 },
    mira: { name: 'Mira', handle: 'mira.moves', color: '#5D8A4A', level: 12 },
    samuel: { name: 'Samuel', handle: 'samo_squats', color: '#9C6B3C', level: 21 },
    nina: { name: 'Nina', handle: 'nina.pr', color: '#3F7F8F', level: 15 },
    oliver: { name: 'Oliver', handle: 'oli.lifts', color: '#7B6C4A', level: 10 },
  };
  const BOARD = [['samuel', 1380], ['peter', 1240], ['tomas', 1105], ['nina', 990], ['anna', 905], ['mira', 820], ['oliver', 700],
    ['eva', 640], ['lucia', 515], ['jakub', 430], ['dano', 410], ['katka', 395], ['filip', 360], ['zuzka', 340], ['marek', 300],
    ['lenka', 280], ['adam', 250], ['ivana', 210], ['rado', 180], ['simona', 150], ['boris', 120]];
  const EXTRA = { dano: 'Dano', katka: 'Katka', filip: 'Filip', zuzka: 'Zuzka', marek: 'Marek', lenka: 'Lenka', adam: 'Adam', ivana: 'Ivana', rado: 'Rado', simona: 'Simona', boris: 'Boris' };
  Object.keys(EXTRA).forEach((k, i) => { PEOPLE[k] = { name: EXTRA[k], handle: k + '.fit', color: ['#6A7FA0', '#A0706A', '#6AA07F', '#8E8A55', '#7D6AA0'][i % 5], level: 4 + (i % 7) }; });

  const ex = (id, sets, reps, weight, extra) => Object.assign({ uid: uid('e'), id, name: (LIBMAP[id] || {}).name || id, sets, reps, weight, failSets: [], unilateral: false }, extra || {});
  function seedPlans() {
    return [
      { id: 'push', name: 'Push', builtin: true, location: 'gym', exercises: [ex('bench-press', 4, 8, 60), ex('overhead-press', 3, 10, 35), ex('incline-dumbbell-press', 3, 10, 22), ex('lateral-raises', 3, 12, 8, { failSets: [3] }), ex('dips', 3, 10, 0)] },
      { id: 'pull', name: 'Pull', builtin: true, location: 'gym', exercises: [ex('pull-ups', 4, 8, 0), ex('bent-over-rows', 3, 10, 55), ex('cable-rows', 3, 10, 45), ex('dumbbell-row', 3, 10, 24, { unilateral: true }), ex('bicep-curls', 3, 12, 12)] },
      { id: 'legs', name: 'Legs', builtin: true, location: 'gym', exercises: [ex('squats', 4, 5, 95), ex('romanian-deadlift', 3, 8, 70), ex('leg-press', 3, 12, 140), ex('lunges', 3, 10, 14, { unilateral: true }), ex('leg-curls', 3, 12, 35), ex('calf-raises', 4, 15, 50)] },
      { id: 'home-starter', name: 'Home starter', builtin: true, location: 'home', exercises: [ex('bodyweight-squat', 3, 12, 0), ex('push-up', 3, 10, 0), ex('split-squat', 3, 10, 0, { unilateral: true }), ex('glute-bridge', 3, 12, 0), ex('plank', 3, 1, 0), ex('dead-bug', 3, 10, 0)] },
      { id: 'outdoor-starter', name: 'Outdoor starter', builtin: true, location: 'outdoor', exercises: [ex('push-up', 3, 10, 0), ex('bodyweight-squat', 3, 15, 0), ex('split-squat', 3, 10, 0, { unilateral: true }), ex('plank', 3, 1, 0), ex('superman', 3, 12, 0), ex('burpee', 3, 8, 0)] },
    ];
  }
  function seedHistory(plans) {
    const h = [];
    const t = today();
    const mon = monday(t);
    // 9 finished weeks + the current one, three workouts a week (Mon / Wed / Fri), progressive loads
    const rot = ['pull', 'legs', 'push'];
    let r = 0;
    for (let w = 9; w >= 0; w--) {
      const wm = addDays(mon, -7 * w);
      const days = w === 5 ? [0, 3] : [0, 2, 4];
      for (const dd of days) {
        const date = addDays(wm, dd);
        if (date >= t) continue;
        const plan = plans.find((p) => p.id === rot[r % 3]); r++;
        const exs = plan.exercises.map((e) => {
          const base = e.weight ? round(e.weight * (0.82 + 0.02 * (9 - w)), e.weight >= 20 ? 2.5 : 1) : 0;
          const sets = e.sets;
          const done = (w === 6 && dd === 4) ? sets - 1 : sets;
          const weights = Array.from({ length: done }, (_, i) => (i >= sets - 2 && base ? base + 2.5 * (w % 2) : base));
          return { id: e.id, name: e.name, sets, reps: e.reps, weights, setsDone: done, failDone: e.failSets.length && done === sets ? e.failSets.slice() : [], unilateral: e.unilateral };
        });
        const doneSets = exs.reduce((s, e) => s + e.setsDone, 0);
        h.push({ id: uid('w'), date, planId: plan.id, planName: plan.name, minutes: 44 + ((w * 7 + dd * 3) % 19), xp: XP_BASE + doneSets * XP_SET,
          note: w === 1 && dd === 2 ? 'Felt strong. Sleep helps.' : w === 4 && dd === 0 ? 'Short on time, kept rest at 90 s.' : '', exercises: exs });
      }
    }
    return h;
  }
  function seedBody() {
    const t = today(); const out = [];
    const bw = [83.1, 82.8, 82.6, 82.2, 82.3, 81.9, 81.6, 81.4, 81.0, 80.8];
    bw.forEach((v, i) => out.push({ id: uid('b'), date: addDays(monday(t), -7 * (9 - i) + 1), weight: v, waist: +(88.5 - i * 0.35).toFixed(1), chest: i % 3 === 0 ? +(101 + i * 0.2).toFixed(1) : null, arm: i % 3 === 0 ? +(36 + i * 0.1).toFixed(1) : null, thigh: null, hips: null, note: i === 9 ? 'Morning, before breakfast' : '' }));
    return out.filter((b) => b.date <= t);
  }
  function seedCommunity() {
    const t = today(); const now = Date.now();
    return {
      on: true, showOnBoard: true, showTopAch: true, notifications: false,
      friends: ['anna', 'tomas', 'lucia', 'peter', 'eva'],
      requests: ['jakub'],
      posts: [
        { id: uid('p'), who: 'tomas', ts: now - 18 * 60e3, kind: 'pr', text: 'Finally pulled 140. Took me a year, worth every session.', pr: { lift: 'Deadlift', kg: 140, prev: 135 }, img: null, likes: 42, liked: false, comments: [{ who: 'anna', text: 'Monster 💪' }, { who: 'peter', text: 'Next stop 150' }] },
        { id: uid('p'), who: 'anna', ts: now - 62 * 60e3, kind: 'workout', text: 'Leg day done. My legs are not speaking to me.', workout: { plan: 'Leg day', minutes: 64, sets: 20, lines: ['Squat 70 kg × 5 × 5', 'Romanian deadlift 60 kg × 8 × 3', 'Leg press 120 kg × 10 × 3'] }, img: 'squats', likes: 27, liked: true, comments: [{ who: 'eva', text: 'Respect.' }] },
        { id: uid('p'), who: 'lucia', ts: now - 3 * 3600e3, kind: 'plan', text: 'Sharing my home plan. No equipment, 25 minutes. Save it if you want it.', plan: { name: 'Lucia’s home 25', exercises: [['push-up', 3, 12], ['lunges', 3, 10], ['glute-bridge', 3, 15], ['plank', 3, 1]] }, img: 'push-up', likes: 61, liked: false, comments: [] },
        { id: uid('p'), who: 'peter', ts: now - 5 * 3600e3, kind: 'workout', text: 'Morning bench before work. 4 × 8 at 80.', workout: { plan: 'Chest + triceps', minutes: 41, sets: 14, lines: ['Bench press 80 kg × 8 × 4', 'Dips BW × 12 × 3'] }, img: 'bench-press', likes: 18, liked: false, comments: [] },
        { id: uid('p'), who: 'eva', ts: now - 26 * 3600e3, kind: 'photo', text: 'Week 6 of the program. Shoulders finally feel stable.', img: 'overhead-press', likes: 33, liked: false, comments: [{ who: 'lucia', text: 'Form looks great' }] },
      ],
      chats: {
        anna: [
          { id: uid('m'), from: 'anna', text: 'Are you training today?', ts: now - 95 * 60e3 },
          { id: uid('m'), from: 'me', text: 'Push day at 6. Want to join?', ts: now - 92 * 60e3 },
          { id: uid('m'), from: 'anna', text: 'Can’t, legs are dead from yesterday 😅', ts: now - 91 * 60e3, react: { me: '😂' } },
          { id: uid('m'), from: 'me', kind: 'plan', share: { type: 'plan', name: 'Push', lines: ['Bench press 4 × 8 · 60 kg', 'Overhead press 3 × 10 · 35 kg', '+3 more'] }, ts: now - 90 * 60e3 },
          { id: uid('m'), from: 'anna', text: 'Saving this for Friday', ts: now - 88 * 60e3, replyTo: 'Push', react: { anna: '❤️' } },
        ],
        tomas: [
          { id: uid('m'), from: 'tomas', text: 'Saw your squat yesterday, nice depth', ts: now - 26 * 3600e3 },
          { id: uid('m'), from: 'me', text: 'Thanks! 100 is close', ts: now - 25 * 3600e3 },
        ],
        peter: [{ id: uid('m'), from: 'peter', text: 'Gym tomorrow 7am?', ts: now - 50 * 3600e3 }],
      },
      unread: { tomas: 0, anna: 1, peter: 0 },
      reminders: [
        { kind: 'water', label: 'Water', detail: 'every 2 h · 08:00–21:00', on: true },
        { kind: 'meal', label: 'Meals', detail: '08:00 · 12:30 · 18:30', on: true },
        { kind: 'workout', label: 'Workout', detail: 'Mon, Wed, Fri · 17:00', on: true },
      ],
    };
  }
  function seed() {
    const plans = seedPlans();
    const t = today();
    return {
      v: 1,
      profile: { name: 'Martin', handle: 'martin.lifts', bio: 'Push / pull / legs. Trying to bench 80 by spring.', color: '#2F3B33' },
      settings: { weeklyGoal: 3, units: 'kg', bodyUnits: 'cm', sound: false, soundLength: 'standard', lang: 'en', equipment: [], showCalories: false, autoBackup: true, sync: true },
      plans, selectedPlanId: null,
      history: seedHistory(plans),
      excused: [],
      session: null,
      rest: null, restDoneId: null,
      restPresets: [{ id: 'r60', label: 'Short', sec: 60 }, { id: 'r90', label: 'Standard', sec: 90 }, { id: 'r120', label: 'Heavy', sec: 120 }],
      lastCustomRest: 150,
      body: seedBody(),
      calorie: { sex: 'male', age: 21, height: 181, activity: 1.55 },
      foods: [{ id: 'f1', name: 'Oats with milk', kcal: 380, p: 15, c: 58, f: 9 }, { id: 'f2', name: 'Chicken and rice', kcal: 620, p: 48, c: 72, f: 12 }, { id: 'f3', name: 'Greek yogurt', kcal: 150, p: 15, c: 6, f: 7 }],
      foodLog: [{ id: uid('fl'), date: t, name: 'Oats with milk', kcal: 380, p: 15, c: 58, f: 9, meal: 'Breakfast' }, { id: uid('fl'), date: t, name: 'Chicken and rice', kcal: 620, p: 48, c: 72, f: 12, meal: 'Lunch' }],
      photos: [],
      activities: [{ id: uid('a'), date: addDays(t, -3), kind: 'run', minutes: 28, km: 4.6 }, { id: uid('a'), date: addDays(t, -9), kind: 'walk', minutes: 45, km: 3.9 }],
      liveActivity: null,
      community: seedCommunity(),
      lastBackup: addDays(t, -6),
      demo: true,
    };
  }

  /* ---------- load / save ---------- */
  let S;
  try { S = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { S = null; }
  if (!S || S.v !== 1) S = seed();
  const subs = [];
  let saveT = 0;
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* plný úložný priestor: pokračujeme v pamäti */ } }
  function changed(what) { clearTimeout(saveT); saveT = setTimeout(save, 60); subs.forEach((f) => { try { f(what || 'change'); } catch (e) { console.error(e); } }); }
  function on(fn) { subs.push(fn); return () => subs.splice(subs.indexOf(fn), 1); }
  window.addEventListener('storage', (e) => { if (e.key === KEY && e.newValue) { try { S = JSON.parse(e.newValue); changed('external'); } catch (er) { /* ignore */ } } });

  /* ---------- units ---------- */
  const LB = 2.20462;
  const unit = () => S.settings.units;
  const toU = (kg) => (unit() === 'lb' ? Math.round(kg * LB) : +(+kg).toFixed(2));
  const fromU = (v) => (unit() === 'lb' ? +(v / LB).toFixed(2) : +v);
  const step = () => (unit() === 'lb' ? 5 / LB : 2.5);
  function fmtW(kg, bare) {
    if (!kg) return 'BW';
    const v = toU(kg); const s = (Math.round(v * 10) / 10).toString();
    return bare ? s : s + ' ' + unit();
  }

  /* ---------- library ---------- */
  const MUSCLES = ['chest', 'back', 'shoulders', 'arms', 'legs', 'glutes', 'core'];
  const MUSCLE_LABEL = { chest: 'Chest', back: 'Back', shoulders: 'Shoulders', arms: 'Arms', legs: 'Legs', glutes: 'Glutes', core: 'Core', fullBody: 'Full body' };
  const EQUIP = ['none', 'bands', 'dumbbells', 'pullupBar', 'bench', 'barbell', 'cableMachine'];
  const EQUIP_LABEL = { none: 'No equipment', bands: 'Resistance bands', dumbbells: 'Dumbbells', pullupBar: 'Pull-up bar', bench: 'Adjustable bench', barbell: 'Barbell', cableMachine: 'Machine' };
  const LOC_LABEL = { gym: 'Gym', home: 'Home', outdoor: 'Outdoors' };
  const MEDIA = '../../media/';
  const img = (id) => { const e = LIBMAP[id]; return e && e.poster ? MEDIA + e.poster : null; };
  const video = (id) => { const e = LIBMAP[id]; return e && e.video ? { mp4: MEDIA + e.video + '.mp4', webm: MEDIA + e.video + '.webm', poster: img(id) } : null; };
  const anyImg = (id) => img(id) || MEDIA + 'bench-press-poster.jpg';
  function libFilter(o) {
    o = o || {};
    const q = (o.q || '').trim().toLowerCase();
    const eq = S.settings.equipment;
    return LIB.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q) && !e.id.includes(q)) return false;
      if (o.muscle && o.muscle !== 'fullBody' && e.primary !== o.muscle) return false;
      if (o.muscle === 'fullBody' && !['squats', 'push-up', 'pull-ups', 'romanian-deadlift', 'overhead-press', 'plank', 'burpee', 'lunges', 'dumbbell-row', 'bodyweight-squat'].includes(e.id)) return false;
      if (o.loc && !e.locations.includes(o.loc)) return false;
      if (o.difficulty && e.difficulty !== o.difficulty) return false;
      if (o.useEquipment !== false && eq.length) {
        if (eq.includes('none')) { if (e.equipment.length) return false; }
        else if (!e.equipment.every((x) => eq.includes(x))) return false;
      }
      return true;
    });
  }
  function toggleEquipment(code) {
    let eq = S.settings.equipment.slice();
    if (code === 'homeGym') eq = ['bands', 'dumbbells', 'pullupBar', 'bench', 'barbell'];
    else if (code === 'none') eq = eq.includes('none') ? [] : ['none'];
    else { eq = eq.filter((x) => x !== 'none'); eq = eq.includes(code) ? eq.filter((x) => x !== code) : eq.concat(code); }
    S.settings.equipment = eq; changed('settings');
  }
  const alternatives = (id) => ((LIBMAP[id] || {}).alts || []).map((a) => LIBMAP[a]).filter(Boolean);

  /* ---------- plans ---------- */
  const plans = () => S.plans;
  const plan = (id) => S.plans.find((p) => p.id === id);
  function recommended() {
    if (!S.plans.length) return null;
    const last = sortedHistory().slice(-1)[0];
    if (!last) return S.plans[0];
    const i = S.plans.findIndex((p) => p.id === last.planId);
    return S.plans[(i + 1) % S.plans.length] || S.plans[0];
  }
  function selected() { return plan(S.selectedPlanId) || recommended(); }
  function selectPlan(id) { S.selectedPlanId = id; changed('plans'); }
  function savePlan(p) {
    p.exercises.forEach((e) => { if (!e.uid) e.uid = uid('e'); e.failSets = (e.failSets || []).filter((n) => n >= 1 && n <= e.sets); });
    const i = S.plans.findIndex((x) => x.id === p.id);
    if (i >= 0) S.plans[i] = p; else S.plans.push(p);
    changed('plans'); return p;
  }
  function newPlan(name, exercises) { return savePlan({ id: uid('plan'), name: name || 'New plan', builtin: false, location: 'gym', exercises: exercises || [] }); }
  function deletePlan(id) { S.plans = S.plans.filter((p) => p.id !== id); if (S.selectedPlanId === id) S.selectedPlanId = null; changed('plans'); }
  function movePlan(id, dir) {
    const i = S.plans.findIndex((p) => p.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= S.plans.length) return;
    const a = S.plans; [a[i], a[j]] = [a[j], a[i]]; changed('plans');
  }
  function movePlanTo(id, index) { const i = S.plans.findIndex((p) => p.id === id); if (i < 0) return; const [p] = S.plans.splice(i, 1); S.plans.splice(Math.max(0, Math.min(index, S.plans.length)), 0, p); changed('plans'); }
  const newExercise = (id, name) => ex(id || uid('custom'), 3, 10, LIBMAP[id] && LIBMAP[id].equipment.length ? 20 : 0, { name: name || (LIBMAP[id] || {}).name || 'Exercise', custom: !LIBMAP[id] });
  function planMinutes(p) { return Math.round(p.exercises.reduce((s, e) => s + e.sets * (e.unilateral ? 2.6 : 1.8), 4)); }

  /* ---------- history ---------- */
  const sortedHistory = () => S.history.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const history = () => sortedHistory().reverse();
  const workout = (id) => S.history.find((w) => w.id === id);
  const maxW = (e) => (e.weights && e.weights.length ? Math.max(...e.weights) : e.weight || 0);
  function deleteWorkout(id) { const w = workout(id); S.history = S.history.filter((x) => x.id !== id); S._undo = w; changed('history'); return w; }
  function undoDelete() { if (S._undo) { S.history.push(S._undo); S._undo = null; changed('history'); } }
  function updateWorkout(id, patch) {
    const w = workout(id); if (!w) return;
    Object.assign(w, patch);
    w.exercises.forEach((e) => { if (e._w != null) { e.weights = Array(e.setsDone).fill(+e._w); delete e._w; } e.weights = (e.weights || []).slice(0, e.setsDone); while (e.weights.length < e.setsDone) e.weights.push(e.weights[e.weights.length - 1] || 0); });
    w.xp = XP_BASE + w.exercises.reduce((s, e) => s + e.setsDone, 0) * XP_SET;
    changed('history');
  }
  function lastTime(planId, exId) {
    const h = history();
    for (const w of h) { if (w.planId !== planId) continue; const e = w.exercises.find((x) => x.id === exId); if (e && e.setsDone) return { weight: maxW(e), reps: e.reps, sets: e.setsDone, date: w.date }; }
    return null;
  }
  function compare(planId, exId, weightKg, reps) {
    const l = lastTime(planId, exId);
    if (!l) return { kind: 'first', text: 'First time' };
    if (weightKg > l.weight) return { kind: 'up', text: '+' + fmtW(weightKg - l.weight) + ' vs last time', last: l };
    if (weightKg < l.weight) return { kind: 'down', text: '−' + fmtW(l.weight - weightKg) + ' vs last time', last: l };
    if (reps > l.reps) return { kind: 'up', text: '+' + (reps - l.reps) + ' reps vs last time', last: l };
    if (reps < l.reps) return { kind: 'down', text: '−' + (l.reps - reps) + ' reps vs last time', last: l };
    return { kind: 'same', text: 'Same as last time', last: l };
  }

  /* ---------- records ---------- */
  function records() {
    const best = {}; const events = [];
    for (const w of sortedHistory()) for (const e of w.exercises) {
      const m = maxW(e); if (!m || !e.setsDone) continue;
      const b = best[e.id];
      if (!b || m > b.kg) { if (b) events.push({ id: e.id, name: e.name, kg: m, prev: b.kg, date: w.date }); best[e.id] = { id: e.id, name: e.name, kg: m, date: w.date, prev: b ? b.kg : null, reps: e.reps }; }
    }
    return { list: Object.values(best).sort((a, b) => b.kg - a.kg), events };
  }
  function milestones() {
    const out = []; const best = {};
    for (const w of sortedHistory()) for (const e of w.exercises) {
      const m = maxW(e); if (!m) continue;
      const prev = best[e.id] || 0;
      if (m > prev) { const st = Math.floor(m / 5) * 5; if (st > 0 && !out.some((o) => o.id === 'ms-' + e.id + '-' + st)) out.push({ id: 'ms-' + e.id + '-' + st, name: e.name + ' ' + st + ' kg', exId: e.id, kg: st, date: w.date, xp: 0 }); best[e.id] = m; }
    }
    return out;
  }

  /* ---------- weeks, goal, streak ---------- */
  const goal = () => S.settings.weeklyGoal;
  const countWeek = (wk) => S.history.filter((w) => weekKey(w.date) === wk).length;
  const isExcused = (wk) => S.excused.includes(wk);
  function streak() {
    let wk = weekKey(today()), d = today(), n = 0, first = true;
    for (let g = 0; g < 520; g++) {
      if (countWeek(wk) >= goal()) n++;
      else if (isExcused(wk) || first) { /* keep */ } else break;
      first = false; d = addDays(d, -7); wk = weekKey(d);
    }
    return n;
  }
  function bestStreak() {
    if (!S.history.length) return 0;
    let d = sortedHistory()[0].date, best = 0, cur = 0;
    while (d <= today()) { const wk = weekKey(d); if (countWeek(wk) >= goal()) best = Math.max(best, ++cur); else if (!isExcused(wk) && wk !== weekKey(today())) cur = 0; d = addDays(d, 7); }
    return best;
  }
  function weekInfo() {
    const t = today(); const mon = monday(t); const wk = weekKey(t);
    const days = Array.from({ length: 7 }, (_, i) => { const date = addDays(mon, i); const ws = S.history.filter((w) => w.date === date); return { date, d: WD[i], n: parse(date).getDate(), done: ws.length, plans: ws.map((w) => w.planName), today: date === t, future: date > t }; });
    const done = countWeek(wk);
    return { key: wk, num: +wk.split('W')[1], done, goal: goal(), left: Math.max(0, goal() - done), met: done >= goal(), excused: isExcused(wk), days, minutes: S.history.filter((w) => weekKey(w.date) === wk).reduce((s, w) => s + (w.minutes || 0), 0) };
  }
  function toggleExcused(wk) { wk = wk || weekKey(today()); S.excused = isExcused(wk) ? S.excused.filter((x) => x !== wk) : S.excused.concat(wk); changed('week'); }
  function setGoal(n) { S.settings.weeklyGoal = Math.max(1, Math.min(7, +n || 3)); changed('settings'); }

  /* ---------- XP, level, achievements ---------- */
  const workoutXP = () => S.history.reduce((s, w) => s + (w.xp || 0), 0);
  const activityXP = () => S.activities.reduce((s, a) => s + 10 + Math.floor(a.minutes / 5), 0);
  function achievements() {
    const n = S.history.length; const st = streak(); const rec = records();
    const plansInHistory = new Set(S.history.map((w) => w.planId)).size;
    const custom = S.plans.filter((p) => !p.builtin).length;
    const wk3 = (() => { const c = {}; S.history.forEach((w) => { const k = weekKey(w.date); c[k] = (c[k] || 0) + 1; }); return Object.values(c); })();
    const goalWeeks = wk3.filter((x) => x >= goal()).length;
    const sh = sortedHistory();
    const dateOf = (k) => (sh[k - 1] || {}).date || null;
    const defs = [
      ['first', '🎯', 'First workout', 'Finish your first workout', 'milestones', 25, n, 1, dateOf(1)],
      ['five', '💪', 'Five workouts', 'Finish 5 workouts', 'milestones', 50, n, 5, dateOf(5)],
      ['ten', '🏅', 'Ten workouts', 'Finish 10 workouts', 'milestones', 100, n, 10, dateOf(10)],
      ['twentyfive', '🚀', 'Twenty-five', 'Finish 25 workouts', 'milestones', 200, n, 25, dateOf(25)],
      ['fifty', '💎', 'Fifty workouts', 'Finish 50 workouts', 'milestones', 350, n, 50, dateOf(50)],
      ['hundred', '👑', 'One hundred', 'Finish 100 workouts', 'milestones', 750, n, 100, dateOf(100)],
      ['weeklygoal1', '🎯', 'Goal reached', 'Reach your weekly goal once', 'consistency', 75, goalWeeks, 1, null],
      ['consistent2', '📅', 'Two weeks strong', 'Weekly goal 2 weeks in a row', 'consistency', 125, st, 2, null],
      ['consistent4', '🔥', 'Four weeks strong', 'Weekly goal 4 weeks in a row', 'consistency', 300, st, 4, null],
      ['consistent8', '⚡', 'Eight weeks strong', 'Weekly goal 8 weeks in a row', 'consistency', 500, st, 8, null],
      ['consistent12', '🏆', 'Twelve weeks strong', 'Weekly goal 12 weeks in a row', 'consistency', 750, st, 12, null],
      ['solid4', '📈', 'Solid month', '3+ workouts in 4 different weeks', 'consistency', 300, wk3.filter((x) => x >= 3).length, 4, null],
      ['fullweek', '🗓️', 'Full week', '5 workouts in one week', 'consistency', 200, Math.max(0, ...wk3), 5, null],
      ['newpr', '💪', 'New record', 'Beat a personal best', 'records', 75, rec.events.length, 1, (rec.events[0] || {}).date],
      ['pr5', '🥇', 'Five records', 'Set 5 personal records', 'records', 150, rec.events.length, 5, (rec.events[4] || {}).date],
      ['pr10', '🎖️', 'Ten records', 'Set 10 personal records', 'records', 300, rec.events.length, 10, (rec.events[9] || {}).date],
      ['customplan', '🧩', 'Your own plan', 'Create a plan of your own', 'customization', 50, custom, 1, null],
      ['fourplans', '🏗️', 'Four plans', 'Have 4 or more plans', 'customization', 100, S.plans.length, 4, null],
      ['variety4', '🔀', 'Variety', 'Train 4 different plans', 'customization', 150, plansInHistory, 4, null],
      ['active', '🏃', 'On the move', 'Log an activity', 'dedication', 50, S.activities.length, 1, null],
    ];
    const list = defs.map(([id, icon, name, desc, cat, xp, have, need, date]) => ({ id, icon, name, desc, category: cat, xp, got: have >= need, progress: Math.min(100, Math.round((have / need) * 100)), have: Math.min(have, need), need, date: have >= need ? (date || null) : null }));
    const ms = milestones().map((m) => ({ id: m.id, icon: '🏋️', name: m.name, desc: '5 kg milestone', category: 'milestone', xp: 0, got: true, progress: 100, date: m.date }));
    return list.concat(ms);
  }
  function xp() {
    const a = achievements().filter((x) => x.got).reduce((s, x) => s + x.xp, 0);
    const total = workoutXP() + activityXP() + a;
    return { total, level: Math.floor(total / XP_LEVEL) + 1, into: total % XP_LEVEL, need: XP_LEVEL, pct: (total % XP_LEVEL) / XP_LEVEL * 100, weekXP: S.history.filter((w) => weekKey(w.date) === weekKey(today())).reduce((s, w) => s + w.xp, 0) };
  }
  const LEVEL_TITLES = ['Rookie', 'Regular', 'Committed', 'Strong', 'Iron', 'Steel', 'Titan', 'Legend'];
  const levelTitle = (lv) => LEVEL_TITLES[Math.min(LEVEL_TITLES.length - 1, Math.floor(lv / 10))];

  /* ---------- totals and stats ---------- */
  function totals() {
    const t = today(); const wk = weekKey(t); const mo = t.slice(0, 7);
    const sum = (arr) => ({ workouts: arr.length, minutes: arr.reduce((s, w) => s + (w.minutes || 0), 0), sets: arr.reduce((s, w) => s + w.exercises.reduce((a, e) => a + e.setsDone, 0), 0), volume: Math.round(arr.reduce((s, w) => s + w.exercises.reduce((a, e) => a + (e.weights || []).reduce((x, y) => x + y, 0) * e.reps, 0), 0)), xp: arr.reduce((s, w) => s + w.xp, 0) });
    return { week: sum(S.history.filter((w) => weekKey(w.date) === wk)), month: sum(S.history.filter((w) => w.date.slice(0, 7) === mo)), all: sum(S.history) };
  }
  function weeklySeries(n) {
    n = n || 8; const out = []; const t = today();
    for (let i = n - 1; i >= 0; i--) {
      const d = addDays(t, -7 * i); const wk = weekKey(d);
      const ws = S.history.filter((w) => weekKey(w.date) === wk);
      out.push({ key: wk, label: 'W' + wk.split('W')[1], workouts: ws.length, sets: ws.reduce((s, w) => s + w.exercises.reduce((a, e) => a + e.setsDone, 0), 0), minutes: ws.reduce((s, w) => s + (w.minutes || 0), 0), xp: ws.reduce((s, w) => s + w.xp, 0) });
    }
    return out;
  }
  function liftSeries(exId) { return sortedHistory().map((w) => { const e = w.exercises.find((x) => x.id === exId); return e && e.setsDone ? { date: w.date, kg: maxW(e) } : null; }).filter(Boolean); }
  function muscleSets(days) {
    days = days || 7; const from = addDays(today(), -days + 1); const out = Object.fromEntries(MUSCLES.map((m) => [m, 0]));
    S.history.filter((w) => w.date >= from).forEach((w) => w.exercises.forEach((e) => { const l = LIBMAP[e.id]; if (l) { out[l.primary] += e.setsDone; (l.secondary || []).forEach((m) => { if (out[m] != null) out[m] += e.setsDone * 0.5; }); } }));
    return out;
  }

  /* ---------- calendar ---------- */
  function month(y, m) {
    const first = new Date(y, m, 1); const startOff = (first.getDay() + 6) % 7;
    const start = addDays(ymd(first), -startOff); const t = today();
    const lastDay = new Date(y, m + 1, 0);
    const endOff = 6 - ((lastDay.getDay() + 6) % 7);
    const end = addDays(ymd(lastDay), endOff);
    const days = []; let d = start;
    while (d <= end) {
      const ws = S.history.filter((w) => w.date === d);
      const out = parse(d).getMonth() !== m;
      days.push({ date: d, n: parse(d).getDate(), out, mon: out ? MON[parse(d).getMonth()] : '', count: ws.length, status: ws.length ? 'done' : d < t ? 'missed' : d === t ? 'today' : 'future', today: d === t, plans: ws.map((w) => w.planName), activity: S.activities.some((a) => a.date === d) });
      d = addDays(d, 1);
    }
    return { y, m, title: MONTHS[m] + ' ' + y, days, weeks: days.length / 7 };
  }
  function day(date) {
    return { date, label: fmtDate(date, true), workouts: S.history.filter((w) => w.date === date), activities: S.activities.filter((a) => a.date === date), achievements: achievements().filter((a) => a.date === date), status: S.history.some((w) => w.date === date) ? 'done' : date < today() ? 'missed' : 'future' };
  }

  /* ---------- the live workout session ---------- */
  const sess = () => S.session;
  function start(planId) {
    const p = plan(planId) || selected(); if (!p) return null;
    S.selectedPlanId = p.id;
    S.session = { planId: p.id, planName: p.name, started: Date.now(), cur: 0, exercises: p.exercises.map((e) => ({
      uid: uid('s'), id: e.id, name: e.name, reps: e.reps, unilateral: !!e.unilateral, plannedFail: e.failSets.slice(),
      sets: Array.from({ length: e.sets }, (_, i) => ({ w: e.weight, r: e.reps, done: false, fail: false, planFail: e.failSets.includes(i + 1), L: false, R: false, touched: false })) })) };
    changed('session'); return S.session;
  }
  function sx(i) { return S.session && S.session.exercises[i]; }
  function toggleSet(i, j, side) {
    const e = sx(i); if (!e) return; const s = e.sets[j];
    if (e.unilateral && side) { s[side] = !s[side]; s.done = s.L && s.R; }
    else { s.done = !s.done; if (e.unilateral) { s.L = s.R = s.done; } }
    if (s.done) { S.session.cur = i; if (e.sets.every((x) => x.done) && i < S.session.exercises.length - 1) S.session.cur = i + 1; }
    changed('session'); return s.done;
  }
  function nextOpen() { if (!S.session) return null; for (let i = 0; i < S.session.exercises.length; i++) { const e = S.session.exercises[i]; const j = e.sets.findIndex((s) => !s.done); if (j >= 0) return { i, j, e, s: e.sets[j] }; } return null; }
  function logNext() { const n = nextOpen(); if (n) toggleSet(n.i, n.j); return n; }
  function setWeight(i, j, kg) {
    const e = sx(i); if (!e) return; kg = Math.max(0, +(+kg).toFixed(2)); const old = e.sets[j].w;
    e.sets[j].w = kg; e.sets[j].touched = true;
    for (let k = j + 1; k < e.sets.length; k++) { const s = e.sets[k]; if (s.done || s.touched) break; if (s.w === old) s.w = kg; }
    changed('session');
  }
  const bumpWeight = (i, j, dir) => { const e = sx(i); if (e) setWeight(i, j, Math.max(0, e.sets[j].w + dir * step())); };
  function setReps(i, j, r) { const e = sx(i); if (!e) return; e.sets[j].r = Math.max(0, Math.round(+r || 0)); changed('session'); }
  function toggleFail(i, j) { const e = sx(i); if (!e) return; e.sets[j].fail = !e.sets[j].fail; changed('session'); }
  function addSet(i) { const e = sx(i); if (!e) return; const l = e.sets[e.sets.length - 1] || { w: 0, r: e.reps }; e.sets.push({ w: l.w, r: l.r, done: false, fail: false, planFail: false, L: false, R: false, touched: false }); changed('session'); }
  function removeSet(i) { const e = sx(i); if (!e || e.sets.length <= 1) return; const l = e.sets[e.sets.length - 1]; if (l.done) return; e.sets.pop(); changed('session'); }
  function replaceExercise(i, libId) {
    const e = sx(i); if (!e) return; const l = LIBMAP[libId]; if (!l) return;
    const done = e.sets.filter((s) => s.done);
    const rest = e.sets.filter((s) => !s.done).map((s) => Object.assign({}, s, { w: l.equipment.length ? s.w : 0 }));
    const repl = { uid: uid('s'), id: l.id, name: l.name, reps: e.reps, unilateral: false, plannedFail: [], replaces: e.name, sets: rest.length ? rest : [{ w: 0, r: e.reps, done: false, fail: false, planFail: false, touched: false }] };
    if (done.length) { e.sets = done; e.replacedBy = l.name; S.session.exercises.splice(i + 1, 0, repl); S.session.cur = i + 1; }
    else S.session.exercises.splice(i, 1, repl);
    changed('session');
  }
  function setCurrent(i) { if (S.session) { S.session.cur = Math.max(0, Math.min(i, S.session.exercises.length - 1)); changed('session'); } }
  function progress() {
    if (!S.session) return { done: 0, total: 0, pct: 0, elapsed: 0 };
    let done = 0, total = 0; S.session.exercises.forEach((e) => e.sets.forEach((s) => { total++; if (s.done) done++; }));
    return { done, total, pct: total ? done / total * 100 : 0, elapsed: Date.now() - S.session.started, xp: XP_BASE + done * XP_SET };
  }
  function cancel() { S.session = null; stopRest(); changed('session'); }
  function finish(note) {
    const s = S.session; if (!s) return null;
    const before = { rec: records().list.reduce((m, r) => (m[r.id] = r.kg, m), {}), ach: new Set(achievements().filter((a) => a.got).map((a) => a.id)), level: xp().level };
    const exercises = s.exercises.map((e) => { const d = e.sets.filter((x) => x.done); return { id: e.id, name: e.name, sets: e.sets.length, reps: d.length ? Math.round(d.reduce((a, x) => a + x.r, 0) / d.length) : e.reps, weights: d.map((x) => x.w), setsDone: d.length, failDone: e.sets.map((x, k) => (x.done && x.fail ? k + 1 : 0)).filter(Boolean), unilateral: e.unilateral, replaces: e.replaces || null }; }).filter((e) => e.setsDone || !e.replaces);
    const doneSets = exercises.reduce((a, e) => a + e.setsDone, 0);
    const w = { id: uid('w'), date: today(), planId: s.planId, planName: s.planName, minutes: Math.max(1, Math.round((Date.now() - s.started) / 60000)), xp: XP_BASE + doneSets * XP_SET, note: note || '', exercises };
    S.history.push(w); S.session = null; S.rest = null; S.selectedPlanId = null;
    const prs = exercises.filter((e) => e.setsDone && maxW(e) > (before.rec[e.id] || 0) && before.rec[e.id] != null).map((e) => ({ name: e.name, kg: maxW(e), prev: before.rec[e.id] }));
    const unlocked = achievements().filter((a) => a.got && !before.ach.has(a.id));
    const lv = xp().level;
    changed('history');
    return { workout: w, prs, unlocked, levelUp: lv > before.level ? lv : null, sets: doneSets };
  }

  /* ---------- rest timer (absolute end time, idempotent completion, optional gong) ---------- */
  function startRest(sec, label) { S.rest = { id: uid('t'), end: Date.now() + sec * 1000, total: sec, label: label || '' }; S.restDoneId = null; unlockAudio(); changed('rest'); }
  function stopRest() { S.rest = null; stopGong(); changed('rest'); }
  function addRest(sec) { if (S.rest) { S.rest.end += sec * 1000; S.rest.total += sec; changed('rest'); } }
  function rest() {
    if (!S.rest) return null; const left = S.rest.end - Date.now();
    return { left: Math.max(0, left), total: S.rest.total * 1000, pct: Math.max(0, Math.min(100, (1 - left / (S.rest.total * 1000)) * 100)), done: left <= 0, label: S.rest.label, text: clock(Math.max(0, left)) };
  }
  function presetSave(p) { const i = S.restPresets.findIndex((x) => x.id === p.id); if (i >= 0) S.restPresets[i] = p; else S.restPresets.push(Object.assign({ id: uid('r') }, p)); changed('rest'); }
  function presetDelete(id) { S.restPresets = S.restPresets.filter((p) => p.id !== id); changed('rest'); }
  function presetMove(id, dir) { const a = S.restPresets, i = a.findIndex((p) => p.id === id), j = i + dir; if (i < 0 || j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; changed('rest'); }
  let AC = null, gongNodes = [];
  function unlockAudio() { if (!S.settings.sound) return; try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) { AC = null; } }
  function stopGong() { gongNodes.forEach((n) => { try { n.stop(); } catch (e) { /* už skončil */ } }); gongNodes = []; }
  function gong() {
    try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) { return false; }
    stopGong();
    const n = { short: 2, standard: 3, long: 3 }[S.settings.soundLength] || 3, gap = { short: 1, standard: 1.3, long: 2 }[S.settings.soundLength] || 1.3;
    for (let k = 0; k < n; k++) {
      const t0 = AC.currentTime + 0.05 + k * gap; const vol = 0.28 * Math.pow(0.6, k);
      [1, 2.76].forEach((mult, h) => { const o = AC.createOscillator(), g = AC.createGain(); o.frequency.value = 196 * mult; o.type = 'sine'; g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol / (h + 1), t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + gap * 1.6); o.connect(g).connect(AC.destination); o.start(t0); o.stop(t0 + gap * 1.7); gongNodes.push(o); });
    }
    return true;
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopGong(); });

  /* ---------- activities ---------- */
  const ACT_LABEL = { run: 'Run', walk: 'Walk', cycle: 'Ride' };
  function startActivity(kind) { S.liveActivity = { kind, started: Date.now() }; changed('activity'); }
  function stopActivity(km) { const a = S.liveActivity; if (!a) return; S.activities.push({ id: uid('a'), date: today(), kind: a.kind, minutes: Math.max(1, Math.round((Date.now() - a.started) / 60000)), km: +km || 0 }); S.liveActivity = null; changed('activity'); }
  function addActivity(a) { S.activities.push(Object.assign({ id: uid('a'), date: today() }, a)); changed('activity'); }
  function deleteActivity(id) { S.activities = S.activities.filter((a) => a.id !== id); changed('activity'); }

  /* ---------- body, food, calories, photos ---------- */
  const BODY_FIELDS = [['weight', 'Body weight', 'kg'], ['waist', 'Waist', 'cm'], ['chest', 'Chest', 'cm'], ['arm', 'Upper arm', 'cm'], ['thigh', 'Thigh', 'cm'], ['hips', 'Hips', 'cm']];
  const bodySorted = () => S.body.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  function bodyLatest(field) { const s = bodySorted().filter((b) => b[field] != null); const l = s[s.length - 1], p = s[s.length - 2]; return l ? { value: l[field], date: l.date, change: p ? +(l[field] - p[field]).toFixed(1) : null } : null; }
  const bodySeries = (field) => bodySorted().filter((b) => b[field] != null).map((b) => ({ date: b.date, v: b[field] }));
  function addBody(entry) { S.body.push(Object.assign({ id: uid('b'), date: today(), note: '' }, entry)); changed('body'); }
  function deleteBody(id) { S.body = S.body.filter((b) => b.id !== id); changed('body'); }
  function calorieEstimate() {
    const l = bodyLatest('weight'); const c = S.calorie; if (!l || !c.height || !c.age || c.age < 18) return null;
    const bmr = 10 * l.value + 6.25 * c.height - 5 * c.age + (c.sex === 'female' ? -161 : 5);
    const tdee = bmr * c.activity;
    return { bmr: Math.round(bmr), low: Math.round(tdee * 0.9 / 10) * 10, high: Math.round(tdee * 1.1 / 10) * 10 };
  }
  const foodDay = (date) => { const items = S.foodLog.filter((f) => f.date === (date || today())); return { items, kcal: items.reduce((s, f) => s + (+f.kcal || 0), 0), p: items.reduce((s, f) => s + (+f.p || 0), 0), c: items.reduce((s, f) => s + (+f.c || 0), 0), f: items.reduce((s, f) => s + (+f.f || 0), 0) }; };
  function logFood(item, save) { S.foodLog.push(Object.assign({ id: uid('fl'), date: today(), meal: 'Snack' }, item)); if (save && !S.foods.some((f) => f.name === item.name)) S.foods.push({ id: uid('f'), name: item.name, kcal: item.kcal, p: item.p, c: item.c, f: item.f }); changed('food'); }
  function deleteFood(id) { S.foodLog = S.foodLog.filter((f) => f.id !== id); changed('food'); }
  function addPhoto(file) {
    return new Promise((res, rej) => {
      const r = new FileReader(); r.onerror = rej;
      r.onload = () => { const im = new Image(); im.onload = () => { const k = Math.min(1, 480 / Math.max(im.width, im.height)); const c = document.createElement('canvas'); c.width = im.width * k; c.height = im.height * k; c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); S.photos.push({ id: uid('ph'), date: today(), src: c.toDataURL('image/jpeg', 0.75) }); if (S.photos.length > 12) S.photos.shift(); changed('photos'); res(); }; im.onerror = rej; im.src = r.result; };
      r.readAsDataURL(file);
    });
  }
  function deletePhoto(id) { S.photos = S.photos.filter((p) => p.id !== id); changed('photos'); }

  /* ---------- community ---------- */
  const C = () => S.community;
  const person = (k) => (k === 'me' ? { key: 'me', name: S.profile.name, handle: S.profile.handle, color: S.profile.color, level: xp().level } : Object.assign({ key: k }, PEOPLE[k] || { name: k, handle: k, color: '#777', level: 1 }));
  const initial = (k) => person(k).name.slice(0, 1);
  function timeAgo(ts) { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'now' : m < 60 ? m + ' min' : m < 24 * 60 ? Math.round(m / 60) + ' h' : m < 48 * 60 ? 'yesterday' : Math.round(m / 1440) + ' d'; }
  const feed = () => C().posts.slice().sort((a, b) => b.ts - a.ts);
  function like(id) { const p = C().posts.find((x) => x.id === id); if (!p) return; p.liked = !p.liked; p.likes += p.liked ? 1 : -1; changed('community'); }
  function comment(id, text) { const p = C().posts.find((x) => x.id === id); if (!p || !text.trim()) return; p.comments.push({ who: 'me', text: text.trim() }); changed('community'); }
  function post(text, attach) {
    const p = { id: uid('p'), who: 'me', ts: Date.now(), kind: 'text', text: text || '', likes: 0, liked: false, comments: [], img: null };
    if (attach && attach.workout) { const w = attach.workout; p.kind = 'workout'; p.img = (w.exercises[0] || {}).id || null; p.workout = { plan: w.planName, minutes: w.minutes, sets: w.exercises.reduce((s, e) => s + e.setsDone, 0), lines: w.exercises.filter((e) => e.setsDone).slice(0, 4).map((e) => e.name + ' ' + fmtW(maxW(e)) + ' × ' + e.reps + ' × ' + e.setsDone) }; }
    if (attach && attach.photo) { p.kind = 'photo'; p.photo = attach.photo; }
    C().posts.push(p); changed('community');
    setTimeout(() => { p.likes += 1; p.comments.push({ who: 'anna', text: ['Nice one!', 'Strong 💪', 'Keep it up'][p.comments.length % 3] }); changed('community'); }, 2600);
    return p;
  }
  function deletePost(id) { C().posts = C().posts.filter((p) => p.id !== id || p.who !== 'me'); changed('community'); }
  const chats = () => Object.keys(C().chats).map((k) => { const m = C().chats[k]; return { key: k, person: person(k), last: m[m.length - 1], unread: C().unread[k] || 0 }; }).sort((a, b) => (b.last ? b.last.ts : 0) - (a.last ? a.last.ts : 0));
  const thread = (k) => { C().chats[k] = C().chats[k] || []; if (C().unread[k]) { C().unread[k] = 0; setTimeout(() => changed('community'), 0); } return C().chats[k]; };
  const REPLIES = ['Nice! 💪', 'Haha true', 'See you there', 'Saving it, thanks', 'How did it feel?', 'Let’s go 🔥'];
  function send(k, msg) {
    C().chats[k] = C().chats[k] || [];
    const m = Object.assign({ id: uid('m'), from: 'me', ts: Date.now() }, typeof msg === 'string' ? { text: msg } : msg);
    C().chats[k].push(m); changed('community');
    setTimeout(() => { if (Math.random() < 0.5) m.react = Object.assign({}, m.react, { [k]: ['❤️', '👍', '💪', '🔥'][Math.floor(Math.random() * 4)] }); C().chats[k].push({ id: uid('m'), from: k, text: REPLIES[Math.floor(Math.random() * REPLIES.length)], ts: Date.now(), replyTo: m.share ? m.share.name : null }); changed('community'); }, 1800);
    return m;
  }
  function react(k, msgId, emoji) { const m = (C().chats[k] || []).find((x) => x.id === msgId); if (!m) return; m.react = m.react || {}; if (m.react.me === emoji) delete m.react.me; else m.react.me = emoji; changed('community'); }
  function sharePlanTo(k, planId) { const p = plan(planId); if (!p) return; return send(k, { kind: 'plan', share: { type: 'plan', planId, name: p.name, lines: p.exercises.slice(0, 2).map((e) => e.name + ' ' + e.sets + ' × ' + e.reps + (e.weight ? ' · ' + fmtW(e.weight) : '')).concat(p.exercises.length > 2 ? ['+' + (p.exercises.length - 2) + ' more'] : []), exercises: p.exercises.map((e) => [e.id, e.sets, e.reps, e.weight]) } }); }
  function shareWorkoutTo(k, wid) { const w = workout(wid); if (!w) return; return send(k, { kind: 'workout', share: { type: 'workout', name: w.planName + ', ' + fmtShort(w.date), lines: w.exercises.filter((e) => e.setsDone).slice(0, 3).map((e) => e.name + ' ' + fmtW(maxW(e)) + ' × ' + e.reps) } }); }
  function savePlanFrom(share) {
    const exs = (share.exercises || []).map(([id, sets, reps, w]) => ex(id, sets, reps, w || 0));
    return newPlan(share.name + ' (shared)', exs);
  }
  function acceptFriend(k) { C().requests = C().requests.filter((x) => x !== k); if (!C().friends.includes(k)) C().friends.push(k); changed('community'); }
  function declineFriend(k) { C().requests = C().requests.filter((x) => x !== k); changed('community'); }
  function addFriend(k) { if (!C().friends.includes(k)) C().friends.push(k); changed('community'); }
  function removeFriend(k) { C().friends = C().friends.filter((x) => x !== k); changed('community'); }
  function searchPeople(q) { q = (q || '').toLowerCase(); return Object.keys(PEOPLE).filter((k) => !q || PEOPLE[k].name.toLowerCase().includes(q) || PEOPLE[k].handle.includes(q)).map(person); }
  function leaderboard() {
    const rows = BOARD.map(([k, v]) => ({ key: k, person: person(k), xp: v }));
    if (C().showOnBoard) rows.push({ key: 'me', person: person('me'), xp: Math.min(1000, xp().weekXP + 600), me: true });
    rows.sort((a, b) => b.xp - a.xp); rows.forEach((r, i) => { r.rank = i + 1; });
    const me = rows.find((r) => r.me) || null;
    return { top: rows.slice(0, 20), me };
  }
  function topAchievements() { return achievements().filter((a) => a.got && a.category !== 'milestone').sort((a, b) => b.xp - a.xp).slice(0, 3); }
  function setCommunity(k, v) { C()[k] = v; changed('community'); }
  function toggleReminder(kind) { const r = C().reminders.find((x) => x.kind === kind); if (r) { r.on = !r.on; changed('community'); } }

  /* ---------- settings, backup, reset ---------- */
  function set(k, v) { S.settings[k] = v; if (k === 'sound' && v) unlockAudio(); changed('settings'); }
  function setProfile(p) { Object.assign(S.profile, p); changed('profile'); }
  function exportJSON() {
    const blob = new Blob([JSON.stringify(Object.assign({ app: 'GymQuest r2 concept', exported: new Date().toISOString() }, S), null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'gymquest-backup-' + today() + '.json';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    S.lastBackup = today(); changed('settings');
  }
  function importJSON(file) {
    return file.text().then((txt) => { const d = JSON.parse(txt); if (!d || !Array.isArray(d.history) || !Array.isArray(d.plans)) throw new Error('This file is not a GymQuest backup.'); delete d.app; delete d.exported; d.v = 1; S = Object.assign(seed(), d); changed('import'); });
  }
  function resetAll(empty) { S = seed(); if (empty) { S.history = []; S.body = []; S.foodLog = []; S.activities = []; S.photos = []; S.demo = false; } changed('reset'); }
  function removeDemo() { S.history = []; S.body = []; S.foodLog = []; S.activities = []; S.demo = false; changed('reset'); }

  /* ---------- tick: timers and rest completion ---------- */
  setInterval(() => {
    let what = null;
    if (S.rest && S.rest.end <= Date.now() && S.restDoneId !== S.rest.id) {
      S.restDoneId = S.rest.id;
      const live = !document.hidden && Date.now() - S.rest.end < 2000;
      if (live && S.settings.sound) gong();
      if (navigator.vibrate && live) { try { navigator.vibrate([120, 80, 120]); } catch (e) { /* nie je podporované */ } }
      what = 'restDone';
      save();
    }
    subs.forEach((f) => { try { f(what || 'tick'); } catch (e) { console.error(e); } });
  }, 1000);

  const motivation = () => {
    const w = weekInfo();
    if (S.session) return 'Workout in progress. Finish it when you are done.';
    if (w.met) return 'Weekly goal reached. Anything more is a bonus.';
    if (w.left === 1) return 'One more workout and the week is done.';
    if (w.done === 0) return 'A new week. The first workout is the hardest one to start.';
    return w.left + ' more workouts to reach your goal this week.';
  };

  return {
    get state() { return S; }, on, changed, save, uid, esc, clone,
    // dates
    today, parse, ymd, addDays, weekKey, fmtDate, fmtShort, ago, clock, hhmm, MON, MONTHS, WD, WDL, wdi, timeAgo,
    // units
    unit, toU, fromU, step, fmtW,
    // library
    LIB, LIBMAP, MUSCLES, MUSCLE_LABEL, EQUIP, EQUIP_LABEL, LOC_LABEL, img, anyImg, video, libFilter, toggleEquipment, alternatives,
    // plans
    plans, plan, recommended, selected, selectPlan, savePlan, newPlan, deletePlan, movePlan, movePlanTo, newExercise, planMinutes,
    // history and stats
    history, sortedHistory, workout, deleteWorkout, undoDelete, updateWorkout, lastTime, compare, records, milestones, maxW,
    goal, setGoal, weekInfo, streak, bestStreak, toggleExcused, isExcused, xp, levelTitle, achievements, topAchievements,
    totals, weeklySeries, liftSeries, muscleSets, month, day, motivation,
    // session
    sess, start, toggleSet, logNext, nextOpen, setWeight, bumpWeight, setReps, toggleFail, addSet, removeSet, replaceExercise, setCurrent, progress, cancel, finish,
    // rest
    startRest, stopRest, addRest, rest, presetSave, presetDelete, presetMove, gong,
    // activities, body, food, photos
    ACT_LABEL, startActivity, stopActivity, addActivity, deleteActivity,
    BODY_FIELDS, bodyLatest, bodySeries, bodySorted, addBody, deleteBody, calorieEstimate, foodDay, logFood, deleteFood, addPhoto, deletePhoto,
    // community
    PEOPLE, person, initial, feed, like, comment, post, deletePost, chats, thread, send, react, sharePlanTo, shareWorkoutTo, savePlanFrom,
    acceptFriend, declineFriend, addFriend, removeFriend, searchPeople, leaderboard, setCommunity, toggleReminder,
    // settings
    set, setProfile, exportJSON, importJSON, resetAll, removeDemo,
  };
})();
