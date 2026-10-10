'use strict';
/* GymQuest social — rollback test for 0005 on the LOCAL test database.
   Preconditions: 0005 applied and run.js executed (so every social table has rows).

     GQ_BASELINE=<schema snapshot taken right after 0001–0004>
     GQ_SNAPSHOT=<command that writes a snapshot: "<cmd> <out-file>">
     node tests/social/rollback.js

   1. 0005_down: schema compared with the baseline; every row preserved (moved to
      community_rollback); v46 flows work; account deletion still removes archived rows.
   2. Re-apply 0005: rows moved back, counters rebuilt exactly, access rules active again.
   3. Second down + compare (repeatable), then 0005 applied again for the UI tests. */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./lib');
const { check, section, sql, sqlVal, lit } = L;

const ROOT = path.join(__dirname, '..', '..');
const UP = path.join(ROOT, 'supabase', 'migrations', '0005_social_feed.sql');
const DOWN = path.join(ROOT, 'supabase', 'rollback', '0005_down.sql');
const TABLES = ['community_consents', 'follows', 'likes', 'reposts', 'post_media', 'moderation_actions', 'rate_events', 'username_changes'];
const rows = (r) => (r && Array.isArray(r.data) ? r.data : []);

function snapshot(tag) {
  const out = path.join(path.dirname(process.env.GQ_BASELINE), 'schema-' + tag + '.txt');
  execFileSync(process.env.GQ_SNAPSHOT, [out]);
  return fs.readFileSync(out, 'utf8');
}
function diffLines(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  const setA = new Map(), setB = new Map();
  A.forEach((l) => setA.set(l, (setA.get(l) || 0) + 1));
  B.forEach((l) => setB.set(l, (setB.get(l) || 0) + 1));
  const onlyA = [], onlyB = [];
  for (const [l, n] of setA) for (let i = 0; i < n - (setB.get(l) || 0); i++) onlyA.push(l);
  for (const [l, n] of setB) for (let i = 0; i < n - (setA.get(l) || 0); i++) onlyB.push(l);
  return { onlyA, onlyB };
}
function counts(schema) {
  return Object.fromEntries(TABLES.map((t) => [t, Number(sqlVal('select count(*) from ' + schema + '.' + t))]));
}
const contentHash = (schema, t) => sqlVal('select md5(coalesce(string_agg(x::text, \'|\' order by x::text), \'\')) from ' + schema + '.' + t + ' x');

async function checkRolledBack(label, baseline, before, hashes) {
  section(label + ': schema compared with the pre-0005 baseline');
  const snap = snapshot(label.replace(/\W+/g, '-'));
  const d = diffLines(baseline, snap);
  const textOnly = Number(sqlVal('select count(*) from public.posts where image_path is null'));
  const allowedA = textOnly ? ['    image_path text NOT NULL,', '    thumb_path text NOT NULL,'] : [];
  const allowedB = (textOnly ? ['    image_path text,', '    thumb_path text,'] : []).concat(['community_rollback']);
  const unexpA = d.onlyA.filter((l) => !allowedA.includes(l));
  const unexpB = d.onlyB.filter((l) => !allowedB.includes(l));
  check('no unexpected schema/privilege/policy difference from the baseline', unexpA.length === 0 && unexpB.length === 0,
    'baseline-only: ' + JSON.stringify(unexpA.slice(0, 8)) + ' now-only: ' + JSON.stringify(unexpB.slice(0, 8)));
  check('only intended difference: the archive schema' + (textOnly ? ' + nullable photo columns (text-only posts exist: ' + textOnly + ')' : ''),
    d.onlyB.includes('community_rollback') && (textOnly ? d.onlyB.includes('    image_path text,') : true));

  section(label + ': data preserved');
  const now = counts('community_rollback');
  check('every social row moved to community_rollback (counts equal)', JSON.stringify(now) === JSON.stringify(before.rows), JSON.stringify(now) + ' vs ' + JSON.stringify(before.rows));
  check('archived rows unchanged (content hash per table)', TABLES.every((t) => contentHash('community_rollback', t) === hashes[t]));
  check('all posts kept (count ' + before.posts + ')', Number(sqlVal('select count(*) from public.posts')) === before.posts);
  check('text-only posts kept with their text', sqlVal('select md5(string_agg(id::text || caption, \'|\' order by id)) from public.posts where image_path is null') === before.textHash);
  check('photo paths of every post kept', sqlVal('select md5(string_agg(id::text || coalesce(image_path,\'\') || coalesce(thumb_path,\'\'), \'|\' order by id)) from public.posts') === before.pathHash);
  check('storage objects untouched', Number(sqlVal('select count(*) from storage.objects')) === before.objects);
  check('reports, blocks, profiles, backups kept', sqlVal('select (select count(*) from public.reports) || \',\' || (select count(*) from public.blocks) || \',\' || (select count(*) from public.profiles) || \',\' || (select count(*) from public.backups) || \',\' || (select count(*) from public.backup_versions)') === before.other);
  check('counters dropped (derived; rebuilt on re-apply)', sqlVal("select to_regclass('public.post_stats') is null and to_regclass('public.profile_stats') is null") === 't');

  section(label + ': archive not reachable, v46 behaviour back');
  const u = await L.signIn(before.user);
  const f = await u.c.from('follows').select('*').limit(1);
  check('social tables no longer reachable through the API', !!f.error);
  const ar = await u.c.schema('community_rollback').from('follows').select('*').limit(1);
  check('archive schema not reachable through the API', !!ar.error);
  check('social functions gone (app falls back)', !!(await u.c.rpc('community_social_version')).error);
  const q = await u.c.from('posts').select('id,user_id,caption,thumb_path,created_at,profiles(username,avatar_path)').eq('status', 'approved').order('created_at', { ascending: false }).range(0, 49);
  check('v46 feed query works', !q.error && rows(q).length > 0, q.error && q.error.message);
  check('text-only posts readable by the v46 query', rows(q).some((r) => r.thumb_path === null && r.caption));
  const img = u.id + '/rb' + label.length + '.jpg', th = u.id + '/rb' + label.length + '_thumb.jpg';
  const fx = L.fixtures();
  await u.c.storage.from('community').upload(img, fx.jpeg, { contentType: 'image/jpeg' });
  await u.c.storage.from('community').upload(th, fx.jpeg, { contentType: 'image/jpeg' });
  const ins = await u.c.from('posts').insert({ user_id: u.id, image_path: img, thumb_path: th, caption: '' }).select('id').single();
  check('v46 photo post works', !ins.error, ins.error && ins.error.message);
  if (!ins.error) { await u.c.from('posts').delete().eq('id', ins.data.id); await u.c.storage.from('community').remove([img, th]); }
  const an = await L.anon().from('profiles').select('id').limit(1);
  check('pre-0005 privileges restored exactly (anon read of profiles works again, as before 0005)', !an.error && rows(an).length === 1);
  const extra = sqlVal('select m.image_path from community_rollback.post_media m join public.posts p on p.id = m.post_id where p.user_id = ' + lit(before.user.id) + ' and p.status = \'approved\' order by m.position limit 1');
  const other = await L.signIn(before.user2);
  const s1 = await other.c.storage.from('community').createSignedUrl(extra, 60);
  check('documented limitation: photos 2–4 not visible to others while rolled back', !!extra && (!!s1.error || !s1.data));
  const s2 = await u.c.storage.from('community').createSignedUrl(extra, 60);
  check('... still visible to their author', !!extra && !s2.error);
  const cover = sqlVal('select image_path from public.posts where user_id = ' + lit(before.user.id) + ' and image_path is not null limit 1');
  const s3 = await other.c.storage.from('community').createSignedUrl(cover, 60);
  check('photo 1 of the same post stays visible to others', !s3.error);
}

(async () => {
  if (sqlVal("select to_regclass('public.follows') is not null") !== 't') throw new Error('0005 must be applied first');
  const baseline = fs.readFileSync(process.env.GQ_BASELINE, 'utf8');
  // Self-contained data: a text-only and a 4-photo post (approved by the local test
  // moderator from GQ_STATE), followed, liked and shared by a second user; a third
  // user is deleted while rolled back.
  const S = JSON.parse(fs.readFileSync(process.env.GQ_STATE, 'utf8'));
  const M = await L.signIn(S.users.M);
  const user = await L.newUser('rb1'), user2 = await L.newUser('rb2'), victimU = await L.newUser('rb3');
  const fx0 = L.fixtures();
  const photos = [];
  for (let i = 0; i < 4; i++) {
    const image = user.id + '/rbpost/' + i + '.jpg', thumb = user.id + '/rbpost/' + i + '_thumb.jpg';
    await user.c.storage.from('community').upload(image, fx0.jpeg, { contentType: 'image/jpeg' });
    await user.c.storage.from('community').upload(thumb, fx0.jpeg, { contentType: 'image/jpeg' });
    photos.push({ image, thumb });
  }
  const tp = await user.c.rpc('create_post', { p_text: 'rollback text-only post' });
  const mp = await user.c.rpc('create_post', { p_text: 'rollback 4 photos', p_photos: photos });
  for (const id of [tp.data, mp.data]) await M.c.from('posts').update({ status: 'approved', published_at: new Date().toISOString() }).eq('id', id);
  const setup = [
    await user2.c.from('follows').insert({ follower_id: user2.id, followee_id: user.id }),
    await user2.c.from('likes').insert({ post_id: mp.data, user_id: user2.id }),
    await user2.c.from('reposts').insert({ user_id: user2.id, post_id: tp.data }),
    await victimU.c.from('follows').insert({ follower_id: victimU.id, followee_id: user.id }),
    await victimU.c.from('likes').insert({ post_id: tp.data, user_id: victimU.id }),
  ];
  check('setup: approved text-only + 4-photo posts, follows, likes, shares', !tp.error && !mp.error && setup.every((r) => !r.error),
    JSON.stringify([tp.error, mp.error].concat(setup.map((r) => r.error)).filter(Boolean)));
  const before = {
    rows: counts('public'),
    posts: Number(sqlVal('select count(*) from public.posts')),
    textHash: sqlVal('select md5(string_agg(id::text || caption, \'|\' order by id)) from public.posts where image_path is null'),
    pathHash: sqlVal('select md5(string_agg(id::text || coalesce(image_path,\'\') || coalesce(thumb_path,\'\'), \'|\' order by id)) from public.posts'),
    objects: Number(sqlVal('select count(*) from storage.objects')),
    other: sql('select (select count(*) from public.reports) || \',\' || (select count(*) from public.blocks) || \',\' || (select count(*) from public.profiles) || \',\' || (select count(*) from public.backups) || \',\' || (select count(*) from public.backup_versions)'),
    user, user2,
  };
  const hashes = Object.fromEntries(TABLES.map((t) => [t, contentHash('public', t)]));
  check('precondition: every social table has rows', Object.values(before.rows).every((n) => n > 0), JSON.stringify(before.rows));
  check('precondition: text-only and multi-photo posts exist', Number(sqlVal('select count(*) from public.posts where image_path is null')) > 0 && before.rows.post_media > 0);

  section('apply 0005_down');
  L.sqlFile(DOWN);
  check('0005_down ran in one transaction', sqlVal("select to_regclass('public.follows') is null and to_regclass('community_rollback.follows') is not null") === 't');
  await checkRolledBack('rollback 1', baseline, before, hashes);

  section('account deletion while rolled back still removes archived rows');
  const victim = victimU.id;
  const victimRows = () => Number(sqlVal(`select (select count(*) from community_rollback.follows where follower_id = ${lit(victim)} or followee_id = ${lit(victim)})
     + (select count(*) from community_rollback.likes where user_id = ${lit(victim)}) + (select count(*) from community_rollback.reposts where user_id = ${lit(victim)})
     + (select count(*) from community_rollback.community_consents where user_id = ${lit(victim)}) + (select count(*) from community_rollback.rate_events where user_id = ${lit(victim)})
     + (select count(*) from community_rollback.moderation_actions where user_id = ${lit(victim)})`));
  const had = victimRows();
  const vd = await L.admin.auth.admin.deleteUser(victim);
  check('archived rows of a deleted account are removed by cascade (' + had + ' rows)', !vd.error && had > 0 && victimRows() === 0, vd.error && vd.error.message);

  section('re-apply 0005');
  L.sqlFile(UP);
  check('0005 re-applied', sqlVal("select to_regclass('public.follows') is not null and to_regclass('community_rollback.follows') is null") === 't');
  const after = counts('public');
  check('rows moved back (all tables present, nothing left in the archive)', TABLES.every((t) => sqlVal("select to_regclass('community_rollback." + t + "') is null") === 't'));
  check('rows equal the pre-rollback rows minus the deleted account', TABLES.every((t) => after[t] <= before.rows[t]) && after.follows < before.rows.follows, JSON.stringify(after));
  const statsMatch = sql(`select
      (select count(*) from public.post_stats s where s.likes <> (select count(*) from public.likes l where l.post_id = s.post_id)
                                                or s.reposts <> (select count(*) from public.reposts r where r.post_id = s.post_id))
    + (select count(*) from public.profile_stats s where s.followers <> (select count(*) from public.follows f where f.followee_id = s.user_id)
                                                   or s.following <> (select count(*) from public.follows f where f.follower_id = s.user_id))
    + (select count(*) from (select post_id from public.likes union select post_id from public.reposts) x where not exists (select 1 from public.post_stats s where s.post_id = x.post_id))`);
  check('counters rebuilt exactly from the rows', statsMatch === '0', statsMatch);
  check('approve history not duplicated by the re-apply backfill', sqlVal("select count(*) from (select post_id from public.moderation_actions where action = 'approve' and moderator_id is null group by post_id having count(*) > 1) x") === '0');
  const u = await L.signIn(user);
  check('social API back', !(await u.c.rpc('community_social_version')).error && !(await u.c.from('follows').select('follower_id').limit(1)).error);
  check('anon access removed again', rows(await L.anon().from('profiles').select('id').limit(1)).length === 0);
  const ev = await u.c.rpc('community_feed', { p_scope: 'everyone', p_limit: 50 });
  check('feeds work, multi-photo posts show all photos again', !ev.error && rows(ev).some((x) => x.photos.length === 4), ev.error && ev.error.message);

  section('second rollback (repeatable) + final re-apply');
  const before2 = Object.assign({}, before, {
    rows: counts('public'), posts: Number(sqlVal('select count(*) from public.posts')),
    textHash: sqlVal('select md5(string_agg(id::text || caption, \'|\' order by id)) from public.posts where image_path is null'),
    pathHash: sqlVal('select md5(string_agg(id::text || coalesce(image_path,\'\') || coalesce(thumb_path,\'\'), \'|\' order by id)) from public.posts'),
    objects: Number(sqlVal('select count(*) from storage.objects')),
    other: sql('select (select count(*) from public.reports) || \',\' || (select count(*) from public.blocks) || \',\' || (select count(*) from public.profiles) || \',\' || (select count(*) from public.backups) || \',\' || (select count(*) from public.backup_versions)'),
  });
  const hashes2 = Object.fromEntries(TABLES.map((t) => [t, contentHash('public', t)]));
  L.sqlFile(DOWN);
  await checkRolledBack('rollback 2', baseline, before2, hashes2);
  L.sqlFile(UP);
  check('0005 applied again (final state for the UI tests)', sqlVal("select to_regclass('public.follows') is not null") === 't');

  console.log('\n==== checks: ' + L.results.pass + ' passed, ' + L.results.fail + ' failed ====');
  if (process.env.GQ_RESULTS) fs.writeFileSync(process.env.GQ_RESULTS, L.results.lines.join('\n') + '\n\n==== checks: ' + L.results.pass + ' passed, ' + L.results.fail + ' failed ====\n');
  process.exit(L.results.fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
