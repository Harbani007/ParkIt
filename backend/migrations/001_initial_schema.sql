-- Draft schema from the proposal. Phase 1 reviews and finalises it.
-- facility_id is included from the start so the system can later support
-- multiple facilities and owners (proposal: "Future scope").

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE facilities (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  address       TEXT,
  opens_at      TIME NOT NULL DEFAULT '06:00',
  closes_at     TIME NOT NULL DEFAULT '23:00',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE slots (
  id            SERIAL PRIMARY KEY,
  facility_id   INT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,                    -- e.g. "A-01"
  vehicle_type  TEXT NOT NULL DEFAULT 'car' CHECK (vehicle_type IN ('car', 'bike')),
  hourly_rate   NUMERIC(10, 2) NOT NULL CHECK (hourly_rate >= 0),
  daily_rate    NUMERIC(10, 2) NOT NULL CHECK (daily_rate >= 0),
  is_blocked    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (facility_id, code)
);

CREATE TABLE bookings (
  id             SERIAL PRIMARY KEY,
  booking_code   TEXT NOT NULL UNIQUE,            -- shown to user and encoded in the QR
  user_id        INT NOT NULL REFERENCES users(id),
  slot_id        INT NOT NULL REFERENCES slots(id),
  vehicle_number TEXT NOT NULL,
  starts_at      TIMESTAMPTZ NOT NULL,
  ends_at        TIMESTAMPTZ NOT NULL,
  amount         NUMERIC(10, 2) NOT NULL,
  status         TEXT NOT NULL DEFAULT 'confirmed'
                 CHECK (status IN ('confirmed', 'checked_in', 'completed', 'cancelled')),
  qr_key         TEXT,                            -- storage key of the QR image (local path or S3 key)
  checked_in_at  TIMESTAMPTZ,
  checked_out_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  -- The database itself refuses double bookings of the same slot.
  EXCLUDE USING gist (
    slot_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status IN ('confirmed', 'checked_in'))
);

CREATE INDEX bookings_user_idx ON bookings (user_id);
CREATE INDEX bookings_slot_time_idx ON bookings (slot_id, starts_at);

-- Simulated payments; a gateway such as Razorpay can fill provider_ref later.
CREATE TABLE payments (
  id            SERIAL PRIMARY KEY,
  booking_id    INT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  amount        NUMERIC(10, 2) NOT NULL,
  status        TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'refunded')),
  provider      TEXT NOT NULL DEFAULT 'simulated',
  provider_ref  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
