import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from 'redis';
import { Store } from '../apps/api/src/store';
import { RedisService, keyId } from '../apps/api/src/redis';
import { buildApp } from '../apps/api/src/app';
import type { KeyType } from '../packages/contracts/src/index';
const enabled = process.env.RUN_REDIS_TESTS === '1';
const port = Number(process.env.REDIS_TEST_PORT ?? 6399);
describe.skipIf(!enabled)('real Redis integration (dedicated test server)', () => {
  const d = mkdtempSync(join(tmpdir(), 'respdeck-redis-'));
  const store = new Store(d),
    service = new RedisService(store),
    raw = createClient({ url: `redis://127.0.0.1:${port}/15` });
  const connection = store.save({
    name: 'Integration',
    host: '127.0.0.1',
    port,
    tls: false,
    readOnly: false,
    color: 'teal',
  });
  const key = (name: string) => Buffer.from(`respdeck-test:${name}`);
  beforeAll(async () => {
    await raw.connect();
    await raw.flushDb();
  });
  afterAll(async () => {
    await service.disconnect();
    store.close();
    if (raw.isOpen) {
      await raw.flushDb();
      raw.destroy();
    }
    rmSync(d, { recursive: true, force: true });
  });
  it('connects, reports server info and isolates database selection', async () => {
    expect(await service.test(store.get(connection.id))).toEqual({
      ok: true,
    });
    await raw.set(key('isolated'), 'in-db-15');
    const summary = await service.summary(connection.id, 15);
    expect(summary.version).toBeTruthy();
    expect(summary.databases).toContain(15);
    expect((await service.scan(connection.id, 14, '0', 'respdeck-test:*')).keys).toHaveLength(0);
  });
  it('preserves TTL and rejects stale string updates', async () => {
    await raw.set(key('value'), 'hello', { EX: 3600 });
    const first = await service.read(connection.id, 15, key('value'), '0');
    expect(first.value).toBe('hello');
    expect(first.editable).toBe(true);
    await service.saveString(connection.id, 15, key('value'), 'updated', first.version!);
    expect(await raw.ttl(key('value'))).toBeGreaterThan(3590);
    await expect(
      service.saveString(connection.id, 15, key('value'), 'stale', first.version!),
    ).rejects.toThrow('CONFLICT');
  });
  it('returns binary previews and prevents truncated string overwrites', async () => {
    await raw.set(key('binary'), Buffer.from([0, 255, 128, 47]));
    const binary = await service.read(connection.id, 15, key('binary'), '0');
    expect(binary.hex).toBe('00ff802f');
    expect(binary.editable).toBe(false);
    await raw.set(key('large'), 'x'.repeat(1024 * 1024 + 10));
    const big = await service.read(connection.id, 15, key('large'), '0');
    expect(big.truncated).toBe(true);
    expect(big.editable).toBe(false);
    expect(big.version).toBeUndefined();
    expect(big.value!.length).toBe(1024 * 1024);
  });
  it('reads empty key names through their opaque API identifier', async () => {
    await raw.set('', 'empty-name');
    expect((await service.read(connection.id, 15, Buffer.alloc(0), '0')).value).toBe('empty-name');
  });
  it('uses binary-safe key names in SCAN and key reads', async () => {
    const binaryKey = Buffer.from([255, 0, 65]);
    await raw.set(binaryKey, 'safe');
    let cursor = '0',
      found = false;
    do {
      const page = await service.scan(connection.id, 15, cursor, '*');
      found ||= page.keys.some((k) => k.id === keyId(binaryKey) && k.binary);
      cursor = page.cursor;
    } while (cursor !== '0');
    expect(found).toBe(true);
    expect((await service.read(connection.id, 15, binaryKey, '0')).value).toBe('safe');
  });
  it.each(['string', 'hash', 'list', 'set', 'zset', 'stream'] as KeyType[])(
    'creates and reads %s keys',
    async (type) => {
      const name = `respdeck-test:create:${type}`;
      await service.createKey(connection.id, 15, name, type, 'first', 3600);
      const data = await service.read(connection.id, 15, Buffer.from(name), '0');
      expect(data.type).toBe(type);
      expect(data.ttl).toBeGreaterThan(3590);
      expect(type === 'string' ? data.value : data.entries[0].value).toBe(
        type === 'stream' ? '{"message":"first"}' : 'first',
      );
      await expect(
        service.createKey(connection.id, 15, name, type, 'overwrite', null),
      ).rejects.toThrow('EXISTS');
    },
  );
  it('edits hash fields, detects lost updates and retains expiration', async () => {
    await raw.hSet(key('hash'), 'field', 'old');
    await raw.expire(key('hash'), 3600);
    await service.mutate(connection.id, 15, key('hash'), 'hash', {
      action: 'update',
      id: keyId('field'),
      original: 'old',
      value: 'new',
    });
    expect(await raw.hGet(key('hash'), 'field')).toBe('new');
    await expect(
      service.mutate(connection.id, 15, key('hash'), 'hash', {
        action: 'update',
        id: keyId('field'),
        original: 'old',
        value: 'stale',
      }),
    ).rejects.toThrow('CONFLICT');
    await service.mutate(connection.id, 15, key('hash'), 'hash', {
      action: 'add',
      label: 'another',
      value: 'v',
    });
    expect(await raw.ttl(key('hash'))).toBeGreaterThan(3590);
  });
  it('edits and removes a list by checked index without removing duplicate values', async () => {
    await raw.rPush(key('list'), ['same', 'middle', 'same']);
    await service.mutate(connection.id, 15, key('list'), 'list', {
      action: 'remove',
      id: '0',
      original: 'same',
    });
    expect(await raw.lRange(key('list'), 0, -1)).toEqual(['middle', 'same']);
    await service.mutate(connection.id, 15, key('list'), 'list', {
      action: 'update',
      id: '0',
      original: 'middle',
      value: 'changed',
    });
    expect((await service.read(connection.id, 15, key('list'), '0')).entries[0].value).toBe(
      'changed',
    );
  });
  it('mutates sets, sorted sets and streams', async () => {
    await raw.sAdd(key('set'), 'a');
    await service.mutate(connection.id, 15, key('set'), 'set', {
      action: 'add',
      value: 'b',
    });
    await service.mutate(connection.id, 15, key('set'), 'set', {
      action: 'remove',
      id: keyId('a'),
    });
    expect(await raw.sMembers(key('set'))).toEqual(['b']);
    await raw.zAdd(key('zset'), { score: 1, value: 'a' });
    await service.mutate(connection.id, 15, key('zset'), 'zset', {
      action: 'update',
      id: keyId('a'),
      score: 4,
    });
    expect(await raw.zScore(key('zset'), 'a')).toBe(4);
    await raw.xAdd(key('stream'), '*', { event: 'first' });
    await service.mutate(connection.id, 15, key('stream'), 'stream', {
      action: 'add',
      fields: { event: 'second' },
    });
    const stream = await service.read(connection.id, 15, key('stream'), '0');
    expect(stream.entries).toHaveLength(2);
    await service.mutate(connection.id, 15, key('stream'), 'stream', {
      action: 'remove',
      id: stream.entries[0].id,
    });
    expect(await raw.xLen(key('stream'))).toBe(1);
  });
  it('paginates collections without loading all members', async () => {
    await raw.rPush(
      key('pages'),
      Array.from({ length: 205 }, (_, i) => `item-${i}`),
    );
    const first = await service.read(connection.id, 15, key('pages'), '0');
    expect(first.entries).toHaveLength(100);
    expect(first.hasMore).toBe(true);
    const second = await service.read(connection.id, 15, key('pages'), first.cursor);
    expect(second.entries[0].value).toBe('item-100');
  });
  it('changes TTL, refuses rename collisions and handles missing keys', async () => {
    await raw.set(key('rename'), 'value');
    await service.ttl(connection.id, 15, key('rename'), 100);
    expect(await raw.ttl(key('rename'))).toBeGreaterThan(90);
    await service.ttl(connection.id, 15, key('rename'), null);
    expect(await raw.ttl(key('rename'))).toBe(-1);
    await raw.set(key('taken'), 'original');
    await expect(
      service.rename(connection.id, 15, key('rename'), key('taken').toString()),
    ).rejects.toThrow('already exists');
    await service.rename(connection.id, 15, key('rename'), key('renamed').toString());
    await service.deleteKey(connection.id, 15, key('renamed'));
    await expect(service.read(connection.id, 15, key('renamed'), '0')).rejects.toThrow(
      'deleted or expired',
    );
  });
  it('blocks every write on read-only connections including direct API calls', async () => {
    const { app } = await buildApp({
      dataDir: join(d, 'api'),
      password: 'integration-test-admin',
      origin: 'http://localhost',
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/login',
      headers: { origin: 'http://localhost' },
      payload: { password: 'integration-test-admin' },
    });
    const headers = {
      origin: 'http://localhost',
      cookie: `respdeck_session=${login.cookies[0].value}`,
      'x-csrf-token': login.json().csrfToken,
    };
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/connections',
      headers,
      payload: {
        name: 'Readonly',
        host: '127.0.0.1',
        port,
        tls: false,
        readOnly: true,
        color: 'teal',
      },
    });
    const id = response.json().id;
    const base = `/api/v1/connections/${id}/databases/15/keys`;
    const k = keyId(key('value'));
    const empty = await app.inject({ url: `${base}/${keyId('')}`, headers });
    expect(empty.json().value).toBe('empty-name');
    for (const [method, path, payload] of [
      ['POST', base, { name: 'blocked', type: 'string', value: 'x', ttl: null }],
      ['PUT', `${base}/${k}/value`, { value: 'x', version: '0'.repeat(40) }],
      ['PATCH', `${base}/${k}/ttl`, { seconds: 60 }],
      ['PATCH', `${base}/${k}/name`, { name: 'blocked' }],
      ['DELETE', `${base}/${k}`, undefined],
      ['POST', `${base}/${k}/entries?type=hash`, { action: 'add', label: 'a', value: 'b' }],
    ] as const) {
      const result = await app.inject({
        method,
        url: path,
        headers,
        payload,
      });
      expect(result.json().code).toBe('READ_ONLY');
    }
    await app.close();
  });
  it('rejects edits of protected values through the service', async () => {
    const data = await service.read(connection.id, 15, key('binary'), '0');
    await expect(
      service.saveString(connection.id, 15, key('binary'), 'overwrite', data.version!),
    ).rejects.toThrow('cannot be edited');
  });
  it('bounds large hash, list and stream pages before transferring them', async () => {
    await raw.hSet(key('oversized-hash'), 'large', 'x'.repeat(1024 * 1024 + 1));
    await raw.rPush(key('oversized-list'), 'x'.repeat(1024 * 1024 + 1));
    await raw.xAdd(key('oversized-stream'), '*', { value: 'x'.repeat(1024 * 1024 + 1) });
    for (const type of ['hash', 'list', 'stream'])
      await expect(service.read(connection.id, 15, key(`oversized-${type}`), '0')).rejects.toThrow(
        'PAGE_TOO_LARGE',
      );
  });
  it('releases connections and reopens them on demand', async () => {
    await service.disconnect(connection.id);
    expect((await service.read(connection.id, 15, key('value'), '0')).value).toBe('updated');
  });
  it('returns helpful errors for wrong credentials and denied ACL commands', async () => {
    await raw.sendCommand([
      'ACL',
      'SETUSER',
      'respdeck_test',
      'on',
      '>test-secret',
      '~*',
      '+ping',
      '+select',
      '+client',
    ]);
    const c = store.save({
      name: 'ACL',
      host: '127.0.0.1',
      port,
      username: 'respdeck_test',
      password: 'wrong',
      tls: false,
      readOnly: true,
      color: 'teal',
    });
    await expect(service.test(store.get(c.id))).rejects.toThrow('WRONGPASS');
    store.save({ ...store.get(c.id), password: 'test-secret' }, c.id);
    await expect(service.scan(c.id, 15, '0', '*')).rejects.toThrow('NOPERM');
    await service.disconnect(c.id);
    await raw.sendCommand(['ACL', 'DELUSER', 'respdeck_test']);
  });
});
