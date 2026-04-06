import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodTypeDef, type ZodType } from 'zod';
import { ValidationError } from '../utils/errors.js';

/**
 * Build a middleware that validates req[location] against a zod schema.
 * On success, the parsed (and coerced) value replaces req[location] so
 * downstream code gets the typed shape.
 *
 * We accept `ZodType<Output, ZodTypeDef, Input>` (rather than the narrower
 * single-arg `ZodSchema<T>`) so schemas with `.default()` / `.transform()`
 * compile cleanly — those have Input ≠ Output (e.g. `string → boolean` on
 * query params) and the old signature forced T to be invariant across both
 * sides. Output is what downstream code sees; Input is what the request may
 * send on the wire. On failure, throws VALIDATION_ERROR with a flat
 * field-keyed error map.
 */
export function validate<Output, Input = Output>(
  schema: ZodType<Output, ZodTypeDef, Input>,
  location: 'body' | 'query' | 'params' = 'body',
) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse(req[location]);
      // Re-assign so the handler sees the parsed/typed value.
      (req as unknown as Record<string, unknown>)[location] = parsed;
      return next();
    } catch (err) {
      if (err instanceof ZodError) {
        const flat = err.flatten();
        return next(
          ValidationError('Validation failed', {
            fields: flat.fieldErrors,
            formErrors: flat.formErrors,
          }),
        );
      }
      return next(err);
    }
  };
}
