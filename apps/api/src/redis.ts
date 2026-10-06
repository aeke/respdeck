import { createClient, RESP_TYPES } from 'redis';
import { createHash, randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';
import type {
  ConnectionInput,
  Entry,
  KeyData,
  KeySummary,
  KeyType,
  Mutation,
  ScanPage,
  ServerSummary,
} from '../../../packages/contracts/src/index.js';
import { AppError } from './errors.js';
import type { Store } from './store.js';

const MAX_VALUE = 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
export const keyId = (key: Buffer | string) => `k_${Buffer.from(key).toString('base64url')}`;
export function keyBuffer(id: string) {
  if (!/^k_[A-Za-z0-9_-]*$/.test(id) || id.length > 8192)
    throw new AppError(400, 'INVALID_KEY', 'Invalid key identifier.');
  const b = Buffer.from(id.slice(2), 'base64url');
  if (`k_${b.toString('base64url')}` !== id)
    throw new AppError(400, 'INVALID_KEY', 'Invalid key identifier.');
  return b;
}
function bytes(v: unknown): Buffer {
  return Buffer.isBuffer(v) ? v : Buffer.from(String(v ?? ''));
}
function str(v: unknown) {
  return bytes(v).toString('utf8');
}
function text(v: unknown) {
  const b = bytes(v);
  try {
    const value = decoder.decode(b);
    if ([...value].some((c) => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0))))
      throw new Error();
    return { value, binary: false };
  } catch {
    return { value: b.toString('hex'), binary: true };
  }
}
const create = (config: ConnectionInput, database: number) =>
  createClient({
    username: config.username || undefined,
    password: config.password || undefined,
    database,
    socket: config.tls
      ? {
          host: config.host,
          port: config.port,
          tls: true,
          ca: config.ca || undefined,
          servername: config.host,
          connectTimeout: 5000,
          reconnectStrategy: false,
        }
      : {
          host: config.host,
          port: config.port,
          connectTimeout: 5000,
          reconnectStrategy: false,
        },
    disableOfflineQueue: true,
    commandsQueueMaxLength: 1000,
    commandOptions: { timeout: 5000 },
  }).withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer });
type Client = ReturnType<typeof create>;
async function cmd(c: Client, args: (string | Buffer)[]): Promise<any> {
  return c.sendCommand(args);
}
async function script(c: Client, source: string, key: Buffer, args: (string | Buffer)[] = []) {
  return cmd(c, ['EVAL', source, '1', key, ...args]);
}
const guard =
  "local t=redis.call('TYPE',KEYS[1]).ok; if t=='none' then return redis.error_reply('MISSING') end; if t~=ARGV[1] then return redis.error_reply('WRONGTYPE') end; ";

export class RedisService {
  private clients = new Map<string, Promise<Client>>();
  constructor(private store: Store) {}
  private async open(config: ConnectionInput, db: number) {
    const client = create(config, db);
    client.on('error', () => {});
    try {
      await client.connect();
      return client;
    } catch (error) {
      if (client.isOpen) client.destroy();
      throw error;
    }
  }
  async test(config: ConnectionInput) {
    const client = await this.open(config, 0);
    try {
      await cmd(client, ['PING']);
      return { ok: true };
    } finally {
      if (client.isOpen) client.destroy();
    }
  }
  async client(id: string, db: number) {
    const tag = `${id}:${db}`;
    let promise = this.clients.get(tag);
    if (promise && !(await promise).isReady) {
      this.clients.delete(tag);
      promise = undefined;
    }
    if (!promise) {
      promise = this.open(this.store.get(id), db);
      this.clients.set(tag, promise);
    }
    try {
      return await promise;
    } catch (e) {
      this.clients.delete(tag);
      throw e;
    }
  }
  async disconnect(id?: string) {
    for (const [tag, promise] of this.clients)
      if (!id || tag.startsWith(`${id}:`)) {
        this.clients.delete(tag);
        try {
          const c = await promise;
          if (c.isOpen) c.destroy();
        } catch {
          /* failed connection already closed */
        }
      }
  }
  writable(id: string) {
    if (this.store.get(id).readOnly)
      throw new AppError(
        403,
        'READ_ONLY',
        'This connection is read-only. Enable writes in connection settings first.',
      );
  }
  async summary(id: string, db: number): Promise<ServerSummary> {
    const c = await this.client(id, db);
    const info = str(await cmd(c, ['INFO']));
    const values = Object.fromEntries(
      info
        .split('\r\n')
        .filter((l) => l.includes(':'))
        .map((l) => {
          const p = l.indexOf(':');
          return [l.slice(0, p), l.slice(p + 1)];
        }),
    );
    const keys = Number(await cmd(c, ['DBSIZE']));
    let databaseCount = 16;
    try {
      const config = await cmd(c, ['CONFIG', 'GET', 'databases']);
      databaseCount = Number(str(config[1])) || 16;
    } catch {
      /* CONFIG may be denied by ACL */
    }
    return {
      version: values.redis_version ?? 'unknown',
      memory: +values.used_memory || 0,
      maxMemory: +values.maxmemory || 0,
      clients: +values.connected_clients || 0,
      ops: +values.instantaneous_ops_per_sec || 0,
      uptime: +values.uptime_in_seconds || 0,
      keys,
      databases: Array.from({ length: Math.min(databaseCount, 64) }, (_, i) => i),
    };
  }
  private async metadata(c: Client, key: Buffer): Promise<KeySummary> {
    const [type, ttl] = await Promise.all([cmd(c, ['TYPE', key]), cmd(c, ['TTL', key])]);
    const name = text(key);
    return {
      id: keyId(key),
      name: name.binary ? `0x${name.value}` : name.value,
      type: str(type),
      ttl: Number(ttl),
      binary: name.binary,
    };
  }
  async scan(
    id: string,
    db: number,
    cursor: string,
    pattern: string,
    type?: string,
  ): Promise<ScanPage> {
    const c = await this.client(id, db);
    const args = ['SCAN', cursor, 'MATCH', pattern || '*', 'COUNT', '100'];
    if (type) args.push('TYPE', type);
    const response = await cmd(c, args);
    const keys: Buffer[] = response[1];
    if (keys.reduce((n, k) => n + bytes(k).length, 0) > MAX_VALUE)
      throw new AppError(
        413,
        'SCAN_TOO_LARGE',
        'This scan batch is too large. Narrow the key pattern.',
      );
    const unique = [...new Map(keys.map((k) => [keyId(k), bytes(k)])).values()];
    const results = await Promise.all(unique.map((key) => this.metadata(c, key)));
    const next = str(response[0]);
    return {
      keys: results.filter((k) => k.type !== 'none' && k.ttl !== -2),
      cursor: next,
      complete: next === '0',
    };
  }
  async read(id: string, db: number, key: Buffer, cursor: string): Promise<KeyData> {
    const c = await this.client(id, db);
    const meta = await this.metadata(c, key);
    if (meta.type === 'none' || meta.ttl === -2)
      throw new AppError(404, 'KEY_NOT_FOUND', 'This key was deleted or expired.');
    let length = 0,
      value: string | undefined,
      hex: string | undefined,
      version: string | undefined,
      entries: Entry[] = [],
      next = '0',
      hasMore = false,
      truncated = false;
    let editable = !this.store.get(id).readOnly;
    if (meta.type === 'string') {
      length = Number(await cmd(c, ['STRLEN', key]));
      const raw = bytes(await cmd(c, ['GETRANGE', key, '0', String(MAX_VALUE - 1)]));
      const decoded = text(raw);
      value = decoded.value;
      if (decoded.binary) hex = decoded.value;
      truncated = length > MAX_VALUE;
      editable &&= !decoded.binary && !truncated;
      if (!truncated) version = createHash('sha1').update(raw).digest('hex');
    } else if (meta.type === 'hash' || meta.type === 'set' || meta.type === 'zset') {
      length = Number(
        await cmd(c, [{ hash: 'HLEN', set: 'SCARD', zset: 'ZCARD' }[meta.type], key]),
      );
      const result = await script(
        c,
        "local r=redis.call(ARGV[1],KEYS[1],ARGV[2],'COUNT','100');local n=0;for _,v in ipairs(r[2]) do n=n+#v;if n>1048576 then return redis.error_reply('PAGE_TOO_LARGE') end end;return r",
        key,
        [{ hash: 'HSCAN', set: 'SSCAN', zset: 'ZSCAN' }[meta.type], cursor],
      );
      next = str(result[0]);
      hasMore = next !== '0';
      const flat: unknown[] = result[1];
      if (flat.reduce<number>((n, item) => n + bytes(item).length, 0) > MAX_VALUE)
        throw new AppError(
          413,
          'VALUE_TOO_LARGE',
          'This collection page exceeds 1 MiB. Use redis-cli to inspect it safely.',
        );
      for (let i = 0; i < flat.length; i += meta.type === 'set' ? 1 : 2) {
        const label = text(flat[i]);
        const v = meta.type === 'hash' ? text(flat[i + 1]) : label;
        entries.push({
          id: keyId(bytes(flat[i])),
          label: label.value,
          value: v.value,
          binary: label.binary || v.binary,
          ...(meta.type === 'zset' ? { score: Number(str(flat[i + 1])) } : {}),
        });
      }
    } else if (meta.type === 'list') {
      length = Number(await cmd(c, ['LLEN', key]));
      const offset = Number(cursor);
      if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(offset))
        throw new AppError(400, 'INVALID_CURSOR', 'Invalid list page offset.');
      // Only fetch individual elements whose size fits the response budget.
      const result = await script(
        c,
        "local out={};local n=0;for i=tonumber(ARGV[1]),math.min(tonumber(ARGV[1])+99,redis.call('LLEN',KEYS[1])-1) do local v=redis.call('LINDEX',KEYS[1],i);n=n+#v;if n>1048576 then return redis.error_reply('PAGE_TOO_LARGE') end;table.insert(out,v) end;return out",
        key,
        [cursor],
      );
      entries = result.map((v: unknown, i: number) => {
        const t = text(v);
        return {
          id: String(offset + i),
          label: String(offset + i),
          value: t.value,
          binary: t.binary,
        };
      });
      hasMore = offset + result.length < length;
      next = hasMore ? String(offset + result.length) : '0';
    } else if (meta.type === 'stream') {
      length = Number(await cmd(c, ['XLEN', key]));
      const result = await script(
        c,
        "local r=redis.call('XRANGE',KEYS[1],ARGV[1],'+','COUNT','101');local n=0;for _,row in ipairs(r) do n=n+#row[1];for _,v in ipairs(row[2]) do n=n+#v;if n>1048576 then return redis.error_reply('PAGE_TOO_LARGE') end end end;return r",
        key,
        [cursor === '0' ? '-' : `(${cursor}`],
      );
      if (Buffer.byteLength(JSON.stringify(result)) > MAX_VALUE)
        throw new AppError(
          413,
          'VALUE_TOO_LARGE',
          'This stream page exceeds 1 MiB. Use redis-cli to inspect it safely.',
        );
      hasMore = result.length > 100;
      entries = result.slice(0, 100).map((row: any) => {
        const fields: Record<string, string> = {};
        let binary = false;
        for (let i = 0; i < row[1].length; i += 2) {
          const k = text(row[1][i]),
            v = text(row[1][i + 1]);
          fields[k.value] = v.value;
          binary ||= k.binary || v.binary;
        }
        return {
          id: str(row[0]),
          label: str(row[0]),
          value: JSON.stringify(fields),
          fields,
          binary,
        };
      });
      next = hasMore ? entries.at(-1)!.id : '0';
    } else editable = false;
    return {
      ...meta,
      length,
      value,
      hex,
      version,
      entries,
      cursor: next,
      hasMore,
      editable,
      truncated,
    };
  }
  async createKey(
    id: string,
    db: number,
    name: string,
    type: KeyType,
    value: string,
    ttl: number | null,
  ) {
    this.writable(id);
    const c = await this.client(id, db);
    const key = Buffer.from(name);
    const commands: Record<KeyType, string[]> = {
      string: ['SET', value],
      hash: ['HSET', 'field', value],
      list: ['RPUSH', value],
      set: ['SADD', value],
      zset: ['ZADD', '0', value],
      stream: ['XADD', '*', 'message', value],
    };
    await script(
      c,
      "if redis.call('EXISTS',KEYS[1])==1 then return redis.error_reply('EXISTS') end; local args={};for i=3,#ARGV do table.insert(args,ARGV[i]) end;redis.call(ARGV[2],KEYS[1],unpack(args));if ARGV[1]~='persist' then redis.call('EXPIRE',KEYS[1],ARGV[1]) end;return 1",
      key,
      [ttl === null ? 'persist' : String(ttl), ...commands[type]],
    );
    return { id: keyId(key) };
  }
  async saveString(id: string, db: number, key: Buffer, value: string, version: string) {
    this.writable(id);
    const c = await this.client(id, db);
    const current = await this.read(id, db, key, '0');
    if (!current.editable)
      throw new AppError(
        403,
        'READ_ONLY_VALUE',
        'Binary and oversized string values cannot be edited in RESPdeck.',
      );
    await script(
      c,
      guard +
        "if redis.sha1hex(redis.call('GET',KEYS[1]))~=ARGV[2] then return redis.error_reply('CONFLICT') end;return redis.call('SET',KEYS[1],ARGV[3],'KEEPTTL')",
      key,
      ['string', version, value],
    );
  }
  async ttl(id: string, db: number, key: Buffer, seconds: number | null) {
    this.writable(id);
    const c = await this.client(id, db);
    await script(
      c,
      "if redis.call('EXISTS',KEYS[1])==0 then return redis.error_reply('MISSING') end;if ARGV[1]=='persist' then redis.call('PERSIST',KEYS[1]) else redis.call('EXPIRE',KEYS[1],ARGV[1]) end;return 1",
      key,
      [seconds === null ? 'persist' : String(seconds)],
    );
  }
  async rename(id: string, db: number, key: Buffer, name: string) {
    this.writable(id);
    const c = await this.client(id, db);
    const renamed = await cmd(c, ['RENAMENX', key, Buffer.from(name)]);
    if (!renamed) throw new AppError(409, 'KEY_EXISTS', 'A key with this name already exists.');
    return { id: keyId(name) };
  }
  async deleteKey(id: string, db: number, key: Buffer) {
    this.writable(id);
    const c = await this.client(id, db);
    if (!(await cmd(c, ['UNLINK', key])))
      throw new AppError(404, 'KEY_NOT_FOUND', 'This key was deleted or expired.');
  }
  async mutate(id: string, db: number, key: Buffer, type: KeyType, m: Mutation) {
    this.writable(id);
    const c = await this.client(id, db);
    const value = m.value ?? '';
    let source: string;
    let args: (string | Buffer)[];
    if (type === 'hash') {
      const field = m.action === 'add' ? Buffer.from(m.label ?? '') : keyBuffer(m.id ?? '');
      if (m.action === 'add') {
        source =
          "if redis.call('HEXISTS',KEYS[1],ARGV[2])==1 then return redis.error_reply('EXISTS') end;return redis.call('HSET',KEYS[1],ARGV[2],ARGV[3])";
        args = [field, value];
      } else {
        source =
          "local v=redis.call('HGET',KEYS[1],ARGV[2]);if not v or v~=ARGV[3] then return redis.error_reply('CONFLICT') end;" +
          (m.action === 'remove'
            ? "return redis.call('HDEL',KEYS[1],ARGV[2])"
            : "return redis.call('HSET',KEYS[1],ARGV[2],ARGV[4])");
        args = [field, m.original ?? '', value];
      }
    } else if (type === 'list') {
      if (m.action === 'add') {
        source = "return redis.call('RPUSH',KEYS[1],ARGV[2])";
        args = [value];
      } else {
        if (!/^\d+$/.test(m.id ?? ''))
          throw new AppError(400, 'INVALID_INDEX', 'Invalid list index.');
        source =
          "local v=redis.call('LINDEX',KEYS[1],ARGV[2]);if not v or v~=ARGV[3] then return redis.error_reply('CONFLICT') end;" +
          (m.action === 'remove'
            ? "redis.call('LSET',KEYS[1],ARGV[2],ARGV[4]);return redis.call('LREM',KEYS[1],1,ARGV[4])"
            : "return redis.call('LSET',KEYS[1],ARGV[2],ARGV[4])");
        args = [
          m.id!,
          m.original ?? '',
          m.action === 'remove' ? `\u0000respdeck:${randomUUID()}` : value,
        ];
      }
    } else if (type === 'set') {
      if (m.action === 'update')
        throw new AppError(
          400,
          'INVALID_ACTION',
          'Remove and add set members to change their value.',
        );
      source = `return redis.call('${m.action === 'remove' ? 'SREM' : 'SADD'}',KEYS[1],ARGV[2])`;
      args = [m.action === 'remove' ? keyBuffer(m.id ?? '') : Buffer.from(value)];
    } else if (type === 'zset') {
      if (m.action === 'remove') {
        source = "return redis.call('ZREM',KEYS[1],ARGV[2])";
        args = [keyBuffer(m.id ?? '')];
      } else {
        source = "return redis.call('ZADD',KEYS[1],ARGV[2],ARGV[3],ARGV[4])";
        args = [
          m.action === 'add' ? 'NX' : 'XX',
          String(m.score ?? 0),
          m.action === 'add' ? Buffer.from(value) : keyBuffer(m.id ?? ''),
        ];
      }
    } else if (type === 'stream') {
      if (m.action === 'update')
        throw new AppError(400, 'INVALID_ACTION', 'Stream entries are immutable.');
      if (m.action === 'remove') {
        if (!/^\d+-\d+$/.test(m.id ?? ''))
          throw new AppError(400, 'INVALID_ID', 'Invalid stream entry ID.');
        source = "return redis.call('XDEL',KEYS[1],ARGV[2])";
        args = [m.id!];
      } else {
        const fields = Object.entries(m.fields ?? {});
        if (!fields.length || fields.length > 100)
          throw new AppError(400, 'INVALID_FIELDS', 'Provide 1–100 stream fields.');
        source =
          "local a={};for i=2,#ARGV do table.insert(a,ARGV[i]) end;return redis.call('XADD',KEYS[1],'*',unpack(a))";
        args = fields.flat();
      }
    } else throw new AppError(400, 'INVALID_TYPE', 'Use the string editor for this key.');
    await script(c, guard + source, key, [type, ...args]);
  }
}
