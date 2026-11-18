import { networkInterfaces } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { sessionService } from '../auth/session-service.js';
import { requireOwner } from '../access/guards.js';
import { shareService } from '../access/share-service.js';
import { currentUser } from '../auth/auth-hook.js';
import { userService } from '../auth/user-service.js';
import { idParamSchema } from '../lib/route-schemas.js';

const passwordField = { type: 'string', minLength: 1, maxLength: 256 } as const;

/** The owner's administration: friend accounts and who can open (read) and change (write) which source. */
export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => requireOwner(currentUser(req)));

  // Each account with when it was last seen and, for a friend, the sources they can open and change.
  app.get('/admin/users', async () => {
    const seen = sessionService.lastSeenByUser();
    const access = shareService.accessByUser();
    return userService.list().map((user) => ({ ...user, lastSeenAt: seen.get(user.id) ?? null, ...(access.get(user.id) ?? { sourceIds: [], writeSourceIds: [] }) }));
  });

  app.put<{ Params: { id: string }; Body: { sourceIds: number[]; writeSourceIds?: number[] } }>(
    '/admin/users/:id/sources',
    {
      schema: {
        ...idParamSchema.schema,
        body: {
          type: 'object',
          required: ['sourceIds'],
          additionalProperties: false,
          properties: {
            sourceIds: { type: 'array', maxItems: 1000, items: { type: 'integer', minimum: 1 } },
            writeSourceIds: { type: 'array', maxItems: 1000, items: { type: 'integer', minimum: 1 } },
          },
        },
      },
    },
    async (req) => shareService.setForUser(Number(req.params.id), req.body.sourceIds, req.body.writeSourceIds ?? []),
  );

  // Where Reelnote can be opened: this PC's home-network addresses (when it listens beyond loopback) and the
  // Tailscale address, if the owner set REELNOTE_TAILSCALE_URL. Tailscale's own 100.x addresses are left out.
  app.get('/admin/addresses', async () => {
    const lan = Object.values(networkInterfaces()).flat()
      .filter((a) => a && a.family === 'IPv4' && !a.internal && !/^(100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|169\.254\.)/.test(a.address))
      .map((a) => `http://${a!.address}:${config.port}`);
    return { port: config.port, host: config.host, lan: config.host === '127.0.0.1' ? [] : lan, tailscale: config.tailscaleUrl };
  });

  app.post<{ Body: { email: string; displayName: string; password: string } }>(
    '/admin/users',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'displayName', 'password'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 254 },
            displayName: { type: 'string', minLength: 1, maxLength: 100 },
            password: passwordField,
          },
        },
      },
    },
    // Accounts created here are friends, who open every source until the owner unticks some; the one owner is created from the CLI.
    async (req, reply) => {
      const user = await userService.create({ ...req.body, role: 'friend' });
      shareService.shareAllWith(user.id);
      return reply.code(201).send(user);
    },
  );

  app.put<{ Params: { id: string }; Body: { disabled: boolean } }>(
    '/admin/users/:id/disabled',
    {
      schema: {
        ...idParamSchema.schema,
        body: { type: 'object', required: ['disabled'], additionalProperties: false, properties: { disabled: { type: 'boolean' } } },
      },
    },
    async (req) => userService.setDisabled(Number(req.params.id), req.body.disabled),
  );

  app.put<{ Params: { id: string }; Body: { password: string } }>(
    '/admin/users/:id/password',
    {
      schema: {
        ...idParamSchema.schema,
        body: { type: 'object', required: ['password'], additionalProperties: false, properties: { password: passwordField } },
      },
    },
    async (req, reply) => {
      await userService.setPassword(Number(req.params.id), req.body.password);
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string } }>('/admin/sources/:id/shares', idParamSchema, async (req) =>
    shareService.listForSource(Number(req.params.id)),
  );

  app.put<{ Params: { id: string }; Body: { userIds: number[]; writeUserIds?: number[] } }>(
    '/admin/sources/:id/shares',
    {
      schema: {
        ...idParamSchema.schema,
        body: {
          type: 'object',
          required: ['userIds'],
          additionalProperties: false,
          properties: {
            userIds: { type: 'array', maxItems: 100, items: { type: 'integer', minimum: 1 } },
            writeUserIds: { type: 'array', maxItems: 100, items: { type: 'integer', minimum: 1 } },
          },
        },
      },
    },
    async (req) => shareService.setForSource(Number(req.params.id), req.body.userIds, req.body.writeUserIds ?? []),
  );
}
