// ============================================================================
// GymQuest — Firebase Cloud Messaging (HTTP v1) sender for the Android app, WebCrypto only.
// ----------------------------------------------------------------------------
// The Android app cannot use Web Push; it registers an FCM token (migration 0016). The `push`
// function sends to those tokens here, after Web Push. Authentication: a Google OAuth access
// token from the project's service account (RS256 JWT, scope firebase.messaging), cached until
// it expires. Each notification carries only the sender's username and the chat id, never the
// message text (same rule as 0010). Runs in Supabase Edge Functions (Deno) and in Node >= 22
// (tests/social/push-fcm-ef.js imports this file against a local mock of Google's endpoints).
//
// Secret (function secret, never in the repo): FCM_SERVICE_ACCOUNT = the service-account JSON
// from Firebase (project settings → service accounts → generate key). Without it FCM is off and
// the function sends Web Push only. FCM_TOKEN_URL / FCM_SEND_URL are read ONLY when
// SUPABASE_URL is a local stack (tests); production always talks to Google.
// ============================================================================

export type FcmConfig = {
  projectId: string;
  clientEmail: string;
  privateKeyPem: string;
  tokenUrl: string;
  sendUrl: string;
};
export type FcmTarget = { token: string; lang: string };
export type FcmResult = { sent: number; gone: number; failed: number };

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const MAX_TOKENS = 10;

const TEXT: Record<string, string> = {
  sk: 'Nová správa od {name}',
  en: 'New message from {name}',
  es: 'Nuevo mensaje de {name}',
  'pt-BR': 'Nova mensagem de {name}',
  fr: 'Nouveau message de {name}',
  ar: 'رسالة جديدة من {name}',
};

function isLocal(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === '127.0.0.1' || h === 'localhost' || h === 'kong' || h === 'host.docker.internal';
  } catch (_e) { return false; }
}

/* null = FCM off (no or unusable secret). */
export function fcmConfig(env: (k: string) => string | undefined, supabaseUrl: string): FcmConfig | null {
  let sa: { project_id?: string; client_email?: string; private_key?: string };
  try { sa = JSON.parse(env('FCM_SERVICE_ACCOUNT') || ''); } catch (_e) { return null; }
  if (!sa || !sa.project_id || !sa.client_email || !sa.private_key || !/BEGIN PRIVATE KEY/.test(sa.private_key)) return null;
  const local = isLocal(supabaseUrl);
  const tokenUrl = (local && env('FCM_TOKEN_URL')) || GOOGLE_TOKEN_URL;
  const sendTpl = (local && env('FCM_SEND_URL')) || 'https://fcm.googleapis.com/v1/projects/{project}/messages:send';
  return { projectId: sa.project_id, clientEmail: sa.client_email, privateKeyPem: sa.private_key, tokenUrl,
    sendUrl: sendTpl.replace('{project}', encodeURIComponent(sa.project_id)) };
}

const enc = new TextEncoder();
function b64u(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function signedAssertion(cfg: FcmConfig, nowSec: number): Promise<string> {
  const header = b64u(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64u(enc.encode(JSON.stringify({ iss: cfg.clientEmail, scope: SCOPE, aud: cfg.tokenUrl, iat: nowSec, exp: nowSec + 3600 })));
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(cfg.privateKeyPem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(header + '.' + claims)));
  return header + '.' + claims + '.' + b64u(sig);
}

const cache = new Map<string, { token: string; exp: number }>();
/* Google OAuth access token for FCM, reused until a minute before it expires. */
export async function fcmAccessToken(cfg: FcmConfig, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = cfg.clientEmail + '|' + cfg.tokenUrl;
  const hit = cache.get(key);
  if (hit && nowSec < hit.exp - 60) return hit.token;
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await signedAssertion(cfg, nowSec) });
  const res = await fetch(cfg.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  if (!res.ok) throw new Error('fcm_token_' + res.status);
  const j = await res.json();
  if (!j || typeof j.access_token !== 'string') throw new Error('fcm_token_invalid');
  cache.set(key, { token: j.access_token, exp: nowSec + (Number(j.expires_in) || 3600) });
  return j.access_token;
}

/* true = FCM says this token no longer exists (app uninstalled, data cleared). */
async function isUnregistered(res: Response): Promise<boolean> {
  if (res.status === 404) return true;
  if (res.status !== 400) return false;
  try {
    const j = await res.json();
    return ((j && j.error && j.error.details) || []).some((d: { errorCode?: string }) => d && d.errorCode === 'UNREGISTERED');
  } catch (_e) { return false; }
}

/* Sends "New message from <name>" (recipient's language) to at most 10 tokens. onGone(token) is
   awaited for every token FCM reports as unregistered (the caller deletes it). Never throws. */
export async function deliverFcm(targets: FcmTarget[], name: string, conv: string, cfg: FcmConfig,
  onGone: (token: string) => Promise<unknown>, nowSec?: number): Promise<FcmResult> {
  const list = (Array.isArray(targets) ? targets : []).filter((t) => t && typeof t.token === 'string' && t.token).slice(0, MAX_TOKENS);
  const out: FcmResult = { sent: 0, gone: 0, failed: 0 };
  if (!list.length) return out;
  let access: string;
  try { access = await fcmAccessToken(cfg, nowSec); } catch (_e) { out.failed = list.length; return out; }
  await Promise.all(list.map(async (t) => {
    const body = (TEXT[t.lang] || TEXT.en).replace('{name}', String(name || '').slice(0, 40));
    const message = {
      token: t.token,
      data: { type: 'chat', conv },
      android: {
        priority: 'HIGH',
        collapse_key: conv,
        ttl: '86400s',
        notification: { title: 'GymQuest', body, tag: 'gq-chat-' + conv, channel_id: 'messages', icon: 'ic_stat_gq' },
      },
    };
    try {
      const res = await fetch(cfg.sendUrl, { method: 'POST', headers: { Authorization: 'Bearer ' + access, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }) });
      if (res.ok) out.sent++;
      else if (await isUnregistered(res)) { out.gone++; try { await onGone(t.token); } catch (_e) { /* best effort */ } }
      else out.failed++;
    } catch (_e) { out.failed++; }
  }));
  return out;
}
