import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync, unlinkSync } from 'node:fs';
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
async function setup(configure = true) {
  let code = '';
  const result = await buildApp({
    dataDir: dir(),
    origin: 'http://localhost',
    onSetupCode: (value) => { code = value; },
  });
  cleanups.push(() => result.app.close());
  await result.app.ready();
  if (configure) {
    const response = await result.app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: { origin: 'http://localhost' },
      payload: { setupCode: code, password: 'test-admin-password' },
    });
    expect(response.statusCode).toBe(200);
  }
  return { ...result, setupCode: code };
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
    const { app } = await setup(false);
    expect((await app.inject('/api/v1/session')).json()).toMatchObject({ configured: false, onboardingComplete: false });
    expect((await app.inject('/api/v1/connections')).statusCode).toBe(503);
  });
  it('requires a valid setup code and completes onboarding with authenticated CSRF', async () => {
    const { app, setupCode } = await setup(false);
    const wrong = await app.inject({
      method: 'POST', url: '/api/v1/setup', headers: { origin: 'http://localhost' },
      payload: { setupCode: 'A'.repeat(43), password: 'test-admin-password' },
    });
    expect(wrong.json().code).toBe('INVALID_SETUP_CODE');
    const missingOrigin = await app.inject({
      method: 'POST', url: '/api/v1/setup',
      payload: { setupCode, password: 'test-admin-password' },
    });
    expect(missingOrigin.json().code).toBe('ORIGIN_REJECTED');
    const claimed = await app.inject({
      method: 'POST', url: '/api/v1/setup', headers: { origin: 'http://localhost' },
      payload: { setupCode, password: 'test-admin-password' },
    });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json()).toMatchObject({ configured: true, authenticated: true, onboardingComplete: false });
    const headers = {
      origin: 'http://localhost',
      cookie: `${claimed.cookies[0].name}=${claimed.cookies[0].value}`,
      'x-csrf-token': claimed.json().csrfToken,
    };
    const complete = await app.inject({
      method: 'POST', url: '/api/v1/setup/complete', headers, payload: {},
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().onboardingComplete).toBe(true);
    const repeated = await app.inject({
      method: 'POST', url: '/api/v1/setup/complete', headers, payload: {},
    });
    expect(repeated.json().onboardingComplete).toBe(true);
    expect((await app.inject('/api/v1/session')).json().onboardingComplete).toBe(true);
    const replay = await app.inject({
      method: 'POST', url: '/api/v1/setup', headers: { origin: 'http://localhost' },
      payload: { setupCode, password: 'another-admin-password' },
    });
    expect(replay.json().code).toBe('SETUP_ALREADY_COMPLETED');
  });
  it('allows only one owner to win concurrent setup attempts', async () => {
    const { app, setupCode } = await setup(false);
    const claim = (password: string) => app.inject({
      method: 'POST', url: '/api/v1/setup', headers: { origin: 'http://localhost' },
      payload: { setupCode, password },
    });
    const responses = await Promise.all([
      claim('first-admin-password'),
      claim('second-admin-password'),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const password = responses[0].statusCode === 200 ? 'first-admin-password' : 'second-admin-password';
    const login = await app.inject({
      method: 'POST', url: '/api/v1/login', headers: { origin: 'http://localhost' },
      payload: { password },
    });
    expect(login.statusCode).toBe(200);
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
    expect(saved.json().passwordStorage).toBe('encrypted');
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
  it('persists an automatically generated encryption key with private permissions', () => {
    const d = dir();
    let store = new Store(d);
    const c = store.save({ ...input, password: 'durable-secret' });
    expect(store.public(c.id).passwordStorage).toBe('encrypted');
    store.close();
    expect(statSync(join(d, 'encryption.key')).mode & 0o777).toBe(0o600);
    store = new Store(d);
    expect(store.get(c.id).password).toBe('durable-secret');
    store.close();
  });
  it('rejects mismatched and malformed encryption keys', () => {
    const d = dir();
    new Store(d).close();
    expect(() => new Store(d, randomBytes(32).toString('base64'))).toThrow(/does not match/);
    const other = dir();
    expect(() => new Store(other, 'not-base64')).toThrow(/canonical base64/);
  });
  it('fails safely if encrypted rows remain after the key file is lost', () => {
    const d = dir();
    const store = new Store(d);
    store.save({ ...input, password: 'legacy-secret' });
    store.close();
    unlinkSync(join(d, 'encryption.key'));
    expect(() => new Store(d)).toThrow(/Restore encryption.key/);
  });
});
it('round-trips binary key identifiers and rejects noncanonical encodings', () => {
  const key = Buffer.from([0, 255, 47, 128]);
  expect(keyBuffer(keyId(key))).toEqual(key);
  expect(() => keyBuffer('%%%')).toThrow();
  expect(() => keyBuffer('k_a')).toThrow();
  expect(keyBuffer(keyId(''))).toEqual(Buffer.alloc(0));
});
