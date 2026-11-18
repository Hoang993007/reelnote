import type { FastifyInstance } from 'fastify';
import { currentUser } from './auth-hook.js';
import type { LoginLimiter } from './login-limiter.js';
import { timingDummyHash, verifyPassword } from './password.js';
import { clearSessionCookie, setSessionCookie } from './session-cookie.js';
import { sessionService } from './session-service.js';
import { toPublicUser, userService } from './user-service.js';

const credentialsSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', minLength: 1, maxLength: 254 },
      password: { type: 'string', minLength: 1, maxLength: 256 },
      /** "Keep me signed in on this device"; off ends the session cookie with the browser. Default on. */
      remember: { type: 'boolean' },
    },
  },
} as const;

const passwordChangeSchema = {
  body: {
    type: 'object',
    required: ['currentPassword', 'newPassword'],
    additionalProperties: false,
    properties: {
      currentPassword: { type: 'string', minLength: 1, maxLength: 256 },
      newPassword: { type: 'string', minLength: 1, maxLength: 256 },
    },
  },
} as const;

export async function authRoutes(app: FastifyInstance, { limiter }: { limiter: LoginLimiter }) {
  app.post<{ Body: { email: string; password: string; remember?: boolean } }>('/auth/login', { schema: credentialsSchema }, async (req, reply) => {
    const email = req.body.email.trim().toLowerCase();
    const waitMs = limiter.check(email);
    if (waitMs > 0) {
      const minutes = Math.ceil(waitMs / 60_000);
      reply.header('Retry-After', String(Math.ceil(waitMs / 1000)));
      return reply.code(429).send({ error: `Too many attempts. Try again in ${minutes} min.`, code: 'rate-limited' });
    }
    const user = userService.findByEmail(email);
    const ok = await verifyPassword(req.body.password, user?.passwordHash ?? await timingDummyHash());
    if (!user || !ok || user.disabledAt !== null) {
      limiter.recordFailure(email);
      return reply.code(401).send({ error: 'Email or password is wrong.', code: 'invalid-credentials' });
    }
    limiter.recordSuccess(email);
    const persistent = req.body.remember !== false;
    const { token, expiresAt } = sessionService.create(user.id, new Date(), persistent);
    setSessionCookie(req, reply, token, expiresAt, persistent);
    return { user: toPublicUser(user) };
  });

  app.post('/auth/logout', async (req, reply) => {
    if (req.sessionId) sessionService.revoke(req.sessionId);
    clearSessionCookie(req, reply);
    return reply.code(204).send();
  });

  // The owner's name too: a friend's UI says whose notes and PC these are.
  app.get('/auth/me', async (req) => ({
    user: toPublicUser(userService.require(currentUser(req).id)),
    ownerName: userService.owner()?.displayName ?? null,
  }));

  app.put<{ Body: { currentPassword: string; newPassword: string } }>('/auth/password', { schema: passwordChangeSchema }, async (req, reply) => {
    const user = userService.require(currentUser(req).id);
    if (!(await verifyPassword(req.body.currentPassword, user.passwordHash))) {
      return reply.code(400).send({ error: 'Current password is wrong.', code: 'invalid-credentials' });
    }
    await userService.setPassword(user.id, req.body.newPassword, req.sessionId ?? undefined);
    return reply.code(204).send();
  });

  app.get('/health', async () => ({ ok: true }));
}
