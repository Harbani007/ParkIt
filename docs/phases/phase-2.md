# Phase 2 plan: Backend API with JWT authentication

Branch: `phase-2/backend-api`. Backend only: no frontend changes, no AWS resources created by
agents. Contract: `docs/api.md` exactly as written in Phase 1; rules D1-D20 from
`docs/requirements.md` (as revised after the Phase 1 review). **No API change is planned.** If an implementer finds a gap, they stop and
the change goes into `docs/api.md` first (CLAUDE.md rule), as a separate `docs` task.

## Scope

1. **Auth**: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`; bcryptjs
   (cost 10) and jsonwebtoken (`sub` = user id as string, `role`, `expiresIn` = `JWT_EXPIRES_IN`).
2. **Middleware**: `requireAuth`, `requireRole(...roles)`, `validate({ body, query, params })` with
   zod. Express 5 makes `req.query` a getter, so parsed values go on `req.valid.{body,query,params}`
   and are never assigned back to `req.query`. Zod errors become `400 { error: "Validation failed",
   details: [{ path, message }] }`.
3. **Facility and slots**: `GET /api/facility`, `GET /api/slots/availability` (price per slot is
   the quote, D16).
4. **Bookings**: create (booking + simulated `paid` payment + QR in one transaction), mine, get one,
   cancel (payment to `refunded`).
5. **Postgres error mapping** (one module, used by the error handler):
   - `23P01` with `constraint = 'bookings_no_vehicle_overlap'` → 409 `"This vehicle already has a
     booking at that time"`; `bookings_no_slot_overlap` (named in 002) → 409 `"This slot was just
     booked for that time"`. Branch on `err.constraint` only.
   - `23505`: `users_email_key` → 409 `"Email already registered"`; `slots_facility_id_code_key` →
     409 `"Slot code already used"`; other → 409 `"Already exists"`.
   - `23503` on deleting a slot → 409 `"Slot has bookings; block it instead"` (D13, race-safe).
   - `23514` → 400 (backstop only; validation should catch it first).
6. **QR**: `qrcode` package renders a PNG of the booking code only (D19); stored through
   `services/storage.js` local driver under key `qr/<32 hex chars>.png` from `crypto.randomBytes(16)`;
   `qr_url` = `/api/files/qr/<hex>.png`. `GET /api/files/*key` serves it (local driver only).
7. **Admin**: slot CRUD, `PATCH /api/admin/facility`, bookings by IST day, check-in, check-out,
   summary.
8. **D18 auto-assign** in one SQL query; on a `bookings_no_slot_overlap` `23P01` for an
   auto-picked slot, re-pick excluding the slots already tried, until no candidate is left; then 409
   `"No free slot of that type"`.
8b. **D20 fair use**: at most 3 active (`confirmed`, `ends_at > now`) bookings per customer (409
   `"You already have 3 active bookings"`), checked inside the booking transaction; login and
   register rate-limited to 10 requests per minute per IP (429), with a small in-memory limiter in
   `src/middleware/rateLimit.js` (no new dependency; the limit is configurable so tests stay fast).
8c. **Facility id**: `FACILITY_ID` setting (default 1); the API never picks "the first facility".
8d. **No caching of API responses**: every `/api` response carries `Cache-Control: no-store`
   (CloudFront forwards `Authorization` via a cache policy, architecture.md §1).
9. **Tests**: unit tests (no DB) for pure functions; supertest integration tests against real
   Postgres for every endpoint, skipped with a warning when the DB is unreachable (same pattern as
   `backend/test/schema.test.js`), cleaning up all rows they create.
10. **Early cloud milestone**: a human-run checklist only (`aws-deployer`).

**New dependency:** `qrcode` (runtime). No timezone library (see assumption A1).
**New env vars:** `UPLOADS_DIR` (default `./uploads`, already git-ignored by `uploads/`) and
`FACILITY_ID` (default 1), added to `backend/.env.example` and `src/config.js` (T4 owns both files).

### Assumptions (ambiguities resolved)

- **A1 IST math without a dependency.** `Asia/Kolkata` is a fixed UTC+05:30 offset with no DST, so
  `src/lib/time.js` shifts by 330 minutes and uses `getUTC*` methods. `getFacility()` throws (500)
  if `facilities.timezone` is not `Asia/Kolkata`, so the assumption cannot fail silently. A tz library
  (e.g. `date-fns-tz`) is only needed when multi-facility/multi-timezone lands (future scope).
- **A2 Single facility.** The app uses facility `config.facilityId` (default 1; the seed forces this id). The test helper
  upserts facility 1 the same way the seed does (including `setval`), so CI works without a seed step.
- **A3 D7.** Too early = `starts_at` before the start of the current IST half hour (400); at
  10:10 a start of 10:00 is accepted. "Too far ahead" = start's IST date > today's IST date +
  `max_advance_days`.
- **A3b D2 facility hours.** `PATCH /api/admin/facility` accepts `opens_at`/`closes_at` only on
  `:00`/`:30`, from `00:00` to `23:30` (never `24:00`).
- **A4 D2.** `starts_at` must parse as ISO 8601 with an offset (`z.string().datetime({ offset: true })`),
  with IST minutes in {0, 30} and seconds/ms = 0. `hours` integer 1..24 by zod; D6 then caps it.
- **A5 D8/D11.** Admin may cancel only `confirmed` bookings that are not `missed` (now < `ends_at`);
  a missed booking keeps its payment. Customer `can_cancel` = owner and `confirmed` and
  `now <= starts_at - 2h`; admin `can_cancel` = `confirmed` and `now < ends_at`.
- **A6 D18 "bookings in the last 30 days"** = non-cancelled bookings on that slot with
  `starts_at` in `[now - 30 days, now)`. Tie: lowest `code`.
- **A7 D15 summary.** Occupancy denominator uses **all** slots of the facility and the current
  opening hours; the percentage is capped at 100. `by_day` has one row per date in the range (zero rows included, via
  `generate_series`); `bookings` there = non-cancelled bookings starting that day. Counts:
  `upcoming` = `confirmed` and `ends_at > now`; `missed` = `confirmed` and `ends_at <= now` (D11, D15).
- **A8 Lists.** `mine?scope=active` = `confirmed` with `ends_at > now` plus every `checked_in`
  booking (even past `ends_at`), ordered by `starts_at` ascending; `past` by `starts_at`
  descending. Booking codes in URLs are uppercased; anything not matching
  `^PK-[A-HJ-NP-Z2-9]{6}$` is 404. Someone else's booking is also 404 for a customer (D19), never
  403, so codes cannot be probed.
- **A9 Times on the wire.** Facility `opens_at`/`closes_at` returned as `HH:MM` (pg returns
  `HH:MM:SS`). Money columns stay strings as pg returns them; JS pricing uses integer paise.
- **A10 Orphan QR files.** The QR is written before `COMMIT`; if the commit fails the file is
  orphaned. Acceptable (random key, never served via a booking); noted, not handled.
- **A11 Test isolation.** `vitest.config.js` sets `fileParallelism: false` so DB test files do not
  race on facility 1. Tests that change facility settings restore them in `afterAll`. Tests create
  their own slots (`T-<random>` codes) and users, assert only on their own rows, and delete
  bookings → users → slots afterwards. Tests needing "now"-relative bookings (check-in, missed,
  overstay) insert rows directly with SQL.

## Tasks

Module layout used below: pure logic in `src/lib/`, DB-aware logic in `src/services/`, HTTP in
`src/routes/`. Service functions take `now` and `facilityId` as parameters so tests control them.

### T1. Time, booking-window and pricing rules (`backend-dev`)
- **Files:** `src/lib/time.js`, `src/lib/rules.js`, `src/lib/pricing.js`, `test/unit/time-rules.test.js`, `test/unit/pricing.test.js` (all new)
- **Content:** `time.js`: `istParts(date) → { date: 'YYYY-MM-DD', minutes }`, `istToUtc(dateStr, 'HH:MM')`,
  `istToday(now)`, `addDays(dateStr, n)`, `timeToMinutes('HH:MM[:SS]')`, `formatHHMM`, `isValidDate`.
  `rules.js`: `checkBookingWindow({ startsAt, hours, facility, now }) → { startsAt, endsAt }` or throws
  `HttpError(400, msg)` for D2, D6 (open, close, same date), D7. `pricing.js`: `priceFor(hours,
  hourlyRate, dailyRate) → "280.00"` (D5) in integer paise.
- **Done when:** unit tests pass with no DB and cover: the four pricing rows in requirements §3;
  `:15` start rejected; `05:30` start rejected; 22:00 + 2 h rejected (ends 24:00 > 23:00); 06:00 + 17 h
  accepted; at 10:10 IST a 10:00 start is accepted and 09:30 rejected; IST date exactly `max_advance_days` ahead accepted, +1 rejected;
  `2026-12-01T10:00:00+05:30` and `2026-12-01T04:30:00Z` treated identically; an IST date that is the
  previous UTC date (e.g. 02:00 IST) maps correctly.
- **Depends on:** none.

### T2. Vehicle, booking code, derived state (`backend-dev`)
- **Files:** `src/lib/vehicle.js`, `src/lib/bookingCode.js`, `src/lib/bookingState.js`, `test/unit/booking-lib.test.js` (all new)
- **Content:** `normaliseVehicleNumber(s)` (uppercase, strip spaces and dashes, validate
  `^[A-Z0-9]{4,12}$`, throws 400 D9). `generateBookingCode(randomBytes = crypto.randomBytes)` using the
  32-char alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32 divides 256, so `byte % 32` is unbiased).
  `bookingState.js`: `deriveStatus(row, now)` (D11), `isOverstayed(row, now)` (D10), `canCancel(row,
  viewer, now)` (A5), `isValidBookingCode(s)`.
- **Done when:** unit tests cover `DL 3C AB 1234` → `DL3CAB1234`, `dl-3c-ab-1234` accepted, `AB1`
  and `DL3C@1234` rejected; 1,000 generated codes all match the D14 pattern; injected bytes give a
  known code; missed/overstayed/can_cancel truth tables for customer and admin at the boundaries
  (exactly 2 h before start, exactly `ends_at`).
- **Depends on:** none.

### T3. Foundation: middleware, error mapping, DB helpers, wiring, test helpers (`backend-dev`)
- **Files:** `src/middleware/auth.js`, `src/middleware/validate.js`, `src/db/errors.js`,
  `src/db/tx.js`, `src/services/facility.js` (new); `src/middleware/errors.js`, `src/app.js`,
  `vitest.config.js` (edit); stub routers exporting an empty `Router()`: `src/routes/auth.js`,
  `src/routes/facility.js`, `src/routes/slots.js`, `src/routes/bookings.js`, `src/routes/files.js`,
  `src/routes/admin/index.js` (applies `requireAuth, requireRole('admin')` then mounts the four
  below), `src/routes/admin/slots.js`, `src/routes/admin/bookings.js`,
  `src/routes/admin/summary.js`, `src/routes/admin/facility.js`; `test/helpers.js`,
  `test/unit/middleware.test.js` (new).
- **Content:** `auth.js`: `signToken(user)`, `requireAuth` (401 for missing/malformed/expired),
  `requireRole(...roles)` (403). `db/errors.js`: `mapPgError(err)` per Scope 5, exporting the
  constraint-name constants. `errors.js` handler calls `mapPgError` before formatting. `tx.js`:
  `withTransaction(fn)` (BEGIN/COMMIT/ROLLBACK, releases client). `facility.js`: `getFacility(db =
  pool)` for id 1, formats times, enforces A1. `app.js` mounts `/api/auth`, `/api/facility`,
  `/api/slots`, `/api/bookings`, `/api/files`, `/api/admin`, and sets `Cache-Control: no-store` on
  every `/api` response (8d). `vitest.config.js`: `fileParallelism:
  false`. `test/helpers.js`: `dbUp` probe, `ensureFacility()`, `createUser({ role })` → `{ user,
  token }`, `createSlot(overrides)`, `insertBookingRow(...)` (direct SQL, with payment),
  `istIso(daysAhead, 'HH:MM')`, and a `tracker` with `cleanup()`.
- **Done when:** `npm test` is green; middleware unit tests cover 401 (no header, bad signature,
  expired), 403 wrong role, `validate` 400 shape with `details`, `mapPgError` for each case in
  Scope 5 using fake error objects; unknown paths under the public mounts return JSON 404, and
  any `/api/admin/*` path returns 401 without a token and 403 with a customer token.
- **Depends on:** none (T1/T2 not needed).

### T4. Storage local driver, QR service, files route (`backend-dev`)
- **Files:** `src/services/storage.js`, `src/services/qr.js`, `src/routes/files.js`,
  `src/config.js`, `backend/.env.example`, `backend/package.json` + `package-lock.json`
  (`npm install qrcode`), `test/files.test.js` (new).
- **Config:** add `uploadsDir` (`UPLOADS_DIR`) and `facilityId` (`FACILITY_ID`, default 1) to
  `src/config.js` and `.env.example`; `getFacility()` (T3) reads `config.facilityId` if present,
  else 1, so T3 and T4 do not both edit `config.js`.
- **Content:** local driver: `put(key, buffer, contentType)` writes under `config.uploadsDir`
  (mkdir -p), `getUrl(key)` → `/api/files/<key>`, `resolveLocal(key)` rejects any key not matching
  `^[a-z]+/[a-f0-9]{32}\.(png)$` (no traversal). `s3` case still throws "not implemented" (Phase 4).
  `qr.js`: `createQr(bookingCode) → key`. Route `GET /api/files/*key` (Express 5 named wildcard;
  `req.params.key` is an array, join with `/`): 404 when the driver is not local, the key is
  invalid, or the file is missing; otherwise `image/png`.
- **Done when:** test stores a QR for `PK-7KQ2XM` and fetches it via supertest with status 200 and
  `content-type: image/png`; key contains no part of the booking code; `GET /api/files/../x`,
  `/api/files/qr/abc.png` and an unknown valid key return 404; `.env.example` lists `UPLOADS_DIR`.
  Tests use a temp `UPLOADS_DIR` and delete it.
- **Depends on:** T3.

### T5. Auth routes (`backend-dev`)
- **Files:** `src/routes/auth.js`, `src/middleware/rateLimit.js` (new), `test/auth.test.js`
- **Content:** password length 8 characters to 72 bytes (`Buffer.byteLength`); `rateLimit({ windowMs,
  max })` in-memory per IP, applied to register and login with 10/minute (429
  `"Too many attempts, try again in a minute"`); the factory takes options so tests can use a low limit.
- **Done when:** tests cover register 201 (token + user, role `customer` even with `role: "admin"` in
  the body, email lowercased), 400 (short password, bad email, phone `12ab`), 409 duplicate email in
  different case; login 200, 401 with identical message for unknown email and wrong password, 400
  missing field; `me` 200 and 401 (no token, garbage token). No `password_hash` in any response; a password over 72 bytes (e.g. 40 multi-byte characters) is
  400; the 11th login in a minute from one IP gets 429 (tested with a fresh limiter instance).
- **Depends on:** T3.

### T6. Facility routes (`backend-dev`)
- **Files:** `src/routes/facility.js`, `src/routes/admin/facility.js`, `test/facility.test.js`
- **Done when:** `GET /api/facility` returns the api.md shape with `HH:MM` times; `PATCH
  /api/admin/facility` 200 partial update, 400 for `closes_at <= opens_at` (checked against merged
  values), `max_advance_days: 0`, `opens_at: "25:00"`, `"06:15"`, `"24:00"`; 401 no token; 403 customer token. Test
  restores the original facility row.
- **Depends on:** T3.

### T7. Admin slot CRUD (`backend-dev`)
- **Files:** `src/routes/admin/slots.js`, `test/admin-slots.test.js`
- **Done when:** tests cover list (blocked included, ordered by code), create 201 / 400 (negative
  rate, bad type, empty code) / 409 duplicate code, patch 200 (rates, `is_blocked`) / 404 / 409
  duplicate code, delete 204 for an unbooked slot and 409 `"Slot has bookings; block it instead"` for
  a booked one (via `23503`), 401 and 403 on one route of each verb. Rate change leaves an existing
  booking's `amount` untouched (D16).
- **Depends on:** T3.

### T8. Availability (`backend-dev`)
- **Files:** `src/routes/slots.js`, `test/availability.test.js`
- **Content:** validate query, `checkBookingWindow`, one SQL query listing unblocked slots of facility
  1 (optionally by type) with `available = NOT EXISTS(overlapping confirmed/checked_in booking)`, and
  `amount` via `priceFor`. Response times in UTC ISO.
- **Done when:** tests (on own test slots) show: free slot `available: true` with correct amount;
  slot with an overlapping confirmed booking `false`; back-to-back booking still `true`; cancelled
  overlapping booking still `true`; blocked slot absent; `vehicle_type=bike` filters; 400 for each
  D2/D6/D7 violation and for missing `hours`.
- **Depends on:** T1, T3.

### T9. Admin summary (`backend-dev`)
- **Files:** `src/routes/admin/summary.js`, `test/admin-summary.test.js`
- **Content:** SQL grouping by `(starts_at AT TIME ZONE $tz)::date` over `generate_series(from, to)`,
  definitions per D15 and A7.
- **Done when:** test inserts known bookings (completed, missed, cancelled with refunded payment,
  upcoming, checked_in) on far-future dates (e.g. 2031) for its own slots and asserts revenue
  excludes refunded, counts per state, `by_day` length = days in range; 400 for `to < from`, range
  > 366 days, bad date; 401/403. (Totals are compared as deltas against a run before inserting, since
  facility 1 may hold other data.)
- **Depends on:** T1, T3.

### T10. Booking service (`backend-dev`)
- **Files:** `src/services/bookings.js`, `test/booking-service.test.js`
- **Content:**
  - `pickFreeSlot(client, { facilityId, vehicleType, startsAt, endsAt, excludeIds, now })`: one query
    (unblocked, type match, `NOT EXISTS` overlap, `ORDER BY` count of non-cancelled bookings with
    `starts_at` in `[now - 30 days, now)`, then `code`, `LIMIT 1`).
  - `createBooking({ facility, userId, slotId?, vehicleType?, startsAt, hours, vehicleNumber, now })`:
    window check (T1), normalise vehicle (T2); explicit slot: 404 unknown, 409 `"Slot is blocked"`,
    400 type mismatch; in `withTransaction`: insert booking with `generateBookingCode` (retry up to 5
    times on `23505 bookings_booking_code_key`, using a savepoint), insert payment `paid`,
    `createQr`, set `qr_key`. Before inserting, count the customer's active bookings (D20) and
    answer 409 at 3. Auto-pick: on `bookings_no_slot_overlap` `23P01`, roll back to a savepoint and
    re-pick excluding every slot tried so far, until no candidate is left → 409 `"No free slot of
    that type"`. `bookings_no_vehicle_overlap` is never retried.
  - `findBookingByCode(code)` (joins slot, payment, customer), `toBookingJson(row, { viewer, now,
    includeCustomer })` using T2 derivations and `storage.getUrl` (null when cancelled).
- **Done when:** tests on a **separate test facility** (so seeded slots never interfere) show: D18
  picks the least-used slot and breaks ties by code; blocked and busy slots skipped; two concurrent
  auto-pick bookings on a 2-slot facility both succeed on different slots; on a 1-slot facility one
  succeeds and the other gets 409 `"No free slot of that type"`; same vehicle overlapping gets the
  vehicle 409 message; a forced booking-code clash (injected generator) retries and succeeds;
  booking, payment and `qr_key` are all present after success and none after failure; three
  concurrent auto-pick bookings on a 3-slot facility all succeed on different slots; a 4th active
  booking for the same customer gets the D20 409.
- **Depends on:** T1, T2, T3, T4.

### T11. Customer booking routes (`backend-dev`)
- **Files:** `src/routes/bookings.js`, `test/bookings.test.js`
- **Content:** `POST /` (`requireRole('customer')`), `GET /mine`, `GET /:code`, `POST /:code/cancel`
  (conditional `UPDATE ... WHERE status = 'confirmed'` plus payment `refunded`, `refunded_at`, in one
  transaction). Route order: `/mine` before `/:code`.
- **Done when:** tests cover create 201 with full Booking shape (code pattern, `amount`, `payment`,
  `qr_url` fetchable via `/api/files`), with and without `slot_id`; 400 rule violation, bad vehicle,
  type mismatch; 401; 403 admin token; 404 unknown slot; 409 two concurrent POSTs for the same
  slot/time (exactly one 201), vehicle overlap, blocked slot. `mine` active/past split incl. a
  `missed` row in past and a `checked_in` row past its `ends_at` still in active; get one 200 owner /
  200 admin / 404 other customer / 404 unknown; cancel 200 (payment `refunded`, `qr_url` null), 409
  inside 2 h for customer, admin cancel inside 2 h 200, admin cancel of a missed booking 409, 409
  already cancelled, 404 other customer; responses carry `Cache-Control: no-store`.
- **Depends on:** T10.

### T12. Admin booking routes (`backend-dev`)
- **Files:** `src/routes/admin/bookings.js`, `test/admin-bookings.test.js`
- **Content:** `GET /` (IST day range via `istToUtc`, optional `status` filter applied after
  derivation, includes `customer`), `POST /:code/check-in`, `POST /:code/check-out` (conditional
  updates for race safety).
- **Done when:** tests (rows inserted with SQL relative to now) cover: list by date with `customer`
  and `status=missed` filter, 400 bad date; check-in 200 at start − 10 min, 409 too early (exact
  api.md message) at start − 20 min, 409 missed, 409 already checked in, 404; check-out 200,
  `overstayed: true` when after `ends_at`, 409 when `confirmed`; 401/403.
- **Depends on:** T10.

### T13. Smoke-deploy checklist (`aws-deployer`)
- **Files:** `infra/smoke-deploy.md` (new)
- **Content:** a human-run checklist using `docs/architecture.md` §8 steps 1-3, 5-7 and 10 in
  minimal form: budget alert first; security groups; RDS (not public); SSM parameters; EC2 with
  instance role, Node 22, PM2 started by the systemd unit (§4), Nginx checking `X-Origin-Verify`; clone, `npm ci`, `npm run migrate`, `npm run seed` against RDS with `DATABASE_SSL=true`;
  CloudFront distribution with only the EC2 origin for `/api/*` (S3 web origin waits for Phase 4),
  the `parkit-api` cache policy and the `X-Origin-Verify` header; verification
  `curl https://<dist>.cloudfront.net/api/health` → `"db":"up"`, sign in then `GET /api/auth/me`
  with the token through CloudFront → 200, and a direct request to the EC2 address refused; a
  screenshot for the report; stop/teardown steps to stay in the free tier. Each step lists the
  exact console path or CLI command for the human, with placeholders, no secrets.
- **Done when:** the file exists, every step is checkable, nothing conflicts with architecture §2-§4,
  and no agent ran any AWS command. The PHASES box stays unticked until a human reports success.
- **Depends on:** none.

### T14. Close the phase (`docs`)
- **Files:** `docs/PHASES.md`
- **Done when:** every Phase 2 box except the cloud milestone is ticked (that one only after the human
  confirms T13); runs after tester and reviewer pass.
- **Depends on:** T1-T13 and the tester.

## Parallel groups

No two tasks in a group share a file. `test/helpers.js`, `app.js`, `config.js` and `package.json` each
belong to exactly one task; later tasks keep extra fixtures inside their own test file.

- **Group A:** T1, T2, T3, T13
- **Group B (after T3; T8 and T9 also after T1):** T4, T5, T6, T7, T8, T9
- **Group C (after T1, T2, T4):** T10
- **Group D (after T10):** T11, T12
- **Group E:** T14, after tester and reviewer

## Test plan (tester)

1. Fresh DB (never `docker compose down -v`, which wipes the dev volume; create a throwaway
   database in the running container instead): `npm run migrate`, `npm test`
   green **without** seeding (proves A2), then `npm run seed` and `npm test` green again (proves
   tests tolerate seeded data). Re-run `npm test` a second time: still green (cleanup works). Count
   rows in `users`, `slots`, `bookings` before and after: unchanged.
2. Stop the DB and run `npm test`: unit tests pass, DB suites are skipped with a warning, no failures.
3. Coverage of the contract: for every row in the api.md endpoint index, find at least one test hitting
   it; every error code listed for that endpoint in api.md has a test.
4. Spot-check by hand with `npm run dev` and curl: register, availability for tomorrow 10:00 IST
   3 h (car amount `"120.00"`), book without `slot_id`, open `qr_url` in a browser (QR decodes to the
   booking code only), cancel, log in as `admin@parkit.local`, check-in rules, summary.
5. Security checks: no `password_hash` in any response; customer token on any `/api/admin/*` → 403;
   another customer's booking → 404; `/api/files/..%2F..%2Fpackage.json` → 404; QR key does not
   contain the booking code.
6. Concurrency: the two "simultaneous POST" tests (explicit slot and auto-pick) pass 5 runs in a row.
7. Conventions: all SQL parameterised (grep for template literals inside `query(` calls containing
   `${`); `001`/`002` migrations unchanged (`git diff main -- backend/migrations`); `.env.example`
   has `UPLOADS_DIR`; `qrcode` is the only new dependency; no commit has AI co-author trailers.
8. CI is green on the branch.
9. `infra/smoke-deploy.md` exists and is a checklist only (no scripts that create resources were run).
