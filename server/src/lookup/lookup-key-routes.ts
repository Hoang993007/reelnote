import type { FastifyInstance } from 'fastify';
import { currentUser } from '../auth/auth-hook.js';
import { requireOwner } from '../access/guards.js';
import { lookupKeyService } from './lookup-key-service.js';

const keyBody = {
  body: {
    type: 'object',
    required: ['key'],
    additionalProperties: false,
    properties: { key: { type: ['string', 'null'], maxLength: 256 } },
  },
} as const;

/**
 * Word lookup keys, set in the app: everyone sets or clears their own Gemini API key; the owner sets the shared
 * one. Answers carry only the last four characters of a key, never the key.
 */
export async function lookupKeyRoutes(app: FastifyInstance) {
  app.get('/lookup-keys', async (req) => {
    const user = currentUser(req);
    return lookupKeyService.status(user.id, user.role === 'owner');
  });

  app.put<{ Body: { key: string | null } }>('/lookup-keys/own', { schema: keyBody }, async (req) => {
    const user = currentUser(req);
    lookupKeyService.setOwn(user.id, req.body.key);
    return lookupKeyService.status(user.id, user.role === 'owner');
  });

  app.put<{ Body: { key: string | null } }>('/lookup-keys/shared', { schema: keyBody }, async (req) => {
    const user = currentUser(req);
    requireOwner(user);
    lookupKeyService.setShared(req.body.key);
    return lookupKeyService.status(user.id, true);
  });
}
