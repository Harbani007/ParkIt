export const BOOKING_CODE_RE = /^PK-[A-HJ-NP-Z2-9]{6}$/;
export const VEHICLE_NUMBER_RE = /^[A-Z0-9]{4,12}$/;

/**
 * Uppercase and strip whitespace; 'PK' + 6 chars without the dash becomes 'PK-XXXXXX' (F9).
 * Anything else is returned cleaned but otherwise unchanged.
 */
export function normaliseBookingCode(input) {
  const s = String(input ?? '').toUpperCase().replace(/\s+/g, '');
  const m = /^PK-?(.{6})$/.exec(s);
  return m ? `PK-${m[1]}` : s;
}

export function isValidBookingCode(code) {
  return BOOKING_CODE_RE.test(code ?? '');
}

/** Same rule as the server (D9): uppercase, remove spaces and dashes. */
export function normaliseVehicleNumber(input) {
  return String(input ?? '').toUpperCase().replace(/[\s-]+/g, '');
}

export function isValidVehicleNumber(normalised) {
  return VEHICLE_NUMBER_RE.test(normalised ?? '');
}
