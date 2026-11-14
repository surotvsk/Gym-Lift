'use strict';
/* GymQuest social — migration 0020 (Google sign-up with a server-enforced 16+ ticket), LOCAL stack only.
   Lokálny GoTrue nemá zapnutého poskytovateľa Google (provider_disabled), takže id-token cestu nejde
   spustiť. Spúšť sa preto skúša priamym vložením do auth.users s raw_app_meta_data {"provider":"google"},
   čo je presne to, čo GoTrue pri registrácii cez id-token zapíše (provider + e-mail v new.email).
   Spustenie: source ../claude-code/local-preview/test-env.sh; node tests/social/google-age.js */
const crypto = require('crypto');
const L = require('./lib');
const { check, section, sql, sqlVal, lit, anon, results } = L;

const tag = L.runTag;
const mail = (n) => 'gqgoogle-' + n + '-' + tag + '@example.test';
const hash = (e) => crypto.createHash('sha256').update(e.trim().toLowerCase()).digest('hex');
const uuid = () => crypto.randomUUID();
const created = [];
function insertUser(email, { provider = 'google', meta = {} } = {}) {
  const id = uuid();
  try {
    sql(`insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
         values (${lit(id)}, 'authenticated', 'authenticated', ${lit(email)}, ${lit(JSON.stringify({ provider, providers: [provider] }))}::jsonb,
                 ${lit(JSON.stringify(meta))}::jsonb, now(), now());`);
    created.push(id);
    return { ok: true, id };
  } catch (e) { return { ok: false, err: String(e.stderr || e.message) }; }
}
const refused = (r) => !r.ok && /age_confirmation_required/.test(r.err);
const ticketRows = (e) => Number(sqlVal(`select count(*) from public.age_tickets where email_hash = ${lit(hash(e))}`));

(async () => {
  try {
    section('0020 present');
    const versionBefore = sqlVal('select public.community_social_version()');
    check('version is 12 or later', Number(versionBefore) >= 12);
    const a = anon();

    section('anon surface');
    const e1 = mail('one');
    const r1 = await a.rpc('age_ticket_create', { p_email: '  ' + e1.toUpperCase() + ' ' });
    check('anon can call age_ticket_create', !r1.error, L.errText(r1));
    check('ticket stores the hash of the normalised e-mail', ticketRows(e1) === 1);
    check('plain e-mail is never stored', sqlVal(`select count(*) from public.age_tickets where email_hash like '%@%'`) === '0');
    const rd = await a.from('age_tickets').select('*');
    check('anon cannot read the table', !!rd.error || (rd.data || []).length === 0, L.errText(rd));
    const wr = await a.from('age_tickets').insert({ email_hash: 'x' });
    check('anon cannot write the table', !!wr.error);
    for (const bad of ['', 'nope', 'a@b', 'a b@c.de', 'x'.repeat(250) + '@e.com', null]) {
      const r = await a.rpc('age_ticket_create', { p_email: bad });
      check('invalid e-mail refused: ' + String(bad).slice(0, 12), !!r.error && /invalid_email/.test(r.error.message), L.errText(r));
    }

    section('trigger');
    const none = insertUser(mail('none'));
    check('google without a ticket is refused', refused(none), none.err);
    const ok = insertUser(e1);
    check('google with a valid ticket is created (case/space-insensitive e-mail)', ok.ok, ok.err);
    check('ticket is deleted (single use)', ticketRows(e1) === 0);
    check('profile exists', ok.ok && sqlVal(`select count(*) from public.profiles where id = ${lit(ok.id)}`) === '1');
    check('consent row has source google_signup', ok.ok && sqlVal(`select source from public.community_consents where user_id = ${lit(ok.id)}`) === 'google_signup');
    const reuse = insertUser(mail('reuse-other'));
    await a.rpc('age_ticket_create', { p_email: mail('reuse') });
    const first = insertUser(mail('reuse'));
    const second = insertUser(mail('reuse') + '.x');
    check('ticket for one e-mail does not help another e-mail', refused(second) && first.ok && refused(reuse));
    sql(`delete from auth.users where id = ${lit(first.id)};`);   // e-mail sa uvoľní, tiket je už spotrebovaný
    const again = insertUser(mail('reuse'));
    check('reuse of a spent ticket is refused', refused(again), again.err);
    const eExp = mail('expired');
    await a.rpc('age_ticket_create', { p_email: eExp });
    sql(`update public.age_tickets set created_at = now() - interval '11 minutes' where email_hash = ${lit(hash(eExp))};`);
    const exp = insertUser(eExp);
    check('expired ticket (11 min) is refused', refused(exp), exp.err);
    const eFresh = mail('fresh');
    await a.rpc('age_ticket_create', { p_email: eFresh });
    sql(`update public.age_tickets set created_at = now() - interval '9 minutes' where email_hash = ${lit(hash(eFresh))};`);
    check('ticket of 9 minutes still works', insertUser(eFresh).ok);
    await a.rpc('age_ticket_create', { p_email: mail('exp-clean') });
    check('create_ticket cleans tickets older than 10 minutes', ticketRows(eExp) === 0);
    const eMail = mail('mailtk');
    await a.rpc('age_ticket_create', { p_email: eMail });
    const notGoogle = insertUser(eMail, { provider: 'email' });
    check('a ticket never lets a non-google provider skip the age flag', refused(notGoogle), notGoogle.err);
    sql(`delete from public.age_tickets;`);
    const meta = insertUser(mail('meta'), { provider: 'email', meta: { age_16_confirmed: true } });
    check('e-mail sign-up with metadata unchanged', meta.ok, meta.err);
    check('e-mail sign-up consent source stays signup', meta.ok && sqlVal(`select source from public.community_consents where user_id = ${lit(meta.id)}`) === 'signup');
    const noMeta = insertUser(mail('nometa'), { provider: 'email' });
    check('e-mail sign-up without metadata still refused', refused(noMeta), noMeta.err);
    const gMeta = insertUser(mail('gmeta'), { meta: { age_16_confirmed: true } });
    check('google with metadata flag works as before and consumes no ticket', gMeta.ok && sqlVal(`select source from public.community_consents where user_id = ${lit(gMeta.id)}`) === 'signup');
    const viaApi = await L.admin.auth.admin.createUser({ email: mail('api'), email_confirm: true, user_metadata: {} });
    check('GoTrue admin create without the flag is refused', !!viaApi.error);

    section('rate limit');
    sql(`delete from public.age_tickets;`);
    let okCount = 0, lastErr = '';
    for (let i = 0; i < 33; i++) {
      const r = await a.rpc('age_ticket_create', { p_email: mail('rl' + i) });
      if (!r.error) okCount++; else lastErr = r.error.message;
    }
    check('600 tickets per minute are allowed (cap only bounds growth)', okCount === 33, okCount + ' ' + lastErr);
    sql(`insert into public.age_tickets select md5(g::text), now() from generate_series(1, 601) g;`);
    const capped = await a.rpc('age_ticket_create', { p_email: mail('rlx') });
    check('above 600 per minute: rate_limited', !!capped.error && /rate_limited/.test(capped.error.message), L.errText(capped));
    sql(`delete from public.age_tickets;`);

    section('support probe');
    const sup = await a.rpc('age_ticket_supported');
    check('anon can call age_ticket_supported (true)', !sup.error && sup.data === true, L.errText(sup));
    const ver = await a.rpc('community_social_version');
    check('anon still cannot call community_social_version', !!ver.error, L.errText(ver));

    section('grants');
    check('anon/authenticated have no table privileges', sqlVal(`select count(*) from information_schema.role_table_grants where table_name = 'age_tickets' and grantee in ('anon','authenticated','PUBLIC')`) === '0');
    check('RLS is on', sqlVal(`select relrowsecurity from pg_class where oid = 'public.age_tickets'::regclass`) === 't');

    section('rollback and reapply');
    const list = L.rollbackFrom(20);
    check('rollback removed table and functions', sqlVal(`select to_regclass('public.age_tickets') is null`) === 't' && sqlVal(`select to_regprocedure('public.age_ticket_supported()') is null`) === 't'
      && sqlVal(`select to_regprocedure('public.age_ticket_create(text)') is null`) === 't');
    check('version back to 11', sqlVal('select public.community_social_version()') === '11');
    const down = insertUser(mail('down'));
    check('after rollback google sign-up is refused (0005 rule)', refused(down), down.err);
    check('after rollback e-mail flag still works', insertUser(mail('down2'), { provider: 'email', meta: { age_16_confirmed: true } }).ok);
    L.reapply(list);
    check('reapply restores version ' + versionBefore, sqlVal('select public.community_social_version()') === versionBefore);
    await a.rpc('age_ticket_create', { p_email: mail('after') });
    check('works again after reapply', insertUser(mail('after')).ok);
    let twice = '';
    try { L.sqlFile(require('path').join(__dirname, '..', '..', 'supabase', 'migrations', '0020_google_age_ticket.sql')); } catch (e) { twice = String(e.stderr || e.message); }
    check('re-running 0020 is refused', /already applied/.test(twice), twice.slice(0, 80));
  } finally {
    if (created.length) sql(`delete from auth.users where id in (${created.map(lit).join(',')});`);
    sql(`delete from public.age_tickets;`);
    L.sql(`notify pgrst, 'reload schema';`);
  }
  console.log('\n==== google-age: ' + results.pass + ' PASS, ' + results.fail + ' FAIL ====');
  process.exitCode = results.fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
