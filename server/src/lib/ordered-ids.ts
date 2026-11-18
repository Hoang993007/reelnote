/** Full-order reorder requests: the body lists every child id of a parent once, in display order. */
import { ValidationError } from './errors.js';

/** Fastify body schema for `{ orderedIds }`; per-parent completeness is checked by `assertCompleteOrder`. */
export const orderedIdsBodySchema = {
  type: 'object',
  required: ['orderedIds'],
  properties: { orderedIds: { type: 'array', maxItems: 500, items: { type: 'integer', minimum: 1 } } },
} as const;

/**
 * Throws a ValidationError (400) unless `orderedIds` is a permutation of `existingIds`.
 * `field` names the body property in the message (e.g. `positions` for page videos).
 */
export function assertCompleteOrder(
  orderedIds: readonly number[],
  existingIds: readonly number[],
  children: string,
  field = 'orderedIds',
): void {
  const existing = new Set(existingIds);
  const requested = new Set(orderedIds);
  if (requested.size !== orderedIds.length || requested.size !== existing.size || orderedIds.some((id) => !existing.has(id))) {
    throw new ValidationError(`${field} must list every ${children} exactly once`);
  }
}
