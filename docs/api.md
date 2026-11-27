# ParkIt API contract

Backend and frontend both follow this file. Change it before changing either. Rules referenced as
D1..D20 are in `docs/requirements.md`.

## Conventions

- Base path `/api`. Requests and responses are JSON (`Content-Type: application/json`).
- Auth: `Authorization: Bearer <jwt>` from register or login. The token carries `sub` (user id) and
  `role` (`customer` or `admin`) and expires after `JWT_EXPIRES_IN` (default 7 days). The role is read
  from the token, so a role change takes effect only when the token expires (accepted limitation).
- Auth levels below: **none**, **user** (any signed-in user), **customer**, **admin**, **owner or
  admin** (the booking's customer or any admin).
- Times are ISO 8601 with an offset, e.g. `2026-12-01T10:00:00+05:30`. Responses use UTC
  (`2026-12-01T04:30:00.000Z`); the frontend shows IST (D1). Dates in query strings are
  `YYYY-MM-DD` in IST.
- Money is a string with 2 decimals, e.g. `"280.00"`.
- Vehicle numbers are normalised by the server (uppercase, spaces and dashes removed) before
  validation (D9).
- Errors: `{ "error": "Human readable message", "details": ... }`. `details` is present for
  validation errors and lists the failing fields.

### Status codes

| Code | When |
|---|---|
| 200 / 201 / 204 | Success (201 on create, 204 on delete) |
| 400 | Validation failed, or a booking rule was broken: outside opening hours, before the current half hour, beyond `max_advance_days`, not on `:00`/`:30`, crosses closing time |
| 401 | Missing, invalid or expired token; wrong email or password |
| 403 | Signed in but wrong role (a customer on an admin route, an admin creating a booking) |
| 404 | Unknown booking code, slot or route; also someone else's booking code, so codes cannot be probed (D19) |
| 409 | Conflict: slot already booked, vehicle already booked at that time (D17), slot blocked, no free slot (D18), 3 active bookings already (D20), duplicate email or slot code, state change not allowed (cancel too late, check-in outside window, booking missed), deleting a booked slot |
| 429 | Too many sign-in or registration attempts from one IP (D20) |

**Database errors the API maps.** `23P01` on constraint `bookings_no_slot_overlap` → 409 "This slot was just booked for that time"; `23P01` on `bookings_no_vehicle_overlap` → 409 "This vehicle already has a booking at that time"; `23505` (unique) → 409 naming the duplicate field. Branch on `err.constraint`, never on the message text. Two simultaneous inserts on the same slot can also make Postgres report a deadlock (`40P01`), because an exclusion constraint writes its index entry before checking; the booking service treats that as a lost race and retries, so the client still gets the normal slot 409 (or, after 3 retries, 409 "Slot is busy, please try again").

### Shared objects

Every Booking also carries `space: { id, name, locality, city, address }` (D22): where it is. Only
the booking's customer, the space's host and the admin can read a booking, so the address is safe
there (D23).

**User**
```json
{ "id": 7, "name": "Asha Verma", "email": "asha@example.com", "phone": "9876543210", "role": "customer" }
```

**Slot**
```json
{ "id": 1, "code": "A-01", "vehicle_type": "car", "hourly_rate": "40.00", "daily_rate": "300.00", "is_blocked": false }
```

**Booking**
```json
{
  "booking_code": "PK-7KQ2XM",
  "status": "confirmed",
  "slot": { "id": 1, "code": "A-01", "vehicle_type": "car" },
  "vehicle_number": "DL3CAB1234",
  "starts_at": "2026-12-01T04:30:00.000Z",
  "ends_at": "2026-12-01T07:30:00.000Z",
  "hours": 3,
  "amount": "120.00",
  "can_cancel": true,
  "overstayed": false,
  "payment": { "amount": "120.00", "status": "paid", "provider": "simulated" },
  "qr_url": "/api/files/qr/3f9a6c0d2b7e4f1a8c5d9e0b7a6f4c21.png",
  "checked_in_at": null,
  "checked_out_at": null,
  "cancelled_at": null,
  "created_at": "2026-11-26T10:12:00.000Z"
}
```
- `status` is one of `confirmed`, `checked_in`, `completed`, `cancelled`, or the derived `missed`
  (a `confirmed` booking with `ends_at ≤ now`, D11).
- `can_cancel` is true when the caller may cancel it now (D8).
- `customer` (`{ "name", "email", "phone" }`) is added only when the caller is an admin: on the admin
  booking list, `GET /api/bookings/:code`, cancel, check-in and check-out. Customers never receive it.
- `overstayed` is true when `checked_out_at > ends_at`, or when still `checked_in` after `ends_at`.
- `qr_url` is a path served by `GET /api/files/*` with the local storage driver, or a pre-signed S3
  URL valid for 15 minutes on AWS. Null for cancelled bookings.

---

## Health

### `GET /api/health` (none)
`200 { "status": "ok", "db": "up", "time": "2026-11-26T10:12:00.000Z" }`. `db` is `"down"` when the database is unreachable; the
endpoint still answers 200, so the smoke test and CloudWatch can tell "API up, database down" apart
from "API down".

## Auth

### `POST /api/auth/register` (none)
Body: `{ "name": string 1-100, "email": email, "phone"?: string 10-15 digits, "password": string, 8 characters to 72 bytes (bcrypt's limit, measured with `Buffer.byteLength`) }`.
Always creates a `customer`; any `role` in the body is ignored. Email is lowercased.
`201 { "token": "<jwt>", "user": User }`. Errors: 400 validation, 409 email already registered, 429 (D20).
When SNS is configured, the email is then subscribed to booking emails (AWS sends a confirmation
link first, D21).

### `POST /api/auth/login` (none)
Body: `{ "email", "password" }`. `200 { "token", "user": User }`. Errors: 400, 401
`"Invalid email or password"` (same message for both cases), 429 after 10 attempts per minute from
one IP (D20).

### `GET /api/auth/me` (user)
`200 { "user": User }`. Errors: 401.

## Facility

### `GET /api/facility` (none)
```json
{ "id": 1, "name": "ParkIt Residency", "address": "New Delhi",
  "opens_at": "06:00", "closes_at": "23:00", "timezone": "Asia/Kolkata", "max_advance_days": 30 }
```

### `PATCH /api/admin/facility` (admin)
Body: any of `{ "opens_at": "HH:MM", "closes_at": "HH:MM", "max_advance_days": 1-365, "name", "address" }`.
Times must be on `:00` or `:30`, between `00:00` and `23:30` (D2). The timezone is fixed (D1).
`200` facility object as above. Errors: 400 (including `closes_at` not after `opens_at`), 401, 403.

The API always works on facility `id = 1` (setting `FACILITY_ID`, default 1); it never picks "the
first facility" by itself.

## Slots and availability

### `GET /api/slots/availability` (none)
Query: `space_id` (optional, default facility 1), `starts_at` (ISO 8601, required), `hours` (integer ≥ 1, required), `vehicle_type`
(`car` or `bike`, optional: both when omitted).
Lists every **unblocked** slot (D12) with whether it is free for the whole range and its price (D5, D16).
```json
{
  "starts_at": "2026-12-01T04:30:00.000Z",
  "ends_at": "2026-12-01T07:30:00.000Z",
  "hours": 3,
  "slots": [
    { "id": 1, "code": "A-01", "vehicle_type": "car", "hourly_rate": "40.00", "daily_rate": "300.00", "available": true,  "amount": "120.00" },
    { "id": 2, "code": "A-02", "vehicle_type": "car", "hourly_rate": "40.00", "daily_rate": "300.00", "available": false, "amount": "120.00" }
  ]
}
```
Errors: 400 for any rule in D2, D6, D7.

## Spaces (marketplace, D22-D24)

**Space** (public): `{ "id": 7, "name": "Sharma house driveway", "locality": "Lajpat Nagar", "city": "New Delhi", "opens_at": "08:00", "closes_at": "19:00", "timezone": "Asia/Kolkata", "max_advance_days": 30, "slot_count": 1, "vehicle_types": ["car"], "from_hourly_rate": "30.00" }`. No `address` (D23).

### `GET /api/spaces` (none)
Query: `q` (optional, matched case-insensitively against locality, city and name), `vehicle_type`
(optional). Lists listed spaces that have at least one unblocked slot, sorted by locality then name.
`200 { "spaces": [Space, ...] }`.

### `GET /api/spaces/:id` (none)
`200` Space. Errors: 404 unknown or unlisted.

### `POST /api/host/spaces` (customer)
Body: `{ "name", "address", "locality", "city"?, "opens_at", "closes_at", "vehicle_type": "car"|"bike", "slots": 1-10, "hourly_rate", "daily_rate" }`.
Creates the space owned by the caller and its slots (`P1`, `P2`, ...). `201` HostSpace
(Space plus `address`). Errors: 400 validation (times as `PATCH /api/admin/facility`).

### `GET /api/host/spaces` (customer)
The caller's spaces. `200 { "spaces": [HostSpace, ...] }`.

### Managing a space: `/api/admin/*` and `/api/host/*`
Every management route below exists twice with the same body and response: under `/api/admin`
(admin; `space_id` optional, default facility 1 for lists, any space for a booking code) and under
`/api/host` (customer who owns the space; `space_id` required in the query string, else 400; not
owned → 404). Host versions: `GET/POST/PATCH/DELETE /api/host/slots`, `GET /api/host/bookings`,
`GET /api/host/bookings/:code`, `POST /api/host/bookings/:code/check-in|check-out|cancel`,
`GET /api/host/summary`, `GET/PATCH /api/host/facility`. A booking code at another space → 404.

## Client config

### `GET /api/config` (none)
What the frontend needs to know about the deployment. `email_notifications` is true when an SNS
topic is configured (D21).
```json
{ "email_notifications": true }
```

## Bookings (customer)

### `POST /api/bookings` (customer)
Body:
```json
{ "slot_id": 1, "vehicle_type": "car", "starts_at": "2026-12-01T10:00:00+05:30", "hours": 3, "vehicle_number": "DL 3C AB 1234" }
```
- `space_id` optional (default facility 1): the space to book at. A host booking their own space → 409 (D24).
- `slot_id` optional. Without it the server picks a free slot of `vehicle_type` by D18. With it,
  `vehicle_type` must match the slot's type or be omitted.
- Creates the booking (`confirmed`), its simulated payment (`paid`) and its QR image in one
  transaction; the amount is fixed now (D16).
- Without `slot_id`, if the chosen slot is taken by a simultaneous request
  (`bookings_no_slot_overlap`), the server tries the next candidate; it answers 409 "no free slot"
  only when none is left (D18).
`201` Booking. Errors: 400 rules (D2, D6, D7, D9) or slot/type mismatch; 401; 403 (admin token);
404 unknown `slot_id`; 409 slot taken, vehicle already booked at that time (D17), slot blocked,
no free slot of that type, or 3 active bookings already (D20).
After a 201, a confirmation email is published through SNS when configured (D21).

### `GET /api/bookings/mine` (customer)
Query: `scope=active|past` (default `active`). `active` = `confirmed` with `ends_at > now`, plus
every `checked_in` booking (the car is still parked, even after `ends_at`); `past` = everything
else, newest first.
`200 { "bookings": [Booking, ...] }`.

### `GET /api/bookings/:code` (owner or admin)
`200` Booking; for an admin caller it also includes `customer`. Errors: 401; 404 unknown code **or** not the owner (D19).

### `POST /api/bookings/:code/cancel` (owner or admin)
Customer: allowed while `confirmed` and now ≤ `starts_at` − 2 h. Admin: allowed while `confirmed`
and now < `ends_at`, so a missed booking keeps its payment (D8, D11). Sets `status = cancelled`,
`cancelled_at`, payment `status = refunded`, `refunded_at`. When SNS is configured, a cancellation
email is published after the response (D21).
`200` Booking (with `customer` when the caller is an admin). Errors: 401; 404 (unknown or not the owner); 409 `"Bookings can be cancelled until 2 hours before the start"`,
booking missed, or not `confirmed`.

## Admin

All admin routes answer 401 without a token and 403 for a customer token.

### `GET /api/admin/slots` (admin)
`200 { "slots": [Slot, ...] }`, blocked ones included, ordered by `code`.

### `POST /api/admin/slots` (admin)
Body: `{ "code": string 1-20, "vehicle_type": "car"|"bike", "hourly_rate": number ≥ 0, "daily_rate": number ≥ 0 }`.
`201` Slot. Errors: 400; 409 code already used.

### `PATCH /api/admin/slots/:id` (admin)
Body: any of `code`, `vehicle_type`, `hourly_rate`, `daily_rate`, `is_blocked`. Rate changes do not
affect existing bookings (D16); blocking does not cancel them (D12).
`200` Slot. Errors: 400; 404; 409 code already used; 409 `"Slot has active bookings; its type cannot change"`
(`vehicle_type` change while a `confirmed` or `checked_in` booking has `ends_at` in the future).

### `DELETE /api/admin/slots/:id` (admin)
`204`. Errors: 404; 409 `"Slot has bookings; block it instead"` (D13).

### `GET /api/admin/bookings` (admin)
Query: `date` (IST date, required), `status` (optional; any booking status including `missed`).
Bookings starting on that date, ordered by `starts_at`:
`200 { "date": "2026-12-01", "bookings": [Booking & { "customer": { "name", "email", "phone" } }, ...] }`.

### `POST /api/admin/bookings/:code/check-in` (admin)
Allowed when `confirmed` and `starts_at − 15 min ≤ now < ends_at` (D10). Sets `checked_in`,
`checked_in_at`. `200` Booking & `customer`. Errors: 404; 409 `"Too early: check-in opens 15 minutes before the start"`,
booking missed, or not `confirmed`.

### `POST /api/admin/bookings/:code/check-out` (admin)
Allowed when `checked_in`. Sets `completed`, `checked_out_at`; `overstayed` reflects D10.
The slot is reserved only until `ends_at`, so an overstaying car does not block the next booking;
the admin booking list highlights overstays (known limitation, D10).
`200` Booking & `customer`. Errors: 404; 409 not `checked_in`.

### `GET /api/admin/summary` (admin)
Query: `from`, `to` (IST dates, inclusive, `to ≥ from`, at most 366 days). Definitions in D15.
`upcoming` = `confirmed` with `ends_at > now`, so every booking is counted in exactly one state. Occupancy divides by all slots × current opening
hours and is capped at 100.
```json
{
  "from": "2026-12-01", "to": "2026-12-07",
  "revenue": "4560.00",
  "occupancy_pct": 37.5,
  "counts": { "completed": 18, "missed": 2, "cancelled": 3, "upcoming": 5, "checked_in": 1 },
  "by_day": [
    { "date": "2026-12-01", "revenue": "640.00", "occupancy_pct": 41.2, "bookings": 6 }
  ]
}
```
Errors: 400.

## Files

### `GET /api/files/*` (none)
Local storage driver only (development). Serves stored files such as QR PNGs by key. The only
accepted path is `qr/` + 32 lowercase hex characters + `.png` (128 random bits from
`crypto.randomBytes(16)`); anything else gets 404 before the disk is touched, which also rules out
path traversal. Knowing a booking code does not reveal its file (D19). On AWS this route is not used:
`qr_url` is a pre-signed S3 URL.

---

## Endpoint index

| Method | Path | Auth | Stories |
|---|---|---|---|
| GET | `/api/health` | none | (ops) |
| POST | `/api/auth/register` | none | C1 |
| POST | `/api/auth/login` | none | C1 |
| GET | `/api/auth/me` | user | C1 |
| GET | `/api/facility` | none | C2 |
| PATCH | `/api/admin/facility` | admin | A3 |
| GET | `/api/slots/availability` | none | C2 |
| GET | `/api/config` | none | C1 |
| POST | `/api/bookings` | customer | C3 |
| GET | `/api/bookings/mine` | customer | C4 |
| GET | `/api/bookings/:code` | owner or admin | C4, C6 |
| POST | `/api/bookings/:code/cancel` | owner or admin | C5, A5 |
| GET | `/api/admin/slots` | admin | A1 |
| POST | `/api/admin/slots` | admin | A1 |
| PATCH | `/api/admin/slots/:id` | admin | A1, A2, A4 |
| DELETE | `/api/admin/slots/:id` | admin | A4 |
| GET | `/api/admin/bookings` | admin | A5 |
| POST | `/api/admin/bookings/:code/check-in` | admin | A6 |
| POST | `/api/admin/bookings/:code/check-out` | admin | A6 |
| GET | `/api/admin/summary` | admin | A7 |
| GET | `/api/files/*` | none | C3, C4 |
