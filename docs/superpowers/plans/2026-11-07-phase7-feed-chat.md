# Phase 7 — ranked feed and viewing leases

Scope: spec sections 8–9 server work; Google setup deferred until last. Branch phase7-feed-chat from dfae83f.
Use existing UI, account isolation, RLS and push targeting. Owner requested all code first, tests at end.
No production inspection, migration, function deployment or push.

Implementation:
- 0018 + rollback: ranked default feed (friends/follows first), aggregate followed-like boost,
  private 30-second chat viewing leases, version10. Existing scopes retain community_feed.
- Version-gated client, explicit missing-RPC rollback fallback, six-language Suggested label,
  20-second heartbeat only in a visible chat; ordered clear on leave/hide/logout.
- Push Edge Function skips viewing recipients except Apple Web Push; old server data defaults to delivery.
- Local SQL/RLS/pagination/rollback tests, browser lifecycle/fallback tests, push decision and transport regressions.

Decisions:
- Boost is five minutes, only in suggested tier. Cursor uses (tier, rank_at, post_id), with a fixed as-of cutoff.
  rank_at is an ordering timestamp, separate from the displayed publication time; no feed snapshots stored.
  Deterministic greedy interleaving defers a third consecutive author while alternatives exist. When only
  that author remains, return their remaining posts rather than hiding content permanently.
- New posts/likes/follows after the cutoff do not enter the current traversal. Removal/block/unfollow can
  still alter a live feed; client deduplication remains in place and refresh starts a new ranking.
- RPC uses invoker RLS. A narrow definer helper exposes only an aggregate boost, never liker identities.
- Presence is per ephemeral viewer, not a single shared user row (one tab cannot clear another tab's lease).
  No client-chosen account or expiry. Expired leases are removed on writes; deleted chats/users cascade.
- Reuse original push_targets via a private v9 helper. Rollback restores the exact original function.
- Branch isolation uses the existing checkout; unrelated untracked icon/design files are untouched.

Status: implementation and review fixes verified locally; uncommitted, no production changes.

Owner release sequence (not executed): publish backward-compatible app first, apply 0018 and reload
PostgREST schema, then deploy push function. Record current v9 settings and a local verified diff before
owner production approval. Rollback: deploy previous push function if needed, apply 0018_down and reload
schema; app falls back. No posts/messages/accounts are deleted by either migration direction.

Review fixes: preserve cooldown only when a notification can be delivered (including Apple); coalesce and
skip obsolete heartbeat renewals, abort optional RPC after5 seconds and bound logout wait to1.5 seconds;
replace whole-payload JSON deletion with a linear index queue over compact ordering columns, fetching
payload for at most50 results. Deep-page work remains a full scalar ranking scan; measure it locally.

## Final verification — 2026-11-09
- Feed/presence SQL, grants, visibility, cursor, rollback and Apple/cooldown: 38/38.
- Browser ranked-feed/fallback/heartbeat lifecycle: 27/27.
- Push suppression decisions: 10/10; existing FCM transport: 25/25.
- Existing native push: 26/26; existing database FCM suite: 34/34.
- Total160 passed; syntax and whitespace checks passed.
- Deep cursor: 985 ms across1829 local posts. Ranking remains a full scalar scan; production-scale load is not verified.
- Local schema restored to v9. Live device/server delivery awaits separately approved release.
- Google OAuth setup/live acceptance stays deferred until last.
