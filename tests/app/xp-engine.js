'use strict';
/* GymQuest — XP engine (v101, spec §4.1–4.2): cumXpForLevel, levelCost, levelForXp, workoutXpFor, activityXpFor.
   Čisté funkcie sa vytiahnu zo script.js a bežia izolovane v Node.

     node tests/app/xp-engine.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'script.js'), 'utf8');
let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  -> ' + JSON.stringify(info) : '')); }
}
const ctx = {};
const names = ['cumXpForLevel', 'levelCost', 'levelForXp', 'workoutXpFor', 'activityXpFor'];
let code = '';
for (const n of names) {
  const m = src.match(new RegExp('function ' + n + '\\b[\\s\\S]*?\\n}\\n|function ' + n + '\\b[^\\n]*\\}\\s*(?:\\/\\/[^\\n]*)?\\n'));
  check('script.js defines ' + n, !!m);
  if (m) code += m[0] + '\n';
}
vm.runInNewContext(code + names.map((n) => 'this.' + n + '=' + n).join(';'), Object.assign(ctx, { Math, Number }));
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), { got, want });

console.log('== cumXpForLevel / levelCost');
[[5, 600], [10, 1700], [20, 5400], [30, 11100], [50, 28500]].forEach(([L, v]) => eq('cum(' + L + ') = ' + v, ctx.cumXpForLevel && ctx.cumXpForLevel(L), v));
eq('levelCost(14) = 360', ctx.levelCost && ctx.levelCost(14), 360);

console.log('== levelForXp');
eq('0 -> L0', ctx.levelForXp && ctx.levelForXp(0).level, 0);
eq('79 -> L0', ctx.levelForXp && ctx.levelForXp(79).level, 0);
eq('80 -> L1', ctx.levelForXp && ctx.levelForXp(80).level, 1);
eq('2944 -> L14 into 4 cost 360', ctx.levelForXp && ctx.levelForXp(2944), { level: 14, into: 4, cost: 360 });
eq('10730 -> L29', ctx.levelForXp && ctx.levelForXp(10730).level, 29);
let ok = true;
for (let L = 0; L <= 200 && ctx.levelForXp; L++) {
  const c = ctx.cumXpForLevel(L);
  if (ctx.levelForXp(c).level !== L || (L > 0 && ctx.levelForXp(c - 1).level !== L - 1)) { ok = false; break; }
}
check('boundaries exact for L0..200', ok);

console.log('== workoutXpFor');
[[2, 0], [3, 36], [15, 60], [24, 78], [40, 78]].forEach(([n, v]) => eq('sets ' + n + ' -> ' + v, ctx.workoutXpFor && ctx.workoutXpFor(n), v));

console.log('== activityXpFor');
[[9, 0], [10, 5], [45, 22], [120, 30]].forEach(([n, v]) => eq('minutes ' + n + ' -> ' + v, ctx.activityXpFor && ctx.activityXpFor(n), v));

console.log('\n==== checks: ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
