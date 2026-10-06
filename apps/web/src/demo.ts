import type {
  Connection,
  Entry,
  KeyData,
  KeyType,
  Mutation,
  ScanPage,
  ServerSummary,
} from '@respdeck/contracts';
import { encode } from './utils';
export const demoConnections: Connection[] = [
  {
    id: 'demo-local',
    name: 'Local development',
    host: '127.0.0.1',
    port: 6379,
    tls: false,
    readOnly: false,
    color: 'teal',
    hasPassword: false,
    hasCa: false,
    passwordStorage: 'none',
  },
  {
    id: 'demo-staging',
    name: 'Staging',
    host: 'redis.staging.internal',
    port: 6379,
    tls: true,
    readOnly: true,
    color: 'amber',
    hasPassword: false,
    hasCa: false,
    passwordStorage: 'none',
  },
];
type DemoKey = KeyData & { expiresAt?: number };
const user = {
  id: 1001,
  name: 'Alex Morgan',
  email: 'alex@example.com',
  role: 'developer',
  team: 'Platform engineering',
  preferences: { theme: 'dark', notifications: true, language: 'en' },
  created_at: '2026-09-18T09:30:00Z',
  last_active: '2026-10-06T08:42:12Z',
};
const initial: [string, KeyType, unknown, number][] = [
  ['users:1001', 'string', JSON.stringify(user, null, 2), -1],
  [
    'users:1002',
    'string',
    JSON.stringify({ id: 1002, name: 'Sam Rivera', role: 'designer' }, null, 2),
    -1,
  ],
  [
    'users:1003',
    'string',
    JSON.stringify({ id: 1003, name: 'Jordan Lee', role: 'developer' }, null, 2),
    -1,
  ],
  [
    'users:1001:profile',
    'hash',
    {
      avatar: 'alex.png',
      timezone: 'Europe/Istanbul',
      bio: 'Building things that matter.',
      status: 'active',
    },
    -1,
  ],
  ['users:online', 'set', ['alex', 'sam', 'jordan', 'taylor', 'casey'], 3600],
  [
    'cache:homepage',
    'string',
    JSON.stringify({ title: 'Welcome home', cached: true, version: 3 }, null, 2),
    900,
  ],
  [
    'cache:products:featured',
    'string',
    JSON.stringify(
      [
        { id: 'p_104', name: 'Studio headphones', price: 129 },
        { id: 'p_218', name: 'Desk lamp', price: 59 },
      ],
      null,
      2,
    ),
    1800,
  ],
  ['cache:api:health', 'string', '{"status":"healthy","latency_ms":4}', 300],
  [
    'sessions:a8f2e1',
    'hash',
    {
      user_id: '1001',
      ip: '192.0.2.10',
      device: 'Chrome · macOS',
      created: '2026-10-06T08:40:00Z',
    },
    86400,
  ],
  ['sessions:b3c9d4', 'hash', { user_id: '1002', device: 'Firefox · Linux' }, 7200],
  [
    'jobs:pending',
    'list',
    [
      'send_welcome_email:1004',
      'generate_report:weekly',
      'resize_avatar:1002',
      'sync_inventory:warehouse_a',
    ],
    -1,
  ],
  ['jobs:completed', 'list', ['send_welcome_email:1001', 'backup:2026-10-05'], 86400],
  [
    'leaderboard:weekly',
    'zset',
    [
      ['alex', 2840],
      ['sam', 2310],
      ['jordan', 1950],
      ['taylor', 1420],
    ],
    -1,
  ],
  [
    'events:activity',
    'stream',
    [
      ['1791276000000-0', { event: 'user.login', user_id: '1001', source: 'web' }],
      ['1791276060000-0', { event: 'project.created', project_id: 'p_42' }],
    ],
    -1,
  ],
  [
    'config:feature_flags',
    'hash',
    { new_dashboard: 'true', dark_mode: 'true', beta_search: 'false' },
    -1,
  ],
  ['config:app_version', 'string', '2.8.0', -1],
  ['rate_limit:api:1001', 'string', '42', 60],
  ['tags:popular', 'set', ['typescript', 'redis', 'design', 'opensource', 'react'], -1],
  ['metrics:page_views', 'string', '128450', -1],
  [
    'notifications:1001',
    'list',
    ['Your weekly report is ready', 'Sam invited you to Platform', 'Welcome to your workspace'],
    86400,
  ],
  ['locks:inventory_sync', 'string', 'worker-03', 120],
  [
    'search:recent',
    'zset',
    [
      ['redis gui', 42],
      ['typescript', 31],
      ['self hosted', 18],
    ],
    3600,
  ],
  [
    'queue:emails',
    'stream',
    [['1791276120000-0', { to: 'demo@example.com', template: 'welcome' }]],
    -1,
  ],
  ['cache:binary_sample', 'string', '00ff1a0042', -1],
];
const databases = new Map<string, Map<string, DemoKey>>();
function makeEntries(type: KeyType, data: unknown): Entry[] {
  if (type === 'hash')
    return Object.entries(data as Record<string, string>).map(([label, value]) => ({
      id: encode(label),
      label,
      value,
    }));
  if (type === 'list' || type === 'set')
    return (data as string[]).map((value, i) => ({
      id: type === 'list' ? String(i) : encode(value),
      label: type === 'list' ? String(i) : value,
      value,
    }));
  if (type === 'zset')
    return (data as [string, number][]).map(([value, score]) => ({
      id: encode(value),
      label: value,
      value,
      score,
    }));
  if (type === 'stream')
    return (data as [string, Record<string, string>][]).map(([id, fields]) => ({
      id,
      label: id,
      value: JSON.stringify(fields),
      fields,
    }));
  return [];
}
function getDb(connection: string, db: number) {
  const tag = `${connection}:${db}`;
  if (!databases.has(tag)) {
    const map = new Map<string, DemoKey>();
    if (db === 0)
      for (const [name, type, raw, ttl] of initial) {
        const value = type === 'string' ? String(raw) : undefined,
          entries = makeEntries(type, raw),
          binary = name === 'cache:binary_sample';
        map.set(encode(name), {
          id: encode(name),
          name,
          type,
          ttl,
          length: value?.length ?? entries.length,
          value,
          entries,
          cursor: '0',
          hasMore: false,
          editable: !connection.includes('staging') && !binary,
          truncated: false,
          version: 'demo',
          ...(binary ? { hex: value } : {}),
          binary: false,
          ...(ttl > 0 ? { expiresAt: Date.now() + ttl * 1000 } : {}),
        });
      }
    databases.set(tag, map);
  }
  const map = databases.get(tag)!;
  for (const [id, key] of map) if (key.expiresAt && key.expiresAt <= Date.now()) map.delete(id);
  return map;
}
function read(connection: string, db: number, id: string): KeyData {
  const data = getDb(connection, db).get(id);
  if (!data) throw new Error('This key was deleted or expired.');
  return structuredClone({
    ...data,
    ttl: data.expiresAt ? Math.max(0, Math.ceil((data.expiresAt - Date.now()) / 1000)) : -1,
  });
}
function writable(connection: string) {
  if (connection.includes('staging')) throw new Error('This demo connection is read-only.');
}
function glob(pattern: string) {
  return new RegExp(
    '^' +
      pattern
        .split('')
        .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
        .join('') +
      '$',
  );
}
const delay = () => new Promise((r) => setTimeout(r, 130));
export const demo = {
  async scan(
    connection: string,
    db: number,
    cursor: string,
    pattern: string,
    type?: string,
  ): Promise<ScanPage> {
    await delay();
    const keys = [...getDb(connection, db).values()]
      .filter((k) => glob(pattern).test(k.name) && (!type || k.type === type))
      .sort((a, b) => a.name.localeCompare(b.name));
    const offset = Number(cursor),
      page = keys.slice(offset, offset + 50).map((k) => {
        const d = read(connection, db, k.id);
        return {
          id: d.id,
          name: d.name,
          type: d.type,
          ttl: d.ttl,
          binary: d.binary,
        };
      });
    return {
      keys: page,
      cursor: offset + 50 >= keys.length ? '0' : String(offset + 50),
      complete: offset + 50 >= keys.length,
    };
  },
  async read(connection: string, db: number, id: string) {
    await delay();
    return read(connection, db, id);
  },
  async summary(connection: string, db: number): Promise<ServerSummary> {
    return {
      version: '8.2.1',
      memory: 24.6 * 1024 ** 2,
      maxMemory: 512 * 1024 ** 2,
      clients: 12,
      ops: 842,
      uptime: 849201,
      keys: getDb(connection, db).size,
      databases: Array.from({ length: 16 }, (_, i) => i),
    };
  },
  async create(
    connection: string,
    db: number,
    name: string,
    type: KeyType,
    value: string,
    ttl: number | null,
  ) {
    writable(connection);
    const map = getDb(connection, db),
      id = encode(name);
    if (map.has(id)) throw new Error('A key with this name already exists.');
    const entries =
      type === 'string'
        ? []
        : type === 'hash'
          ? [{ id: encode('field'), label: 'field', value }]
          : type === 'stream'
            ? [
                {
                  id: `${Date.now()}-0`,
                  label: `${Date.now()}-0`,
                  value: JSON.stringify({ message: value }),
                  fields: { message: value },
                },
              ]
            : [
                {
                  id: type === 'list' ? '0' : encode(value),
                  label: type === 'list' ? '0' : value,
                  value,
                  ...(type === 'zset' ? { score: 0 } : {}),
                },
              ];
    map.set(id, {
      id,
      name,
      type,
      ttl: ttl ?? -1,
      value: type === 'string' ? value : undefined,
      entries,
      binary: false,
      length: type === 'string' ? value.length : 1,
      version: 'demo',
      editable: true,
      cursor: '0',
      hasMore: false,
      truncated: false,
      ...(ttl ? { expiresAt: Date.now() + ttl * 1000 } : {}),
    });
    return { id };
  },
  async save(connection: string, db: number, id: string, value: string) {
    writable(connection);
    const key = getDb(connection, db).get(id)!;
    key.value = value;
    key.length = new TextEncoder().encode(value).length;
  },
  async ttl(connection: string, db: number, id: string, seconds: number | null) {
    writable(connection);
    const key = getDb(connection, db).get(id)!;
    key.expiresAt = seconds ? Date.now() + seconds * 1000 : undefined;
  },
  async rename(connection: string, db: number, id: string, name: string) {
    writable(connection);
    const map = getDb(connection, db),
      next = encode(name);
    if (map.has(next)) throw new Error('A key with this name already exists.');
    const key = map.get(id)!;
    map.delete(id);
    map.set(next, { ...key, id: next, name });
    return { id: next };
  },
  async remove(connection: string, db: number, id: string) {
    writable(connection);
    getDb(connection, db).delete(id);
  },
  async mutate(connection: string, db: number, id: string, type: KeyType, m: Mutation) {
    writable(connection);
    const key = getDb(connection, db).get(id)!;
    const entries = key.entries;
    if (m.action === 'remove') key.entries = entries.filter((e) => e.id !== m.id);
    else if (m.action === 'update') {
      const e = entries.find((e) => e.id === m.id)!;
      if (type === 'zset') e.score = m.score;
      else e.value = m.value ?? '';
    } else {
      const value = m.value ?? '',
        label =
          type === 'hash'
            ? (m.label ?? '')
            : type === 'list'
              ? String(entries.length)
              : type === 'stream'
                ? `${Date.now()}-0`
                : value;
      const eid = type === 'list' || type === 'stream' ? label : encode(label);
      if (entries.some((e) => e.id === eid)) throw new Error('This entry already exists.');
      entries.push({
        id: eid,
        label,
        value: type === 'stream' ? JSON.stringify(m.fields) : value,
        fields: m.fields,
        score: m.score,
      });
    }
    if (type === 'list')
      key.entries.forEach((e, i) => {
        e.id = String(i);
        e.label = String(i);
      });
    key.length = key.entries.length;
    if (!key.length) getDb(connection, db).delete(id);
  },
};
