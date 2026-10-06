import type {
  Connection,
  ConnectionInput,
  KeyData,
  KeyType,
  Mutation,
  ScanPage,
  ServerSummary,
  Session,
} from '@respdeck/contracts';
import { demo } from './demo';
let csrfToken = '';
export class RequestError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    signal,
    credentials: 'same-origin',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(method === 'GET' ? {} : { 'X-CSRF-Token': csrfToken }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    if (data.code === 'UNAUTHENTICATED')
      window.dispatchEvent(new Event('respdeck-session-expired'));
    throw new RequestError(data.code, data.message ?? 'Request failed.');
  }
  return data;
}
export const auth = {
  async session() {
    const s = await request<Session>('/session');
    csrfToken = s.csrfToken ?? '';
    return s;
  },
  async login(password: string) {
    const s = await request<Session>('/login', 'POST', { password });
    csrfToken = s.csrfToken ?? '';
    return s;
  },
  async logout() {
    await request('/logout', 'POST');
    csrfToken = '';
  },
};
export const connections = {
  list: () => request<Connection[]>('/connections'),
  save: (input: ConnectionInput, id?: string) =>
    request<Connection>(`/connections${id ? `/${id}` : ''}`, id ? 'PUT' : 'POST', input),
  test: (input: ConnectionInput, id?: string) =>
    request(id ? `/connections/${id}/test` : '/connections/test', 'POST', input),
  remove: (id: string) => request(`/connections/${id}`, 'DELETE'),
};
export function workspace(id: string, db: number) {
  const isDemo = id.startsWith('demo-'),
    base = `/connections/${id}/databases/${db}`;
  return {
    scan: (cursor: string, pattern: string, type?: string, signal?: AbortSignal) =>
      isDemo
        ? demo.scan(id, db, cursor, pattern, type)
        : request<ScanPage>(
            `${base}/keys?${new URLSearchParams({ cursor, pattern, ...(type ? { type } : {}) })}`,
            'GET',
            undefined,
            signal,
          ),
    read: (key: string, cursor = '0', signal?: AbortSignal) =>
      isDemo
        ? demo.read(id, db, key)
        : request<KeyData>(
            `${base}/keys/${key}?cursor=${encodeURIComponent(cursor)}`,
            'GET',
            undefined,
            signal,
          ),
    summary: () => (isDemo ? demo.summary(id, db) : request<ServerSummary>(`${base}/summary`)),
    create: (name: string, type: KeyType, value: string, ttl: number | null) =>
      isDemo
        ? demo.create(id, db, name, type, value, ttl)
        : request<{ id: string }>(`${base}/keys`, 'POST', {
            name,
            type,
            value,
            ttl,
          }),
    save: (key: string, value: string, version: string) =>
      isDemo
        ? demo.save(id, db, key, value)
        : request(`${base}/keys/${key}/value`, 'PUT', { value, version }),
    ttl: (key: string, seconds: number | null) =>
      isDemo
        ? demo.ttl(id, db, key, seconds)
        : request(`${base}/keys/${key}/ttl`, 'PATCH', { seconds }),
    rename: (key: string, name: string) =>
      isDemo
        ? demo.rename(id, db, key, name)
        : request<{ id: string }>(`${base}/keys/${key}/name`, 'PATCH', {
            name,
          }),
    remove: (key: string) =>
      isDemo ? demo.remove(id, db, key) : request(`${base}/keys/${key}`, 'DELETE'),
    mutate: (key: string, type: KeyType, input: Mutation) =>
      isDemo
        ? demo.mutate(id, db, key, type, input)
        : request(`${base}/keys/${key}/entries?type=${type}`, 'POST', input),
  };
}
