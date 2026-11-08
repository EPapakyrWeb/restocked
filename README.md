# Restocked: back-in-stock email alerts

An embeddable "email me when it's back" form, a webhook receiver, and a notifier that tells each customer **exactly once** when a sold-out product is really back.

- **Zero dependencies.** Node 22 standard library only, with built-in SQLite (`node:sqlite`) for storage.
- **Exactly-once by design.** Duplicate and simultaneous webhooks, phantom restocks, email provider outages and restarts are all handled. There's an end-to-end test suite that proves it against the challenge's own test harness.

Author: **EPMnemon**

---

## Run it

```bash
docker build -t restocked .
docker run -p 3000:3000 \
  -e PORT=3000 \
  -e STOCK_API_URL=... -e STOCK_API_KEY=... \
  -e RESEND_API_KEY=... -e RESEND_BASE_URL=... \
  -e WEBHOOK_SECRET=... -e ADMIN_PASSWORD=... \
  -v restocked-data:/data \
  restocked
```

`-v restocked-data:/data` keeps the database across container *re-creation* (redeploys). A plain `docker restart` keeps it anyway.

Without Docker (Node ≥ 22.13): `npm start`, with the same env vars.

### Environment

| Variable | Required | What it does |
|---|---|---|
| `STOCK_API_URL` | yes | `GET {url}/{sku}` returns `{ quantity, in_stock, ... }`. `GET {url}` returns the catalogue. |
| `STOCK_API_KEY` | yes | Bearer token for the stock API |
| `RESEND_API_KEY` | yes | Bearer token for the email API |
| `RESEND_BASE_URL` | yes | Email API base URL (Resend format, `POST {url}/emails`). Defaults to `https://api.resend.com`. |
| `WEBHOOK_SECRET` | yes | Must match the `X-Webhook-Secret` header. If unset, every webhook is rejected (fail closed). |
| `ADMIN_PASSWORD` | yes | Protects `/admin` (HTTP Basic, any username). If unset, `/admin` is disabled. |
| `PORT` | no | Default `3000` |
| `DATA_DIR` | no | Where the SQLite file lives. Default `/data` in Docker. |
| `EMAIL_FROM` | no | Default `Restocked <onboarding@resend.dev>` |
| `BRAND_NAME` | no | Default `Restocked` |
| `POLL_SECONDS` | no | Safety-net re-check interval for waiting SKUs. Default `60`. |

## Endpoints

| | |
|---|---|
| `GET /embed?sku=SKU&accent=14532d` | The form, made to live in an iframe on any store. With `sku`, it shows the product and only asks for an email. Without it, it asks for the SKU too. Works without JavaScript and reports its height via `postMessage` so the iframe can auto-size. |
| `POST /api/requests` | `{ "email", "sku" }` → `201`. A second *open* request for the same email + SKU → `409`. Bad input → `400`. CORS-enabled. |
| `POST /webhooks/stock` | `{ event_id, sku, quantity, ... }` with `X-Webhook-Secret`. Wrong or missing secret → `401`. Otherwise `200` once the event is on disk, including for duplicates, so the sender stops retrying. |
| `GET /admin` | Password-protected. Every request, its status (waiting / notified / undeliverable), when it was requested and notified, send attempts, last error. Filterable and searchable. Also a webhook log showing what each webhook claimed versus what the stock API said. |
| `GET /` | Product page with a live demo of the embed and the copy-paste snippet. |
| `GET /healthz` | Liveness |

## How customers hear from us once: not zero times, not twice

**Not twice**

1. **The database enforces one open request per customer and product.** It's a partial unique index on `(email, sku) WHERE status IN ('waiting','sending')`, so 20 identical simultaneous submissions produce exactly one row. Email is lower-cased and SKU compared case-insensitively.
2. **Webhook events are deduplicated by `event_id`.** A retry or a simultaneous second delivery hits the primary key, gets counted, and does nothing else.
3. **Atomic claim before sending.** `UPDATE requests SET status='sending' WHERE sku=? AND status='waiting' RETURNING *`. Only one worker can move a row out of `waiting`, so two restock signals for the same SKU can't both email the same person.
4. **Idempotency key per request.** Every send for request *N* uses `Idempotency-Key: restock-request-N`. If a send "fails" after the provider actually delivered it (timeout, connection drop), the retry is deduplicated by the provider instead of producing a second email.

**Not zero**

5. **Webhooks are acknowledged only after they're committed to disk.** The event and a durable "check this SKU" job are written in one transaction before we return `200`. A crash after that point loses nothing.
6. **Failed sends are retried, never dropped.** On 5xx, 429, timeouts or network errors the request goes back to `waiting` and the SKU check is rescheduled with backoff (5 s → 15 min). Each retry re-checks stock first, so if the item sold out again meanwhile, nobody gets a misleading "it's back" email. They wait for the next restock instead. Only a permanent rejection (`400`/`422`) marks a request undeliverable, and it's visible in the admin.
7. **Crash recovery.** On boot, anything stuck in `sending` goes back to `waiting` and is re-checked. The idempotency key (4) covers the case where the crash happened after the provider accepted the email.
8. **Missed webhooks are caught.** Every `POLL_SECONDS`, and on boot, every SKU with waiting customers is re-checked against the stock API. A restock whose webhook never arrived, or arrived while the app was down, still notifies people.

**Don't trust the webhook**

9. **A webhook is only a hint.** It never sends an email by itself. It schedules a stock API check, and the stock API decides. A webhook claiming a restock that the API doesn't confirm ("phantom") emails nobody, and the admin's webhook log shows it as *not confirmed*.
10. **Secrets are compared in constant time** (SHA-256 then `timingSafeEqual`, so length isn't leaked either). Payloads are size-limited and validated.

**The honest edge.** Exactly-once delivery across a network is impossible in the strict sense. This design is at-least-once internally, made effectively-once by the provider's idempotency window. Resend keeps idempotency keys for 24 hours, so a duplicate is only possible if the app crashed mid-send *and* stayed down for over 24 hours.

## Design decisions

- **Everyone waiting is notified on a restock**, not just the first *N* where *N* = quantity. That's standard back-in-stock behaviour, and it means a customer is never silently skipped. Limiting to quantity would be a one-line change in the claim query.
- **A request for an item that's actually in stock** (stale product page) is accepted and the customer is emailed right away. That's better than an error.
- **Notified requests are closed.** If the item sells out and comes back again, the customer isn't re-emailed unless they sign up again. The email says it's one-time.
- **SQLite, single instance.** Correct and durable for a single node. To scale horizontally, swap to Postgres. The same claim query works with `FOR UPDATE SKIP LOCKED`.
- **No cookies, no tracking, honeypot field** on the form. The embed sends `frame-ancestors *`. Admin and every other page send `frame-ancestors 'none'` + `X-Frame-Options: DENY`.

## Tests

`test/e2e.js` boots the challenge's own test harness and this app, then checks:

- invalid input is rejected;
- 20 simultaneous duplicate requests give one 201;
- wrong or missing secret gives 401;
- a phantom restock sends nothing;
- a restock delivered twice at once sends one email per customer;
- the same event sent 10× concurrently sends one email;
- an email API that returns 500 twice still produces exactly one delivered email;
- a request for an in-stock item is emailed once;
- **restart:** the app is SIGKILLed, stock comes back with no webhook while it's down, and the email arrives after boot;
- customers are not re-emailed on a later restock;
- admin auth and anti-framing work;
- the embed is frameable and works without JS.

```bash
git clone https://github.com/yitzi-farla/back-in-stock-challenge /tmp/bis
HARNESS=/tmp/bis/harness/server.js npm test
```

It was also soak-tested against the live simulator for 80 seconds at one event per second, with a hard kill and restart in the middle and three injected email failures:

- 59 emails delivered to 59 notified requests;
- 0 duplicate deliveries;
- 0 customers left waiting on an in-stock product.

## Deploying

- **Railway:** new project from this repo. It builds the Dockerfile. Add a volume mounted at `/data` and set the env vars.
- **Any VPS:** `docker run -d --restart unless-stopped -p 3000:3000 -v restocked-data:/data --env-file .env restocked` behind a reverse proxy with TLS.

## Built with

Claude (Anthropic) as the AI coding assistant.
