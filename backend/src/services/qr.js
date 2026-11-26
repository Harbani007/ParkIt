import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { getStorage } from './storage.js';

// Renders a PNG QR of the booking code only (D19) and stores it under a random key.
// The key reveals nothing about the booking. Returns the key.
export async function prepareQr(bookingCode, storage = getStorage()) {
  const png = await QRCode.toBuffer(bookingCode, { type: 'png', margin: 2, width: 300 });
  const key = `qr/${randomBytes(16).toString('hex')}.png`;
  await storage.put(key, png, 'image/png');
  return key;
}

export const createQr = prepareQr;
