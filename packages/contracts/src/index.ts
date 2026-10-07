export const keyTypes = ['string', 'hash', 'list', 'set', 'zset', 'stream'] as const;
export type KeyType = (typeof keyTypes)[number];
export type Theme = 'light' | 'dark' | 'system';
export type Accent = 'violet' | 'teal' | 'amber';
export interface ConnectionInput {
  name: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls: boolean;
  ca?: string;
  readOnly: boolean;
  color: string;
}
export interface Connection extends Omit<ConnectionInput, 'password' | 'ca'> {
  id: string;
  hasPassword: boolean;
  hasCa: boolean;
  passwordStorage: 'encrypted' | 'session' | 'none';
}
export interface KeySummary {
  id: string;
  name: string;
  type: string;
  ttl: number;
  size?: number;
  binary: boolean;
}
export interface ScanPage {
  keys: KeySummary[];
  cursor: string;
  complete: boolean;
}
export interface Entry {
  id: string;
  label: string;
  value: string;
  score?: number;
  fields?: Record<string, string>;
  binary?: boolean;
}
export interface KeyData extends KeySummary {
  length: number;
  value?: string;
  hex?: string;
  version?: string;
  entries: Entry[];
  cursor: string;
  hasMore: boolean;
  editable: boolean;
  truncated: boolean;
}
export interface Mutation {
  action: 'add' | 'update' | 'remove';
  id?: string;
  label?: string;
  value?: string;
  score?: number;
  fields?: Record<string, string>;
  original?: string;
}
export interface ServerSummary {
  version: string;
  memory: number;
  maxMemory: number;
  clients: number;
  ops: number;
  uptime: number;
  keys: number;
  databases: number[];
}
export interface SetupInput {
  setupCode: string;
  password: string;
}
export interface Session {
  configured: boolean;
  authenticated: boolean;
  onboardingComplete: boolean;
  csrfToken?: string;
  encryptionEnabled: boolean;
}
export interface ApiError {
  code: string;
  message: string;
}
