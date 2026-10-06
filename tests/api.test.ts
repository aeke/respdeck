import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { buildApp } from '../apps/api/src/app';
import { Store } from '../apps/api/src/store';
import { keyBuffer, keyId } from '../apps/api/src/redis';
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
function dir() {
  const d = mkdtempSync(join(tmpdir(), 'respdeck-'));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}
const input = {
  name: 'Test',
  host: '127.0.0.1',
  port: 6399,
  tls: false,
  readOnly: true,
  color: 'teal',
};
async function setup(password = 'test-admin-password') {
  const result = await buildApp({
    dataDir: dir(),
    password,
    origin: 'http://localhost',
  });
  cleanups.push(() => result.app.close());
  await result.app.ready();
  return result;
}
async function signIn(app: Awaited<ReturnType<typeof buildApp>>['app']) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/login',
    headers: { origin: 'http://localhost' },
    payload: { password: 'test-admin-password' },
  });
  expect(response.statusCode).toBe(200);
  return {
    cookie: response.cookies[0].name + '=' + response.cookies[0].value,
    origin: 'http://localhost',
    'x-csrf-token': response.json().csrfToken,
  };
}
describe('session and API boundary', () => {
  it('keeps real connections disabled until an administrator is configured', async () => {
    const { app } = await setup('');
    expect((await app.inject('/api/v1/session')).json().configured).toBe(false);
    expect((await app.inject('/api/v1/connections')).statusCode).toBe(503);
  });
  it('requires a session, same origin and CSRF token for writes', async () => {
    const { app } = await setup();
    expect((await app.inject('/api/v1/connections')).statusCode).toBe(401);
    const headers = await signIn(app);
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/connections',
      headers: { cookie: headers.cookie, origin: headers.origin },
      payload: input,
    });
    expect(missing.json().code).toBe('CSRF_REJECTED');
    const cross = await app.inject({
      method: 'POST',
      url: '/api/v1/connections',
      headers: { ...headers, origin: 'http://evil.example' },
      payload: input,
    });
    expect(cross.json().code).toBe('ORIGIN_REJECTED');
    const saved = await app.inject({
      method: 'POST',
      url: '/api/v1/connections',
      headers,
      payload: { ...input, password: 'redis-secret' },
    });
    expect(saved.statusCode).toBe(201);
    expect(saved.json()).not.toHaveProperty('password');
    expect(saved.json().passwordStorage).toBe('session');
    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/logout',
      headers,
    });
    expect(logout.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/connections', headers })).statusCode).toBe(401);
  });
  it('validates connections and publishes an authenticated OpenAPI document', async () => {
    const { app } = await setup();
    const headers = await signIn(app);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/connections',
      headers,
      payload: { ...input, port: 99999 },
    });
    expect(bad.statusCode).toBe(400);
    const spec = await app.inject({ url: '/api/docs/json', headers });
    expect(spec.statusCode).toBe(200);
    expect(spec.json().paths['/api/v1/connections']).toBeDefined();
  });
  it('limits sign-in attempts', async () => {
    const { app } = await setup();
    let response;
    for (let i = 0; i < 6; i++)
      response = await app.inject({
        method: 'POST',
        url: '/api/v1/login',
        headers: { origin: 'http://localhost' },
        payload: { password: 'wrong' },
      });
    expect(response!.statusCode).toBe(429);
  });
});
describe('credential storage', () => {
  it('encrypts credentials and restores them without returning secrets in metadata', () => {
    const d = dir(),
      key = randomBytes(32).toString('base64');
    let store = new Store(d, key);
    const c = store.save({
      ...input,
      password: 'highly-sensitive-test-password',
    });
    expect(store.get(c.id).password).toBe('highly-sensitive-test-password');
    expect(store.public(c.id)).not.toHaveProperty('password');
    store.close();
    expect(
      readFileSync(join(d, 'respdeck.sqlite')).includes(
        Buffer.from('highly-sensitive-test-password'),
      ),
    ).toBe(false);
    store = new Store(d, key);
    expect(store.get(c.id).password).toBe('highly-sensitive-test-password');
    store.save({ ...input, name: 'Renamed' }, c.id);
    expect(store.get(c.id).password).toBe('highly-sensitive-test-password');
    store.close();
  });
  it('never persists a password without an encryption key', () => {
    const d = dir();
    let store = new Store(d);
    const c = store.save({ ...input, password: 'session-only-secret' });
    expect(store.get(c.id).password).toBe('session-only-secret');
    store.close();
    store = new Store(d);
    expect(store.get(c.id).password).toBeUndefined();
    expect(store.public(c.id).hasPassword).toBe(false);
    store.close();
  });
  it('rejects the wrong encryption key and permits credential recovery', () => {
    const d = dir();
    let store = new Store(d, randomBytes(32).toString('base64'));
    const c = store.save({ ...input, password: 'secret' });
    store.close();
    store = new Store(d, randomBytes(32).toString('base64'));
    expect(() => store.get(c.id)).toThrow('decrypt');
    store.save({ ...input, password: 'new-secret' }, c.id);
    expect(store.get(c.id).password).toBe('new-secret');
    store.close();
  });
});
it('round-trips binary key identifiers and rejects noncanonical encodings', () => {
  const key = Buffer.from([0, 255, 47, 128]);
  expect(keyBuffer(keyId(key))).toEqual(key);
  expect(() => keyBuffer('%%%')).toThrow();
  expect(() => keyBuffer('k_a')).toThrow();
  expect(keyBuffer(keyId(''))).toEqual(Buffer.alloc(0));
});
