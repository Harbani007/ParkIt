import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('./parkit.js', () => ({ getConfig: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
});

async function load(result) {
  const { getConfig } = await import('./parkit.js');
  getConfig.mockReset();
  if (result instanceof Error) getConfig.mockRejectedValue(result);
  else getConfig.mockResolvedValue(result);
  const { useConfig } = await import('./useConfig.js');
  return { useConfig, getConfig };
}

describe('useConfig', () => {
  it('starts with emails off and picks up the server value', async () => {
    const { useConfig } = await load({ email_notifications: true });
    const { result } = renderHook(() => useConfig());
    expect(result.current.email_notifications).toBe(false);
    await waitFor(() => expect(result.current.email_notifications).toBe(true));
  });

  it('falls back to emails off when the request fails', async () => {
    const { useConfig, getConfig } = await load(new Error('offline'));
    const { result } = renderHook(() => useConfig());
    await waitFor(() => expect(getConfig).toHaveBeenCalled());
    expect(result.current.email_notifications).toBe(false);
  });
});
