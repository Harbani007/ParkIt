-- Phase 1 schema review. Forward-only changes on top of 001 (btree_gist is created there).

-- facilities: timezone used for business rules and reports (D1).
ALTER TABLE facilities ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';
-- facilities: how far ahead a booking may start, editable by the admin (D7).
ALTER TABLE facilities ADD COLUMN max_advance_days INT NOT NULL DEFAULT 30
  CONSTRAINT facilities_max_advance_days_range CHECK (max_advance_days BETWEEN 1 AND 365);
-- facilities: a facility must close after it opens (D6, no overnight windows).
ALTER TABLE facilities ADD CONSTRAINT facilities_hours_order CHECK (closes_at > opens_at);

-- users: emails are stored lowercase so UNIQUE(email) is case-insensitive.
ALTER TABLE users ADD CONSTRAINT users_email_lowercase CHECK (email = lower(email));

-- bookings: when the booking was cancelled (D8).
ALTER TABLE bookings ADD COLUMN cancelled_at TIMESTAMPTZ;
-- bookings: amount can never be negative.
ALTER TABLE bookings ADD CONSTRAINT bookings_amount_nonnegative CHECK (amount >= 0);
-- bookings: vehicle numbers are uppercase letters and digits only (D9).
ALTER TABLE bookings ADD CONSTRAINT bookings_vehicle_number_format
  CHECK (vehicle_number ~ '^[A-Z0-9]{4,12}$');
-- bookings: speeds up the admin "bookings by day" query.
CREATE INDEX bookings_starts_at_idx ON bookings (starts_at);
-- bookings: one vehicle cannot hold two overlapping active bookings (D17).
ALTER TABLE bookings ADD CONSTRAINT bookings_no_vehicle_overlap
  EXCLUDE USING gist (
    vehicle_number WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status IN ('confirmed', 'checked_in'));

-- payments: one simulated payment per booking.
ALTER TABLE payments ADD CONSTRAINT payments_booking_id_key UNIQUE (booking_id);
-- payments: when the refund happened (D8).
ALTER TABLE payments ADD COLUMN refunded_at TIMESTAMPTZ;
-- payments: amount can never be negative.
ALTER TABLE payments ADD CONSTRAINT payments_amount_nonnegative CHECK (amount >= 0);

-- bookings: give the 001 slot exclusion constraint a stable name, so the API can tell a slot clash
-- from a vehicle clash (bookings_no_vehicle_overlap) by err.constraint.
ALTER TABLE bookings RENAME CONSTRAINT bookings_slot_id_tstzrange_excl TO bookings_no_slot_overlap;
