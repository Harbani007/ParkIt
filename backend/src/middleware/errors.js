import { mapPgError } from '../db/errors.js';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function notFound(req, _res, next) {
  next(new HttpError(404, `Not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(rawErr, _req, res, _next) {
  const err = mapPgError(rawErr);
  const status = err.status ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : err.message,
    ...(err.details ? { details: err.details } : {}),
  });
}
