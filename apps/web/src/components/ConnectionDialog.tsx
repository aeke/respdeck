import { useState } from 'react';
import { Check, Loader2, Plug, ShieldCheck, Trash2 } from 'lucide-react';
import type { Connection, ConnectionInput, Session } from '@respdeck/contracts';
import { connections } from '../api';
import { Dialog, FormError } from './Dialog';
export function ConnectionDialog({
  existing,
  session,
  onClose,
  onSaved,
  onRemoved,
}: {
  existing?: Connection;
  session: Session;
  onClose: () => void;
  onSaved: (c: Connection) => void;
  onRemoved: () => void;
}) {
  const [input, setInput] = useState<ConnectionInput>({
    name: existing?.name ?? '',
    host: existing?.host ?? '127.0.0.1',
    port: existing?.port ?? 6379,
    username: existing?.username ?? '',
    password: undefined,
    tls: existing?.tls ?? false,
    readOnly: existing?.readOnly ?? true,
    color: existing?.color ?? 'violet',
  });
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(''),
    [tested, setTested] = useState(false),
    [deleting, setDeleting] = useState(false);
  const change = (patch: Partial<ConnectionInput>) => {
    setInput((prev) => ({ ...prev, ...patch }));
    setTested(false);
  };
  const perform = async (action: 'save' | 'test' | 'delete') => {
    setError('');
    setBusy(action);
    try {
      if (action === 'test') {
        await connections.test(input, existing?.id);
        setTested(true);
      } else if (action === 'delete') {
        await connections.remove(existing!.id);
        onRemoved();
      } else {
        onSaved(await connections.save(input, existing?.id));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  return (
    <Dialog
      title={existing ? 'Connection settings' : 'Add a connection'}
      description="Your Redis server, in your workspace."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void perform('save');
        }}
      >
        <label className="field">
          Connection name
          <input
            required
            autoFocus
            maxLength={80}
            placeholder="e.g. Local development"
            value={input.name}
            onChange={(e) => change({ name: e.target.value })}
          />
        </label>
        <div className="form-row">
          <label className="field grow">
            Host
            <input required value={input.host} onChange={(e) => change({ host: e.target.value })} />
          </label>
          <label className="field port-field">
            Port
            <input
              type="number"
              required
              min={1}
              max={65535}
              value={input.port}
              onChange={(e) => change({ port: Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="form-row">
          <label className="field grow">
            Username <span className="muted">optional</span>
            <input
              autoComplete="off"
              placeholder="default"
              value={input.username}
              onChange={(e) => change({ username: e.target.value })}
            />
          </label>
          <label className="field grow">
            Password
            <input
              type="password"
              autoComplete="new-password"
              placeholder={
                existing?.hasPassword ? 'Leave blank to keep saved password' : 'Optional'
              }
              value={input.password ?? ''}
              onChange={(e) => change({ password: e.target.value || undefined })}
            />
          </label>
        </div>
        {existing?.hasPassword && (
          <label className="check-field">
            <input
              type="checkbox"
              checked={input.password === ''}
              onChange={(e) => change({ password: e.target.checked ? '' : undefined })}
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
            onChange={(e) => change({ tls: e.target.checked })}
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
                existing?.hasCa
                  ? 'Leave unchanged to keep saved CA'
                  : 'Use system certificates by default'
              }
              value={input.ca ?? ''}
              onChange={(e) => change({ ca: e.target.value })}
            />
          </label>
        )}
        <label className="check-field">
          <input
            type="checkbox"
            checked={input.readOnly}
            onChange={(e) => change({ readOnly: e.target.checked })}
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
                onClick={() => change({ color })}
              >
                {input.color === color && <Check size={14} />}
              </button>
            ))}
          </div>
        </div>
        <p className="form-hint">
          {session.encryptionEnabled
            ? 'Passwords are encrypted on disk.'
            : 'Passwords stay in server memory until sign-out or restart. Configure encryption to save them across restarts.'}
        </p>
        <FormError message={error} />
        {tested && (
          <div className="form-success">
            <Check size={15} />
            Connection successful
          </div>
        )}
        {deleting && (
          <div className="form-error">
            Remove this connection? Your Redis data will stay intact.
            <div className="dialog-actions">
              <button type="button" className="button" onClick={() => setDeleting(false)}>
                Keep connection
              </button>
              <button
                type="button"
                className="button danger"
                disabled={!!busy}
                onClick={() => void perform('delete')}
              >
                Remove connection
              </button>
            </div>
          </div>
        )}
        <div className="dialog-actions">
          {existing && (
            <button
              type="button"
              className="icon-button danger-text"
              aria-label="Remove connection"
              disabled={!!busy}
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={17} />
            </button>
          )}
          <button
            type="button"
            className="button"
            disabled={!!busy || !input.name}
            onClick={() => void perform('test')}
          >
            {busy === 'test' ? <Loader2 size={15} className="spin" /> : <Plug size={15} />} Test
            connection
          </button>
          <button className="button primary" disabled={!!busy}>
            {busy === 'save' && <Loader2 size={15} className="spin" />}
            {existing ? 'Save connection' : 'Add connection'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
