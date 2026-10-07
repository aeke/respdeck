import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { closeSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import type { Connection, ConnectionInput } from '../../../packages/contracts/src/index.js';
import { AppError } from './errors.js';
function decodeKey(value: string) {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== value)
    throw new Error('encryption.key must be canonical base64 encoding exactly 32 bytes.');
  return bytes;
}
export interface Administrator {
  salt: string;
  passwordHash: string;
  onboardingComplete: boolean;
}

export class Store {
  private db: DatabaseSync;
  private key: Buffer;
  constructor(dir: string, encryptionKey?: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(dir, 'respdeck.sqlite'));
    this.db.exec(
      'PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, config TEXT NOT NULL, secret TEXT); CREATE TABLE IF NOT EXISTS administrator (id INTEGER PRIMARY KEY CHECK (id = 1), salt TEXT NOT NULL, password_hash TEXT NOT NULL, onboarding_complete INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_complete IN (0,1)));',
    );
    this.key = this.resolveKey(dir, encryptionKey);
  }
  private resolveKey(dir: string, provided?: string) {
    const path = join(dir, 'encryption.key');
    let key: Buffer | undefined;
    if (provided !== undefined) key = decodeKey(provided);
    try {
      const stat = lstatSync(path);
      if (!stat.isFile()) throw new Error(`Encryption key path ${path} must be a regular file.`);
      const stored = decodeKey(readFileSync(path, 'utf8'));
      if (key && !key.equals(stored)) throw new Error('RESPDECK_ENCRYPTION_KEY does not match the persisted encryption.key.');
      key = stored;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (key) {
      try { lstatSync(path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return this.publishKey(path, key, provided !== undefined);
      }
      return key;
    }
    if (this.db.prepare('SELECT 1 FROM connections WHERE secret IS NOT NULL LIMIT 1').get())
      throw new Error(`Encrypted Redis credentials exist but ${path} is missing. Restore encryption.key or provide the original RESPDECK_ENCRYPTION_KEY.`);
    return this.publishKey(path, randomBytes(32), false);
  }
  private publishKey(path: string, key: Buffer, requireMatch: boolean) {
    const temp = `${path}.${randomUUID()}.tmp`;
    let fd: number | undefined;
    try {
      fd = openSync(temp, 'wx', 0o600);
      writeFileSync(fd, key.toString('base64'));
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      try { linkSync(temp, path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const winner = lstatSync(path);
        if (!winner.isFile()) throw new Error('Concurrent encryption key creation produced an invalid encryption.key.');
        const winnerKey = decodeKey(readFileSync(path, 'utf8'));
        if (requireMatch && !winnerKey.equals(key))
          throw new Error('RESPDECK_ENCRYPTION_KEY does not match the concurrently persisted encryption.key.');
        return winnerKey;
      }
      return key;
    } finally {
      if (fd !== undefined) closeSync(fd);
      try { unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
  get encryptionEnabled() {
    return !!this.key;
  }
  private encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key!, iv);
    return Buffer.concat([
      iv,
      cipher.update(value, 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('base64');
  }
  private decrypt(value: string) {
    if (!this.key)
      throw new AppError(
        409,
        'SECRET_LOCKED',
        'Provide the original encryption key or re-enter the Redis password.',
      );
    try {
      const b = Buffer.from(value, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12));
      decipher.setAuthTag(b.subarray(-16));
      return Buffer.concat([decipher.update(b.subarray(12, -16)), decipher.final()]).toString(
        'utf8',
      );
    } catch {
      throw new AppError(
        409,
        'SECRET_LOCKED',
        'Unable to decrypt the saved password. Re-enter it or restore the original encryption key.',
      );
    }
  }
  private row(id: string) {
    const row = this.db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as
      { id: string; config: string; secret: string | null } | undefined;
    if (!row) throw new AppError(404, 'CONNECTION_NOT_FOUND', 'Connection not found.');
    return row;
  }
  get(id: string): ConnectionInput {
    const row = this.row(id);
    const config = JSON.parse(row.config) as ConnectionInput;
    const password = row.secret ? this.decrypt(row.secret) : undefined;
    return { ...config, password };
  }
  public(id: string): Connection {
    const row = this.row(id);
    const { ca, ...config } = JSON.parse(row.config) as ConnectionInput;
    return {
      ...config,
      id,
      hasCa: !!ca,
      hasPassword: !!row.secret,
      passwordStorage: row.secret ? 'encrypted' : 'none',
    };
  }
  list(): Connection[] {
    return (
      this.db.prepare('SELECT id FROM connections ORDER BY rowid').all() as {
        id: string;
      }[]
    ).map((row) => this.public(row.id));
  }
  save(input: ConnectionInput, id: string = randomUUID()) {
    const { password, ...config } = input;
    let secret: string | null = null;
    const existing = this.db
      .prepare('SELECT secret, config FROM connections WHERE id = ?')
      .get(id) as { secret: string | null; config: string } | undefined;
    if (existing && input.ca === undefined)
      config.ca = (JSON.parse(existing.config) as ConnectionInput).ca;
    if (password === undefined) secret = existing?.secret ?? null;
    else if (password) secret = this.encrypt(password);
    this.db
      .prepare(
        'INSERT INTO connections (id,config,secret) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config,secret=excluded.secret',
      )
      .run(id, JSON.stringify(config), secret);
    return this.public(id);
  }
  remove(id: string) {
    this.row(id);
    this.db.prepare('DELETE FROM connections WHERE id = ?').run(id);
  }
  getAdministrator(): Administrator | undefined {
    const row = this.db.prepare('SELECT salt, password_hash, onboarding_complete FROM administrator WHERE id = 1').get() as
      { salt: string; password_hash: string; onboarding_complete: number } | undefined;
    return row && { salt: row.salt, passwordHash: row.password_hash, onboardingComplete: row.onboarding_complete === 1 };
  }
  createAdministrator(salt: string, passwordHash: string) {
    return this.db.prepare('INSERT INTO administrator (id, salt, password_hash) VALUES (1, ?, ?) ON CONFLICT(id) DO NOTHING').run(salt, passwordHash).changes === 1;
  }
  completeOnboarding() {
    this.db.prepare('UPDATE administrator SET onboarding_complete = 1 WHERE id = 1').run();
  }
  close() {
    this.db.close();
  }
}
