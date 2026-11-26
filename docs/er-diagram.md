# ParkIt: ER diagram

The schema after migrations `001_initial_schema.sql` and `002_finalise_schema.sql`
(PostgreSQL 16, RDS on AWS).

```mermaid
erDiagram
  facilities ||--o{ slots : "has"
  users ||--o{ bookings : "makes"
  slots ||--o{ bookings : "is booked by"
  bookings ||--o| payments : "paid by"

  facilities {
    serial id PK
    text name
    text address
    time opens_at "default 06:00"
    time closes_at "default 23:00, after opens_at"
    text timezone "default Asia/Kolkata"
    int max_advance_days "default 30, 1 to 365"
    timestamptz created_at
  }

  users {
    serial id PK
    text name
    text email UK "stored lowercase"
    text phone
    text password_hash "bcrypt"
    text role "customer or admin"
    timestamptz created_at
  }

  slots {
    serial id PK
    int facility_id FK
    text code "unique per facility, e.g. A-01"
    text vehicle_type "car or bike"
    numeric hourly_rate "10,2, at least 0"
    numeric daily_rate "10,2, at least 0"
    boolean is_blocked
    timestamptz created_at
  }

  bookings {
    serial id PK
    text booking_code UK "e.g. PK-7KQ2XM, in the QR"
    int user_id FK
    int slot_id FK
    text vehicle_number "A-Z and 0-9, 4 to 12"
    timestamptz starts_at
    timestamptz ends_at "after starts_at"
    numeric amount "10,2, fixed at booking"
    text status "confirmed, checked_in, completed, cancelled"
    text qr_key "storage key of the QR image"
    timestamptz checked_in_at
    timestamptz checked_out_at
    timestamptz cancelled_at
    timestamptz created_at
  }

  payments {
    serial id PK
    int booking_id FK, UK "one payment per booking"
    numeric amount "10,2, at least 0"
    text status "paid or refunded"
    text provider "simulated"
    text provider_ref "for a real gateway later"
    timestamptz refunded_at
    timestamptz created_at
  }
```

**Integrity enforced by the database**
- **No double booking.** An exclusion constraint on `bookings` (`bookings_no_slot_overlap`: `slot_id` equal and
  `tstzrange(starts_at, ends_at)` overlapping, for `confirmed`/`checked_in` rows only) makes
  Postgres itself refuse an overlapping booking, even when two requests arrive at once. Ranges are
  half-open, so back-to-back bookings are fine, and cancelled bookings free the slot.
- **One vehicle, one place** (`bookings_no_vehicle_overlap`): the same rule on `vehicle_number`.
- `(facility_id, code)` is unique, emails are unique and lowercase, booking codes are unique,
  money columns cannot be negative, and a facility must close after it opens.
- Deleting a facility removes its slots; a slot or user with bookings cannot be deleted, and
  deleting a booking removes its payment.

**Booking states.** `confirmed → checked_in → completed`, and `confirmed → cancelled` (payment
`refunded`). `missed` is not stored: it is a `confirmed` booking whose `ends_at` has passed.

**Future scope.** Every slot already belongs to a facility, so several facilities can be added
later by giving `facilities` an owner, with no change to `bookings` or `payments`.
