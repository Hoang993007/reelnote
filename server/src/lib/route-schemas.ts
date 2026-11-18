/** Reusable Fastify JSON schemas for route parameters */

/** Validates :id as a non-negative integer — Fastify coerces and rejects NaN */
export const idParamSchema = {
  schema: {
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'integer', minimum: 1 },
      },
    },
  },
} as const;
