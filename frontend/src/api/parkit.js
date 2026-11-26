// One function per endpoint in docs/api.md. All return parsed JSON (null for 204)
// and throw ApiError. `opts` may carry { signal } to cancel a request.
import { api } from './client.js';

const enc = encodeURIComponent;

function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// Health and facility
export const health = (opts) => api('/health', opts);
export const getFacility = (opts) => api('/facility', opts);
export const getConfig = (opts) => api('/config', opts); // -> { email_notifications }
export const updateFacility = (fields, opts) =>
  api('/admin/facility', { ...opts, method: 'PATCH', body: fields });

// Auth: login/register -> { token, user }; me -> { user }
export const login = (email, password, opts) =>
  api('/auth/login', { ...opts, method: 'POST', body: { email, password } });
export const register = ({ name, email, phone, password }, opts) =>
  api('/auth/register', {
    ...opts,
    method: 'POST',
    body: { name, email, ...(phone ? { phone } : {}), password },
  });
export const me = (opts) => api('/auth/me', opts);

// Availability -> { starts_at, ends_at, hours, slots: [...] }
export const getAvailability = ({ startsAt, hours, vehicleType }, opts) =>
  api(`/slots/availability${qs({ starts_at: startsAt, hours, vehicle_type: vehicleType })}`, opts);

// Bookings (customer). body: { slot_id?, vehicle_type, starts_at, hours, vehicle_number }
export const createBooking = (body, opts) =>
  api('/bookings', { ...opts, method: 'POST', body });
export const myBookings = (scope = 'active', opts) =>
  api(`/bookings/mine${qs({ scope })}`, opts); // -> { bookings }
export const getBooking = (code, opts) => api(`/bookings/${enc(code)}`, opts);
export const cancelBooking = (code, opts) =>
  api(`/bookings/${enc(code)}/cancel`, { ...opts, method: 'POST' });

// Admin: slots
export const adminSlots = (opts) => api('/admin/slots', opts); // -> { slots }
export const createSlot = (slot, opts) =>
  api('/admin/slots', { ...opts, method: 'POST', body: slot });
export const updateSlot = (id, fields, opts) =>
  api(`/admin/slots/${enc(id)}`, { ...opts, method: 'PATCH', body: fields });
export const deleteSlot = (id, opts) =>
  api(`/admin/slots/${enc(id)}`, { ...opts, method: 'DELETE' }); // -> null

// Admin: bookings, gate, summary
export const adminBookings = (date, status, opts) =>
  api(`/admin/bookings${qs({ date, status })}`, opts); // -> { date, bookings }
export const checkIn = (code, opts) =>
  api(`/admin/bookings/${enc(code)}/check-in`, { ...opts, method: 'POST' });
export const checkOut = (code, opts) =>
  api(`/admin/bookings/${enc(code)}/check-out`, { ...opts, method: 'POST' });
export const summary = (from, to, opts) => api(`/admin/summary${qs({ from, to })}`, opts);
