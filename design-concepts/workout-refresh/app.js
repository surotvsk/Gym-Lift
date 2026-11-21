/* Standalone, synthetic previews. No app script, storage, accounts or workout data. */
(() => {
  const query = new URLSearchParams(location.search);
  const view = query.get('view') === 'practice' ? 'practice' : 'workout';
  const option = ['a', 'b', 'c'].includes(query.get('option')) ? query.get('option') : 'a';
  const theme = query.get('theme') === 'light' ? 'light' : 'dark';
  const arabic = query.get('lang') === 'ar';
  const text = (en, ar) => arabic ? ar : en;
  document.documentElement.dataset.theme = theme;
  document.documentElement.lang = arabic ? 'ar' : 'en';
  document.documentElement.dir = arabic ? 'rtl' : 'ltr';
  const url = (values) => {
    const params = new URLSearchParams({ view, option, theme, lang: arabic ? 'ar' : 'en', ...values });
    return '?' + params;
  };
  const plans = [
    { name: text('Push', 'الدفع'), count: 5, sets: 16, tone: '', names: [text('Bench press', 'ضغط الصدر'), text('Overhead press', 'ضغط الكتف')], loads: ['4 × 8 · 40 kg', '3 × 10 · 24 kg'] },
    { name: text('Back & Biceps', 'الظهر والعضلة ذات الرأسين'), count: 4, sets: 13, tone: 'lav', names: [text('Lat pulldown', 'السحب العلوي'), text('Dumbbell row', 'تجديف بالدمبل')], loads: ['4 × 10 · 45 kg', '3 × 10 · 24 kg'] },
    { name: text('Legs', 'الساقان'), count: 5, sets: 17, tone: 'peach', names: [text('Squat', 'القرفصاء'), text('Romanian deadlift', 'الرفعة الرومانية')], loads: ['4 × 8 · 60 kg', '3 × 10 · 50 kg'] },
    { name: text('Home starter', 'البداية في المنزل'), count: 6, sets: 18, tone: 'sky', names: [text('Push-ups', 'تمرين الضغط'), text('Lunges', 'الاندفاع')], loads: ['3 × 12', '3 × 10'] },
    { name: text('Outdoor starter', 'البداية في الخارج'), count: 6, sets: 18, tone: 'sand', names: [text('Step-ups', 'صعود الدرجة'), text('Pull-ups', 'العقلة')], loads: ['3 × 12', '3 × 8'] }
  ];
  const practiceTitle = text('Light practice sets', 'مجموعات تحضير خفيفة');
  const note = text('Separate from the timed Warm-up. Not working sets.', 'منفصلة عن مؤقت الإحماء. ليست مجموعات عمل.');
  const requestedPlan = Number(query.get('plan') || 0);
  const demoPlanIndex = Number.isInteger(requestedPlan) && requestedPlan >= 0 && requestedPlan < plans.length ? requestedPlan : 0;
  const demoPlan = plans[demoPlanIndex];
  const thirdExercise = [text('Triceps extension', 'تمديد العضلة ثلاثية الرؤوس'), text('Barbell curl', 'ثني الذراع بالبار'), text('Leg curl', 'ثني الساق'), text('Plank', 'تمرين البلانك'), text('Lunges', 'الاندفاع')];
  const exercises = [...demoPlan.names, thirdExercise[demoPlanIndex]];
  const loads = demoPlanIndex === 0 ? ['40 kg · 8', '24 kg · 10', '12 kg · 12'] : [demoPlan.loads[0], demoPlan.loads[1], '3 × 12'];
  const practice = exercises.map(() => []);
  const workingDone = new Set();
  let selected = 1;
  const root = document.getElementById('preview');
  const sheet = document.getElementById('practice-sheet');
  document.getElementById('preview-label').textContent = text('GYMLIFT · CONCEPT PREVIEW', 'GYMLIFT · معاينة تصميم');
  const themeLink = document.getElementById('theme-link');
  themeLink.textContent = theme === 'dark' ? text('Light mode', 'الوضع الفاتح') : text('Dark mode', 'الوضع الداكن');
  themeLink.href = url({ theme: theme === 'dark' ? 'light' : 'dark' });
  document.getElementById('concept-links').innerHTML =
    [['workout', text('Workout', 'التمرين')], ['practice', text('Practice sets', 'مجموعات التحضير')]]
      .map(([key, label]) => `<a href="${url({ view: key })}" ${view === key ? 'aria-current="page"' : ''}>${label}</a>`).join('') +
    ['a', 'b', 'c'].map(key => `<a class="option-link" href="${url({ option: key })}" aria-label="${text('Option', 'خيار')} ${key.toUpperCase()}" ${key === option ? 'aria-current="page"' : ''}>${key.toUpperCase()}</a>`).join('');
  document.querySelector('.preview-bottom').innerHTML =
    [text('Today', 'اليوم'), text('Workout', 'التمرين'), text('Stats', 'الإحصاءات'), text('Messages', 'الرسائل'), text('You', 'أنت')]
      .map((label, i) => `<span class="${i === 1 ? 'current' : ''}">${label}</span>`).join('');
  const counts = plan => `${plan.count} ${text('exercises', 'تمارين')} · ${plan.sets} ${text('sets', 'مجموعات')}`;
  const start = () => `<a class="start-demo" href="${url({ view: 'practice', plan: String(selected) })}">${text('Start preview', 'بدء المعاينة')} →</a>`;
  const compact = plan => plan.names.map((name, i) => `<div class="compact-exercise"><span>${name}</span><small dir="ltr">${plan.loads[i]}</small></div>`).join('');
  const selectedPreview = () => `<section class="selected-preview"><h2>${plans[selected].name}</h2>${compact(plans[selected])}${start()}</section>`;
  const row = (plan, i, compactMode = false) => `<button type="button" class="plan-row ${compactMode ? '' : 'tone-' + plan.tone}" data-plan="${i}" aria-pressed="${selected === i}">
    <span class="plan-number ${compactMode ? 'tone-' + plan.tone : ''}">${compactMode ? '' : String(i + 1).padStart(2, '0')}</span>
    <span class="plan-copy"><strong>${plan.name}</strong><small>${i === 1 ? text('NEXT ✦ · ', 'التالي ✦ · ') : ''}${counts(plan)}</small></span><span class="plan-arrow" aria-hidden="true">›</span></button>`;
  function renderWorkout() {
    const variants = { a: text('A · Compact plan rows', 'A · صفوف خطط مدمجة'), b: text('B · Next workout first', 'B · التمرين التالي أولاً'), c: text('C · Expandable agenda', 'C · جدول قابل للتوسيع') };
    let content;
    if (option === 'a') content = `<div class="plan-list">${plans.map((plan, i) => row(plan, i)).join('')}</div>${selectedPreview()}`;
    else if (option === 'b') content = `<section class="featured-plan tone-lav"><small>${text('UP NEXT ✦', 'التالي ✦')}</small><h2>${plans[selected].name}</h2><p>${counts(plans[selected])}</p>${start()}</section>
      <p class="section-label">${text('Your other plans', 'خططك الأخرى')}</p><div class="compact-plans">${plans.map((plan, i) => i !== selected ? row(plan, i, true) : '').join('')}</div>${selectedPreview()}`;
    else content = `<div class="agenda">${plans.map((plan, i) => `<details ${i === selected ? 'open' : ''}><summary class="tone-${plan.tone}"><span><strong>${plan.name}</strong><small>${i === 1 ? text('NEXT ✦ · ', 'التالي ✦ · ') : ''}${counts(plan)}</small></span></summary><div class="agenda-body">${compact(plan)}<a class="start-demo" href="${url({ view: 'practice', plan: String(i) })}">${text('Start preview', 'بدء المعاينة')} →</a></div></details>`).join('')}</div><p class="preview-references">${text('Expand a plan to see its exercises. No oversized tiles.', 'افتح خطة لعرض تمارينها. بدون بطاقات مربعة كبيرة.')}</p>`;
    root.innerHTML = `<div class="preview-heading"><div><h1>${text('Workout', 'التمرين')}</h1><p>${variants[option]}</p></div><small>${text('5 plans', '5 خطط')}</small></div>${content}`;
    root.querySelectorAll('[data-plan]').forEach(button => button.addEventListener('click', () => { selected = Number(button.dataset.plan); renderWorkout(); }));
  }
  const progress = (index) => {
    const rows = index === undefined ? practice.flat() : practice[index];
    return rows.length ? `${rows.filter(row => row.done).length}/${rows.length} ${text('done', 'مكتملة')}` : text('Optional', 'اختياري');
  };
  function practiceRows(index) {
    return `${practice[index].map((row, i) => `<div class="practice-line"><span>W${i + 1}</span><span dir="ltr">${row.weight} kg × ${row.reps}</span><button type="button" data-done="${index}:${i}" aria-label="${text('Complete practice set', 'إكمال مجموعة تحضير')} ${i + 1}" aria-pressed="${row.done}">✓</button></div>`).join('')}
      <div class="practice-actions"><button type="button" data-add="${index}" ${practice[index].length >= 6 ? 'disabled' : ''}>${text('+ Warm-up', '+ إحماء')}</button><button type="button" data-ramp="${index}">${text('Warm-up ramp', 'إحماء تدريجي')}</button></div>`;
  }
  const practiceBody = (index) => `<div class="practice-content"><p>${note}</p>${(index === undefined ? [0, 1, 2] : [index]).map(i => `<h3>${exercises[i]}</h3>${practiceRows(i)}`).join('')}</div>`;
  const disclosure = (index, open) => `<details class="practice-disclosure" data-practice="${index === undefined ? 'all' : index}" ${open ? 'open' : ''}><summary><span>${index === undefined ? practiceTitle : text('Warm-up sets', 'مجموعات الإحماء')}</span><span class="practice-count">${progress(index)}</span></summary>${practiceBody(index)}</details>`;
  const working = (index) => `<div class="working-sets">${[1, 2, 3].map(set => `<button type="button" class="set-tick" data-working="${index}:${set}" aria-label="${exercises[index]} ${text('set', 'مجموعة')} ${set}" aria-pressed="${workingDone.has(index + ':' + set)}"><bdi>${loads[index]}</bdi> ✓</button>`).join('')}</div>`;
  function renderPractice() {
    const open = Array.from(root.querySelectorAll('details[open]')).map(el => el.dataset.practice);
    const variants = { a: text('A · One quiet disclosure', 'A · قسم قابل للطي'), b: text('B · Warm-ups with each exercise', 'B · إحماء مع كل تمرين'), c: text('C · Tucked into a bottom sheet', 'C · لوحة سفلية عند الطلب') };
    const top = `<div class="preview-heading"><div><h1>${text('Workout', 'التمرين')}</h1><p>${variants[option]}</p></div><small>${text('Preview only', 'معاينة فقط')}</small></div>
      <section class="session-banner"><small>${demoPlan.name.toUpperCase()} · ${text('IN PROGRESS', 'قيد التدريب')}</small><div class="clock" dir="ltr">2:14</div><p>${text(`${workingDone.size} of ${demoPlan.sets} working sets completed`, `اكتملت ${workingDone.size} من ${demoPlan.sets} مجموعة عمل`)}</p><div class="session-flags"><span>${text('◷ Rest', '◷ الراحة')}</span><span>${text('Warm-up · Off', 'الإحماء · معطل')}</span><span>${text('Stretching · Off', 'الإطالة · معطلة')}</span></div></section>`;
    const launcher = `<div class="practice-launcher tone-sand"><div><strong>${practiceTitle}</strong><small>${text('Out of the way. Ready when you are.', 'مخفية حتى تحتاج إليها.')}</small></div><button type="button" id="open-sheet">${text('Manage', 'إدارة')}</button></div>`;
    root.innerHTML = top + (option === 'a' ? disclosure(undefined, open.includes('all')) : option === 'c' ? launcher : '') +
      exercises.map((name, i) => `<section class="session-ex ${option === 'b' ? 'per-exercise' : ''}"><h2>${name}</h2><p>${text('Working sets', 'مجموعات العمل')} · <bdi dir="ltr">${i === 0 ? '4 × 8' : '3 × 10'}</bdi></p>${working(i)}${option === 'b' ? disclosure(i, open.includes(String(i))) : ''}</section>`).join('') +
      `<p class="preview-references">${text('Similar approach:', 'أسلوب مشابه:')} <a href="https://help.hevyapp.com/hc/en-us/articles/35650921359639-How-to-Use-the-Warm-Up-Calculator-for-Percentage-Based-Warm-Up-Sets">Hevy</a> · <a href="https://help.strongapp.io/article/171-warm-up-calculator">Strong</a><br>${text('Synthetic preview. Your workouts are never read or changed.', 'معاينة ببيانات تجريبية. لا تتم قراءة تدريباتك أو تغييرها.')}</p>`;
    document.getElementById('open-sheet')?.addEventListener('click', () => { renderSheet(); sheet.showModal(); });
  }
  function renderSheet() {
    document.getElementById('sheet-caption').textContent = demoPlan.name + ' · ' + text('OPTIONAL', 'اختياري');
    document.getElementById('sheet-title').textContent = practiceTitle;
    document.getElementById('sheet-body').innerHTML = practiceBody(undefined);
  }
  document.getElementById('close-sheet').addEventListener('click', () => sheet.close());
  function interact(event) {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.working) {
      if (workingDone.has(button.dataset.working)) workingDone.delete(button.dataset.working); else workingDone.add(button.dataset.working);
      button.setAttribute('aria-pressed', String(workingDone.has(button.dataset.working)));
      root.querySelector('.session-banner p').textContent = text(`${workingDone.size} of ${demoPlan.sets} working sets completed`, `اكتملت ${workingDone.size} من ${demoPlan.sets} مجموعة عمل`);
      return;
    }
    if (button.dataset.add !== undefined) {
      const index = Number(button.dataset.add);
      if (practice[index].length < 6) practice[index].push({ weight: 20, reps: 5, done: false });
    } else if (button.dataset.ramp !== undefined) {
      const index = Number(button.dataset.ramp);
      practice[index] = [{ weight: 20, reps: 8, done: false }, { weight: 30, reps: 5, done: false }];
    } else if (button.dataset.done) {
      const [index, row] = button.dataset.done.split(':').map(Number);
      practice[index][row].done = !practice[index][row].done;
    } else return;
    if (sheet.open) renderSheet(); else renderPractice();
  }
  root.addEventListener('click', interact);
  sheet.addEventListener('click', interact);
  if (view === 'workout') renderWorkout(); else renderPractice();
})();
