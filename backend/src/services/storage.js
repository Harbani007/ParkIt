// Storage adapter for QR codes and receipts.
// Phase 2 implements the local driver; Phase 4 adds the S3 driver (same interface).
//
// interface Storage {
//   put(key: string, body: Buffer, contentType: string): Promise<void>
//   getUrl(key: string): Promise<string>   // local: /api/files/<key>, s3: pre-signed URL
// }
import { config } from '../config.js';

export function getStorage() {
  switch (config.storageDriver) {
    case 'local':
    case 's3':
      throw new Error(`storage driver "${config.storageDriver}" not implemented yet`);
    default:
      throw new Error(`unknown STORAGE_DRIVER "${config.storageDriver}"`);
  }
}
