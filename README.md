# Physiotherapy Treatment at Home — Appointment Enquiry System

An appointment-enquiry assistant for **Physiotherapy Treatment at Home** (Jayanagar, Bengaluru). It includes:

- a website chatbot (a standalone page plus a one-line embed for the clinic's existing site)
- a conversational appointment-request flow with consent, a review step and a reference number
- answers to common questions, drawn only from verified business facts
- a secure staff dashboard to search, review, confirm, reschedule, cancel, add notes, export and delete records
- staff email notifications, with delivery logging and retry
- a PostgreSQL database, migrations, retention scripts and automated tests

> **A request is not a booking.** Patients only ever see "Confirmed" once a staff member sets that status in the dashboard.

---

## 1. How it works

```
Clinic website ──<script src=/widget.js>──▶ iframe /embed ─┐
Standalone page  /  ─────────────────────────────────────┤
                                                         ▼
                                POST /api/chat  (rate-limited, server-side state)
                                         │
              ┌──────────────────────────┼───────────────────────────┐
              ▼                          ▼                           ▼
   Safety rules (urgent /       Conversation engine           Optional AI (Groq):
   medical-advice detection)    (src/lib/chat/engine.ts)      intent label ONLY,
   always run first             FAQ answers from              never writes replies
                                src/lib/business.ts
                                         │
                                         ▼
                         submitEnquiry(): validate → save → reference → notify
                                         │                           │
                                         ▼                           ▼
                                   PostgreSQL                 Email (SMTP / test)
                                         ▲                    logged + retryable
                                         │
                     /dashboard (staff login, roles, audit log)
```

**Why the AI is limited.** The assistant must never invent prices, service areas, credentials or medical advice. If you enable Groq, it only sorts a free-text message into one of a fixed list of intents. Every reply comes from verified templates in `src/lib/chat/faq.ts` and `src/lib/chat/engine.ts`. If the AI is off, slow or failing, the assistant keeps working on rules alone.

| Folder | Purpose |
|---|---|
| `src/lib/business.ts` | **The only source of clinic facts.** Edit this file once the clinic confirms prices, areas or services. |
| `src/lib/chat/` | Conversation engine, FAQ, safety rules, session store |
| `src/lib/enquiries/service.ts` | Saving enquiries, status changes, notes, search, export, metrics |
| `src/lib/notify/` | Email transport, message templates, delivery log and retry |
| `src/lib/auth/` | Staff login (bcrypt), signed session cookie, roles, lockout |
| `src/middleware.ts` | Protects the dashboard, sets CSP and frame-ancestors |
| `src/app/` | Pages (`/`, `/embed`, `/privacy`, `/dashboard/*`) and API routes |
| `public/widget.js` | Embed launcher for the clinic website |
| `drizzle/` | SQL migrations |
| `scripts/` | Migrate, create staff, retention purge, notification retry |
| `tests/`, `e2e/` | Vitest (against real Postgres) and Playwright tests |

---

## 2. Local setup

Requires Node 20+ and PostgreSQL 14+.

```bash
npm install
cp .env.example .env               # then edit values (see section 4)
createdb physio_dev                 # or use any Postgres URL
npm run db:migrate
npm run staff:create -- --email you@clinic.example --name "Your Name" --role ADMIN   # prompts for password
npm run dev                         # http://localhost:3000
```

- Patient chat: `http://localhost:3000`
- Staff dashboard: `http://localhost:3000/dashboard`

Passwords must be at least 12 characters and include upper case, lower case and a number. Five wrong attempts lock the account for 15 minutes.

---

## 3. Deploying

The app is a standard Next.js server and needs a Node runtime plus PostgreSQL.

**Recommended:** Vercel, Render or Railway for the app, and Supabase or Neon (Postgres) for the database, all in an India region where available.

1. Create a Postgres database. Use a dedicated role that has rights only on this database, and set `DATABASE_SSL=true`.
2. Set every variable from `.env.example` in the host's secret settings. **Never commit `.env`.**
3. Build with `npm ci && npm run build`. Run migrations once per release with `npm run db:migrate`.
4. Start with `npm start` (or let the platform's Next.js preset do it).
5. Create staff accounts with `npm run staff:create` against the production `DATABASE_URL`.
6. Schedule these jobs:
   - `npm run notifications:retry` every 10–15 minutes (retries failed staff emails, up to 5 attempts)
   - `npm run retention:purge` daily (use `--dry-run` first)
7. Point an uptime monitor at `GET /api/health`.
8. Add the embed snippet to the clinic website (section 5).

**Scaling note:** rate limiting is held in memory, per instance. On a multi-instance or serverless deployment, swap `src/lib/ratelimit.ts` for a Redis/Upstash-backed limiter; the interface is one function.

---

## 4. Environment variables

All variables are listed with placeholders in `.env.example`. The main ones:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `SESSION_SECRET`, `CHAT_TOKEN_SECRET` | yes | 32+ random characters each (`openssl rand -base64 48`) |
| `APP_URL` | yes | Public URL; used in email links and the embed snippet |
| `ALLOWED_EMBED_ORIGINS` | for embed | The clinic website origin(s), comma-separated |
| `EMAIL_MODE` | yes | `disabled`, `test` (logged, never delivered) or `smtp` |
| `SMTP_*`, `EMAIL_FROM`, `STAFF_NOTIFICATION_EMAILS` | for email | Recipients must come from the clinic. **No clinic email address is assumed.** |
| `AI_PROVIDER`, `GROQ_API_KEY`, `GROQ_MODEL` | optional | Leave `AI_PROVIDER=none` for rule-only mode |
| `RETENTION_DAYS` | optional | Default 365 |
| `MAX_ADVANCE_BOOKING_DAYS` | optional | Default 90 |

Secrets are read only on the server (`src/lib/env.ts`). No secret is ever sent to the browser.

---

## 5. Adding the chat to the clinic website

Add this line just before `</body>` on the clinic site, replacing the domain with yours:

```html
<script src="https://YOUR-APP-DOMAIN/widget.js" defer></script>
```

Then set `ALLOWED_EMBED_ORIGINS=https://physiotherapytreatmentathome.com,https://www.physiotherapytreatmentathome.com`.

The widget adds a floating "Book a home visit" button that opens the chat in an iframe. Patient data never touches the host page. On phones the chat opens full-screen. If the chat fails to load, the panel shows the clinic's phone number. The exact snippet is also shown in **Dashboard → Setup & status**.

---

## 6. Staff dashboard

| Feature | Who |
|---|---|
| View and search requests (name, phone, reference, locality, status, preferred-date range) | Staff, Admin |
| Update status (the 7 statuses), add internal notes, call or WhatsApp the patient | Staff, Admin |
| See notification failures and retry them | Staff, Admin |
| Export CSV (formula-injection safe; every export is audited) | Admin |
| Permanently delete a patient record (typed confirmation; audited) | Admin |
| Setup & status page, audit log | Admin |

Statuses: New Enquiry → Awaiting Clinic Review → Awaiting Patient Response → Confirmed → Completed, plus Reschedule Requested and Cancelled. Patients who check their status see plain-language text, and the word "confirmed" appears only for **Confirmed**.

---

## 7. Privacy, safety and retention

- **Collects only:** name, phone, preferred date and time, locality, a short reason in the patient's own words, therapist preference, and the consent timestamp. No ID numbers, payment details or medical records.
- **Explicit consent** is required before anything is saved. The consent text is stored with each enquiry. If the patient declines, nothing is stored.
- **Urgent symptoms** (chest pain, breathing difficulty, stroke signs, severe bleeding and so on) override every flow with advice to call 112 or 108.
- **Requests for diagnosis, exercises, medicines or predicted outcomes** are declined politely.
- **Staff emails** contain only what the brief specified, with the reason capped at 200 characters.
- **Chat drafts** expire after 24 hours. Closed enquiries are deleted after `RETENTION_DAYS` by the purge job. Open requests are never auto-deleted.
- **The privacy notice** is at `/privacy`. The clinic should review it, and the retention period, with its own adviser.
- **Security:** bcrypt password hashes; HS256 session cookies (httpOnly, SameSite=Strict, 8-hour expiry); every request re-checks the database, so deactivating a user takes effect immediately; account lockout; login and chat rate limits; strict CSP and frame-ancestors; `no-store` and `noindex` on the dashboard; parameterised SQL throughout.

---

## 8. Tests

```bash
# Unit + integration (needs a Postgres test DB; default URL is in tests/setup.ts or set TEST_DATABASE_URL)
npm test

# End-to-end (against a running build)
npm run build && npm start &
E2E_STAFF_EMAIL=you@clinic.example E2E_STAFF_PASSWORD=... npm run test:e2e
# optional: E2E_HOST_PAGE=<a page that includes widget.js>  E2E_SHOTS_DIR=<folder for screenshots>
```

| Brief scenario | Covered by |
|---|---|
| 1. Complete enquiry | `tests/enquiry-flow.test.ts` §1, `e2e/booking.spec.ts` |
| 2. Incomplete or invalid details | §2 + `tests/validation.test.ts` |
| 3. Date not verified | §3/4 ("preference only") |
| 4. Clinic hasn't confirmed | §3/4 (status stays "not yet confirmed" until staff confirm) |
| 5. Duplicate event | §5: concurrent duplicate submits produce one enquiry and one notification (idempotency key). *WhatsApp webhook de-duplication applies once WhatsApp is built.* |
| 6. Notification fails | §6: enquiry kept, failure logged, retry succeeds |
| 7. Cancel or reschedule | §7 |
| 8. Unknown prices or services | §8: standard fallback, no invented answers |
| 9. Medical diagnosis | §9 (plus urgent-symptom handling) |
| 10. Unauthorised dashboard access | `tests/security.test.ts`, `e2e/booking.spec.ts` |
| 11. Credentials missing | §11: email `disabled`/missing SMTP shown as NOT_CONFIGURED; AI off/failing falls back to rules |
| 12. Database down | `tests/http.test.ts`: chat returns 503 with the phone fallback; submission is never falsely acknowledged |

---

## 9. Status checklist

### ✅ Built and tested locally
- Chat flow, FAQ, safety rules, consent, summary/edit, reference numbers: 76 Vitest tests against a real PostgreSQL 16 database
- Staff login, roles, lockout, dashboard search, status changes, notes, CSV export, delete
- Notification logging, failure handling, retry (with a simulated failing provider)
- Embed widget on a separate origin, desktop and mobile layouts: 6 Playwright tests in Chromium
- Production build (`next build`), typecheck and lint all clean

### ⚙️ Built, but needs credentials before it is live (currently **not** live)
- **Staff email:** set `EMAIL_MODE=smtp`, SMTP credentials, `EMAIL_FROM` and the clinic-provided `STAFF_NOTIFICATION_EMAILS`. Not verified against a real mail server.
- **Groq AI intent detection:** set `AI_PROVIDER=groq` and `GROQ_API_KEY`. Never called against the live Groq API in testing.

### 📝 Remaining setup tasks
- [ ] Choose hosting and a database, set production secrets, run migrations
- [ ] Create real staff accounts
- [ ] Get staff notification email address(es) from the clinic
- [ ] Add the embed snippet to physiotherapytreatmentathome.com and set `ALLOWED_EMBED_ORIGINS`
- [ ] Schedule `notifications:retry` and `retention:purge`
- [ ] Clinic to confirm, before they're added to `src/lib/business.ts`: prices, home-visit service areas, list of treatments, therapist details and qualifications
- [ ] Clinic to review the privacy notice and retention period
- [ ] Replace the in-memory rate limiter with Redis if running more than one instance

### ⏸ Not built (by decision)
- **WhatsApp Business Platform.** Email-only was chosen for this phase. When it's added, it needs the official Cloud API or an authorised provider, webhook signature verification, de-duplication, opt-out handling and approved templates. The clinic's existing number is **not** assumed to be connected.
