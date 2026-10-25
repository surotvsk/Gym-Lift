// ============================================================================
// GymQuest — Edge Function: push
// ----------------------------------------------------------------------------
// Sends a Web Push notification "New message from <username>" to the friend's
// registered devices after the caller sent a chat message (migration 0010).
//
//   POST { action: 'send', message: <messages.id> }   (caller's JWT required)
//
// The database decides everything (push_targets, service_role only): the message
// must be the caller's own, at most 10 minutes old, in an open chat without a
// block, and not yet notified — so a message is never notified twice and nobody
// can make the function notify anyone else. Quick follow-up messages in the same
// chat (within 20 seconds) are grouped into the notification already shown. The notification carries only the
// sender's username and the chat id, never the message text. Payloads are
// encrypted for each device (RFC 8291) and signed with VAPID (RFC 8292).
// Only the well-known browser push services are contacted.
//
// Android app (migration 0016): push_targets() also returns FCM tokens ("fcm"); they get the same
// notification through Firebase Cloud Messaging (fcm.ts), when FCM_SERVICE_ACCOUNT is set.
// Secrets (set once by the project owner, never in the repo):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   base64url P-256 key pair; the public key is
//                                         also in community-config.js (vapidPublicKey)
//   VAPID_SUBJECT                         contact URL, e.g. https://surotvsk.github.io/Gymquest/
//   FCM_SERVICE_ACCOUNT                   Firebase service-account JSON (optional; without it no FCM)
// Deploy: supabase functions deploy push   (verify_jwt stays on)
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendPush, type Vapid } from './webpush.ts';
import { deliverFcm, fcmConfig } from './fcm.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TEXT: Record<string, string> = {
  sk: 'Nová správa od {name}',
  en: 'New message from {name}',
  es: 'Nuevo mensaje de {name}',
  'pt-BR': 'Nova mensagem de {name}',
  fr: 'Nouveau message de {name}',
  ar: 'رسالة جديدة من {name}',
};

/* Only real browser push services (no requests to arbitrary URLs). A local test stack may
   add one extra prefix through PUSH_TEST_ENDPOINT_PREFIX; production never sets it. */
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const vapid: Vapid = {
    publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
    privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
    subject: Deno.env.get('VAPID_SUBJECT') ?? '',
  };
  if (!serviceKey || !vapid.publicKey || !vapid.privateKey || !vapid.subject) return json({ error: 'server_not_configured' }, 500);

  const body = await req.json().catch(() => ({}));
  const message = Number(body && body.message);
  if (!body || body.action !== 'send' || !Number.isSafeInteger(message) || message <= 0) return json({ error: 'bad_request' }, 400);

  // The caller comes from their JWT, never from the body.
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: userData, error: userErr } = await caller.auth.getUser();
  const uid = userData?.user?.id;
  if (userErr || !uid) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(supabaseUrl, serviceKey);
  const { data, error } = await admin.rpc('push_targets', { p_sender: uid, p_message: message });
  if (error) return json({ error: 'db_error' }, 500);
  if (!data || data.ok !== true) return json({ sent: 0, reason: (data && data.reason) || 'not_allowed' });

  const conv = String(data.conversation);
  const name = String(data.sender_name || '').slice(0, 40);
  const subs = (Array.isArray(data.subs) ? data.subs : []).slice(0, 10);
  let sent = 0, gone = 0, failed = 0, skipped = 0;
  await Promise.all(subs.map(async (s: { endpoint: string; p256dh: string; auth: string; lang: string }) => {
    if (!allowedEndpoint(s.endpoint)) { skipped++; return; }
    const text = (TEXT[s.lang] || TEXT.en).replace('{name}', name);
    const payload = { type: 'chat', title: 'GymQuest', body: text, conv, tag: 'gq-chat-' + conv };
    try {
      const status = await sendPush(s, payload, vapid, { ttl: 86400, urgency: 'high', topic: conv.replace(/-/g, '') });
      if (status >= 200 && status < 300) sent++;
      else if (status === 404 || status === 410) { gone++; await admin.rpc('push_gone', { p_endpoint: s.endpoint }); }
      else failed++;
    } catch (_e) { failed++; }
  }));
  // Android app (0016): the same notification through FCM; off without FCM_SERVICE_ACCOUNT.
  const fcm = fcmConfig((k) => Deno.env.get(k), supabaseUrl);
  if (fcm && Array.isArray(data.fcm) && data.fcm.length) {
    const r = await deliverFcm(data.fcm, name, conv, fcm, (token) => admin.rpc('push_fcm_gone', { p_token: token }));
    sent += r.sent; gone += r.gone; failed += r.failed;
  }
  return json({ sent, gone, failed, skipped });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
