import Fastify, { LogController, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import staticFiles from '@fastify/static';
import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { keyTypes } from '../../../packages/contracts/src/index.js';
import { Store } from './store.js';
import { RedisService, keyBuffer } from './redis.js';
import { AppError, translateError } from './errors.js';

const scryptAsync = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
export interface AppOptions {
  dataDir?: string;
  encryptionKey?: string;
  origin?: string;
  secureCookie?: boolean;
  webDir?: string;
  logger?: boolean;
  onSetupCode?: (code: string) => void;
}
const connectionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  host: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .refine((v) => !/[\s/@]/.test(v)),
  port: z.number().int().min(1).max(65535).default(6379),
  username: z.string().max(256).optional(),
  password: z.string().max(4096).optional(),
  tls: z.boolean().default(false),
  ca: z.string().max(65536).optional(),
  readOnly: z.boolean().default(true),
  color: z.enum(['violet', 'teal', 'amber']).default('violet'),
});
const seconds = z.number().int().min(1).max(2147483647).nullable();
const valueSchema = z
  .string()
  .max(1024 * 1024)
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 1024 * 1024, 'Value exceeds 1 MiB.');
const keyNameSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 4096, 'Key name exceeds 4096 bytes.');
const createSchema = z.object({
  name: keyNameSchema,
  type: z.enum(keyTypes),
  value: valueSchema,
  ttl: seconds.default(null),
});
const stringSchema = z.object({
  value: valueSchema,
  version: z.string().regex(/^[a-f0-9]{40}$/),
});
const mutationSchema = z.object({
  action: z.enum(['add', 'update', 'remove']),
  id: z.string().max(8192).optional(),
  label: z.string().max(4096).optional(),
  value: valueSchema.optional(),
  score: z.number().finite().optional(),
  fields: z.record(z.string().max(4096), z.string().max(65536)).optional(),
  original: valueSchema.optional(),
});
const paramsSchema = z.object({
  id: z.string().uuid(),
  db: z.coerce.number().int().min(0).max(63),
  key: z.string().max(8192).optional(),
});
const pageSchema = z.object({
  cursor: z
    .string()
    .regex(/^\d+(?:-\d+)?$/)
    .max(64)
    .default('0'),
  pattern: z.string().max(4096).default('*'),
  type: z.enum(keyTypes).optional(),
});
const json = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { unrepresentable: 'any', target: 'draft-7' });

export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({
    logger: options.logger
      ? {
          level: 'info',
          redact: [
            'req.headers.cookie',
            'req.headers.authorization',
            'password',
            'value',
            'secret',
          ],
        }
      : false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 2 * 1024 * 1024,
    requestTimeout: 15000,
  });
  const store = new Store(options.dataDir ?? resolve('data'), options.encryptionKey);
  const redis = new RedisService(store);
  const sessions = new Map<string, { csrf: string; expires: number }>();
  let setupDigest: Buffer | undefined;
  if (!store.getAdministrator()) {
    const code = randomBytes(32).toString('base64url');
    setupDigest = createHash('sha256').update(code).digest();
    (options.onSetupCode ?? ((value) => app.log.warn(`RESPdeck setup code: ${value}`)))(code);
  }
  const getSession = (token?: string) => {
    if (!token) return;
    const s = sessions.get(token);
    if (!s) return;
    if (s.expires < Date.now()) {
      sessions.delete(token);
      return;
    }
    return s;
  };
  const pruneSessions = setInterval(() => {
    for (const [token, session] of sessions)
      if (session.expires < Date.now()) sessions.delete(token);
    if (!sessions.size) void redis.disconnect();
  }, 60000);
  pruneSessions.unref();
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'RESPdeck API',
        version: '0.1.0',
        description:
          'Single-user Redis workspace. Session cookie and X-CSRF-Token are required for mutations.',
      },
      components: {
        securitySchemes: {
          session: { type: 'apiKey', in: 'cookie', name: 'respdeck_session' },
        },
      },
    },
  });
  app.addHook('onRequest', async (req, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('X-Frame-Options', 'DENY')
      .header('Referrer-Policy', 'same-origin');
    if (req.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const allowed = options.origin ? [options.origin] : [`http://${req.headers.host}`];
        // Vite's local development proxy preserves the browser origin.
        if (!options.origin && /^(localhost|127\.0\.0\.1):4310$/.test(req.headers.host ?? ''))
          allowed.push('http://127.0.0.1:5173', 'http://localhost:5173');
        if (!req.headers.origin || !allowed.includes(req.headers.origin))
          throw new AppError(403, 'ORIGIN_REJECTED', 'Request origin is not allowed.');
      }
      const publicRoute = req.url.split('?')[0];
      if (
        publicRoute === '/api/v1/session' ||
        publicRoute === '/api/v1/login' ||
        publicRoute === '/api/v1/setup'
      )
        return;
      if (!store.getAdministrator())
        throw new AppError(503, 'ADMIN_NOT_CONFIGURED', 'Complete first-run setup to enable real connections.');
      const session = getSession(req.cookies.respdeck_session);
      if (!session)
        throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to access your Redis connections.');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-csrf-token'] !== session.csrf)
        throw new AppError(403, 'CSRF_REJECTED', 'Your session changed. Sign in again.');
    }
  });
  app.setErrorHandler((error, _req, reply) => {
    const validation = (error as { validation?: unknown }).validation;
    const e =
      validation || error instanceof z.ZodError
        ? new AppError(400, 'INVALID_REQUEST', 'Check the request fields and try again.')
        : (error as { statusCode?: number }).statusCode === 429
          ? new AppError(429, 'RATE_LIMITED', 'Too many sign-in attempts. Try again in a minute.')
          : translateError(error);
    reply.code(e.status).send({ code: e.code, message: e.message });
  });
  app.get('/health', async () => ({ status: 'ok', version: '0.1.0' }));
  app.get('/api/v1/session', async (req) => {
    const s = getSession(req.cookies.respdeck_session);
    const administrator = store.getAdministrator();
    return {
      configured: !!administrator,
      authenticated: !!s,
      onboardingComplete: administrator?.onboardingComplete ?? false,
      csrfToken: s?.csrf,
      encryptionEnabled: store.encryptionEnabled,
    };
  });
  const issueSession = async (reply: FastifyReply, onboardingComplete: boolean) => {
    sessions.clear();
    await redis.disconnect();
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(32).toString('base64url');
    sessions.set(token, { csrf, expires: Date.now() + 8 * 3600_000 });
    reply.setCookie('respdeck_session', token, {
      httpOnly: true, sameSite: 'strict', secure: options.secureCookie ?? false, path: '/', maxAge: 8 * 3600,
    });
    return { configured: true, authenticated: true, onboardingComplete, csrfToken: csrf, encryptionEnabled: store.encryptionEnabled };
  };
  const setupSchema = z.object({
    setupCode: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    password: z.string().min(12).max(4096),
  }).strict();
  app.post('/api/v1/setup', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { body: json(setupSchema) },
  }, async (req, reply) => {
    if (store.getAdministrator()) throw new AppError(409, 'SETUP_ALREADY_COMPLETED', 'Administrator setup has already been completed.');
    const body = setupSchema.parse(req.body);
    const candidate = createHash('sha256').update(body.setupCode).digest();
    if (!setupDigest || !timingSafeEqual(candidate, setupDigest))
      throw new AppError(403, 'INVALID_SETUP_CODE', 'The setup code is invalid.');
    const salt = randomBytes(16);
    const hash = await scryptAsync(body.password, salt);
    if (!store.createAdministrator(salt.toString('base64'), hash.toString('base64')))
      throw new AppError(409, 'SETUP_ALREADY_COMPLETED', 'Administrator setup has already been completed.');
    setupDigest = undefined;
    return issueSession(reply, false);
  });
  const loginSchema = z.object({ password: z.string().max(4096) });
  app.post('/api/v1/login', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { body: json(loginSchema) },
  }, async (req, reply) => {
    const administrator = store.getAdministrator();
    if (!administrator)
      throw new AppError(503, 'ADMIN_NOT_CONFIGURED', 'Complete first-run setup to enable real connections.');
    const body = loginSchema.parse(req.body);
    const candidate = await scryptAsync(body.password, Buffer.from(administrator.salt, 'base64'));
    const expected = Buffer.from(administrator.passwordHash, 'base64');
    if (!timingSafeEqual(candidate, expected))
      throw new AppError(401, 'INVALID_PASSWORD', 'Incorrect administrator password.');
    return issueSession(reply, administrator.onboardingComplete);
  });
  app.post('/api/v1/setup/complete', { schema: { body: json(z.object({}).strict()) } }, async (req) => {
    store.completeOnboarding();
    const administrator = store.getAdministrator()!;
    return {
      configured: true, authenticated: true, onboardingComplete: administrator.onboardingComplete,
      csrfToken: getSession(req.cookies.respdeck_session)?.csrf, encryptionEnabled: store.encryptionEnabled,
    };
  });
  app.post('/api/v1/logout', async (_req, reply) => {
    sessions.clear();
    await redis.disconnect();
    reply.clearCookie('respdeck_session', { path: '/' });
    return { ok: true };
  });
  app.get('/api/v1/connections', async () => store.list());
  app.post('/api/v1/connections/test', { schema: { body: json(connectionSchema) } }, async (req) =>
    redis.test(connectionSchema.parse(req.body)),
  );
  app.post(
    '/api/v1/connections/:id/test',
    { schema: { body: json(connectionSchema) } },
    async (req) => {
      const id = z
        .string()
        .uuid()
        .parse((req.params as { id: string }).id);
      const stored = store.get(id);
      const input = connectionSchema.parse(req.body);
      return redis.test({
        ...input,
        password: input.password ?? stored.password,
        ca: input.ca ?? stored.ca,
      });
    },
  );
  app.post(
    '/api/v1/connections',
    { schema: { body: json(connectionSchema) } },
    async (req, reply) => {
      reply.code(201);
      return store.save(connectionSchema.parse(req.body));
    },
  );
  app.put('/api/v1/connections/:id', { schema: { body: json(connectionSchema) } }, async (req) => {
    const id = z
      .string()
      .uuid()
      .parse((req.params as { id: string }).id);
    store.public(id);
    await redis.disconnect(id);
    return store.save(connectionSchema.parse(req.body), id);
  });
  app.delete('/api/v1/connections/:id', async (req) => {
    const id = z
      .string()
      .uuid()
      .parse((req.params as { id: string }).id);
    await redis.disconnect(id);
    store.remove(id);
    return { ok: true };
  });
  const base = '/api/v1/connections/:id/databases/:db';
  const params = (p: unknown) => paramsSchema.parse(p);
  app.get(`${base}/summary`, async (req) => {
    const p = params(req.params);
    return redis.summary(p.id, p.db);
  });
  app.get(
    `${base}/keys`,
    {
      schema: {
        querystring: json(
          z.object({
            cursor: z.string().default('0'),
            pattern: z.string().default('*'),
            type: z.enum(keyTypes).optional(),
          }),
        ),
      },
    },
    async (req) => {
      const p = params(req.params),
        q = pageSchema.parse(req.query);
      if (!/^\d+$/.test(q.cursor))
        throw new AppError(400, 'INVALID_CURSOR', 'Invalid scan cursor.');
      return redis.scan(p.id, p.db, q.cursor, q.pattern, q.type);
    },
  );
  app.post(`${base}/keys`, { schema: { body: json(createSchema) } }, async (req, reply) => {
    const p = params(req.params),
      b = createSchema.parse(req.body);
    reply.code(201);
    return redis.createKey(p.id, p.db, b.name, b.type, b.value, b.ttl);
  });
  app.get(`${base}/keys/:key`, async (req) => {
    const p = params(req.params),
      q = pageSchema.parse(req.query);
    return redis.read(p.id, p.db, keyBuffer(p.key!), q.cursor);
  });
  app.put(`${base}/keys/:key/value`, { schema: { body: json(stringSchema) } }, async (req) => {
    const p = params(req.params),
      b = stringSchema.parse(req.body);
    await redis.saveString(p.id, p.db, keyBuffer(p.key!), b.value, b.version);
    return { ok: true };
  });
  app.patch(
    `${base}/keys/:key/ttl`,
    { schema: { body: json(z.object({ seconds })) } },
    async (req) => {
      const p = params(req.params);
      await redis.ttl(
        p.id,
        p.db,
        keyBuffer(p.key!),
        (req.body as { seconds: number | null }).seconds,
      );
      return { ok: true };
    },
  );
  app.patch(
    `${base}/keys/:key/name`,
    { schema: { body: json(z.object({ name: keyNameSchema })) } },
    async (req) => {
      const p = params(req.params);
      const body = z.object({ name: keyNameSchema }).parse(req.body);
      return redis.rename(p.id, p.db, keyBuffer(p.key!), body.name);
    },
  );
  app.delete(`${base}/keys/:key`, async (req) => {
    const p = params(req.params);
    await redis.deleteKey(p.id, p.db, keyBuffer(p.key!));
    return { ok: true };
  });
  app.post(
    `${base}/keys/:key/entries`,
    {
      schema: {
        body: json(mutationSchema),
        querystring: json(z.object({ type: z.enum(keyTypes) })),
      },
    },
    async (req) => {
      const p = params(req.params);
      const type = z.enum(keyTypes).parse((req.query as { type: string }).type);
      await redis.mutate(p.id, p.db, keyBuffer(p.key!), type, mutationSchema.parse(req.body));
      return { ok: true };
    },
  );
  await app.register(swaggerUI, { routePrefix: '/api/docs' });
  const webDir = options.webDir ?? resolve('../web/dist');
  if (existsSync(webDir)) {
    await app.register(staticFiles, { root: webDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/'))
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Endpoint not found.' });
      return reply.sendFile('index.html');
    });
  }
  app.addHook('onClose', async () => {
    clearInterval(pruneSessions);
    sessions.clear();
    await redis.disconnect();
    store.close();
  });
  return { app, store, redis };
}
