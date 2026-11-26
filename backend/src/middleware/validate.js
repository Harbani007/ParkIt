import { HttpError } from './errors.js';

// validate({ body, query, params }) with zod schemas. Parsed values go on req.valid.*;
// req.query is a getter in Express 5 and is never assigned.
export const validate = (schemas) => (req, _res, next) => {
  const valid = {};
  const details = [];
  for (const part of ['params', 'query', 'body']) {
    if (!schemas[part]) continue;
    const result = schemas[part].safeParse(req[part] ?? {});
    if (result.success) {
      valid[part] = result.data;
    } else {
      for (const issue of result.error.issues) {
        details.push({ path: [part, ...issue.path].join('.'), message: issue.message });
      }
    }
  }
  if (details.length) return next(new HttpError(400, 'Validation failed', details));
  req.valid = { ...req.valid, ...valid };
  next();
};
