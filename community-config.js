/* ============================================================================
   GymQuest — Community configuration (frontend)
   ----------------------------------------------------------------------------
   This file is loaded BEFORE script.js. Fill in your own Supabase project
   values to turn the OPTIONAL online Community on.

   IMPORTANT — only ever put the PROJECT URL and the PUBLISHABLE (anon) key
   here. They are designed to be public and are safe in frontend code.
   NEVER put the service_role key, a secret key, the database password, or an
   SMTP password in this file, in the repository, or in logs.

   vapidPublicKey is the PUBLIC half of the Web Push (VAPID) key pair used for
   chat notifications (migration 0010). The private half is only a Supabase
   Edge Function secret (VAPID_PRIVATE_KEY) and never belongs here.

   Leave both values empty to keep Community DISABLED: the app then stays
   exactly as before — fully offline, no accounts, no network requests.

   After changing this file you MUST bump CACHE_VERSION in sw.js (and the ?v=
   query strings in index.html) so the service worker re-fetches it.
   ========================================================================= */
window.GYMQUEST_COMMUNITY = {
  supabaseUrl: 'https://mbjbtprkwvoqgqphgudq.supabase.co',
  supabaseAnonKey: 'sb_publishable_JjrKzkL8_uLpogHHjB1Y5g_4Lk1zAv-',
  vapidPublicKey: 'BEufgNF0ky0RK1M8EYhzsrJvt-wvYzoIgI-Xyvq4WZhb5E130D_3fHTJkTQo1LF6-RoMz4kYChbQ-Djg7C4c7vw',
};
