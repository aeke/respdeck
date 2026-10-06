import { useEffect, useState, lazy, Suspense } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  Braces,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  FileCode2,
  Info,
  Loader2,
  LockKeyhole,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import type { Entry, KeyType, Mutation } from '@respdeck/contracts';
import { workspace } from '../api';
import { size, ttlLabel } from '../utils';
import { Dialog, FormError } from './Dialog';
const ValueEditor = lazy(() => import('./ValueEditor'));
type Notice = (message: string, error?: boolean) => void;
export function TypeBadge({ type }: { type: string }) {
  return <span className={`type-badge type-${type}`}>{type}</span>;
}
export function KeyEditor({
  connection,
  db,
  keyId,
  theme,
  readOnly,
  onDirty,
  notify,
  onDeleted,
  onRenamed,
}: {
  connection: string;
  db: number;
  keyId: string;
  theme: 'dark' | 'light';
  readOnly: boolean;
  onDirty: (dirty: boolean) => void;
  notify: Notice;
  onDeleted: () => void;
  onRenamed: (id: string, name: string) => void;
}) {
  const client = useQueryClient(),
    api = workspace(connection, db);
  const queryKey = ['key', connection, db, keyId];
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) => api.read(keyId, pageParam, signal),
    initialPageParam: '0',
    getNextPageParam: (page) => (page.hasMore ? page.cursor : undefined),
  });
  const data = query.data?.pages[0];
  const [value, setValue] = useState(''),
    [original, setOriginal] = useState(''),
    [format, setFormat] = useState<'json' | 'text' | 'hex'>('json');
  const [tab, setTab] = useState('value'),
    [dialog, setDialog] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [input, setInput] = useState(''),
    [entry, setEntry] = useState<Entry>(),
    [entryLabel, setEntryLabel] = useState(''),
    [entryValue, setEntryValue] = useState(''),
    [score, setScore] = useState('0');
  const dirty = value !== original;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (data) {
      setValue(data.value ?? '');
      setOriginal(data.value ?? '');
      setFormat(
        data.hex
          ? 'hex'
          : (() => {
              try {
                JSON.parse(data.value ?? '');
                return 'json';
              } catch {
                return 'text';
              }
            })(),
      );
    }
  }, [data?.value, data?.id, data?.version, data?.hex]);
  const refresh = async () => {
    if (dirty && !window.confirm('Discard your unsaved changes and reload this value?')) return;
    setValue(data?.value ?? '');
    setOriginal(data?.value ?? '');
    await client.resetQueries({ queryKey });
  };
  const changed = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['keys', connection, db] }),
      client.invalidateQueries({ queryKey: ['summary', connection, db] }),
      client.resetQueries({ queryKey }),
    ]);
  };
  const save = async () => {
    if (!data?.editable || !dirty || busy) return;
    setBusy(true);
    try {
      await api.save(keyId, value, data.version!);
      setOriginal(value);
      await changed();
      notify('Value saved. TTL preserved.');
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  const open = (name: string, initial = '') => {
    setError('');
    setInput(initial);
    setDialog(name);
  };
  const openEntry = (existing?: Entry) => {
    setEntry(existing);
    setEntryLabel(existing?.label ?? '');
    setEntryValue(
      existing?.value ??
        (data?.type === 'stream' ? '{\n  "event": "user.created",\n  "user_id": "1004"\n}' : ''),
    );
    setScore(String(existing?.score ?? 0));
    open('entry');
  };
  const perform = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError('');
    try {
      await action();
      setDialog('');
      await changed();
      notify(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const entries = [
    ...new Map((query.data?.pages.flatMap((p) => p.entries) ?? []).map((e) => [e.id, e])).values(),
  ];
  if (query.isPending)
    return (
      <div className="editor-loading">
        <Loader2 size={24} className="spin" />
        <span>Opening key…</span>
      </div>
    );
  if (query.isError || !data)
    return (
      <div className="empty-state">
        <Info size={30} />
        <h3>Couldn’t open this key</h3>
        <p>{query.error?.message}</p>
        <button className="button" onClick={() => void query.refetch()}>
          <RefreshCw size={15} />
          Try again
        </button>
      </div>
    );
  return (
    <div className="editor-panel">
      <div className="editor-header">
        <div className="key-title">
          <span className="key-title-icon">
            <Braces size={19} />
          </span>
          <div>
            <h2 title={data.name}>{data.name || '(empty key)'}</h2>
            <div className="key-subtitle">
              <TypeBadge type={data.type} />
              <span>
                {data.type === 'string'
                  ? size(data.length)
                  : `${data.length.toLocaleString()} ${data.type === 'hash' ? 'fields' : data.type === 'stream' ? 'entries' : 'members'}`}
              </span>
              <span className="dot-divider">·</span>
              <span>{connection.startsWith('demo-') ? 'Demo data' : 'Redis key'}</span>
            </div>
          </div>
        </div>
        <div className="editor-header-actions">
          <button
            className="icon-button"
            aria-label="Copy key name"
            title="Copy key name"
            onClick={() => {
              void navigator.clipboard
                .writeText(data.name)
                .then(() => notify('Key name copied.'))
                .catch(() => notify('Clipboard is unavailable.', true));
            }}
          >
            <Copy size={16} />
          </button>
          <button
            className="icon-button"
            title="Rename key"
            aria-label="Rename key"
            disabled={readOnly || dirty}
            onClick={() => open('rename', data.name)}
          >
            <Pencil size={15} />
          </button>
          <button
            className="icon-button danger-text"
            title="Delete key"
            aria-label="Delete key"
            disabled={readOnly}
            onClick={() => open('delete')}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <div className="editor-tabs">
        <div role="tablist" aria-label="Key inspector">
          <button
            role="tab"
            aria-selected={tab === 'value'}
            className={tab === 'value' ? 'active' : ''}
            onClick={() => setTab('value')}
          >
            <FileCode2 size={15} />
            Value
          </button>
          <button
            role="tab"
            aria-selected={tab === 'details'}
            className={tab === 'details' ? 'active' : ''}
            onClick={() => setTab('details')}
          >
            <Info size={15} />
            Details
          </button>
        </div>
        <button
          className={`ttl-button ${data.ttl > -1 ? 'expiring' : ''}`}
          disabled={readOnly}
          onClick={() => open('ttl', data.ttl > -1 ? String(data.ttl) : '')}
        >
          <Clock3 size={13} />
          {ttlLabel(data.ttl)}
          {!readOnly && <ChevronDown size={12} />}
        </button>
      </div>
      {tab === 'details' ? (
        <div className="details-view">
          <h3>Key information</h3>
          <p>Metadata for this key in database {db}.</p>
          <dl>
            {[
              ['Name', data.name],
              ['Type', data.type],
              ['Database', `db${db}`],
              ['Time to live', ttlLabel(data.ttl)],
              [
                data.type === 'string' ? 'Value size' : 'Collection length',
                data.type === 'string' ? size(data.length) : String(data.length),
              ],
              ['Access', data.editable ? 'Read & write' : 'Read only'],
              ['Encoding', data.hex || data.binary ? 'Binary' : 'UTF-8'],
            ].map(([label, v]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="form-hint">
            TTL is measured when this key is loaded. Refresh to get its current value.
          </p>
        </div>
      ) : (
        <>
          <div className="value-toolbar">
            <div className="value-label">
              {data.type === 'string' ? (
                <>
                  <span className="status-dot" />{' '}
                  {format === 'json'
                    ? 'JSON document'
                    : format === 'hex'
                      ? 'Binary preview'
                      : 'String value'}
                </>
              ) : (
                <>
                  {data.type === 'hash'
                    ? 'Hash fields'
                    : data.type === 'stream'
                      ? 'Stream entries'
                      : 'Collection members'}
                  <span className="count-pill">{data.length}</span>
                </>
              )}
            </div>
            <div className="toolbar-actions">
              {data.type === 'string' ? (
                <>
                  <select
                    aria-label="Value format"
                    value={format}
                    onChange={(e) => setFormat(e.target.value as typeof format)}
                    disabled={!!data.hex}
                  >
                    {data.hex ? (
                      <option value="hex">Hex</option>
                    ) : (
                      <>
                        <option value="json">JSON</option>
                        <option value="text">Text</option>
                      </>
                    )}
                  </select>
                  {format === 'json' && (
                    <button
                      className="icon-button"
                      aria-label="Format JSON"
                      title="Format JSON"
                      disabled={!data.editable}
                      onClick={() => {
                        try {
                          setValue(JSON.stringify(JSON.parse(value), null, 2));
                        } catch {
                          notify('This value is not valid JSON.', true);
                        }
                      }}
                    >
                      <Braces size={16} />
                    </button>
                  )}
                  <button
                    className="icon-button"
                    aria-label="Copy value"
                    title="Copy value"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(value)
                        .then(() => notify('Value copied.'))
                        .catch(() => notify('Clipboard is unavailable.', true))
                    }
                  >
                    <Copy size={15} />
                  </button>
                </>
              ) : (
                <button
                  className="button small"
                  disabled={!data.editable}
                  onClick={() => openEntry()}
                >
                  <Plus size={14} />
                  Add {data.type === 'hash' ? 'field' : 'entry'}
                </button>
              )}
              <button
                className="icon-button"
                aria-label="Refresh key"
                title="Refresh key"
                onClick={() => void refresh()}
              >
                <RefreshCw size={15} className={query.isFetching ? 'spin' : ''} />
              </button>
            </div>
          </div>
          {data.truncated && (
            <div className="inline-banner">
              Preview limited to 1 MiB. Editing is disabled to protect the full value.
            </div>
          )}
          {data.hex && (
            <div className="inline-banner">
              Binary value shown as hexadecimal. Editing is disabled.
            </div>
          )}
          {data.type === 'string' ? (
            <div className="code-container">
              <Suspense
                fallback={
                  <div className="editor-loading">
                    <Loader2 className="spin" size={20} />
                  </div>
                }
              >
                <ValueEditor
                  value={value}
                  theme={theme}
                  format={format}
                  editable={data.editable}
                  onChange={setValue}
                />
              </Suspense>
            </div>
          ) : (
            <div className="collection-container">
              <table className="entry-table">
                <thead>
                  <tr>
                    <th>
                      {data.type === 'hash'
                        ? 'Field'
                        : data.type === 'list'
                          ? 'Index'
                          : data.type === 'stream'
                            ? 'Entry ID'
                            : 'Member'}
                    </th>
                    {data.type !== 'set' && <th>{data.type === 'zset' ? 'Score' : 'Value'}</th>}
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td className="mono">{e.label}</td>
                      {data.type !== 'set' && (
                        <td className="mono entry-value">
                          {data.type === 'zset' ? e.score : e.value}
                        </td>
                      )}
                      <td className="entry-actions">
                        {e.binary && <span className="muted">binary</span>}
                        {data.type !== 'set' && data.type !== 'stream' && (
                          <button
                            className="icon-button"
                            aria-label={`Edit ${e.label}`}
                            disabled={!data.editable || e.binary}
                            onClick={() => openEntry(e)}
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                        <button
                          className="icon-button danger-text"
                          aria-label={`Remove ${e.label}`}
                          disabled={!data.editable || e.binary}
                          onClick={() => {
                            setEntry(e);
                            open('remove-entry');
                          }}
                        >
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!entries.length && (
                <div className="empty-state compact">
                  <MoreHorizontal />
                  <p>No entries returned in this page.</p>
                </div>
              )}
              {query.hasNextPage && (
                <button
                  className="button load-more"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {query.isFetchingNextPage ? 'Loading…' : 'Load more entries'}
                </button>
              )}
            </div>
          )}
          <div className="editor-footer">
            <div>
              {data.editable ? (
                dirty ? (
                  <>
                    <span className="status-dot amber" />
                    Unsaved changes
                  </>
                ) : (
                  <>
                    <Check size={13} />
                    All changes saved
                  </>
                )
              ) : (
                <>
                  <LockKeyhole size={13} />
                  Read-only value
                </>
              )}
            </div>
            {data.type === 'string' ? (
              <div>
                <span className="shortcut-hint">⌘ / Ctrl S to save</span>
                <button
                  className="button primary small"
                  disabled={!dirty || !data.editable || busy}
                  onClick={() => void save()}
                >
                  {busy ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
                  Save changes
                </button>
              </div>
            ) : (
              <span className="muted">{entries.length} loaded · changes save immediately</span>
            )}
          </div>
        </>
      )}
      {dialog && (
        <Dialog
          title={
            dialog === 'ttl'
              ? 'Set expiration'
              : dialog === 'rename'
                ? 'Rename key'
                : dialog === 'delete'
                  ? 'Delete key'
                  : dialog === 'remove-entry'
                    ? 'Remove entry'
                    : entry
                      ? 'Edit entry'
                      : 'Add entry'
          }
          description={
            dialog === 'delete'
              ? 'This permanently removes the key and its value.'
              : dialog === 'ttl'
                ? 'Choose how long this key should live.'
                : undefined
          }
          onClose={() => {
            if (!busy) setDialog('');
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (dialog === 'rename')
                void perform(async () => {
                  const next = await api.rename(keyId, input);
                  onRenamed(next.id, input);
                }, 'Key renamed.');
              else if (dialog === 'ttl')
                void perform(
                  () => api.ttl(keyId, input ? Number(input) : null),
                  input ? 'Expiration updated.' : 'Expiration removed.',
                );
              else if (dialog === 'delete')
                void perform(async () => {
                  await api.remove(keyId);
                  onDeleted();
                }, 'Key deleted.');
              else if (dialog === 'remove-entry')
                void perform(
                  () =>
                    api.mutate(keyId, data.type as KeyType, {
                      action: 'remove',
                      id: entry!.id,
                      original: entry!.value,
                    }),
                  'Entry removed.',
                );
              else {
                let fields: Record<string, string> | undefined;
                if (data.type === 'stream') {
                  try {
                    const parsed = JSON.parse(entryValue);
                    if (
                      !parsed ||
                      typeof parsed !== 'object' ||
                      Array.isArray(parsed) ||
                      !Object.values(parsed).every((v) => typeof v === 'string') ||
                      Object.keys(parsed).length < 1
                    )
                      throw new Error();
                    fields = parsed;
                  } catch {
                    setError('Provide a JSON object with string field values.');
                    return;
                  }
                }
                const m: Mutation = {
                  action: entry ? 'update' : 'add',
                  id: entry?.id,
                  label: entryLabel,
                  value: entryValue,
                  original: entry?.value,
                  score: Number(score),
                  fields,
                };
                void perform(
                  () => api.mutate(keyId, data.type as KeyType, m),
                  entry ? 'Entry updated.' : 'Entry added.',
                );
              }
            }}
          >
            {dialog === 'rename' && (
              <label className="field">
                New key name
                <input
                  autoFocus
                  required
                  value={input}
                  maxLength={4096}
                  onChange={(e) => setInput(e.target.value)}
                />
              </label>
            )}
            {dialog === 'ttl' && (
              <>
                <div className="ttl-presets">
                  {[
                    ['5 minutes', '300'],
                    ['1 hour', '3600'],
                    ['1 day', '86400'],
                    ['No expiry', ''],
                  ].map(([label, v]) => (
                    <button
                      type="button"
                      className={`button small ${input === v ? 'selected' : ''}`}
                      key={label}
                      onClick={() => setInput(v)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="field">
                  Time to live in seconds
                  <input
                    autoFocus
                    type="number"
                    min={1}
                    max={2147483647}
                    placeholder="Leave empty for no expiration"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                  />
                </label>
                <p className="form-hint">The countdown starts when you save.</p>
              </>
            )}
            {dialog === 'delete' && (
              <>
                <div className="delete-target mono">{data.name}</div>
                <label className="field">
                  Type the key name to confirm
                  <input
                    autoFocus
                    autoComplete="off"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                  />
                </label>
              </>
            )}
            {dialog === 'remove-entry' && (
              <p>
                Remove <code>{entry?.label}</code> from <code>{data.name}</code>? Removing the last
                member also removes the Redis key.
              </p>
            )}
            {dialog === 'entry' && (
              <>
                {data.type === 'hash' && (
                  <label className="field">
                    Field name
                    <input
                      required
                      autoFocus
                      disabled={!!entry}
                      value={entryLabel}
                      onChange={(e) => setEntryLabel(e.target.value)}
                    />
                  </label>
                )}
                {data.type === 'zset' && (
                  <label className="field">
                    Score
                    <input
                      type="number"
                      step="any"
                      required
                      value={score}
                      onChange={(e) => setScore(e.target.value)}
                    />
                  </label>
                )}
                <label className="field">
                  {data.type === 'stream'
                    ? 'Fields (JSON object)'
                    : data.type === 'set' || data.type === 'zset'
                      ? 'Member'
                      : 'Value'}
                  <textarea
                    autoFocus={data.type !== 'hash'}
                    rows={5}
                    className="mono"
                    required={data.type === 'stream'}
                    disabled={data.type === 'zset' && !!entry}
                    value={entryValue}
                    onChange={(e) => setEntryValue(e.target.value)}
                  />
                </label>
              </>
            )}
            <FormError message={error} />
            <div className="dialog-actions">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => setDialog('')}
              >
                Cancel
              </button>
              <button
                className={`button ${dialog === 'delete' || dialog === 'remove-entry' ? 'danger' : 'primary'}`}
                disabled={busy || (dialog === 'delete' && input !== data.name)}
              >
                {busy && <Loader2 size={14} className="spin" />}
                {dialog === 'delete'
                  ? 'Delete key'
                  : dialog === 'remove-entry'
                    ? 'Remove entry'
                    : 'Save changes'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
