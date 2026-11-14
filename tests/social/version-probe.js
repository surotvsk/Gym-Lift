'use strict';
/* GymQuest — 0021: pripravený plán nesmie preniesť právo čítať verziu medzi rolami.
   Len lokálny stack a vlastný dočasný účet; návrat na 0020 a opätovné nasadenie. */
const path = require('path');
const L = require('./lib');
const { check, section, sql, sqlVal, lit, results } = L;
const up = path.resolve(__dirname, '..', '..', 'supabase', 'migrations', '0021_version_probe.sql');
let user, undone;

async function probe(label) {
  const signed = await user.c.rpc('community_social_version');
  check(label + ': authenticated RPC returns version 13', !signed.error && signed.data === 13, L.errText(signed));
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
  check(label + ': authenticated prepared execution succeeded', output === '13', output);
  check(label + ': same prepared plan refuses anonymous execution', /permission denied for function community_social_version/.test(error), error);
  const a = L.anon();
  const anonymous = await a.rpc('community_social_version');
  check(label + ': anonymous RPC is refused', anonymous.error?.code === '42501', L.errText(anonymous));
  const supported = await a.rpc('age_ticket_supported');
  check(label + ': signed-out Google age support remains available', !supported.error && supported.data === true, L.errText(supported));
}

(async () => {
  try {
    section('0021 installed');
    if (sqlVal('select public.community_social_version()') !== '13') throw new Error('apply local migration 0021 first');
    user = await L.newUser('version-probe');
    await probe('installed');
    let repeated = '';
    try { L.sqlFile(up); } catch (e) { repeated = String(e.stderr || e.message); }
    check('repeat migration is refused', /0021 already applied/.test(repeated), repeated);

    section('rollback and reapply');
    undone = L.rollbackFrom(21);
    check('rollback restores version 12', sqlVal('select public.community_social_version()') === '12');
    const old = await user.c.rpc('community_social_version');
    check('authenticated old-version RPC still works', !old.error && old.data === 12, L.errText(old));
    L.reapply(undone); undone = null;
    await probe('reapplied');
  } finally {
    if (undone) L.reapply(undone);
    if (user) sql(`delete from auth.users where id = ${lit(user.id)};`);
  }
  console.log('\n==== checks: ' + results.pass + ' passed, ' + results.fail + ' failed ====');
  process.exitCode = results.fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
