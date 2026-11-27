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

// Health, config and the default facility
export const health = (opts) => api('/health', opts);
export const getFacility = (opts) => api('/facility', opts);
export const getConfig = (opts) => api('/config', opts); // -> { email_notifications }

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

// Marketplace: search spaces (no address, D23) and one space
export const searchSpaces = ({ q, vehicleType } = {}, opts) =>
  api(`/spaces${qs({ q, vehicle_type: vehicleType })}`, opts); // -> { spaces }
export const getSpace = (id, opts) => api(`/spaces/${enc(id)}`, opts);

// Availability -> { starts_at, ends_at, hours, slots: [...] }
export const getAvailability = ({ spaceId, startsAt, hours, vehicleType }, opts) =>
  api(`/slots/availability${qs({ space_id: spaceId, starts_at: startsAt, hours, vehicle_type: vehicleType })}`, opts);

// Bookings (customer). body: { space_id, slot_id?, vehicle_type, starts_at, hours, vehicle_number }
export const createBooking = (body, opts) =>
  api('/bookings', { ...opts, method: 'POST', body });
export const myBookings = (scope = 'active', opts) =>
  api(`/bookings/mine${qs({ scope })}`, opts); // -> { bookings }
export const getBooking = (code, opts) => api(`/bookings/${enc(code)}`, opts);
export const cancelBooking = (code, opts) =>
  api(`/bookings/${enc(code)}/cancel`, { ...opts, method: 'POST' });

// Hosting: the caller's spaces and listing a new one
export const myHostSpaces = (opts) => api('/host/spaces', opts); // -> { spaces }
export const createHostSpace = (space, opts) =>
  api('/host/spaces', { ...opts, method: 'POST', body: space });

// Managing a space. The admin pages are shared by the admin (/api/admin, any space) and hosts
// (/api/host?space_id=, their own spaces only); ManageScope in App.jsx sets which one is active.
let scope = { base: '/admin', spaceId: null };
export function setManageScope(next) {
  scope = next;
}
const m = (path, params = {}) => `${scope.base}${path}${qs({ ...params, space_id: scope.spaceId })}`;

export const manageFacility = (opts) => api(m('/facility'), opts);
export const updateFacility = (fields, opts) =>
  api(m('/facility'), { ...opts, method: 'PATCH', body: fields });

export const adminSlots = (opts) => api(m('/slots'), opts); // -> { slots }
export const createSlot = (slot, opts) => api(m('/slots'), { ...opts, method: 'POST', body: slot });
export const updateSlot = (id, fields, opts) =>
  api(m(`/slots/${enc(id)}`), { ...opts, method: 'PATCH', body: fields });
export const deleteSlot = (id, opts) => api(m(`/slots/${enc(id)}`), { ...opts, method: 'DELETE' }); // -> null

export const adminBookings = (date, status, opts) =>
  api(m('/bookings', { date, status }), opts); // -> { date, bookings }
export const manageBooking = (code, opts) => api(m(`/bookings/${enc(code)}`), opts);
export const checkIn = (code, opts) => api(m(`/bookings/${enc(code)}/check-in`), { ...opts, method: 'POST' });
export const checkOut = (code, opts) => api(m(`/bookings/${enc(code)}/check-out`), { ...opts, method: 'POST' });
export const manageCancel = (code, opts) => api(m(`/bookings/${enc(code)}/cancel`), { ...opts, method: 'POST' });
export const summary = (from, to, opts) => api(m('/summary', { from, to }), opts);
