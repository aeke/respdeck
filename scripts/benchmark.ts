import { createClient } from 'redis';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../apps/api/src/store';
import { RedisService } from '../apps/api/src/redis';
if (process.env.RUN_REDIS_BENCHMARK !== '1')
  throw new Error(
    'Use RUN_REDIS_BENCHMARK=1 with a dedicated disposable Redis. This script clears database 14.',
  );
const port = Number(process.env.REDIS_TEST_PORT ?? 6399),
  db = 14;
const raw = createClient({ url: `redis://127.0.0.1:${port}/${db}` });
const dir = mkdtempSync(join(tmpdir(), 'respdeck-benchmark-'));
const store = new Store(dir),
  service = new RedisService(store);
const connection = store.save({
  name: 'Benchmark',
  host: '127.0.0.1',
  port,
  tls: false,
  readOnly: true,
  color: 'teal',
});
await raw.connect();
try {
  await raw.flushDb();
  for (let batch = 0; batch < 100; batch++) {
    const args: string[] = [];
    for (let i = 0; i < 1000; i++)
      args.push(`benchmark:${String(batch * 1000 + i).padStart(6, '0')}`, 'synthetic');
    await raw.sendCommand(['MSET', ...args]);
  }
  const started = performance.now();
  const first = await service.scan(connection.id, db, '0', 'benchmark:*');
  const elapsed = performance.now() - started;
  if (first.complete || first.keys.length < 1 || first.keys.length > 500)
    throw new Error('Expected a partial SCAN batch, not a full-keyspace load.');
  console.log(
    JSON.stringify(
      {
        totalKeys: await raw.dbSize(),
        firstBatchKeys: first.keys.length,
        firstBatchMs: Math.round(elapsed),
        complete: first.complete,
        responseBytes: Buffer.byteLength(JSON.stringify(first)),
      },
      null,
      2,
    ),
  );
} finally {
  await service.disconnect();
  store.close();
  await raw.flushDb();
  raw.destroy();
  rmSync(dir, { recursive: true, force: true });
}
