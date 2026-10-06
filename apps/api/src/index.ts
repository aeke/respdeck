import { resolve } from 'node:path';
import { buildApp } from './app.js';
const { app } = await buildApp({
  dataDir: resolve(process.env.DATA_DIR ?? '../../data'),
  password: process.env.RESPDECK_ADMIN_PASSWORD || undefined,
  encryptionKey: process.env.RESPDECK_ENCRYPTION_KEY || undefined,
  origin: process.env.RESPDECK_ORIGIN || undefined,
  secureCookie: process.env.COOKIE_SECURE === 'true',
  webDir: resolve(process.env.WEB_DIR ?? '../web/dist'),
  logger: true,
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
await app.listen({
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 4310),
});
