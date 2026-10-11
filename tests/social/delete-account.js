'use strict';
/* GymQuest — delete-account Edge Function: both modes, failure reporting and the minimal
   service_role privileges of migration 0006. LOCAL test stack only (lib.js refuses anything else);
   the function must be served locally (`supabase functions serve`).

   Run with migration 0006 applied, on any 0005 state (absent, applied, rolled back): the social
   steps (follows, likes, shares, rate events) are covered only while 0005's tables exist.

   Proves:
     * Leave Community and full deletion remove exactly what they should and keep the rest;
     * EVERY database step (each delete, the profile update, the auth-user delete) reports a
       visible error (HTTP 500 + the step) when it fails — never ok — and a retry then completes;
     * every privilege granted by 0006 is needed (revoking any one makes its step fail visibly),
       and service_role gets nothing beyond them (no content reads, inserts or other columns);
     * anon has no access to Community/backup tables or buckets; a user cannot read or change
       another user's rows; the function refuses unauthenticated calls.
   Usage: node tests/social/delete-account.js */
const { execFileSync } = require('child_process');
const L = require('./lib');
const { check, section, sql, sqlVal, lit } = L;

const SOCIAL = sqlVal("select to_regclass('public.follows') is not null") === 't';
/* 0008: Leave Community first runs community_leave_cleanup (security definer, runs as its owner), which also
   updates the profile row; the function's own profile update runs as service_role. */
const PHASE2 = sqlVal("select to_regprocedure('public.community_leave_cleanup(uuid)') is not null") === 't';
const FN = L.URL_ + '/functions/v1/delete-account';
const ANON = process.env.GQ_LOCAL_ANON;
let fx, M, O, F;   // O: blocked both ways by the seeded user; F: unblocked, for follows/likes/shares

/* Approval as the local moderator (the posts guard lets only moderators change status). */
async function approve(id) {
  const r = await M.c.from('posts').update({ status: 'approved', published_at: new Date().toISOString() }).eq('id', id).select('id');
  if (r.error || !(r.data || []).length) throw new Error('approve: ' + (r.error ? r.error.message : 'no row'));
}
/* SQL as the database superuser (triggers on auth.users need it). Local container only. */
function sqlSuper(q) {
  return execFileSync('docker', ['exec', '-i', process.env.GQ_LOCAL_DB || 'supabase_db_gqtest', 'psql', '-U', 'supabase_admin',
    '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input: q, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
/* Runs a statement as service_role inside a rolled-back transaction: null = allowed, else the error. */
function asServiceRole(stmt) {
  try { sql('begin; set local role service_role; ' + stmt + '; rollback;'); return null; }
  catch (e) { return String(e.stderr || e.message).split('\n').find((l) => /ERROR/.test(l)) || 'error'; }
}
async function token(u) { return (await u.c.auth.getSession()).data.session.access_token; }
async function invoke(u, mode, noAuth) {
  const headers = { apikey: ANON, 'Content-Type': 'application/json' };
  if (!noAuth) headers.Authorization = 'Bearer ' + await token(u);
  const r = await fetch(FN, { method: 'POST', headers, body: JSON.stringify({ mode }) });
  let body = null; try { body = await r.json(); } catch (e) {}
  return { status: r.status, body };
}
async function upload(u, bucket, p) {
  const r = await u.c.storage.from(bucket).upload(p, fx.jpeg, { contentType: 'image/jpeg' });
  if (r.error) throw new Error('upload ' + bucket + ': ' + r.error.message);
}

/* A user with a row in every table the function touches. */
async function seed(tag) {
  const X = await L.newUser('del-' + tag);
  await upload(X, 'community', X.id + '/p.jpg'); await upload(X, 'community', X.id + '/p_thumb.jpg');
  const ins = await X.c.from('posts').insert({ user_id: X.id, image_path: X.id + '/p.jpg', thumb_path: X.id + '/p_thumb.jpg', caption: 'c' }).select('id').single();
  if (ins.error) throw new Error('post: ' + ins.error.message);
  X.post = ins.data.id;
  await approve(X.post);
  const e = [
    (await X.c.from('reports').insert({ reporter_id: X.id, post_id: O.post, reason: 'test' })).error,
    (await X.c.from('blocks').insert({ blocker_id: X.id, blocked_id: O.id })).error,
    (await O.c.from('blocks').insert({ blocker_id: O.id, blocked_id: X.id })).error,
    (await X.c.from('profiles').update({ bio: 'hello' }).eq('id', X.id)).error,
    (await X.c.rpc('save_backup', { p_payload: { plan: 'p' }, p_schema: 1, p_base_revision: 0, p_device: 't', p_app_version: 'v47' })).error,
  ];
  await upload(X, 'backups', X.id + '/media/m/h'); await upload(X, 'avatars', X.id + '/avatar.jpg');
  if (SOCIAL) {
    e.push((await X.c.rpc('create_post', { p_text: 'text ' + tag })).error);   // also writes rate_events
    e.push((await X.c.from('follows').insert({ follower_id: X.id, followee_id: F.id })).error);
    e.push((await F.c.from('follows').insert({ follower_id: F.id, followee_id: X.id })).error);
    e.push((await X.c.from('likes').insert({ post_id: F.post, user_id: X.id })).error);
    e.push((await X.c.from('reposts').insert({ user_id: X.id, post_id: F.post })).error);
  }
  if (e.some(Boolean)) throw new Error('seed ' + tag + ': ' + e.filter(Boolean).map((x) => x.message).join('; '));
  return X;
}
function state(id) {
  const q = [
    ['auth', `select count(*) from auth.users where id = ${lit(id)}`],
    ['posts', `select count(*) from public.posts where user_id = ${lit(id)}`],
    ['reports', `select count(*) from public.reports where reporter_id = ${lit(id)}`],
    ['blocksBy', `select count(*) from public.blocks where blocker_id = ${lit(id)}`],
    ['blocksOf', `select count(*) from public.blocks where blocked_id = ${lit(id)}`],
    ['bio', `select coalesce((select bio from public.profiles where id = ${lit(id)}), '-')`],
    ['profile', `select count(*) from public.profiles where id = ${lit(id)}`],
    ['backup', `select count(*) from public.backups where user_id = ${lit(id)}`],
    ['versions', `select count(*) from public.backup_versions where user_id = ${lit(id)}`],
    ['files', `select count(*) from storage.objects where bucket_id in ('community','avatars') and (storage.foldername(name))[1] = ${lit(id)}`],
    ['backupFiles', `select count(*) from storage.objects where bucket_id = 'backups' and (storage.foldername(name))[1] = ${lit(id)}`],
  ];
  if (SOCIAL) q.push(
    ['follows', `select count(*) from public.follows where follower_id = ${lit(id)}`],
    ['followers', `select count(*) from public.follows where followee_id = ${lit(id)}`],
    ['likes', `select count(*) from public.likes where user_id = ${lit(id)}`],
    ['reposts', `select count(*) from public.reposts where user_id = ${lit(id)}`],
    ['rate', `select count(*) from public.rate_events where user_id = ${lit(id)}`],
    ['consent', `select count(*) from public.community_consents where user_id = ${lit(id)}`]);
  const out = {};
  for (const [k, s] of q) { const v = sqlVal(s); out[k] = k === 'bio' ? v : Number(v); }
  return out;
}
const J = JSON.stringify;
const LEFT_EXPECT = (s) => s.posts === 0 && s.reports === 0 && s.blocksBy === 0 && s.blocksOf === 0 && s.files === 0
  && (!SOCIAL || (s.follows === 0 && s.followers === 0 && s.likes === 0 && s.reposts === 0 && s.rate === 0));

/* Failure injection: a BEFORE trigger that raises for the caller's rows only. */
function inject(table, timing, cond, superuser) {
  const name = 'gq_inject_' + table.replace('.', '_');
  const run = superuser ? sqlSuper : sql;
  run(`create or replace function public.gq_inject_fail() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$;
       drop trigger if exists ${name} on ${table};
       create trigger ${name} before ${timing} on ${table} for each row when (${cond}) execute function public.gq_inject_fail();`);
  return () => run(`drop trigger if exists ${name} on ${table};`);
}

(async () => {
  fx = L.fixtures();
  if (sqlVal("select has_table_privilege('service_role', 'public.posts', 'DELETE')") !== 't') throw new Error('apply migration 0006 first');
  M = await L.newUser('del-mod'); L.makeModerator(M);   // posting needs a moderator to exist
  O = await L.newUser('del-other');
  await upload(O, 'community', O.id + '/o.jpg'); await upload(O, 'community', O.id + '/o_thumb.jpg');
  O.post = (await O.c.from('posts').insert({ user_id: O.id, image_path: O.id + '/o.jpg', thumb_path: O.id + '/o_thumb.jpg', caption: 'o' }).select('id').single()).data.id;
  await approve(O.post);
  F = await L.newUser('del-friend');
  await upload(F, 'community', F.id + '/f.jpg'); await upload(F, 'community', F.id + '/f_thumb.jpg');
  F.post = (await F.c.from('posts').insert({ user_id: F.id, image_path: F.id + '/f.jpg', thumb_path: F.id + '/f_thumb.jpg', caption: 'f' }).select('id').single()).data.id;
  await approve(F.post);
  console.log('schema: 0005 ' + (SOCIAL ? 'present' : 'absent') + ', 0006 applied');

  section('service_role has exactly the privileges of 0006');
  const allowed = [
    'delete from public.posts where user_id = gen_random_uuid()',
    'delete from public.reports where reporter_id = gen_random_uuid()',
    'delete from public.blocks where blocker_id = gen_random_uuid()',
    'delete from public.blocks where blocked_id = gen_random_uuid()',
    "update public.profiles set bio = '', avatar_path = null where id = gen_random_uuid()",
    'delete from public.backups where user_id = gen_random_uuid()',
  ];
  for (const s of allowed) check('allowed: ' + s, asServiceRole(s) === null, asServiceRole(s));
  const refused = [
    'select caption from public.posts', 'select image_path from public.posts', 'select * from public.posts',
    'select bio from public.profiles', 'select username from public.profiles', 'select role from public.profiles',
    'select reason from public.reports', 'select * from public.blocks', 'select payload from public.backups',
    'select * from public.backup_versions', 'delete from public.backup_versions',
    "insert into public.posts (user_id, caption) values (gen_random_uuid(), 'x')",
    "insert into public.blocks (blocker_id, blocked_id) values (gen_random_uuid(), gen_random_uuid())",
    "update public.profiles set role = 'moderator'", "update public.profiles set username = 'x'",
    'update public.profiles set suspended = true', 'delete from public.profiles',
    "update public.posts set status = 'approved'", "update public.reports set status = 'resolved'",
    "update public.backups set payload = '{}'",
  ];
  for (const s of refused) check('refused: ' + s, /permission denied/.test(asServiceRole(s) || ''), asServiceRole(s));
  section('the same through the real Data API with the service key (supabase-js, as the function calls it)');
  const sr = L.admin, rnd = '00000000-0000-4000-8000-000000000000';
  const apiAllowed = [
    ['DELETE posts?user_id=eq.<id>', sr.from('posts').delete().eq('user_id', rnd)],
    ['DELETE reports?reporter_id=eq.<id>', sr.from('reports').delete().eq('reporter_id', rnd)],
    ['DELETE blocks?blocker_id=eq.<id>', sr.from('blocks').delete().eq('blocker_id', rnd)],
    ['DELETE blocks?blocked_id=eq.<id>', sr.from('blocks').delete().eq('blocked_id', rnd)],
    ['PATCH profiles?id=eq.<id> {bio, avatar_path}', sr.from('profiles').update({ bio: '', avatar_path: null }).eq('id', rnd)],
    ['DELETE backups?user_id=eq.<id>', sr.from('backups').delete().eq('user_id', rnd)],
  ];
  for (const [n, q] of apiAllowed) { const r = await q; check('API allowed: ' + n, !r.error, J(r.error)); }
  const apiRefused = [
    ['GET posts?select=caption', sr.from('posts').select('caption').limit(1)],
    ['GET posts?select=*', sr.from('posts').select('*').limit(1)],
    ['GET profiles?select=bio', sr.from('profiles').select('bio').limit(1)],
    ['GET reports?select=reason', sr.from('reports').select('reason').limit(1)],
    ['GET blocks?select=*', sr.from('blocks').select('*').limit(1)],
    ['GET backups?select=payload', sr.from('backups').select('payload').limit(1)],
    ['GET backup_versions', sr.from('backup_versions').select('*').limit(1)],
    ['DELETE backup_versions', sr.from('backup_versions').delete().eq('user_id', rnd)],
    ['POST posts', sr.from('posts').insert({ user_id: rnd, caption: 'x' })],
    ['POST blocks', sr.from('blocks').insert({ blocker_id: rnd, blocked_id: O.id })],
    ['PATCH profiles {role}', sr.from('profiles').update({ role: 'moderator' }).eq('id', rnd)],
    ['PATCH profiles {username}', sr.from('profiles').update({ username: 'x' }).eq('id', rnd)],
    ['PATCH posts {status}', sr.from('posts').update({ status: 'approved' }).eq('id', rnd)],
    ['PATCH backups {payload}', sr.from('backups').update({ payload: {} }).eq('user_id', rnd)],
    ['DELETE profiles', sr.from('profiles').delete().eq('id', rnd)],
    ['DELETE posts … returning rows (would read content)', sr.from('posts').delete().eq('user_id', rnd).select('caption')],
  ];
  for (const [n, q] of apiRefused) { const r = await q; check('API refused (42501): ' + n, !!r.error && r.error.code === '42501', J(r.error || r.data)); }
  for (const role of ['anon', 'authenticated']) {
    const g = sql(`select string_agg(table_name || ':' || privilege_type, ',' order by 1) from information_schema.role_table_grants
      where grantee = '${role}' and table_schema = 'public' and table_name in ('posts','reports','blocks','profiles','backups','backup_versions')
      and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')`);
    console.log('    ' + role + ' table grants (unchanged by 0006): ' + (g || 'none'));
  }

  section('access rules: anon and other users');
  const anonC = L.anon();
  const tables = ['profiles', 'posts', 'reports', 'blocks', 'backups', 'backup_versions'].concat(SOCIAL
    ? ['follows', 'likes', 'reposts', 'post_media', 'post_stats', 'profile_stats', 'community_consents', 'moderation_actions', 'rate_events', 'username_changes'] : []);
  for (const t of tables) {
    const r = await anonC.from(t).select('*').limit(1);
    check('anon cannot read ' + t, !!r.error || (r.data || []).length === 0, J(r.error || r.data));
  }
  const ar = await anonC.from('posts').insert({ user_id: O.id, caption: 'x' });
  check('anon cannot insert posts', !!ar.error, J(ar.error));
  for (const b of ['community', 'backups']) {
    const r = await anonC.storage.from(b).list(O.id);
    check('anon cannot list the ' + b + ' bucket', !!r.error || (r.data || []).length === 0, J(r.data));
  }
  const V = await seed('victim'), A = await L.newUser('del-attacker');
  const before = state(V.id);
  const probes = [
    ['read another user\'s backup', await A.c.from('backups').select('payload').eq('user_id', V.id)],
    ['read another user\'s backup versions', await A.c.from('backup_versions').select('*').eq('user_id', V.id)],
    ['read another user\'s blocks', await A.c.from('blocks').select('*').eq('blocker_id', V.id)],
    ['read another user\'s reports', await A.c.from('reports').select('*').eq('reporter_id', V.id)],
    ['change another user\'s bio', await A.c.from('profiles').update({ bio: 'hacked' }).eq('id', V.id).select('id')],
    ['delete another user\'s post', await A.c.from('posts').delete().eq('id', V.post).select('id')],
    ['delete another user\'s block', await A.c.from('blocks').delete().eq('blocker_id', V.id).select('blocker_id')],
    ['overwrite another user\'s backup', await A.c.from('backups').update({ payload: {} }).eq('user_id', V.id).select('user_id')],
  ];
  for (const [n, r] of probes) check('a user cannot ' + n, L.denied(r), J(r.error || r.data));
  const fromStorage = await A.c.storage.from('backups').download(V.id + '/media/m/h');
  check('a user cannot download another user\'s backup media', !!fromStorage.error);
  check('... and the other user\'s data is unchanged', J(state(V.id)) === J(before), J(state(V.id)));
  const na = await invoke(V, 'full', true);
  check('the function refuses an unauthenticated call (401) and changes nothing', na.status === 401 && J(state(V.id)) === J(before), J(na));

  section('Leave Community (mode community)');
  const X = await seed('leave');
  const r1 = await invoke(X, 'community');
  const s1 = state(X.id);
  check('answers 200 {ok:true, mode:community}', r1.status === 200 && r1.body && r1.body.ok === true && r1.body.mode === 'community', J(r1));
  check('removed: posts, reports, blocks both ways, community/avatar files' + (SOCIAL ? ', follows both ways, likes, shares, rate events' : ''), LEFT_EXPECT(s1), J(s1));
  check('kept: account, profile (bio cleared), private backup + its files' + (SOCIAL ? ', 16+ confirmation' : ''),
    s1.auth === 1 && s1.profile === 1 && s1.bio === '' && s1.backup === 1 && s1.backupFiles === 1 && (!SOCIAL || s1.consent === 1), J(s1));
  check('the other user\'s post and account are untouched', sqlVal('select count(*) from public.posts where id = ' + lit(O.post)) === '1');

  section('full deletion (mode full)');
  const Y = await seed('full');
  const y0 = state(Y.id);
  check('precondition: the account has rows everywhere, incl. backup_versions (no service_role privilege on it)', y0.posts >= 1 && y0.reports === 1 && y0.blocksBy === 1
    && y0.blocksOf === 1 && y0.backup === 1 && y0.versions >= 1 && y0.files >= 1 && y0.backupFiles === 1, J(y0));
  const r2 = await invoke(Y, 'full');
  const s2 = state(Y.id);
  check('answers 200 {ok:true, mode:full}', r2.status === 200 && r2.body && r2.body.ok === true && r2.body.mode === 'full', J(r2));
  check('nothing left: auth user, profile, posts, reports, blocks, backup, backup versions (by cascade from auth.users), all files' + (SOCIAL ? ', social rows' : ''),
    LEFT_EXPECT(s2) && s2.auth === 0 && s2.profile === 0 && s2.backup === 0 && s2.versions === 0 && s2.backupFiles === 0, J(s2));

  section('every database step reports its failure (injected error), and a retry completes');
  const steps = [
    ['community', 'posts', 'public.posts', 'delete', 'old.user_id = $ID', 'db_delete_failed'],
    ['community', 'reports', 'public.reports', 'delete', 'old.reporter_id = $ID', 'db_delete_failed'],
    ['community', 'blocks', 'public.blocks', 'delete', 'old.blocker_id = $ID', 'db_delete_failed'],
    ['community', 'blocks', 'public.blocks', 'delete', 'old.blocked_id = $ID', 'db_delete_failed'],
    ['community', 'profiles', 'public.profiles', 'update', PHASE2 ? "new.id = $ID and current_user = 'service_role'" : 'new.id = $ID', 'db_update_failed'],
    ['full', 'posts', 'public.posts', 'delete', 'old.user_id = $ID', 'db_delete_failed'],
    ['full', 'reports', 'public.reports', 'delete', 'old.reporter_id = $ID', 'db_delete_failed'],
    ['full', 'blocks', 'public.blocks', 'delete', 'old.blocker_id = $ID', 'db_delete_failed'],
    ['full', 'blocks', 'public.blocks', 'delete', 'old.blocked_id = $ID', 'db_delete_failed'],
    ['full', 'backups', 'public.backups', 'delete', 'old.user_id = $ID', 'db_delete_failed'],
    ['full', null, 'auth.users', 'delete', 'old.id = $ID', 'delete_failed'],
  ];
  if (SOCIAL) steps.push(
    ['community', 'follows', 'public.follows', 'delete', 'old.follower_id = $ID', 'db_delete_failed'],
    ['community', 'follows', 'public.follows', 'delete', 'old.followee_id = $ID', 'db_delete_failed'],
    ['community', 'likes', 'public.likes', 'delete', 'old.user_id = $ID', 'db_delete_failed'],
    ['community', 'reposts', 'public.reposts', 'delete', 'old.user_id = $ID', 'db_delete_failed'],
    ['community', 'rate_events', 'public.rate_events', 'delete', 'old.user_id = $ID', 'db_delete_failed']);
  if (PHASE2) steps.push(
    ['community', 'community_leave_cleanup', 'public.profiles', 'update', "new.id = $ID and current_user <> 'service_role'", 'db_delete_failed']);
  let n = 0;
  for (const [mode, label, table, timing, cond, err] of steps) {
    const U = await seed('inj' + (n++));
    const undo = inject(table, timing, cond.replace('$ID', lit(U.id)), table === 'auth.users');
    let r;
    try { r = await invoke(U, mode); } finally { undo(); }
    const s = state(U.id);
    const named = label === null ? !r.body.table : r.body.table === label;
    check(`${mode}: failure in ${table} (${cond.replace(/ = \$ID/, '')}) → 500 ${err}${label ? ' (' + label + ')' : ''}, no ok`,
      r.status === 500 && r.body && r.body.error === err && named && r.body.ok !== true, J(r));
    if (mode === 'full') check('   ... the account still exists (not reported or done as deleted)', s.auth === 1, J(s));
    const retry = await invoke(U, mode);
    const s2r = state(U.id);
    check('   ... retry after the failure is fixed: 200 ok and the end state is complete', retry.status === 200 && retry.body.ok === true
      && (mode === 'community' ? LEFT_EXPECT(s2r) && s2r.bio === '' && s2r.backup === 1 : s2r.auth === 0 && s2r.profile === 0 && s2r.backup === 0 && s2r.versions === 0), J(retry) + ' ' + J(s2r));
  }

  section('every 0006 privilege is needed (revoked one at a time → visible failure)');
  const privs = [
    ['community', 'delete on public.posts', 'posts', 'db_delete_failed'],
    ['community', 'select (user_id) on public.posts', 'posts', 'db_delete_failed'],
    ['community', 'delete on public.reports', 'reports', 'db_delete_failed'],
    ['community', 'select (reporter_id) on public.reports', 'reports', 'db_delete_failed'],
    ['community', 'delete on public.blocks', 'blocks', 'db_delete_failed'],
    ['community', 'select (blocker_id) on public.blocks', 'blocks', 'db_delete_failed'],
    ['community', 'select (blocked_id) on public.blocks', 'blocks', 'db_delete_failed'],
    ['community', 'update (bio) on public.profiles', 'profiles', 'db_update_failed'],
    ['community', 'update (avatar_path) on public.profiles', 'profiles', 'db_update_failed'],
    ['community', 'select (id) on public.profiles', 'profiles', 'db_update_failed'],
    ['full', 'delete on public.backups', 'backups', 'db_delete_failed'],
    ['full', 'select (user_id) on public.backups', 'backups', 'db_delete_failed'],
  ];
  for (const [mode, priv, label, err] of privs) {
    const U = await seed('priv' + (n++));
    sql('revoke ' + priv + ' from service_role;');
    let r;
    try { r = await invoke(U, mode); } finally { sql('grant ' + priv + ' to service_role;'); }
    check(`without ${priv}: ${mode} → 500 ${err} (${label}), no ok` + (mode === 'full' ? ', account kept' : ''),
      r.status === 500 && r.body && r.body.error === err && r.body.table === label && (mode !== 'full' || state(U.id).auth === 1), J(r));
    const retry = await invoke(U, mode);
    const sr = state(U.id);
    check('   ... with the privilege back, a retry completes', retry.status === 200 && retry.body.ok === true
      && (mode === 'community' ? LEFT_EXPECT(sr) && sr.bio === '' : sr.auth === 0 && sr.backup === 0), J(retry) + ' ' + J(sr));
  }
  check('privileges restored exactly (0006 state)', asServiceRole('select caption from public.posts') !== null
    && allowed.every((s) => asServiceRole(s) === null));

  console.log('\n==== checks: ' + L.results.pass + ' passed, ' + L.results.fail + ' failed ====');
  if (process.env.GQ_RESULTS) require('fs').writeFileSync(process.env.GQ_RESULTS, L.results.lines.join('\n') + '\n');
  process.exit(L.results.fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
