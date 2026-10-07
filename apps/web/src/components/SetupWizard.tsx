import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Eye, EyeOff, Layers3, Loader2, LockKeyhole, LogOut, Plug, Plus } from 'lucide-react';
import type { Connection, ConnectionInput, Session } from '@respdeck/contracts';
import { RequestError, auth, connections } from '../api';
import { FormError } from './Dialog';
import { ConnectionFields, newConnectionInput } from './ConnectionFields';

const steps = ['Secure workspace', 'Connect Redis'];
const minPassword = 12;

export function SetupShell({
  step,
  title,
  description,
  children,
  wide = false,
}: {
  step?: 1 | 2;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="setup-page">
      <section className={`setup-panel ${wide ? 'wide' : ''}`}>
        <header className="setup-brand">
          <span className="brand-mark">
            <Layers3 size={22} strokeWidth={2} />
          </span>
          <span className="setup-wordmark">
            resp<span className="brand-light">deck</span>
            <span className="brand-period">.</span>
          </span>
        </header>
        {step && (
          <ol className="setup-steps" aria-label="Setup progress">
            {steps.map((label, index) => (
              <li
                key={label}
                className={index + 1 === step ? 'current' : index + 1 < step ? 'done' : ''}
                aria-current={index + 1 === step ? 'step' : undefined}
              >
                <span className="setup-step-number">
                  {index + 1 < step ? <Check size={12} /> : index + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>
        )}
        <h1 className="setup-title">{title}</h1>
        {description && <p className="setup-description">{description}</p>}
        {children}
      </section>
    </main>
  );
}

export function LoadingScreen() {
  return (
    <SetupShell title="Loading RESPdeck">
      <div className="setup-loading" role="status">
        <Loader2 size={18} className="spin" />
        Checking your workspace…
      </div>
    </SetupShell>
  );
}

export function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <SetupShell title="Can’t reach RESPdeck">
      <FormError message={message} />
      <div className="setup-actions">
        <button className="button primary" onClick={onRetry}>
          Retry
        </button>
      </div>
    </SetupShell>
  );
}

function PasswordInput({
  label,
  value,
  onChange,
  autoComplete,
  autoFocus,
  shown,
  onToggle,
  describedBy,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
  shown: boolean;
  onToggle?: () => void;
  describedBy?: string;
}) {
  return (
    <label className="field">
      {label}
      <span className="password-control">
        <input
          type={shown ? 'text' : 'password'}
          required
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          aria-describedby={describedBy}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {onToggle && (
          <button
            type="button"
            className="icon-button"
            aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            onClick={onToggle}
          >
            {shown ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </span>
    </label>
  );
}

export function SetupStep({
  onDone,
  onAlreadyConfigured,
}: {
  onDone: (session: Session) => void;
  onAlreadyConfigured: () => void;
}) {
  const [setupCode, setSetupCode] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [shown, setShown] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    const code = setupCode.trim();
    if (password.length < minPassword) {
      setError(`Use an administrator password of at least ${minPassword} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const session = await auth.setup({ setupCode: code, password });
      setSetupCode('');
      setPassword('');
      setConfirm('');
      onDone(session);
    } catch (e) {
      if (e instanceof RequestError && e.code === 'SETUP_ALREADY_COMPLETED') {
        setSetupCode('');
        setPassword('');
        setConfirm('');
        onAlreadyConfigured();
        return;
      }
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <SetupShell
      step={1}
      title="Secure your workspace"
      description="Create the administrator password for this RESPdeck server. Redis comes next, and you can skip it."
    >
      <form
        className="setup-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="setup-callout">
          <LockKeyhole size={16} />
          <p>
            Find the one-time setup code in the server logs (for Docker:{' '}
            <code>docker logs &lt;container&gt;</code>) on the line starting with{' '}
            <code>RESPdeck setup code:</code>. It proves you control this server.
          </p>
        </div>
        <label className="field">
          Setup code
          <input
            required
            autoFocus
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            value={setupCode}
            onChange={(e) => setSetupCode(e.target.value)}
          />
        </label>
        <PasswordInput
          label="Administrator password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          shown={shown}
          onToggle={() => setShown((v) => !v)}
          describedBy="setup-password-hint"
        />
        <PasswordInput
          label="Confirm password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          shown={shown}
        />
        <p id="setup-password-hint" className="form-hint">
          At least {minPassword} characters. This is for RESPdeck only, not your Redis password.
        </p>
        <FormError message={error} />
        <div className="setup-actions">
          <button className="button primary" disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <LockKeyhole size={14} />}
            Create administrator
          </button>
        </div>
      </form>
    </SetupShell>
  );
}

export function LoginScreen({
  notice,
  onDone,
}: {
  notice?: string;
  onDone: (session: Session) => void;
}) {
  const [password, setPassword] = useState(''),
    [shown, setShown] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <SetupShell title="Unlock your workspace" description="Sign in with your administrator password.">
      <form
        className="setup-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            const session = await auth.login(password);
            setPassword('');
            onDone(session);
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        {notice && (
          <div className="form-error" role="alert">
            {notice}
          </div>
        )}
        <PasswordInput
          label="Administrator password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          autoFocus
          shown={shown}
          onToggle={() => setShown((v) => !v)}
        />
        <FormError message={error} />
        <div className="setup-actions">
          <button className="button primary" disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <LockKeyhole size={14} />}
            Sign in
          </button>
        </div>
      </form>
    </SetupShell>
  );
}

export function OnboardingStep({
  onDone,
  onSignOut,
}: {
  onDone: (session: Session) => void;
  onSignOut: () => void;
}) {
  const client = useQueryClient();
  const existing = useQuery({ queryKey: ['connections'], queryFn: connections.list });
  const [input, setInput] = useState<ConnectionInput>(newConnectionInput);
  const [tested, setTested] = useState(false),
    [saved, setSaved] = useState<Connection>(),
    [adding, setAdding] = useState(false),
    [busy, setBusy] = useState<'' | 'test' | 'save' | 'skip' | 'complete'>(''),
    [error, setError] = useState('');
  const change = (patch: Partial<ConnectionInput>) => {
    setInput((prev) => ({ ...prev, ...patch }));
    setTested(false);
  };
  const saveds = existing.data ?? [];
  const showForm = !saved && (adding || (existing.isSuccess && saveds.length === 0));
  const complete = async () => {
    setError('');
    setBusy('complete');
    try {
      const session = await auth.completeSetup();
      setInput(newConnectionInput());
      await client.invalidateQueries({ queryKey: ['connections'] });
      onDone(session);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const skip = async () => {
    setError('');
    setBusy('skip');
    try {
      const session = await auth.completeSetup();
      setInput(newConnectionInput());
      onDone(session);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const test = async () => {
    setError('');
    setBusy('test');
    try {
      await connections.test(input);
      setTested(true);
    } catch (e) {
      setTested(false);
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const saveAndContinue = async () => {
    if (!tested || busy) return;
    setError('');
    setBusy('save');
    let connection: Connection;
    try {
      connection = await connections.save(input);
    } catch (e) {
      setError((e as Error).message);
      setBusy('');
      return;
    }
    setSaved(connection);
    setInput(newConnectionInput());
    setBusy('');
    await complete();
  };
  return (
    <SetupShell
      step={2}
      wide
      title="Connect Redis"
      description="Optional. Test a Redis server and save it, or skip and add connections later."
    >
      {existing.isError && <FormError message={existing.error.message} />}
      {saved ? (
        <div className="setup-form">
          <div className="form-success">
            <Check size={15} />
            Saved “{saved.name}” at {saved.host}:{saved.port}.
          </div>
          <FormError message={error} />
          <div className="setup-actions">
            <button className="button primary" disabled={!!busy} onClick={() => void complete()}>
              {busy === 'complete' && <Loader2 size={14} className="spin" />}
              {error ? 'Retry finishing setup' : 'Finish setup'}
            </button>
          </div>
        </div>
      ) : existing.isPending ? (
        <div className="setup-loading" role="status">
          <Loader2 size={18} className="spin" />
          Loading saved connections…
        </div>
      ) : showForm ? (
        <form
          className="setup-form"
          onSubmit={(e) => {
            e.preventDefault();
            void saveAndContinue();
          }}
        >
          <ConnectionFields
            input={input}
            onChange={change}
            passwordLabel="Redis password"
            hostHint="localhost refers to the RESPdeck container itself. In Docker or Coolify, use a Redis hostname reachable on the shared Docker network."
          />
          <FormError message={error} />
          {tested && (
            <div className="form-success" role="status">
              <Check size={15} />
              Connection successful
            </div>
          )}
          <div className="setup-actions split">
            <button
              type="button"
              className="button"
              disabled={!!busy}
              onClick={() => void skip()}
            >
              {busy === 'skip' && <Loader2 size={14} className="spin" />}
              Skip for now
            </button>
            <button
              type="button"
              className="button"
              disabled={!!busy || !input.name}
              onClick={() => void test()}
            >
              {busy === 'test' ? <Loader2 size={15} className="spin" /> : <Plug size={15} />}
              Test connection
            </button>
            <button className="button primary" disabled={!tested || !!busy}>
              {busy === 'save' && <Loader2 size={14} className="spin" />}
              Save and continue
            </button>
          </div>
        </form>
      ) : (
        <div className="setup-form">
          <p className="setup-description">Connections already saved on this server:</p>
          <ul className="setup-connections">
            {saveds.map((c) => (
              <li key={c.id}>
                <span className={`connection-dot ${c.color}`} />
                <strong>{c.name}</strong>
                <small>
                  {c.host}:{c.port}
                </small>
              </li>
            ))}
          </ul>
          <FormError message={error} />
          <div className="setup-actions split">
            <button className="button" disabled={!!busy} onClick={() => setAdding(true)}>
              <Plus size={14} />
              Add another
            </button>
            <button className="button primary" disabled={!!busy} onClick={() => void complete()}>
              {busy === 'complete' && <Loader2 size={14} className="spin" />}
              Continue
            </button>
          </div>
        </div>
      )}
      <button type="button" className="setup-link" onClick={onSignOut}>
        <LogOut size={13} />
        Sign out
      </button>
    </SetupShell>
  );

}

export function EmptyConnections({
  onAdd,
  onSignOut,
}: {
  onAdd: () => void;
  onSignOut: () => void;
}) {
  return (
    <SetupShell
      title="No Redis connections yet"
      description="Add a Redis server to start browsing keys."
    >
      <div className="setup-actions split">
        <button className="button" onClick={onSignOut}>
          <LogOut size={14} />
          Sign out
        </button>
        <button className="button primary" onClick={onAdd}>
          <Plus size={14} />
          Add connection
        </button>
      </div>
    </SetupShell>
  );
}
