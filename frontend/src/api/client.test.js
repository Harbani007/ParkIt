import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError, fileUrl, setTokenGetter, setUnauthorizedHandler } from './client.js';

function mockResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    },
  };
}

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setTokenGetter(() => null);
  setUnauthorizedHandler(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('api()', () => {
  it('sends the Bearer header from the token getter', async () => {
    setTokenGetter(() => 'abc123');
    fetchMock.mockResolvedValue(mockResponse(200, { ok: true }));
    const data = await api('/bookings/mine');
    expect(data).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/bookings/mine');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer abc123');
  });

  it('omits Authorization without a token and Content-Type without a body', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, {}));
    await api('/slots');
    const { headers, body } = fetchMock.mock.calls[0][1];
    expect(headers.Authorization).toBeUndefined();
    expect(headers['Content-Type']).toBeUndefined();
    expect(body).toBeUndefined();
  });

  it('serialises a JSON body', async () => {
    fetchMock.mockResolvedValue(mockResponse(201, { id: 1 }));
    await api('/bookings', { method: 'POST', body: { slot_id: 3 } });
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"slot_id":3}');
  });

  it('throws ApiError with status, message and details', async () => {
    const details = [{ path: 'email', message: 'Invalid' }];
    fetchMock.mockResolvedValue(mockResponse(400, { error: 'Validation failed', details }));
    const err = await api('/auth/register', { method: 'POST', body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('Validation failed');
    expect(err.details).toEqual(details);
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(mockResponse(500, undefined));
    const err = await api('/x').catch((e) => e);
    expect(err.status).toBe(500);
    expect(err.message).toBe('Request failed (500)');
  });

  it('401 with a token calls the unauthorized handler and uses the expiry message', async () => {
    const handler = vi.fn();
    setTokenGetter(() => 'tok');
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(mockResponse(401, { error: 'Unauthorized' }));
    const err = await api('/bookings/mine').catch((e) => e);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(err.status).toBe(401);
    expect(err.message).toMatch(/session has expired/i);
  });

  it('401 without a token (login) does not call the handler and keeps the server message', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(mockResponse(401, { error: 'Invalid email or password' }));
    const err = await api('/auth/login', { method: 'POST', body: {} }).catch((e) => e);
    expect(handler).not.toHaveBeenCalled();
    expect(err.status).toBe(401);
    expect(err.message).toBe('Invalid email or password');
  });

  it('429 gives a rate-limit message', async () => {
    fetchMock.mockResolvedValue(mockResponse(429, undefined));
    const err = await api('/auth/login', { method: 'POST', body: {} }).catch((e) => e);
    expect(err.status).toBe(429);
    expect(err.message).toMatch(/too many attempts/i);
  });

  it('network failure becomes ApiError status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await api('/slots').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/cannot reach the server/i);
  });

  it('rethrows AbortError untouched', async () => {
    const abort = new DOMException('Aborted', 'AbortError');
    fetchMock.mockRejectedValue(abort);
    await expect(api('/slots')).rejects.toBe(abort);
  });

  it('204 resolves to null', async () => {
    fetchMock.mockResolvedValue(mockResponse(204, undefined));
    await expect(api('/bookings/1', { method: 'DELETE' })).resolves.toBeNull();
  });
});

describe('fileUrl()', () => {
  it('returns null for empty input', () => {
    expect(fileUrl(null)).toBeNull();
    expect(fileUrl('')).toBeNull();
  });

  it('keeps absolute URLs untouched', () => {
    const u = 'https://bucket.s3.amazonaws.com/qr/1.png?X-Amz-Signature=abc';
    expect(fileUrl(u)).toBe(u);
  });

  it('returns relative paths as-is when no API origin is set', () => {
    expect(fileUrl('/api/files/qr/1.png')).toBe('/api/files/qr/1.png');
    expect(fileUrl('api/files/qr/1.png')).toBe('/api/files/qr/1.png');
  });

  it('prefixes relative paths (not absolute URLs) with VITE_API_URL', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.com');
    vi.resetModules();
    const mod = await import('./client.js');
    expect(mod.fileUrl('/api/files/qr/1.png')).toBe('https://api.example.com/api/files/qr/1.png');
    expect(mod.fileUrl('https://s3.example.com/x.png')).toBe('https://s3.example.com/x.png');
  });
});
