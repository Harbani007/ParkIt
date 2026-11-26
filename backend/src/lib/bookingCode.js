import crypto from 'node:crypto';

// 32 characters, so `byte % 32` is unbiased (256 / 32 is exact). No I, O, 0, 1 (D14).
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** randomBytes(n) must return n random bytes; injectable for tests. */
export function generateBookingCode(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(6);
  let code = 'PK-';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[bytes[i] % 32];
  return code;
}
