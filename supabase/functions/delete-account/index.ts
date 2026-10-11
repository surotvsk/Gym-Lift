// ============================================================================
// GymQuest — Edge Function: delete-account
// ----------------------------------------------------------------------------
// Privileged. Two modes, both authenticated by the caller's JWT:
//
//   mode = 'community'  -> "Leave Community": removes the caller's posts,
//                          community/avatar media, reports, blocks, follows
//                          (both directions), likes, shares and spam-limit
//                          events, friends, friend requests, chats and
//                          comments (0008), takes the caller out of the user
//                          search, and clears bio + avatar. KEEPS the auth
//                          account and the private cloud backup.
//
//   mode = 'full'       -> "Delete my account and all cloud data": removes the
//                          caller's community artifacts AND the private backup
//                          (backups bucket objects + backups row via cascade),
//                          then deletes the auth user.
//
// It never touches the user's private ON-DEVICE workouts (the app keeps those).
// The service_role key lives ONLY here (function secrets) and is never exposed
// to the browser.
//
// Deploy (as the project owner):
//   supabase functions deploy delete-account
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are RESERVED
// secrets Supabase provides automatically — never set them manually.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey) return json({ error: 'server_not_configured' }, 500);

  const body = await req.json().catch(() => ({}));
  const mode = body && body.mode === 'community' ? 'community' : 'full';

  // 1. Identify the caller from their JWT (never trust a body-supplied id).
  const authHeader = req.headers.get('Authorization') ?? '';
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await caller.auth.getUser();
  const uid = userData?.user?.id;
  if (userErr || !uid) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(supabaseUrl, serviceKey);

  // 2. Remove the caller's storage objects.
  const buckets = mode === 'full'
    ? ['community', 'avatars', 'backups']
    : ['community', 'avatars'];
  for (const bucket of buckets) {
    // Recursive + paginated: handles nested backups media paths <uid>/media/<id>/<hash>.
    const paths = await listAllRecursive(admin, bucket, uid);
    if (paths.length) {
      // Never silently ignore a Storage failure — a partial deletion must surface.
      const { error: rmErr } = await admin.storage.from(bucket).remove(paths);
      if (rmErr) return json({ error: 'storage_delete_failed', bucket }, 500);
    }
  }

  // 3. Community content: posts (their extra photos, likes, shares and counters
  //    cascade), reports and blocks authored/owned by the caller. Every failure
  //    is reported — never a false "done".
  const steps: Array<[string, string, boolean]> = [
    ['posts', 'user_id', false],
    ['reports', 'reporter_id', false],
    ['blocks', 'blocker_id', false],
    ['blocks', 'blocked_id', false],
  ];
  if (mode === 'community') {
    // Leave Community keeps the auth account, so the social rows tied to the
    // profile must go explicitly (a full delete removes them by cascade):
    steps.push(
      ['follows', 'follower_id', true],   // whom the caller follows
      ['follows', 'followee_id', true],   // who follows the caller
      ['likes', 'user_id', true],         // the caller's likes on other posts
      ['reposts', 'user_id', true],       // the caller's shares of other posts
      ['rate_events', 'user_id', true],   // spam-limit activity log
    );
    // Kept on purpose: community_consents (account-level 16+ confirmation, also
    // used by private sync), moderation_actions (a safety record must not be
    // erasable by leaving and rejoining), username_changes (the username stays).
  }
  for (const [table, column, social] of steps) {
    const failed = await deleteRows(admin, table, column, uid, social);
    if (failed) return json({ error: 'db_delete_failed', table: failed }, 500);
  }

  if (mode === 'community') {
    // Phase 2 (migration 0008): friendships, friend requests, chats (messages and
    // read markers cascade), the caller's comments and the search listing. Not
    // there before 0008 or after its rollback — then there is nothing to remove.
    const { error: cleanErr } = await admin.rpc('community_leave_cleanup', { p_user: uid });
    if (cleanErr && cleanErr.code !== 'PGRST202' && cleanErr.code !== '42883') {
      return json({ error: 'db_delete_failed', table: 'community_leave_cleanup' }, 500);
    }
    // Keep the account and the private backup; just clear the public profile bits.
    const { error: profErr } = await admin.from('profiles').update({ bio: '', avatar_path: null }).eq('id', uid);
    if (profErr) return json({ error: 'db_update_failed', table: 'profiles' }, 500);
    return json({ ok: true, mode: 'community' }, 200);
  }

  // 4. Full delete: private backup row (cascade) + the auth user.
  //    profiles and everything referencing them (posts, reports, blocks, follows,
  //    likes, shares, consents, moderation history, rate events) cascade from auth.users.
  const backupFailed = await deleteRows(admin, 'backups', 'user_id', uid, false);
  if (backupFailed) return json({ error: 'db_delete_failed', table: backupFailed }, 500);
  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  if (delErr) return json({ error: 'delete_failed' }, 500);

  return json({ ok: true, mode: 'full' }, 200);
});

async function listAllRecursive(admin: ReturnType<typeof createClient>, bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw new Error('storage_list_failed: ' + bucket + ': ' + error.message);
    if (!data || data.length === 0) break;
    for (const f of data) {
      const path = `${prefix}/${f.name}`;
      if (f && f.id) out.push(path);              // a file
      else out.push(...await listAllRecursive(admin, bucket, path));   // a folder → recurse
    }
    if (data.length < 1000) break;                // last page
    offset += data.length;                        // paginate
  }
  return out;
}

// Deletes the caller's rows; returns the table name on failure, null on success.
// `social` tables come from migration 0005: when they do not exist (before the
// migration, or after its rollback) there is nothing to delete.
async function deleteRows(admin: ReturnType<typeof createClient>, table: string, column: string, uid: string,
                          social: boolean): Promise<string | null> {
  const { error } = await admin.from(table).delete().eq(column, uid);
  if (!error) return null;
  if (social && (error.code === 'PGRST205' || error.code === '42P01')) return null;
  return table;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
