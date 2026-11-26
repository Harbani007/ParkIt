# Phase 1 plan: Requirements and database design

Branch: `phase-1/requirements-db-design`. Docs and schema only. No route code (Phase 2), no frontend (Phase 3).
Course deliverables: proposal (problem statement and objectives) and ER diagram. The report is capped
at 5 pages, so every doc should be short and easy to paste into it.

## Decisions for the user

Approved on 2026-11-26 with the review changes to D1, D5, D8, D10 and D11. Every task below
assumes them; `docs/requirements.md` (Task 2) is where they are frozen.

**After the Phase 1 code review** the rules were tightened in `docs/requirements.md`, which wins
over the table below: D2 (opening times on `:00`/`:30`), D7 (start no earlier than the current half
hour), D8 (admin may cancel only before `ends_at`, so missed bookings keep their payment), D10
(overstay limitation; checked-in bookings stay active), D11 (`ends_at ≤ now`), D15 (all slots,
capped at 100%; `upcoming` defined), D18 (count by `starts_at`, retry next candidate), D19 (404 for
someone else's code; 128-bit QR keys) and new D20 (3 active bookings per customer; login rate
limit). The slot exclusion constraint is named `bookings_no_slot_overlap` in 002.

### Booking states

| State | Stored? | How it is reached |
|---|---|---|
| `confirmed` | yes | booking created; simulated payment `paid` |
| `checked_in` | yes | admin check-in inside the D10 window |
| `completed` | yes | admin check-out (flag `overstayed` if after `ends_at`) |
| `cancelled` | yes | customer (until 2 h before start) or admin (before check-in); payment `refunded` |
| `missed` | derived | still `confirmed` after `ends_at` |

Only `confirmed` and `checked_in` occupy a slot, so cancelled and missed bookings never block a new
one, and back-to-back bookings are allowed (`[start, end)` ranges).

| # | Topic | Proposed default |
|---|---|---|
| D1 | Timezone | Timestamps are stored as `TIMESTAMPTZ` (UTC inside Postgres). Business rules (opening hours, "same day", reports by date) and the UI use the facility timezone, `Asia/Kolkata` (IST), stored on `facilities.timezone`. The API accepts and returns ISO 8601 with an offset. |
| D2 | Booking granularity | A booking starts on `:00` or `:30` and lasts a whole number of hours. The request sends `starts_at` and `hours`; the server computes `ends_at`. |
| D3 | Minimum duration | 1 hour. |
| D4 | Rounding | None is needed because of D2 (whole hours only). Amounts are rupees with 2 decimals, sent as strings (`"120.00"`). |
| D5 | When the daily rate applies | The daily rate caps the price of **one booking**: `amount = min(hours * hourly_rate, daily_rate)`. It is per booking, not per customer per day, so two separate 4 h bookings cost more than one 8 h booking; that is intended and stated in the UI. Example: Rs 40/h with a Rs 300 day rate gives 7 h = Rs 280 and 8 h or more = Rs 300. |
| D6 | Spanning midnight or closing time | Not allowed. A booking must fit inside one day's opening window (`opens_at <= start`, `end <= closes_at`, same IST date). Default hours are 06:00-23:00, so the longest booking is 17 h. Overnight and multi-day parking are future scope. |
| D7 | Max advance booking | 30 days ahead, stored on `facilities.max_advance_days` and editable by the admin. A booking cannot start in the past. |
| D8 | Cancellation | A customer can cancel a `confirmed` booking until **2 hours before** `starts_at`, with a full simulated refund (the payment row moves to `refunded`; the UI labels it "simulated"). Inside the 2 h window the API refuses (409). A booking made less than 2 h before its start therefore cannot be cancelled by the customer, and the booking page says so before confirming. The admin can cancel any `confirmed` booking before check-in, also with a full refund. |
| D9 | Vehicle types | `car` and `bike`, already in the schema. The booking takes the slot's type. Vehicle numbers are stored uppercase with spaces and dashes removed, and must match `^[A-Z0-9]{4,12}$`. |
| D10 | Check-in and check-out | Admin only. Check-in: `confirmed` bookings, from 15 min before `starts_at` (early arrival) until `ends_at` (late arrival; lost time is not refunded). Earlier than 15 min the API refuses and the driver waits. Check-out: any `checked_in` booking, any time. If `checked_out_at > ends_at` the booking is flagged **overstayed** (shown, not charged in this version). A `checked_in` booking past `ends_at` shows as overstaying on the admin list. |
| D11 | No-shows ("missed") | A `confirmed` booking whose `ends_at` has passed with no check-in is **missed**. It is derived, not stored: the API returns `status: "missed"` for it, so no background job is needed and it can never get out of step. Missed bookings are counted separately from completed ones in the admin summary. The payment is kept (no refund), so it still counts as revenue. |
| D12 | Blocking a slot | Blocking hides the slot from new availability. Existing bookings on it are not cancelled automatically; the admin cancels them by hand if needed. |
| D13 | Deleting a slot | Allowed only if the slot has never been booked. Otherwise the API returns 409 and the admin should block it instead. `bookings.slot_id` stays `ON DELETE RESTRICT`. |
| D14 | Booking code | `PK-` followed by 6 characters from an unambiguous set (`A-Z` and `2-9`, without `I`, `O`, `0`, `1`), e.g. `PK-7KQ2XM`. It is encoded in the QR code and used in URLs. |
| D15 | Revenue and occupancy | Revenue = sum of payments still `paid` (refunded ones excluded) for bookings starting in the range, by IST date. Occupancy for a day = booked slot-hours of non-cancelled bookings ÷ (unblocked slots × opening hours), as a percentage. The summary also counts bookings per state: completed, missed, cancelled, upcoming, checked_in. |
| D16 | Price quote | There is no separate quote endpoint. The availability response includes `amount` for each slot. This satisfies the Phase 2 item "price quote". `bookings.amount` is computed once at booking time, so a later rate change never alters an existing booking. |
| D17 | One vehicle, one place | A vehicle number cannot have two `confirmed`/`checked_in` bookings whose times overlap. Enforced by a second exclusion constraint in the DB, like slot double booking, and mapped to 409. |
| D18 | "Any free slot" (balanced allocation) | `slot_id` is optional on `POST /api/bookings`. If omitted, the server picks, among free unblocked slots of the requested `vehicle_type`, the one with the fewest bookings in the last 30 days (tie: lowest `code`). This spreads wear and use evenly across slots: a small load-balancing scheduler, done in one SQL query. |
| D19 | QR safety | The QR encodes only the booking code. Looking a code up returns customer data only to its owner or an admin; check-in by code is admin only. QR images are stored under a random key, never the booking code. |

## Scope

1. `docs/requirements.md`: a short proposal (problem statement, objectives, scope, out of scope),
   followed by numbered user stories for the customer (C1..) and the admin (A1..), each with
   testable acceptance criteria.
2. Pricing rules (D2-D5) and booking rules (D1, D6-D13) as a section of `docs/requirements.md`.
   They are not a separate file, so the report can quote them directly.
3. Schema review. `001` stays untouched and the changes go in `002_finalise_schema.sql`:
   - `facilities`: add `timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata'` and
     `max_advance_days INT NOT NULL DEFAULT 30 CHECK (max_advance_days BETWEEN 1 AND 365)`,
     and add `CHECK (closes_at > opens_at)`.
   - `users`: `CHECK (email = lower(email))`. The API lowercases emails, so uniqueness is
     case-insensitive.
   - `bookings`: add `cancelled_at TIMESTAMPTZ`, add `CHECK (amount >= 0)`, add
     `CHECK (vehicle_number ~ '^[A-Z0-9]{4,12}$')` (D9), add an index on `(starts_at)` for the
     admin "bookings by day" query, and add the vehicle exclusion constraint (D17):
     `EXCLUDE USING gist (vehicle_number WITH =, tstzrange(starts_at, ends_at) WITH &&)
     WHERE (status IN ('confirmed', 'checked_in'))`.
   - `payments`: add `UNIQUE (booking_id)` (one simulated payment per booking), add
     `refunded_at TIMESTAMPTZ`, and add `CHECK (amount >= 0)`.
   - Business rules that depend on the current time or on facility settings (hours, advance days,
     whole hours) are enforced in the API, not in the DB.
4. `docs/er-diagram.md`: a Mermaid `erDiagram` of the final schema (001 + 002), plus a few lines on
   the exclusion constraint and the multi-facility future scope.
5. `docs/api.md`: every Phase 2 endpoint, using the exact list in Task 1.

**Out of scope:** route handlers, auth middleware, QR generation, frontend, AWS.

## Tasks

### Task 1: API contract (`docs`)
- **Files:** `docs/api.md` (new)
- **Depends on:** the decisions above being approved.
- **Content:** start with a conventions section: base `/api`; JSON; `Authorization: Bearer <jwt>`;
  money as string; ISO 8601 times; error body `{ error, details? }`. Then a status code table:
  - 400: validation or business rule failure (outside opening hours, too far ahead, past start)
  - 401: missing or invalid token
  - 403: wrong role, or not your booking
  - 404: not found
  - 409: conflict (slot already booked `23P01`, duplicate email, invalid status transition,
    deleting a booked slot, slot blocked)

  Then one section per endpoint giving the auth level, request (params, query, body with types),
  a `200`/`201` response example, and the specific errors:

  | Method and path | Auth | Purpose |
  |---|---|---|
  | `GET /api/health` | none | existing |
  | `POST /api/auth/register` | none | `{name, email, phone?, password(min 8)}` → `201 {token, user}` |
  | `POST /api/auth/login` | none | `{email, password}` → `{token, user}` |
  | `GET /api/auth/me` | user | current user |
  | `GET /api/facility` | none | name, address, hours, timezone, max_advance_days |
  | `GET /api/slots/availability?starts_at=&hours=&vehicle_type=` | none | every unblocked slot with `{id, code, vehicle_type, hourly_rate, daily_rate, available, amount}` |
  | `POST /api/bookings` | customer | `{slot_id?, vehicle_type, starts_at, hours, vehicle_number}` (no `slot_id`: D18 picks one) → `201` booking with `booking_code`, `amount`, `status`, `qr_url`, `payment` |
  | `GET /api/bookings/mine?scope=active\|past` | customer | own bookings. `active` means confirmed or checked_in and not ended; `past` is everything else |
  | `GET /api/bookings/:code` | owner or admin | one booking, including `qr_url` |
  | `POST /api/bookings/:code/cancel` | owner or admin | applies D8 → booking with status `cancelled` |
  | `GET /api/admin/slots` | admin | all slots, including blocked ones |
  | `POST /api/admin/slots` | admin | `{code, vehicle_type, hourly_rate, daily_rate}` → `201` |
  | `PATCH /api/admin/slots/:id` | admin | any of `code, vehicle_type, hourly_rate, daily_rate, is_blocked` |
  | `DELETE /api/admin/slots/:id` | admin | `204`, or `409` per D13 |
  | `PATCH /api/admin/facility` | admin | any of `opens_at, closes_at, max_advance_days` |
  | `GET /api/admin/bookings?date=YYYY-MM-DD&status=` | admin | bookings starting on that IST date, with customer name and slot code |
  | `POST /api/admin/bookings/:code/check-in` | admin | applies D10 |
  | `POST /api/admin/bookings/:code/check-out` | admin | applies D10 |
  | `GET /api/admin/summary?from=YYYY-MM-DD&to=YYYY-MM-DD` | admin | `{revenue, occupancy_pct, counts: {completed, missed, cancelled, upcoming, checked_in}, by_day: [...]}` per D15 |
  | `GET /api/files/*` | none (unguessable key) | local storage driver only; serves QR PNGs |
- **Done when:** every row above has a section with a request, a response example and errors; the
  field names match the column names in 001 + 002; and no endpoint exists that is not in this table.

### Task 2: Requirements, pricing and booking rules (`docs`)
- **Files:** `docs/requirements.md` (new)
- **Depends on:** the decisions above being approved.
- **Content:** proposal section (problem statement, 3-5 objectives, scope and future scope);
  user stories C1-C6 (register/login, check availability and price, book and get a QR, view
  active/past bookings, cancel, see the QR at the gate) and A1-A7 (manage slots, set rates, set
  hours and max advance days, block/unblock, view bookings by day, check in/out, see occupancy and
  revenue). Each story gets 2-4 "Given/When/Then" or bullet acceptance criteria. Then "Pricing rules"
  (D2-D5, with two worked examples), "Booking rules" (D1, D6-D19) and a short "Cloud requirements"
  section (non-functional, about 10 lines), each line naming the AWS service that meets it:
  - Availability and durability: data in RDS with automated backups; files in S3; nothing kept on
    the EC2 disk, so the instance can be replaced.
  - Security: HTTPS between the browser and CloudFront (the CloudFront → EC2 leg is a stated limitation); RDS and the assets bucket are private; the API
    reaches S3 through an EC2 instance role (no access keys); QR files served by short-lived
    pre-signed URLs; passwords hashed with bcrypt.
  - Scalability: the API is stateless (JWT, no server sessions, files in S3), so more EC2
    instances could sit behind a load balancer without code changes; static files are served
    from the CloudFront edge and never touch EC2.
  - Resource efficiency: free-tier sizes; the CDN offloads every static request from the
    origin; an S3 lifecycle rule expires QR files of finished bookings; D18 spreads load across
    slots.
  - Observability: CloudWatch metrics for EC2 CPU, RDS connections and API errors, shown in the
    report.
- **Done when:** every story has acceptance criteria that refer to an endpoint in Task 1's table,
  every decision D1-D19 appears in the doc, and the file is under about 2 pages.

### Task 3: Migration 002 (`backend-dev`)
- **Files:** `backend/migrations/002_finalise_schema.sql` (new). `backend/src/db/seed.js` only if
  the seed breaks; it should not, because every new column has a default.
- **Depends on:** none.
- **Content:** exactly the changes in Scope item 3, each with a one-line comment. Use `ALTER TABLE`
  only and do not touch `001`.
- **Done when:** on a fresh DB (`docker compose down -v && docker compose up -d db`), `npm run migrate`
  applies 001 and 002, a second `npm run migrate` prints "migrations up to date", `npm run seed`
  succeeds, and `npm test` still passes.

### Task 4: Schema tests (`backend-dev`)
- **Files:** `backend/test/schema.test.js` (new)
- **Depends on:** Task 3.
- **Content:** integration tests against `DATABASE_URL`, run inside a transaction that is rolled
  back. Skip the suite with a clear message if the DB is unreachable; CI has Postgres, so it runs
  there. Cases:
  1. Two overlapping `confirmed` bookings on the same slot raise `23P01`.
  2. An overlap with a `cancelled` booking is allowed.
  3. Back-to-back bookings (`ends_at` equal to the next `starts_at`) are allowed.
  4. A second payment for the same booking raises `23505`.
  5. A mixed-case email is rejected (`23514`).
  6. `closes_at <= opens_at` is rejected.
  7. The same vehicle number on two different slots at overlapping times raises `23P01`.
  8. A vehicle number with lowercase letters or spaces is rejected (`23514`).
  9. Real concurrency: two separate pool connections each open a transaction and insert an
     overlapping booking for the same slot at the same moment (`Promise.all`). Exactly one
     commits; the other fails with `23P01`. Clean up the committed row afterwards. This is the
     "two customers click Book at once" demo.
- **Done when:** `npm test` passes locally with the DB up and in CI.

### Task 5: ER diagram (`docs`)
- **Files:** `docs/er-diagram.md` (new)
- **Depends on:** Task 3.
- **Content:** a Mermaid `erDiagram` with facilities, users, slots, bookings and payments, showing
  every column, its type and PK/FK/UK markers, and the cardinalities (facility 1-n slots,
  user 1-n bookings, slot 1-n bookings, booking 1-0..1 payment). Below it, at most 10 lines
  covering the exclusion constraint, why `facility_id` exists (future multi-facility), and status
  transitions (`confirmed → checked_in → completed`, `confirmed → cancelled`).
- **Done when:** the diagram renders on GitHub and matches 001 + 002 column for column.

### Task 7: Cloud architecture and deployment specification (`docs`)
- **Files:** `docs/architecture.md` (extend the existing file; no second architecture doc)
- **Depends on:** Task 2.
- **Content:** keep the Mermaid diagram and request flow, then add:
  - Network and security: VPC layout, two security groups (EC2 allows 80 from CloudFront only
    via the AWS-managed CloudFront prefix list, 22 from the team's IP; RDS allows 5432 only from
    the EC2 security group; RDS not publicly accessible); HTTPS via CloudFront; both S3 buckets
    private with Block Public Access; CloudFront reads the web bucket through Origin Access
    Control.
  - IAM: EC2 instance role with least privilege (`s3:GetObject`/`PutObject` on the assets bucket
    only, `sns:Publish` on one topic, read access to its SSM parameters); no access keys on the
    server or in the repo.
  - Secrets: `DATABASE_URL` and `JWT_SECRET` in SSM Parameter Store (SecureString), loaded at
    start-up; `.env` only for local development.
  - Data protection: RDS automated backups (7 days), a manual snapshot before the demo; S3
    lifecycle rule for QR files.
  - Cost: a table of each service, its free-tier allowance and expected monthly cost (target Rs 0
    inside free tier), and an AWS Budgets alert at USD 1 and 5 created before anything else.
  - Deployment procedure: numbered steps a human runs (Phase 4 turns them into scripts), plus how
    a new API version is rolled out and rolled back.
  - Monitoring: CloudWatch metrics and alarms to show (EC2 CPU, RDS connections and free storage,
    CloudFront 5xx rate).
  - Live demo script: customer books on the CloudFront URL → row shown in RDS → QR object shown in
    S3 → admin checks the booking in → CloudWatch graph moves.
- **Done when:** every item above has a section, nothing in it conflicts with `docs/PHASES.md`
  Phase 4, and the doc stays within about 3 pages.

### Task 6: Close the phase (`docs`)
- **Files:** `docs/PHASES.md`, `CLAUDE.md` (one line: point to `docs/requirements.md` and
  `docs/er-diagram.md` under "Source of truth")
- **Depends on:** Tasks 1-5 and the tester passing.
  Also add two Phase 4 items so the cloud requirements get built: "S3 lifecycle rule expiring QR
  files of finished bookings" and "CloudWatch dashboard (EC2 CPU, RDS connections, API 5xx) with
  screenshots for the report". Phase 2 gets "slot auto-assignment (D18)" and an early cloud
  milestone: "Smoke deploy: `/api/health` reachable through CloudFront → EC2 → RDS", so AWS is
  proven long before the final demo and not left to the end.
- **Done when:** all six Phase 1 boxes are ticked.

## Parallel groups

Requirements come first, so the contract and schema are written against frozen rules.

- **Group A:** Task 2 (requirements, frozen as the source of truth). Task 3 (migration) may start
  alongside it because the schema decisions above are already fixed.
- **Group B (after Task 2):** Task 1 (API contract), Task 4 (schema tests, after Task 3), Task 5
  (ER diagram, after Task 3) and Task 7 (cloud architecture). They touch different files.
- **Group C:** Task 6, last, after tester and reviewer.

## Test plan (tester)

1. On a fresh DB (`docker compose down -v && docker compose up -d db`): `npm run migrate` applies
   `001` and `002`; a second run is a no-op; `npm run seed` succeeds; `npm test` is green
   (health tests and schema tests).
2. `git diff main -- backend/migrations/001_initial_schema.sql` is empty.
3. In `psql`, `\d facilities`, `\d bookings` and `\d payments` show the 002 columns and constraints.
4. Cross-check the docs:
   - Every column in `\d` output appears in `docs/er-diagram.md`.
   - Every endpoint in `docs/api.md` is referenced by at least one user story.
   - Every story's acceptance criteria point to an endpoint that exists.
   - D1-D19 appear in `docs/requirements.md`, and the "Cloud requirements" section names a
     service for every line.
   - The pricing examples compute correctly (Rs 40/h, Rs 300/day: 7 h = 280.00, 8 h = 300.00,
     17 h = 300.00).
5. Field names and status values in `docs/api.md` match the DB (`confirmed`, `checked_in`,
   `completed`, `cancelled`; `paid`, `refunded`), plus the derived `missed` (D11).
6. No route or frontend code changed in this phase (`git diff main --stat` shows only `docs/`,
   `backend/migrations/002_*`, `backend/test/schema.test.js`, and optionally `backend/src/db/seed.js`).
7. `docs/architecture.md` covers every bullet of Task 7 and agrees with Phase 4 in `docs/PHASES.md`.
