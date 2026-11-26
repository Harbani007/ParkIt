import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://bucket.s3.amazonaws.com/signed'),
}));

const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
const { config } = await import('../src/config.js');
const { createS3Storage, getStorage } = await import('../src/services/storage.js');

const key = `qr/${'a'.repeat(32)}.png`;
let client;
beforeEach(() => {
  client = { send: vi.fn(async () => ({})) };
  getSignedUrl.mockClear();
});

describe('s3 storage driver (mocked client)', () => {
  it('put sends Bucket, Key, Body and ContentType', async () => {
    const body = Buffer.from('png');
    await createS3Storage({ client, bucket: 'b' }).put(key, body, 'image/png');
    const cmd = client.send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('PutObjectCommand');
    expect(cmd.input).toEqual({ Bucket: 'b', Key: key, Body: body, ContentType: 'image/png' });
  });

  it('getUrl returns a pre-signed URL valid for 900 seconds', async () => {
    const url = await createS3Storage({ client, bucket: 'b' }).getUrl(key);
    expect(url).toBe('https://bucket.s3.amazonaws.com/signed');
    const [c, cmd, opts] = getSignedUrl.mock.calls[0];
    expect(c).toBe(client);
    expect(cmd.input).toEqual({ Bucket: 'b', Key: key });
    expect(opts).toEqual({ expiresIn: 900 });
  });

  it('delete calls DeleteObject and swallows failures', async () => {
    const s = createS3Storage({ client, bucket: 'b' });
    await s.delete(key);
    const cmd = client.send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('DeleteObjectCommand');
    expect(cmd.input).toEqual({ Bucket: 'b', Key: key });
    client.send.mockRejectedValueOnce(new Error('boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(s.delete(key)).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('rejects invalid keys without calling S3', async () => {
    const s = createS3Storage({ client, bucket: 'b' });
    for (const bad of ['../x', 'qr/abc.png', `x/${'a'.repeat(32)}.png`, `qr/${'a'.repeat(32)}.txt`]) {
      await expect(s.put(bad, Buffer.from('x'), 'image/png')).rejects.toThrow('Invalid storage key');
      await expect(s.getUrl(bad)).rejects.toThrow('Invalid storage key');
      await expect(s.delete(bad)).rejects.toThrow('Invalid storage key');
    }
    expect(client.send).not.toHaveBeenCalled();
  });

  it('errors clearly when the bucket is missing', async () => {
    const s = createS3Storage({ client, bucket: '' });
    await expect(s.put(key, Buffer.from('x'), 'image/png')).rejects.toThrow(/S3_ASSETS_BUCKET/);
    const original = { d: config.storageDriver, b: config.s3AssetsBucket };
    config.storageDriver = 's3';
    config.s3AssetsBucket = '';
    try {
      expect(() => getStorage()).toThrow(/S3_ASSETS_BUCKET/);
    } finally {
      config.storageDriver = original.d;
      config.s3AssetsBucket = original.b;
    }
  });
});
