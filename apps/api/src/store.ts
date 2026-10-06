import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Connection, ConnectionInput } from '../../../packages/contracts/src/index.js';
import { AppError } from './errors.js';

export class Store {
  private db: DatabaseSync;
  private ephemeral = new Map<string, string>();
  private key?: Buffer;
  constructor(dir: string, encryptionKey?: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (encryptionKey) {
      this.key = Buffer.from(encryptionKey, 'base64');
      if (this.key.length !== 32)
        throw new Error('RESPDECK_ENCRYPTION_KEY must encode exactly 32 bytes.');
    }
    this.db = new DatabaseSync(join(dir, 'respdeck.sqlite'));
    this.db.exec(
      'PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, config TEXT NOT NULL, secret TEXT);',
    );
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
    const password = this.ephemeral.get(id) ?? (row.secret ? this.decrypt(row.secret) : undefined);
    return { ...config, password };
  }
  public(id: string): Connection {
    const row = this.row(id);
    const { ca, ...config } = JSON.parse(row.config) as ConnectionInput;
    return {
      ...config,
      id,
      hasCa: !!ca,
      hasPassword: !!row.secret || this.ephemeral.has(id),
      passwordStorage: row.secret ? 'encrypted' : this.ephemeral.has(id) ? 'session' : 'none',
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
    else {
      this.ephemeral.delete(id);
      if (password && this.key) secret = this.encrypt(password);
      else if (password) this.ephemeral.set(id, password);
    }
    this.db
      .prepare(
        'INSERT INTO connections (id,config,secret) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config,secret=excluded.secret',
      )
      .run(id, JSON.stringify(config), secret);
    return this.public(id);
  }
  remove(id: string) {
    this.row(id);
    this.ephemeral.delete(id);
    this.db.prepare('DELETE FROM connections WHERE id = ?').run(id);
  }
  clearSessionSecrets() {
    this.ephemeral.clear();
  }
  close() {
    this.ephemeral.clear();
    this.db.close();
  }
}
