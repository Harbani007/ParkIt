// Storage adapter for QR codes and receipts.
// Drivers: local (disk) and s3 (same interface). S3 credentials come from the EC2 instance role.
//
// interface Storage {
//   put(key: string, body: Buffer, contentType: string): Promise<void>
//   delete(key: string): Promise<void>     // idempotent
//   getUrl(key: string): Promise<string>   // local: /api/files/<key>, s3: pre-signed URL
// }
import fs from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

const SIGNED_URL_SECONDS = 900;

// S3 driver. The client is created lazily so local mode and tests never need AWS; credentials
// come from the default provider chain (instance role), never from env keys.
export function createS3Storage({ client, bucket = config.s3AssetsBucket, region = config.awsRegion } = {}) {
  let s3 = client;
  const ctx = () => {
    if (!bucket) throw new Error('S3_ASSETS_BUCKET must be set when STORAGE_DRIVER=s3');
    s3 ??= new S3Client({ region });
    return s3;
  };
  const checked = (key) => {
    if (!isValidKey(key)) throw new Error('Invalid storage key');
    return key;
  };
  return {
    async put(key, buffer, contentType) {
      checked(key);
      await ctx().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType }));
    },
    async getUrl(key) {
      checked(key);
      return getSignedUrl(ctx(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: SIGNED_URL_SECONDS });
    },
    async delete(key) {
      checked(key);
      try {
        await ctx().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (err) {
        console.warn('s3 delete failed', key, err.message);
      }
    },
  };
}

let s3Storage;

export function getStorage() {
  switch (config.storageDriver) {
    case 'local':
      return localStorage;
    case 's3':
      if (!config.s3AssetsBucket) throw new Error('S3_ASSETS_BUCKET must be set when STORAGE_DRIVER=s3');
      s3Storage ??= createS3Storage();
      return s3Storage;
    default:
      throw new Error(`unknown STORAGE_DRIVER "${config.storageDriver}"`);
  }
}
