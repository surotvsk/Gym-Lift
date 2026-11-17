'use strict';
/* GymQuest — 0021/0022: the prepared plan must not carry the right to read the version between roles (kept by 0022,
   which raises the capability to 14). Local stack only, own temporary account; 0022-only rollback to 13, then 0021 to 12, with reapply. */
const path = require('path');
const L = require('./lib');
const { check, section, sql, sqlVal, lit, results } = L;
const up = path.resolve(__dirname, '..', '..', 'supabase', 'migrations', '0021_version_probe.sql');
const up22 = path.resolve(__dirname, '..', '..', 'supabase', 'migrations', '0022_phase_badges.sql');
let user, undone;

async function probe(label, expected) {
  const signed = await user.c.rpc('community_social_version');
  check(label + ': authenticated RPC returns version ' + expected, !signed.error && signed.data === expected, L.errText(signed));
  let output = '', error = '';
  try {
    output = sql(`begin;
      set local role authenticated;
      prepare gq_probe as select public.community_social_version();
      execute gq_probe;
      set local role anon;
      execute gq_probe;
      rollback;`);
  } catch (e) { output = String(e.stdout || '').trim(); error = String(e.stderr || e.message); }
  check(label + ': authenticated prepared execution succeeded', output === String(expected), output);
  check(label + ': same prepared plan refuses anonymous execution', /permission denied for function community_social_version/.test(error), error);
  const a = L.anon();
  const anonymous = await a.rpc('community_social_version');
  check(label + ': anonymous RPC is refused', anonymous.error?.code === '42501', L.errText(anonymous));
  const supported = await a.rpc('age_ticket_supported');
  check(label + ': signed-out Google age support remains available', !supported.error && supported.data === true, L.errText(supported));
}

(async () => {
  try {
    section('0022 installed (capability 14, 0021 probe semantics retained)');
    if (sqlVal('select public.community_social_version()') !== '14') throw new Error('apply local migrations 0021 and 0022 first (tests/social/phase-badges.js needs capability 13, so run it before applying 0022)');
    user = await L.newUser('version-probe');
    await probe('installed', 14);
    let repeated = '';
    try { L.sqlFile(up); } catch (e) { repeated = String(e.stderr || e.message); }
    check('repeat 0021 is refused', /0021 already applied/.test(repeated), repeated);
    repeated = '';
    try { L.sqlFile(up22); } catch (e) { repeated = String(e.stderr || e.message); }
    check('repeat 0022 is refused', /0022 already applied/.test(repeated), repeated);

    section('rollback 0022 only: capability 13 fallback, then reapply');
    undone = L.rollbackFrom(22);
    check('only 0022 rolled back; version 13', undone.length === 1 && undone[0].n === 22 && sqlVal('select public.community_social_version()') === '13');
    await probe('capability 13', 13);
    L.reapply(undone); undone = null;
    await probe('0022 reapplied', 14);

    section('rollback 0021 (with 0022) and reapply');
    undone = L.rollbackFrom(21);
    check('rollback restores version 12', sqlVal('select public.community_social_version()') === '12');
    const old = await user.c.rpc('community_social_version');
    check('authenticated old-version RPC still works', !old.error && old.data === 12, L.errText(old));
    L.reapply(undone); undone = null;
    await probe('reapplied', 14);
  } finally {
    if (undone) L.reapply(undone);
    if (user) sql(`delete from auth.users where id = ${lit(user.id)};`);
  }
  console.log('\n==== checks: ' + results.pass + ' passed, ' + results.fail + ' failed ====');
  process.exitCode = results.fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
