# Usage Metering & Tiered Billing

## Status
Draft — July 2026

## Why this, why now

`feat/MCPDB-14/friends-family-mvp` already ships the hard infrastructure part of going remote: Streamable HTTP transport, WorkOS OAuth + DCR (so Claude mobile/web can install the server without manual config), signed session cookies, and a dashboard that lists a user's databases. That branch gets instant-db in front of real users. It does not let anyone pay for it.

The MCPDB-14 epic explicitly deferred billing, audit logs, data export, rate limiting, and account deletion to a "Strangers" milestone — i.e., the milestone where instant-db stops being something you hand to friends and starts being something the public can sign up for and pay. Of those five, **billing is the only one with zero revenue impact if skipped, and the only one nothing else depends on**. Data export and account deletion are prerequisites for billing people fairly (you can't charge someone for data you won't let them leave with or delete), so this spec folds them in as small supporting pieces rather than treating them as separate epics.

Without this feature, every other improvement to the product (backups, teams, Postgres) increases cost with no way to recover it.

## Provider choice: Stripe, and why this costs $0 until someone pays

The only external service this feature needs is a payment processor — usage metering itself is just SQLite counters (see Data model), so it adds no infrastructure cost at all.

**Stripe is free until money moves.** No monthly fee, no minimum, no cost for test mode. It only takes a cut (2.9% + $0.30) on a transaction that actually succeeds. Concretely, at $0 in revenue this integration costs $0 to run:

- Stripe Checkout (hosted payment page) — free
- Stripe Billing Portal (hosted subscription management: cancel, update card, view invoices) — free
- Webhooks — free, unlimited
- Stripe CLI (`stripe listen --forward-to localhost:3000/webhooks/stripe`) for local webhook testing — free, no tunneling service (ngrok etc.) needed

This also means using Stripe Checkout + the Billing Portal instead of building any custom subscription-management UI is the *simpler* path, not just the cheaper one — it deletes an entire category of screens (payment method forms, cancel-flow UI, invoice history) you'd otherwise have to build and secure yourself.

Merchant-of-record alternatives (Lemon Squeezy, Paddle) are worth knowing about because they additionally handle global sales-tax/VAT registration and filing for you, which Stripe does not do automatically (Stripe Tax exists but you still register for it and it has its own per-transaction fee). At single-founder, pre-revenue scale, with likely US-first customers, that complexity isn't worth trading Stripe's simplicity and ecosystem familiarity for yet — revisit if international revenue becomes material.

## Goals

- A user can go from Free → Paid inside the dashboard via Stripe Checkout, and back via the Stripe customer portal.
- Usage (tool calls, storage) is metered per user and enforced before it causes unbounded hosting cost.
- Hitting a limit produces a clear, actionable error inside the Claude conversation itself — not a silent failure.
- Downgrades and cancellations degrade gracefully (read-only, not data loss).
- A user can export all their data and delete their account at any time, unconditionally — this is both an ethical requirement for charging money and a trust feature per `SPECS/remote-hosted-service.md`.

## Non-goals (this pass)

- Usage-based/overage billing (metered billing beyond the plan cap) — hard caps only for v1.
- Team seats / shared billing — single account = single payer.
- Annual plans, coupons, referral credits — add once monthly billing is proven.
- Audit log UI — logging can piggyback on this work's instrumentation, but the searchable dashboard view is a separate ticket.

## Plan tiers

| Resource | Free | Pro (~$10/mo) |
|---|---|---|
| Databases | 3 | Unlimited |
| Storage | 50 MB total | 5 GB |
| Tool calls | 200 / day | 10,000 / day |
| Data export | Always | Always |
| Account deletion | Always | Always |

Numbers are the same order of magnitude as the existing draft in `SPECS/remote-hosted-service.md`; tune before launch based on what real Friends & Family usage looks like (you already have a running instance — pull actual tool-call-per-day numbers before locking these in).

## Data model

Billing/usage state is **control-plane data, not tenant data** — it must not live inside a user's own `_metadata.sqlite` (that file should stay something a user can download and self-host with zero modification, per the data-portability principle already in the hosted-service spec). Add a new file: `data/_accounts.sqlite`, owned by the hosting layer only (this is exactly the kind of thing MCPDB-13 calls "hosting-only").

```sql
CREATE TABLE accounts (
  user_id TEXT PRIMARY KEY,           -- WorkOS user id, already the identity used to scope data/{user_id}/
  email TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',  -- 'free' | 'pro'
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status TEXT,           -- mirrors Stripe: active, past_due, canceled, ...
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE usage_daily (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,                  -- 'YYYY-MM-DD' UTC
  tool_calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE stripe_webhook_events (
  id TEXT PRIMARY KEY,                -- Stripe event id, for idempotency
  received_at INTEGER NOT NULL,
  type TEXT NOT NULL
);
```

Storage usage is not tracked incrementally — it's cheap to compute on demand (`du` over `data/{user_id}/*.sqlite`, or `SUM(page_count * page_size)` via `PRAGMA` per file) and only needs checking on writes, so no running counter is needed and it can't drift.

`_accounts.sqlite` is a plain file on the same Fly volume everything else already lives on — no hosted database service, no ORM, no migration tooling beyond what the project already uses. This is the whole reason the "simplest possible" version of this feature has no new infra line item.

## Architecture

### Where enforcement hooks in

There's already a single chokepoint for every tool call: the `wrap()` helper in `src/logger.ts` that every tool handler goes through for JSONL logging. Usage metering rides the same seam:

```
MCP tool call
   -> transport.ts (existing, per-user scoped via OAuth token)
   -> wrap() [logger.ts]
        -> checkQuota(userId)      // NEW: reject before execution if over limit
        -> execute tool handler
        -> recordUsage(userId)     // NEW: increment usage_daily after success
        -> log JSONL (existing)
```

This means quota logic never touches the tool handlers themselves (`src/tools/*.ts` stay backend-agnostic and OSS-clean, consistent with the MCPDB-13 boundary decision — quota/billing code lives in the hosting layer, not the core server).

### Quota check semantics

- **Tool-call quota**: read `usage_daily` for `(userId, today)`, compare against plan limit. Read-then-increment has an acceptable race under concurrent requests (worst case a user goes a handful of calls over on a given day) — do not add locking for this, it's not worth the complexity for a soft daily cap.
- **Storage quota**: checked only on the operations that can grow storage — `insert_record`, `execute_mutation`, `create_database`, `create_table`. Compute current size, reject if the operation would exceed the cap. This is a hard gate, not a race-tolerant counter, because storage cost is the one dimension that doesn't reset daily.
- **Database count quota**: checked in `create_database` — trivial `COUNT(*)` against the registry.

### Error shape back through MCP

When a call is rejected, the tool handler must still return a valid MCP tool result (not a transport-level error) so Claude can relay it conversationally:

```json
{
  "content": [{
    "type": "text",
    "text": "You've hit the Free plan limit of 200 tool calls today. Upgrade to Pro for 10,000 calls/day: https://instantdb.dev/dashboard/billing"
  }],
  "isError": true
}
```

This is the same pattern `execute_mutation` already uses for rejecting disallowed SQL — no new response convention needed.

### Stripe integration

Extends `src/web-server.ts` (already handles `/auth/*` and `/api/*` routes for the dashboard):

- `POST /api/billing/checkout` — session-gated, creates a Stripe Checkout Session for the Pro price, `client_reference_id = userId`, redirects to Stripe-hosted checkout. No card data ever touches this server.
- `POST /api/billing/portal` — creates a Stripe Billing Portal session for the user's `stripe_customer_id`, so they can cancel/update payment method without any UI you have to build.
- `POST /webhooks/stripe` — unauthenticated (verified via Stripe signature header instead), handles:
  - `checkout.session.completed` → set `plan='pro'`, store `stripe_customer_id`/`stripe_subscription_id`
  - `customer.subscription.updated` → sync `subscription_status`
  - `customer.subscription.deleted` → set `plan='free'`, keep data, apply free-tier enforcement going forward
  - `invoice.payment_failed` → mark `subscription_status='past_due'`; grace period before downgrade (see below)
  - All events written to `stripe_webhook_events` first, keyed by Stripe event id, so retried webhook deliveries are no-ops.

### Downgrade / cancellation behavior

Never delete data on downgrade. If a canceled Pro user has 40 databases and Free allows 3:
- Existing databases become **read-only** (queries succeed, `insert_record`/`execute_mutation`/`create_database`/`create_table` are rejected with the same upgrade-prompt error shape above) until either they upgrade again or they delete databases down to the Free limit themselves.
- This is enforced by the same `checkQuota` — it's a "you're over the limit" state, not a special case.

### Data export & account deletion (supporting scope)

- `GET /api/export` — zips all of a user's `.sqlite` files plus a metadata sidecar JSON (descriptions/notes/field metadata), matching the format already promised in `SPECS/remote-hosted-service.md`. Required before you can ethically take payment — a paying user must be able to leave with their data at any time.
- `POST /api/account/delete` — deletes `data/{user_id}/`, the `_accounts.sqlite` row, cancels any active Stripe subscription via API, revokes WorkOS session. Require typed confirmation in the dashboard UI (same pattern as the existing `delete_database` tool's `confirm: true` guard).

## Security considerations

This feature adds two new attack surfaces that don't exist anywhere else in the codebase today: an unauthenticated webhook endpoint, and a control-plane record (`plan`) that determines how much of the hosting bill a given user can run up. Both deserve more scrutiny than a typical CRUD feature.

**Webhook forgery is the #1 risk.** `/webhooks/stripe` must be publicly reachable (Stripe can't log in to your dashboard), which means it's the one endpoint in this whole feature an attacker can hit directly.
- Verify `Stripe-Signature` on every request using Stripe's SDK helper (`stripe.webhooks.constructEvent`) before touching the payload. Reject anything that fails verification with a 400, do not process it "just to log it."
- Use the **test-mode webhook secret** in dev and **live-mode webhook secret** in prod, stored as Fly secrets (`STRIPE_WEBHOOK_SECRET`) — same pattern already used for `OAUTH_*` secrets in this repo, never committed to `.env` in git.
- The signature check has a timestamp-tolerance window built into Stripe's SDK (rejects old replayed payloads by default) — don't disable it.
- Idempotency via `stripe_webhook_events` (unique constraint on Stripe's event id, insert-or-ignore) — Stripe retries undelivered webhooks, and double-processing `customer.subscription.deleted` must not do anything worse the second time than the first.
- Explicitly allow-list the event `type`s this handler acts on (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`) and ignore everything else rather than trying to handle "whatever Stripe sends."

**The `plan` field must be server-authoritative, full stop.** Nothing in the dashboard or any API request should ever be able to set `accounts.plan` directly — it is written in exactly one place: the webhook handler, after signature verification. `checkQuota` reads it, nothing writes it except that one path. This is the property that makes the whole quota system trustworthy; treat any code path that touches `plan` outside the webhook handler as a bug.

**Scope the Stripe API key.** Use a [restricted key](https://stripe.com/docs/keys#limit-access) with only what this feature needs — write access to Checkout Sessions and Billing Portal Sessions, read access to Customers/Subscriptions — instead of the full secret key. If it ever leaks (log line, error report, misconfigured env), the blast radius is "can't touch funds or other Stripe account settings" instead of full account compromise.

**IDOR check on `/api/billing/portal`.** The Stripe customer id used to create a portal session must be derived server-side from the authenticated session's `user_id` → `accounts` row lookup — never accepted as a request parameter. Otherwise user A could request a portal session for user B's `stripe_customer_id` and manage (or cancel) their subscription.

**No PCI scope.** Checkout and the Billing Portal are both Stripe-hosted redirects — card numbers never touch this server, so there's no PCI-DSS burden to take on.

**Free tier is your DoS exposure.** Because signup requires no payment, a scripted or bot-created account is the realistic abuse case, not a sophisticated exploit. The hard caps (200 calls/day, 50MB, 3 databases) exist specifically to bound worst-case hosting cost per free account to something negligible — treat any proposal to raise those limits as a cost decision, not just a UX one. WorkOS already requires a real OAuth identity to sign up (no anonymous accounts), which is a meaningful deterrent on its own; explicit rate-limiting or CAPTCHA on account creation is not needed for v1 but is the next lever if abuse shows up in practice.

**Downgrade enforcement is a security property, not just a UX nicety.** If a canceled subscription doesn't actually flip enforcement back to Free-tier limits (e.g., a bug lets `checkQuota` keep reading a stale cached plan), you're giving away Pro-tier hosting for free indefinitely. Cover this with a test: cancel → webhook fires → next tool call is measured against Free limits, not just that the dashboard UI shows "Free."

## Phased rollout

Every phase below runs at $0 fixed cost — Stripe in test mode is free, and there's no infra to provision beyond the existing Fly volume.

1. **Meter only, enforce nothing.** Ship `checkQuota`/`recordUsage` behind a flag that logs would-be rejections but never blocks. Run this against real Friends & Family traffic for a week to sanity-check the tier numbers before anyone can be denied service by them. Stripe isn't even involved yet.
2. **Enforce Free tier + add Checkout/Portal/webhooks, in Stripe test mode.** Wire up the full flow — signup, checkout, webhook, quota enforcement — using Stripe test API keys and test card numbers. Costs nothing, proves the whole loop works end to end.
3. **Flip to Stripe live keys.** This is a config change (swap `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` from test to live in Fly secrets, create the live-mode Price object), not a code change. This is the point the product can generate revenue.
4. **Add data export + account deletion**, required before any public/paid announcement beyond friends & family (both a trust requirement and, in most jurisdictions, a legal one once you're charging strangers money).

## Open questions

- Exact price point and whether `$10/mo` beats a `$8` or `$12` anchor — needs no engineering to decide, just a decision before Phase 2.
- Tax handling — Stripe Tax can be turned on with no extra code; decide before first paid invoice, not after.
- Whether "past_due" grace period is 3 days or 7 before auto-downgrade to Free enforcement.
