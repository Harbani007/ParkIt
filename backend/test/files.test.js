import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createQr } from '../src/services/qr.js';
import { getStorage, resolveLocal } from '../src/services/storage.js';

// No database needed: files are served straight from disk.
const originalDir = config.uploadsDir;
const originalDriver = config.storageDriver;
let tmp;
const app = createApp();

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parkit-uploads-'));
  config.uploadsDir = tmp;
  config.storageDriver = 'local';
});

afterAll(() => {
  config.uploadsDir = originalDir;
  config.storageDriver = originalDriver;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('storage and QR', () => {
  it('stores a QR for a booking code and serves it as image/png', async () => {
    const key = await createQr('PK-7KQ2XM');
    expect(key).toMatch(/^qr\/[a-f0-9]{32}\.png$/);
    expect(key.toUpperCase()).not.toContain('7KQ2XM');
    expect(await getStorage().getUrl(key)).toBe(`/api/files/${key}`);

    const res = await request(app).get(`/api/files/${key}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/png/);
    expect(res.headers['cache-control']).toBe('no-store');
    // PNG signature
    expect(res.body.subarray(0, 4).toString('hex')).toBe('89504e47');
  });

  it('resolveLocal rejects keys outside qr/<32 hex>.png', () => {
    for (const bad of ['../x', 'qr/abc.png', 'qr/../../package.json', '/etc/passwd', `qr/${'a'.repeat(32)}.txt`, `QR/${'a'.repeat(32)}.png`]) {
      expect(() => resolveLocal(bad)).toThrow();
    }
    expect(resolveLocal(`qr/${'a'.repeat(32)}.png`).startsWith(path.resolve(tmp))).toBe(true);
  });
});

describe('GET /api/files/*', () => {
  it('404s for traversal, short keys, encoded traversal and unknown valid keys', async () => {
    for (const p of [
      '/api/files/../x',
      '/api/files/qr/abc.png',
      '/api/files/..%2F..%2Fpackage.json',
      '/api/files/qr/..%2F..%2Fpackage.json',
      `/api/files/qr/${'0'.repeat(32)}.png`,
      '/api/files/',
    ]) {
      const res = await request(app).get(p);
      expect(res.status, p).toBe(404);
      expect(res.body.error).toBeTruthy();
    }
  });

  it('404s when the driver is not local', async () => {
    const key = await createQr('PK-7KQ2XM');
    config.storageDriver = 's3';
    try {
      const res = await request(app).get(`/api/files/${key}`);
      expect(res.status).toBe(404);
    } finally {
      config.storageDriver = 'local';
    }
  });
});
