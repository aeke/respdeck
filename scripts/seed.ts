import { createClient } from 'redis';
if (!process.env.REDIS_URL)
  throw new Error(
    'Set REDIS_URL to a disposable development Redis server. Existing keys are never cleared.',
  );
const client = createClient({ url: process.env.REDIS_URL });
client.on('error', () => {});
await client.connect();
try {
  await client.set(
    'respdeck:sample:user',
    JSON.stringify({ id: 1001, name: 'Alex Morgan', role: 'developer' }, null, 2),
    { NX: true },
  );
  await client.hSet('respdeck:sample:profile', { team: 'Platform', timezone: 'Europe/Istanbul' });
  await client.rPush('respdeck:sample:jobs', ['send_email', 'generate_report']);
  await client.sAdd('respdeck:sample:tags', ['redis', 'typescript', 'opensource']);
  await client.zAdd('respdeck:sample:scores', [
    { score: 120, value: 'alex' },
    { score: 95, value: 'sam' },
  ]);
  await client.xAdd('respdeck:sample:events', '*', { event: 'sample.created', source: 'seed' });
  console.log('Added six synthetic respdeck:sample:* keys. No database flush performed.');
} finally {
  client.destroy();
}
