import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { validate } from '../../middleware/validate.js';
import { HttpError } from '../../middleware/errors.js';

export const adminSlotsRouter = Router();

const COLUMNS = 'id, code, vehicle_type, hourly_rate, daily_rate, is_blocked';

// NUMERIC(10,2): at most 2 decimals, below 10^8.
const rate = z
  .number()
  .min(0)
  .max(99999999.99)
  .refine((n) => /^\d+(\.\d{1,2})?$/.test(String(n)), 'At most 2 decimal places');
const code = z.string().trim().min(1).max(20);
const vehicleType = z.enum(['car', 'bike']);

const idParams = z.object({ id: z.string().regex(/^\d{1,9}$/, 'Invalid id').transform(Number) });

const createBody = z.object({
  code,
  vehicle_type: vehicleType,
  hourly_rate: rate,
  daily_rate: rate,
});

const patchBody = z
  .object({
    code: code.optional(),
    vehicle_type: vehicleType.optional(),
    hourly_rate: rate.optional(),
    daily_rate: rate.optional(),
    is_blocked: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to change');

adminSlotsRouter.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM slots WHERE facility_id = $1 ORDER BY code`,
    [req.space.id],
  );
  res.json({ slots: rows });
});

adminSlotsRouter.post('/', validate({ body: createBody }), async (req, res) => {
  const b = req.valid.body;
  const { rows } = await pool.query(
    `INSERT INTO slots (facility_id, code, vehicle_type, hourly_rate, daily_rate)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
    [req.space.id, b.code, b.vehicle_type, b.hourly_rate, b.daily_rate],
  );
  res.status(201).json(rows[0]);
});

adminSlotsRouter.patch('/:id', validate({ params: idParams, body: patchBody }), async (req, res) => {
  const b = req.valid.body;
  const sets = [];
  const values = [];
  // Column names come from this fixed list, never from the request.
  for (const col of ['code', 'vehicle_type', 'hourly_rate', 'daily_rate', 'is_blocked']) {
    if (b[col] !== undefined) {
      values.push(b[col]);
      sets.push(`${col} = $${values.length}`);
    }
  }
  values.push(req.valid.params.id, req.space.id);
  const idParam = values.length - 1;
  const facilityParam = values.length;
  const row = await withTransaction(async (client) => {
    if (b.vehicle_type !== undefined) {
      // Lock the slot, then refuse a type change while it has live bookings.
      const slot = await client.query(
        'SELECT vehicle_type FROM slots WHERE id = $1 AND facility_id = $2 FOR UPDATE',
        [req.valid.params.id, req.space.id],
      );
      if (slot.rows[0] && slot.rows[0].vehicle_type !== b.vehicle_type) {
        const live = await client.query(
          `SELECT 1 FROM bookings
            WHERE slot_id = $1 AND status IN ('confirmed', 'checked_in') AND ends_at > now() LIMIT 1`,
          [req.valid.params.id],
        );
        if (live.rowCount) throw new HttpError(409, 'Slot has active bookings; its type cannot change');
      }
    }
    const { rows } = await client.query(
      `UPDATE slots SET ${sets.join(', ')}
        WHERE id = $${idParam} AND facility_id = $${facilityParam}
        RETURNING ${COLUMNS}`,
      values,
    );
    return rows[0];
  });
  if (!row) throw new HttpError(404, 'Slot not found');
  res.json(row);
});

// A slot that was ever booked fails with 23503 (bookings_slot_id_fkey), mapped to 409 (D13).
adminSlotsRouter.delete('/:id', validate({ params: idParams }), async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM slots WHERE id = $1 AND facility_id = $2', [
    req.valid.params.id,
    req.space.id,
  ]);
  if (!rowCount) throw new HttpError(404, 'Slot not found');
  res.status(204).end();
});
