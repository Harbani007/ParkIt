const API_ORIGIN = import.meta.env.VITE_API_URL ?? '';
const BASE = `${API_ORIGIN}/api`;

export const TOKEN_KEY = 'parkit.token';

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status; // 0 = network failure
    this.details = details; // validation details from the server, if any
  }
}

// The auth context registers these so this module does not import React.
let getToken = () => null;
let onUnauthorized = null;

export function setTokenGetter(fn) {
  getToken = typeof fn === 'function' ? fn : () => null;
}

export function setUnauthorizedHandler(fn) {
  onUnauthorized = typeof fn === 'function' ? fn : null;
}

// `qr_url` is a relative /api/files/... path (local driver) or an absolute
// pre-signed S3 URL. Only relative paths get the API origin prefixed.
export function fileUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`;
}

// api(path, { method, body, signal }): path is relative to /api, e.g. '/bookings/mine'.
// Resolves to parsed JSON (null for 204) or throws ApiError.
export async function api(path, { method = 'GET', body, signal } = {}) {
  const token = getToken();
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err; // callers cancel on purpose
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }

  if (res.status === 204) return null;

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    let message = data?.error ?? `Request failed (${res.status})`;
    if (res.status === 429) {
      message = data?.error ?? 'Too many attempts. Wait a minute and try again.';
    }
    if (res.status === 401 && token) {
      // Only a request that carried a token means the session died. A 401 on
      // login (no token) keeps the server's "Invalid email or password".
      message = 'Your session has expired. Please log in again.';
      if (onUnauthorized) onUnauthorized();
    }
    throw new ApiError(res.status, message, data?.details);
  }
  return data;
}
