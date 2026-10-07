import { useState } from 'react';
import { Check, Loader2, Plug, Trash2 } from 'lucide-react';
import type { Connection, ConnectionInput } from '@respdeck/contracts';
import { ConnectionFields } from './ConnectionFields';
import { connections } from '../api';
import { Dialog, FormError } from './Dialog';
export function ConnectionDialog({
  existing,
  onClose,
  onSaved,
  onRemoved,
}: {
  existing?: Connection;
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
        <ConnectionFields input={input} existing={existing} onChange={change} />
        <p className="form-hint">Passwords are encrypted on disk.</p>
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
