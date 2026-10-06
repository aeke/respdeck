import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../apps/api/src/store';
import { RedisService } from '../apps/api/src/redis';
import { translateError } from '../apps/api/src/errors';
describe.skipIf(!process.env.REDIS_TLS_TEST_PORT || !process.env.REDIS_TLS_TEST_CA)(
  'verified TLS connection',
  () => {
    it('accepts the supplied CA and rejects an untrusted certificate', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'respdeck-tls-test-')),
        store = new Store(dir),
        service = new RedisService(store);
      const input = {
        name: 'TLS',
        host: 'localhost',
        port: Number(process.env.REDIS_TLS_TEST_PORT),
        tls: true,
        readOnly: true,
        color: 'teal',
      };
      try {
        expect(
          await service.test({
            ...input,
            ca: readFileSync(process.env.REDIS_TLS_TEST_CA!, 'utf8'),
          }),
        ).toEqual({ ok: true });
        let failure: unknown;
        try {
          await service.test(input);
        } catch (e) {
          failure = e;
        }
        expect(failure).toBeDefined();
        expect(translateError(failure).code).toBe('TLS_ERROR');
      } finally {
        await service.disconnect();
        store.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  },
);
