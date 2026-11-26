import { HttpError } from './errors.js';

// Small in-memory fixed-window limiter keyed on req.ip (set app 'trust proxy' behind proxies).
// Each call creates its own counters, so tests can use a fresh instance.
export function rateLimit({ windowMs = 60_000, max = 10, now = Date.now } = {}) {
  const hits = new Map(); // ip -> { count, resetAt }
  return (req, _res, next) => {
    const t = now();
    for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
    const key = req.ip ?? 'unknown';
    let entry = hits.get(key);
    if (!entry) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) return next(new HttpError(429, 'Too many attempts, try again in a minute'));
    next();
  };
}
