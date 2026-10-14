/* GymQuest design concepts — shared sample data (not the real app).
   Every concept renders the same week of training so the designs can be compared fairly. */
window.GQ = (function () {
  const img = (id) => '../media/' + id + '-poster.jpg';
  const user = {
    name: 'Martin', handle: 'martin.lifts', level: 12, xp: 2340, nextLevelXp: 2500,
    weekDone: 2, weekGoal: 3, streakWeeks: 4, workouts: 63, minutesThisWeek: 118,
    bio: 'Push / pull / legs. Trying to bench 80 by spring.',
  };
  const today = {
    plan: 'Push day', estMinutes: 55, location: 'Gym',
    exercises: [
      { id: 'bench-press', name: 'Bench press', sets: 4, reps: 8, weight: 60, last: 57.5, done: 2, img: img('bench-press'), muscle: 'Chest' },
      { id: 'overhead-press', name: 'Overhead press', sets: 3, reps: 10, weight: 35, last: 35, done: 0, img: img('overhead-press'), muscle: 'Shoulders' },
      { id: 'incline-dumbbell-press', name: 'Incline dumbbell press', sets: 3, reps: 10, weight: 22, last: 20, done: 0, img: img('incline-dumbbell-press'), muscle: 'Upper chest' },
      { id: 'lateral-raises', name: 'Lateral raises', sets: 3, reps: 15, weight: 8, last: 8, done: 0, img: img('lateral-raises'), muscle: 'Side delts' },
      { id: 'dips', name: 'Dips', sets: 3, reps: 10, weight: 0, last: 0, done: 0, img: img('dips'), muscle: 'Triceps' },
    ],
  };
  const plans = [
    { name: 'Push day', count: 5, minutes: 55, img: img('bench-press'), next: true },
    { name: 'Pull day', count: 5, minutes: 50, img: img('lat-pulldown') },
    { name: 'Leg day', count: 6, minutes: 60, img: img('squats') },
    { name: 'Home starter', count: 4, minutes: 25, img: img('push-up') },
    { name: 'Outdoor starter', count: 4, minutes: 30, img: img('lunges') },
  ];
  /* Monday-first week; 1 = trained */
  const week = [
    { d: 'Mon', n: 6, done: true, plan: 'Pull day' }, { d: 'Tue', n: 7, done: false }, { d: 'Wed', n: 8, done: true, plan: 'Leg day' },
    { d: 'Thu', n: 9, done: false, today: true }, { d: 'Fri', n: 10 }, { d: 'Sat', n: 11 }, { d: 'Sun', n: 12 },
  ];
  const history = [
    { date: 'Wed, Oct 8', plan: 'Leg day', minutes: 58, sets: 18, xp: 110, top: 'Squat 100 kg × 5', pr: true },
    { date: 'Mon, Oct 6', plan: 'Pull day', minutes: 49, sets: 15, xp: 95, top: 'Rows 60 kg × 8' },
    { date: 'Fri, Oct 3', plan: 'Push day', minutes: 52, sets: 16, xp: 100, top: 'Bench 57.5 kg × 8' },
    { date: 'Wed, Oct 1', plan: 'Leg day', minutes: 61, sets: 18, xp: 110, top: 'Squat 97.5 kg × 5' },
    { date: 'Mon, Sep 29', plan: 'Pull day', minutes: 47, sets: 15, xp: 95, top: 'Pull-ups BW × 9' },
  ];
  const records = [
    { name: 'Squat', kg: 100, date: 'Oct 8', delta: '+2.5' },
    { name: 'Deadlift', kg: 120, date: 'Sep 24', delta: '+5' },
    { name: 'Bench press', kg: 60, date: 'Oct 3', delta: '+2.5' },
    { name: 'Overhead press', kg: 37.5, date: 'Sep 19', delta: '' },
  ];
  /* body weight, last 8 weeks */
  const bodyWeight = [82.4, 82.1, 81.9, 81.6, 81.8, 81.2, 80.9, 80.6];
  /* sets per week, last 8 weeks */
  const volume = [38, 42, 40, 45, 31, 47, 49, 34];
  const achievements = [
    { id: 'consistent4', name: 'Four weeks strong', desc: 'Weekly goal 4 weeks in a row', xp: 300, got: true },
    { id: 'fifty', name: 'Fifty workouts', desc: '50 workouts logged', xp: 350, got: true },
    { id: 'newpr', name: 'New record', desc: 'Beat a personal best', xp: 75, got: true },
    { id: 'hundred', name: 'One hundred', desc: '100 workouts logged', xp: 750, got: false, progress: 63 },
    { id: 'consistent8', name: 'Eight weeks strong', desc: 'Weekly goal 8 weeks in a row', xp: 500, got: false, progress: 50 },
  ];
  const people = {
    anna: { name: 'Anna', handle: 'anna_lifts', color: '#C46A4A' },
    tomas: { name: 'Tomáš', handle: 'tomas.k', color: '#4A7C6F' },
    lucia: { name: 'Lucia', handle: 'lucia.runs', color: '#7A5C99' },
    peter: { name: 'Peter', handle: 'peto_gym', color: '#B08A3E' },
    eva: { name: 'Eva', handle: 'evafit', color: '#4E6E9E' },
  };
  const feed = [
    { who: 'tomas', ago: '18 min', text: 'Finally pulled 140. Took me a year, worth every session.', kind: 'pr', pr: { lift: 'Deadlift', kg: 140, prev: 135 }, img: null, likes: 42, comments: 9 },
    { who: 'anna', ago: '1 h', text: 'Leg day done. My legs are not speaking to me.', kind: 'workout',
      workout: { plan: 'Leg day', minutes: 64, sets: 20, lines: ['Squat 70 kg × 5 × 5', 'Romanian deadlift 60 kg × 8 × 3', 'Leg press 120 kg × 10 × 3'] }, img: 'squats', likes: 27, comments: 4 },
    { who: 'lucia', ago: '3 h', text: 'Sharing my home plan — no equipment, 25 minutes. Save it if you want it.', kind: 'plan',
      plan: { name: 'Lucia’s home 25', lines: ['Push-ups 3 × 12', 'Lunges 3 × 10 / leg', 'Glute bridge 3 × 15', 'Plank 3 × 45 s'] }, img: 'push-up', likes: 61, comments: 12 },
    { who: 'peter', ago: '5 h', text: 'Morning bench before work. 4 × 8 at 80.', kind: 'workout',
      workout: { plan: 'Chest + triceps', minutes: 41, sets: 14, lines: ['Bench press 80 kg × 8 × 4', 'Dips BW × 12 × 3'] }, img: 'bench-press', likes: 18, comments: 2 },
    { who: 'eva', ago: 'yesterday', text: 'Week 6 of the program. Shoulders finally feel stable.', kind: 'photo', img: 'overhead-press', likes: 33, comments: 5 },
  ];
  const stories = ['anna', 'tomas', 'lucia', 'peter', 'eva'];
  const chat = {
    with: 'anna',
    messages: [
      { from: 'anna', text: 'Are you training today?', t: '16:02' },
      { from: 'me', text: 'Push day at 6. Want to join?', t: '16:05' },
      { from: 'anna', text: 'Can’t, legs are dead from yesterday 😅', t: '16:06', react: '😂' },
      { from: 'me', kind: 'plan', plan: 'Push day', lines: ['Bench press 4 × 8 · 60 kg', 'Overhead press 3 × 10 · 35 kg', '+3 more'], t: '16:07' },
      { from: 'anna', text: 'Saving this for Friday', t: '16:09', replyTo: 'Push day', react: '❤️' },
    ],
  };
  const leaderboard = [
    { who: 'peter', xp: 1240, level: 18 }, { who: 'tomas', xp: 1105, level: 16 }, { who: 'me', xp: 980, level: 12 },
    { who: 'anna', xp: 905, level: 14 }, { who: 'eva', xp: 640, level: 9 }, { who: 'lucia', xp: 515, level: 11 },
  ];
  const reminders = [
    { kind: 'water', label: 'Water', detail: 'every 2 h · 08:00–21:00', on: true },
    { kind: 'meal', label: 'Meals', detail: '08:00 · 12:30 · 18:30', on: true },
    { kind: 'workout', label: 'Workout', detail: 'Mon, Wed, Fri · 17:00', on: true },
  ];
  const person = (key) => (key === 'me' ? { name: user.name, handle: user.handle, color: '#2F3B33' } : people[key]);
  const initials = (key) => person(key).name.slice(0, 1);
  return { img, user, today, plans, week, history, records, bodyWeight, volume, achievements, people, feed, stories, chat, leaderboard, reminders, person, initials };
})();

/* Small helper every concept uses: tab switching by [data-tab] buttons and [data-screen] sections. */
window.gqTabs = function (root, onChange) {
  root = root || document;
  const go = (name) => {
    root.querySelectorAll('[data-screen]').forEach((s) => { s.hidden = s.dataset.screen !== name; });
    root.querySelectorAll('[data-tab]').forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    const scroller = root.querySelector('[data-scroll]');
    if (scroller) scroller.scrollTop = 0;
    if (onChange) onChange(name);
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest ? e.target.closest('[data-tab]') : null;
    if (b) { e.preventDefault(); go(b.dataset.tab); }
  });
  go((root.querySelector('[data-tab].is-active') || root.querySelector('[data-tab]')).dataset.tab);
  return go;
};
