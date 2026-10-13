// ============================================================================
// GymQuest — Edge Function: reminders
// ----------------------------------------------------------------------------
// Sends the water / meal / workout reminders (migration 0012). Called ONLY by the
// database: pg_cron runs reminders_dispatch() every 5 minutes, which POSTs here
// with the header x-gq-reminder: <REMINDER_SECRET>. There is no user JWT, so the
// function is deployed with JWT verification off and checks the shared secret
// itself (constant-time). reminders_due() (service_role only) decides who is due
// and marks it as sent in the same call, so a reminder is never sent twice.
// Notifications are encrypted per device and signed with VAPID like `push`
// (same webpush.ts module, same push-service allow list).
//
// Secrets (function secrets, never in the repo): REMINDER_SECRET (≥ 32 chars; the same
// value is stored in Vault as gq_reminders_secret), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT (shared with `push`).
// Deploy: supabase functions deploy reminders --no-verify-jwt
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendPush, type Vapid } from '../push/webpush.ts';

const TEXT: Record<string, Record<string, string>> = {
  water: {
    sk: '💧 Čas napiť sa vody', en: '💧 Time to drink some water', es: '💧 Hora de beber agua',
    'pt-BR': '💧 Hora de beber água', fr: '💧 C’est le moment de boire de l’eau', ar: '💧 حان وقت شرب الماء',
  },
  meal: {
    sk: '🍽️ Čas na jedlo', en: '🍽️ Time to eat', es: '🍽️ Hora de comer',
    'pt-BR': '🍽️ Hora de comer', fr: '🍽️ C’est l’heure de manger', ar: '🍽️ حان وقت الأكل',
  },
  workout: {
    sk: '🏋️ Dnes je tréningový deň – poď na to!', en: '🏋️ It’s workout time – let’s go!', es: '🏋️ ¡Hora de entrenar, vamos!',
    'pt-BR': '🏋️ Hora de treinar – bora!', fr: '🏋️ C’est l’heure de l’entraînement – on y va !', ar: '🏋️ حان وقت التمرين – هيا بنا!',
  },
};

function allowedEndpoint(endpoint: string): boolean {
  const testPrefix = Deno.env.get('PUSH_TEST_ENDPOINT_PREFIX');
  if (testPrefix && endpoint.startsWith(testPrefix)) return true;
  let u: URL;
  try { u = new URL(endpoint); } catch (_e) { return false; }
  if (u.protocol !== 'https:' || u.port !== '') return false;
  const h = u.hostname.toLowerCase();
  return h === 'fcm.googleapis.com' || h === 'android.googleapis.com'
    || h === 'push.apple.com' || h.endsWith('.push.apple.com')
    || h === 'push.services.mozilla.com' || h.endsWith('.push.services.mozilla.com')
    || h.endsWith('.notify.windows.com');
}

function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const secret = Deno.env.get('REMINDER_SECRET') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const vapid: Vapid = {
    publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
    privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
    subject: Deno.env.get('VAPID_SUBJECT') ?? '',
  };
  if (secret.length < 32 || !serviceKey || !vapid.publicKey || !vapid.privateKey || !vapid.subject) return json({ error: 'server_not_configured' }, 500);
  if (!sameSecret(req.headers.get('x-gq-reminder') ?? '', secret)) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  const { data, error } = await admin.rpc('reminders_due');
  if (error) return json({ error: 'db_error' }, 500);
  const targets = Array.isArray(data) ? data.slice(0, 5000) : [];
  let sent = 0, gone = 0, failed = 0, skipped = 0;
  const jobs: Promise<void>[] = [];
  for (const t of targets) {
    const kinds: string[] = Array.isArray(t.kinds) ? t.kinds.filter((k: string) => TEXT[k]) : [];
    const subs = (Array.isArray(t.subs) ? t.subs : []).slice(0, 10);
    for (const s of subs) {
      if (!allowedEndpoint(s.endpoint)) { skipped++; continue; }
      for (const kind of kinds) {
        jobs.push((async () => {
          const payload = { type: 'reminder', kind, title: 'GymQuest', body: (TEXT[kind][s.lang] || TEXT[kind].en), tag: 'gq-reminder-' + kind };
          try {
            const status = await sendPush(s, payload, vapid, { ttl: 1800, urgency: 'normal', topic: 'reminder' + kind });
            if (status >= 200 && status < 300) sent++;
            else if (status === 404 || status === 410) { gone++; await admin.rpc('push_gone', { p_endpoint: s.endpoint }); }
            else failed++;
          } catch (_e) { failed++; }
        })());
      }
    }
  }
  await Promise.all(jobs);
  return json({ users: targets.length, sent, gone, failed, skipped });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
