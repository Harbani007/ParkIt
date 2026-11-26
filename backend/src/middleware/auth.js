import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { HttpError } from './errors.js';

export function signToken(user) {
  return jwt.sign({ role: user.role }, config.jwtSecret, {
    subject: String(user.id),
    expiresIn: config.jwtExpiresIn,
    algorithm: 'HS256',
  });
}

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const match = /^Bearer (\S+)$/i.exec(header);
  if (!match) return next(new HttpError(401, 'Authentication required'));
  try {
    const payload = jwt.verify(match[1], config.jwtSecret, { algorithms: ['HS256'] });
    const id = Number(payload.sub);
    if (!Number.isInteger(id) || !payload.role) throw new Error('bad claims');
    req.user = { id, role: payload.role };
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired token'));
  }
}

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Authentication required'));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, 'Not allowed'));
    next();
  };
