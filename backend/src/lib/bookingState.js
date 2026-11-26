// Derived booking state. Rows use DB column names; times may be Date or ISO strings.
// Boundary convention (consistent with D11, "ended" means ends_at <= now):
//   missed     = confirmed and ends_at <= now
//   overstayed = checked_out_at > ends_at, or still checked_in and now >= ends_at
// (an open booking is treated as over at ends_at, like D11; a checkout exactly at ends_at is on time).

const CODE_RE = /^PK-[A-HJ-NP-Z2-9]{6}$/;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

const ms = (t) => new Date(t).getTime();

export function isValidBookingCode(s) {
  return typeof s === 'string' && CODE_RE.test(s);
}

/** D11: stored status, except confirmed-and-ended becomes 'missed'. */
export function deriveStatus(row, now) {
  if (row.status === 'confirmed' && ms(row.ends_at) <= now.getTime()) return 'missed';
  return row.status;
}

/** D10. */
export function isOverstayed(row, now) {
  if (row.status === 'completed' && row.checked_out_at) {
    return ms(row.checked_out_at) > ms(row.ends_at);
  }
  if (row.status === 'checked_in') return now.getTime() >= ms(row.ends_at);
  return false;
}

/**
 * D8 / A5. viewer = { id, role }. Customer: owner, confirmed, now <= starts_at - 2h.
 * Admin: confirmed, now < ends_at. Row owner is row.user_id.
 */
export function canCancel(row, viewer, now) {
  if (row.status !== 'confirmed') return false;
  if (viewer.role === 'admin') return now.getTime() < ms(row.ends_at);
  if (viewer.role === 'customer') {
    return (
      String(row.user_id) === String(viewer.id) &&
      now.getTime() <= ms(row.starts_at) - TWO_HOURS_MS
    );
  }
  return false;
}
