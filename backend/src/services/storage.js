// Storage adapter for QR codes and receipts.
// Phase 2 implements the local driver; Phase 4 adds the S3 driver (same interface).
//
// interface Storage {
//   put(key: string, body: Buffer, contentType: string): Promise<void>
//   delete(key: string): Promise<void>     // idempotent
//   getUrl(key: string): Promise<string>   // local: /api/files/<key>, s3: pre-signed URL
// }
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

const KEY_PATTERN = /^qr\/[a-f0-9]{32}\.png$/;

export const isValidKey = (key) => typeof key === 'string' && KEY_PATTERN.test(key);

// Absolute path for a valid key; throws for anything else (no traversal).
export function resolveLocal(key) {
  if (!isValidKey(key)) throw new Error('Invalid storage key');
  return path.join(path.resolve(config.uploadsDir), ...key.split('/'));
}

const localStorage = {
  async put(key, buffer) {
    const file = resolveLocal(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buffer);
  },
  async delete(key) {
    await fs.rm(resolveLocal(key), { force: true });
  },
  async getUrl(key) {
    if (!isValidKey(key)) throw new Error('Invalid storage key');
    return `/api/files/${key}`;
  },
};

export function getStorage() {
  switch (config.storageDriver) {
    case 'local':
      return localStorage;
    case 's3':
      throw new Error('storage driver "s3" not implemented yet (Phase 4)');
    default:
      throw new Error(`unknown STORAGE_DRIVER "${config.storageDriver}"`);
  }
}
