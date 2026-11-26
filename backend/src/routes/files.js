import { Router } from 'express';
import fs from 'node:fs/promises';
import { config } from '../config.js';
import { HttpError } from '../middleware/errors.js';
import { isValidKey, resolveLocal } from '../services/storage.js';

export const filesRouter = Router();

// Local storage driver only. Anything but qr/<32 hex>.png is 404 before the disk is touched.
filesRouter.get('/*key', async (req, res, next) => {
  try {
    const key = [].concat(req.params.key).join('/');
    if (config.storageDriver !== 'local' || !isValidKey(key)) throw new HttpError(404, `Not found: ${req.method} ${req.originalUrl}`);
    let data;
    try {
      data = await fs.readFile(resolveLocal(key));
    } catch (err) {
      if (err.code === 'ENOENT') throw new HttpError(404, `Not found: ${req.method} ${req.originalUrl}`);
      throw err;
    }
    res.type('image/png').send(data);
  } catch (err) {
    next(err);
  }
});
