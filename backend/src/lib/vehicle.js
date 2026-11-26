import { HttpError } from '../middleware/errors.js';

/** D9: uppercase, strip spaces and dashes, must match ^[A-Z0-9]{4,12}$. */
export function normaliseVehicleNumber(input) {
  const n = String(input ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z0-9]{4,12}$/.test(n)) {
    throw new HttpError(400, 'Vehicle number must be 4 to 12 letters or digits');
  }
  return n;
}
