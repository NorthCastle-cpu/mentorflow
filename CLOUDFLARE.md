# MentorFlow on Cloudflare Workers

Branch `cloudflare`. GitHub Pages (`main`) keeps working unchanged until you decide to retire it.

## What is deployed (account `cdea4d600885c30dad767efa7a0c0729`)

| Thing | Value |
| --- | --- |
| Worker | `mentorflow`, at <https://mentorflow.sarah-arissa.workers.dev> (workers.dev only, no custom domain or route yet) |
| D1 database | `mentorflow-db`, id `d24bf757-6036-44b1-8f58-e778cf3a56ce` (schema in `migrations/`) |
| Cron | `0 20,21 * * *`: sends only on the run where it is 21:00 in Europe/London |
| Zero Trust team domain | `mentorflow.cloudflareaccess.com` |
| Login method | One-time PIN (a code is emailed to the address being signed in) |
| Reusable Access policy | **Sarah only**: allow `sarah_arissa@hotmail.co.uk`, 30-day session |
| Access app | `MentorFlow (workers.dev)` → `mentorflow.sarah-arissa.workers.dev` (AUD `e3961f45…2c30`) |
| Access app (pre-staged) | `MentorFlow (mentorflow.saraharissa.com, pre-staged)` (AUD `1ea2c5fb…c320`). It has no DNS or route yet |

## How it works
* `wrangler.jsonc` serves `dist/` as static assets. `/api/*` always runs the Worker first (`run_worker_first`).
* **Two locks:** Cloudflare Access protects the whole hostname. On top of that, every `/api` request is checked in
  `worker/auth.js`: the `Cf-Access-Jwt-Assertion` JWT must be RS256-signed by the team's JWKS, the issuer must be the team
  domain, the AUD must match one of `ACCESS_AUD`, the token must be in date, and the email must be exactly `ALLOWED_EMAIL`.
  If anything is missing (including the config itself), the request is rejected with 401, 403 or 503.
* **Sync** (`src/js/sync.js`, `worker/api.js`): the iPad stays the main copy. Every local write is queued in an IndexedDB
  `outbox`. Deletes become tombstones (`deletedAt`). `POST /api/changes` upserts only when the incoming `updatedAt` is
  newer and returns any newer server copies. `GET /api/changes?since=<seq>` pages through changes using a server-assigned
  sequence number. Settings sync one field at a time.
  **Everything syncs** (students, sessions, tasks, money/expenses, checklists, settings) **except** the Notion token and the
  per-device "sync on/off" choice. Note that the settings include the invoice bank-detail fields (account name, sort code,
  account number). They are synced too, so they are stored in D1 if they are filled in.
* The app only turns sync on when it is served by this Worker (it checks `/api/session`). On GitHub Pages it stays local-only.
* If the Access session has expired, the app shows **Sign in to sync** (on Today and in More › Sync). It opens
  `./api/login` → Access login → back to the app. The service worker never caches or intercepts `/api/` or `/cdn-cgi/`.
* **Digest** (`worker/digest.js`): this covers lessons whose sync time is after the last digest. Lessons edited more than
  3 days before the previous digest are excluded, so a backup restore doesn't email every lesson ever. It builds one
  `.ics` file (METHOD:PUBLISH, Europe/London VTIMEZONE, `UID:<id>@mentorflow`, SEQUENCE, no VALARM) using the same
  `src/js/ics.js` that the app's calendar button uses. Nothing is sent if nothing is new, and the London date is recorded
  so it never sends twice. `GET /api/digest/preview` (signed in) shows what tonight's email would contain.

## Switching the digest on (after Email Routing is set up)
1. Turn on Email Routing for saraharissa.com and add `sarah_arissa@hotmail.co.uk` as a destination address. Sarah must
   click the verification link.
2. In `wrangler.jsonc`, set `"DIGEST_ENABLED": "true"`, then run `npm run deploy`. (Or change just that variable in
   Dashboard › Workers › mentorflow › Settings › Variables.)

## Deploy / develop
```bash
export CLOUDFLARE_ACCOUNT_ID=cdea4d600885c30dad767efa7a0c0729 CLOUDFLARE_API_TOKEN=…   # never commit the token
npm run deploy          # build → apply D1 migrations → wrangler deploy
npm run test:unit       # parser, calendar, worker (auth + merge), sync (two devices via Miniflare), digest
node tests/e2e.mjs all  # needs dist served at http://localhost:8080/mentorflow/
node tests/sync-e2e.mjs all  # browser ↔ real Worker + D1 (Miniflare), Chromium + WebKit
```
