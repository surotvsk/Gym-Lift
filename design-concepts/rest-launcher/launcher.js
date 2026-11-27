/* GymLift prototyp: spúšťač Oddychu. Nič nečíta z úložiska aplikácie (localStorage, IndexedDB); všetky texty sú označená vzorka.
   Parametre URL: variant=a|b|c, theme=dark|light, lang=en|ar. Téma, jazyk a variant sa nastavujú už v <head> (index.html). */
(function () {
  'use strict';

  const I18N = {
    en: {
      badge: 'Prototype · sample data',
      plan: 'Sample plan: Push',
      summary: '12 of 20 sets · sample values',
      rest: 'Rest timer',
      warmup: 'Warm-up',
      stretching: 'Stretching',
      more: 'More workout options',
      exName: 'Bench press',
      exMeta: 'Sample exercise · 4 sets',
      cap: {
        a: 'Variant A · lime filled pill (recommended for the app)',
        b: 'Variant B · high-contrast outline',
        c: 'Variant C · lavender filled pill'
      }
    },
    ar: {
      badge: 'نموذج أولي · بيانات تجريبية',
      plan: 'خطة تجريبية: دفع',
      summary: '12 من 20 مجموعة · قيم تجريبية',
      rest: 'مؤقت الراحة',
      warmup: 'الإحماء',
      stretching: 'التمدد',
      more: 'خيارات أخرى للتمرين',
      exName: 'ضغط الصدر',
      exMeta: 'تمرين تجريبي · 4 مجموعات',
      cap: {
        a: 'الخيار A · زر ليموني معبأ (موصى به للتطبيق)',
        b: 'الخيار B · إطار عالي التباين',
        c: 'الخيار C · زر لافندر معبأ'
      }
    }
  };

  const d = document.documentElement;
  const lang = d.getAttribute('lang') === 'ar' ? 'ar' : 'en';
  const variant = d.getAttribute('data-variant');
  const s = I18N[lang];
  const set = (id, text) => { document.getElementById(id).textContent = text; };

  set('proto-badge', s.badge);
  set('plan-name', s.plan);
  set('summary', s.summary);
  set('rest-text', s.rest);
  set('warmup-text', s.warmup);
  set('stretch-text', s.stretching);
  document.getElementById('btn-more').setAttribute('aria-label', s.more);
  set('ex-name', s.exName);
  set('ex-meta', s.exMeta);
  set('caption', s.cap[variant]);
  document.title = 'GymLift prototype · Rest launcher ' + variant.toUpperCase();

  /* Pripravené pre snímky obrazovky: po načítaní písma. */
  const ready = () => d.setAttribute('data-ready', '1');
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(ready, ready); else ready();
})();
