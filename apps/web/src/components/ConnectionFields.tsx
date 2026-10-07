import { Check, ShieldCheck } from 'lucide-react';
import type { Connection, ConnectionInput } from '@respdeck/contracts';
export function ConnectionFields({
  input,
  existing,
  onChange,
  autoFocus = true,
  hostHint,
  passwordLabel = 'Password',
}: {
  input: ConnectionInput;
  existing?: Connection;
  onChange: (patch: Partial<ConnectionInput>) => void;
  autoFocus?: boolean;
  hostHint?: string;
  passwordLabel?: string;
}) {
  return (
    <>
      <label className="field">
        Connection name
        <input
          required
          autoFocus={autoFocus}
          maxLength={80}
          placeholder="e.g. Local development"
          value={input.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>
      <div className="form-row">
        <label className="field grow">
          Host
          <input required value={input.host} onChange={(e) => onChange({ host: e.target.value })} />
        </label>
        <label className="field port-field">
          Port
          <input
            type="number"
            required
            min={1}
            max={65535}
            value={input.port}
            onChange={(e) => onChange({ port: Number(e.target.value) })}
          />
        </label>
      </div>
      {hostHint && <p className="form-hint">{hostHint}</p>}
      <div className="form-row">
        <label className="field grow">
          Username <span className="muted">optional</span>
          <input
            autoComplete="off"
            placeholder="default"
            value={input.username}
            onChange={(e) => onChange({ username: e.target.value })}
          />
        </label>
        <label className="field grow">
          {passwordLabel}
          <input
            type="password"
            autoComplete="new-password"
            placeholder={existing?.hasPassword ? 'Leave blank to keep saved password' : 'Optional'}
            value={input.password ?? ''}
            onChange={(e) => onChange({ password: e.target.value || undefined })}
          />
        </label>
      </div>
      {existing?.hasPassword && (
        <label className="check-field">
          <input
            type="checkbox"
            checked={input.password === ''}
            onChange={(e) => onChange({ password: e.target.checked ? '' : undefined })}
          />
          <div>
            <strong>Clear saved password</strong>
            <span>Use this if the Redis server no longer requires a password.</span>
          </div>
        </label>
      )}
      <label className="check-field">
        <input
          type="checkbox"
          checked={input.tls}
          onChange={(e) => onChange({ tls: e.target.checked })}
        />
        <div>
          <strong>Use TLS</strong>
          <span>Encrypt the connection and verify the certificate.</span>
        </div>
        <ShieldCheck size={18} />
      </label>
      {input.tls && (
        <label className="field">
          CA certificate <span className="muted">optional PEM</span>
          <textarea
            rows={3}
            placeholder={
              existing?.hasCa ? 'Leave unchanged to keep saved CA' : 'Use system certificates by default'
            }
            value={input.ca ?? ''}
            onChange={(e) => onChange({ ca: e.target.value })}
          />
        </label>
      )}
      <label className="check-field">
        <input
          type="checkbox"
          checked={input.readOnly}
          onChange={(e) => onChange({ readOnly: e.target.checked })}
        />
        <div>
          <strong>Read-only connection</strong>
          <span>Browse safely. All writes are blocked by the server.</span>
        </div>
      </label>
      <div className="field">
        Connection color
        <div className="accent-options">
          {['violet', 'teal', 'amber'].map((color) => (
            <button
              type="button"
              key={color}
              className={`color-choice ${color} ${input.color === color ? 'chosen' : ''}`}
              aria-label={`${color} connection color`}
              aria-pressed={input.color === color}
              onClick={() => onChange({ color })}
            >
              {input.color === color && <Check size={14} />}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
export const newConnectionInput = (): ConnectionInput => ({
  name: '',
  host: '127.0.0.1',
  port: 6379,
  username: '',
  password: undefined,
  tls: false,
  readOnly: true,
  color: 'violet',
});
