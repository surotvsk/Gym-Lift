# Account emails — verification (signup confirmation, resend, password reset)

Two parts:

- **`run-auth.js`** — automated, real Chrome over the DevTools protocol, local or deployed app, live
  Supabase. Uses **only** the disposable test accounts of `tests/sync` (same `GQ_CREDS_DIR`,
  `GQ_TEST_IDS`, `GQ_PROTECTED_IDS`, `GQ_WORK`, `GQ_BASE`). It never sends email to an undeliverable
  address: failure / rate-limit / offline paths substitute the Auth response inside the browser, and
  reset/sign-in links come from `GQ_GENLINK`, a local helper (kept outside the repo) that creates a link
  with the admin "generate link" call — no email is sent — and writes it to a file.
- **`inbox-e2e.js`** — manual, step by step, with **one inbox the project owner authorized**
  (`GQ_INBOX_EMAIL`). Emails are triggered through the normal GymQuest forms; a person checks Inbox /
  Spam / All Mail and clicks the links on the same PC (the local app at `http://localhost:8124/` must
  be in the Auth redirect allow list). Links, tokens and passwords are never printed; the new password
  for the reset step is written to a file in `GQ_CREDS_DIR` for the person to type.

## Permanent production test accounts — NEVER DELETE

`gqsync-c`, `gqsocial-a` and `gqsocial-b` are permanent production test accounts for ongoing GymQuest
development. **Never delete them** and never use them for full account deletion ("Delete my account",
`delete-account` mode `full`) or for injected-failure tests. Full deletion and failure-injection tests
run only with disposable **local** accounts on the local Supabase stack (`tests/social/delete-account.js`).
Do not create another production account without separate approval. Their credentials live outside
the repository.

```powershell
node tests/auth/run-auth.js                       # or a filter: node tests/auth/run-auth.js "H/I/J"
node tests/auth/inbox-e2e.js serve                # keep running while links are clicked
$env:GQ_SERVER_RUNNING = '1'
node tests/auth/inbox-e2e.js signup               # -> check inbox, do not click yet
node tests/auth/inbox-e2e.js resend               # after 60 s -> check inbox; click old link, then new
node tests/auth/inbox-e2e.js verify-confirmed
node tests/auth/inbox-e2e.js reset                # -> check inbox; open link once, set the password, reopen it
node tests/auth/inbox-e2e.js verify-reset
```

"Request accepted" (HTTP 200 + Auth timestamps), "handed to the email provider" (no send error in the
Auth log; Supabase fails the request if SMTP rejects it) and "received in the inbox" (a person saw it)
are reported separately — only the last one proves delivery.

## Results — v46 (2026-10-10)

Automated (`run-auth.js`): **55 / 55 passed** on the local build. Scenario L fails on v44 and
scenario M on v45 (a double-click sent two requests); both pass from v46.

| Scenario | What it proves |
|---|---|
| E | rate limit (with the wait time), provider send failure and offline show truthful messages for signup, resend and reset — never a false "sent"; invalid email / short password refused before any request; 60 s cooldown sends no request |
| F | signing up an already-registered email shows the same neutral message, creates no session, sends no email, leaves the password unchanged |
| K | reset for an unknown address and for an existing account look identical |
| H / I / J | reset link opens the GymQuest set-password form and clears the tokens from the address bar; short password refused; new password works, old one does not, normal sign-in works; reused and tampered links show the "invalid or expired, nothing changed" page offering a new reset or confirmation link |
| R | a `token_hash` reset link (the Reset Password template) survives a plain prefetch and a scanner that runs the page: it only shows the form, the token is used on *Set password*; the account is signed in and bound to its workspace; reuse ends on the invalid/expired page with the password unchanged |
| C | an email sign-in link returns to GymQuest and signs in the intended account in its own workspace |
| L | a real mouse double-click on *Resend confirmation email*, *Send link* (reset) and *Set password* sends exactly one request; the button is disabled while it runs and restored after success (cooldown / result view), failure, a 30 s no-response timeout, or closing and reopening the dialog |
| M | a real mouse double-click on *Sign up* sends exactly one signup request (success path against the server with an already-confirmed test account, which gets no email); the button is disabled while it runs, also after a re-render, and enabled again after success, failure or the timeout |

Real inbox (`inbox-e2e.js`, one authorized Gmail address; v44 local build, and one reset on the live
v44 site):

| Step | Accepted | Received | Link behaviour |
|---|---|---|---|
| A signup | yes (`POST /signup 200`) | Inbox, ~1 min | after the resend: rejected, "invalid or expired" page, nothing changed |
| D resend (after cooldown) | yes (`POST /resend 200`) | Inbox, ~1 min | confirmed the account, "email confirmed", signed in, address bar clean |
| B confirmed account | — | — | password sign-in and GymQuest sign-in return the intended account and its workspace |
| G reset | yes (`POST /recover 200`) | Inbox, ~1 min | set-password form; password updated; reopening the link rejected |
| I after reset | — | — | old password refused, new password works, normal GymQuest sign-in works |
