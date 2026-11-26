import { pool } from './pool.js';

// Runs fn(client) in a transaction; commits on success, rolls back on error, always releases.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // keep the original error
    }
    throw err;
  } finally {
    client.release();
  }
}
