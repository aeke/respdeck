import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Activity,
  ArrowDownUp,
  ArrowRight,
  BookOpen,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CircleHelp,
  Command,
  Database,
  ExternalLink,
  Folder,
  FolderTree,
  HardDrive,
  KeyRound,
  Layers3,
  LayoutGrid,
  List,
  Loader2,
  LockKeyhole,
  LogOut,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Users,
  X,
} from 'lucide-react';
import type { Accent, Connection, KeySummary, KeyType, Session, Theme } from '@respdeck/contracts';
import { keyTypes } from '@respdeck/contracts';
import { auth, connections, workspace, demoOnly } from './api';
import { demoConnections } from './demo';
import { encode, patternFor, size, ttlLabel } from './utils';
import { Dialog, FormError } from './components/Dialog';
import { ConnectionDialog } from './components/ConnectionDialog';
import { KeyEditor, TypeBadge } from './components/KeyEditor';

const emptySession: Session = {
  configured: false,
  authenticated: false,
  encryptionEnabled: false,
};
type View = 'browser' | 'overview' | 'settings';
function Sparkline({ values, className = '' }: { values: number[]; className?: string }) {
  const max = Math.max(...values, 1),
    min = Math.min(...values, 0);
  const points = values
    .map(
      (v, i) =>
        `${values.length < 2 ? 0 : (i / (values.length - 1)) * 120},${36 - ((v - min) / (max - min || 1)) * 28}`,
    )
    .join(' ');
  return (
    <svg viewBox="0 0 120 40" className={`sparkline ${className}`} aria-hidden="true">
      <defs>
        <linearGradient id={`fill-${className || 'default'}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity=".17" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,40 ${points} 120,40`} fill={`url(#fill-${className || 'default'})`} />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export default function App() {
  const client = useQueryClient();
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('respdeck-theme') as Theme) || 'dark',
  );
  const [accent, setAccent] = useState<Accent>(
    () => (localStorage.getItem('respdeck-accent') as Accent) || 'violet',
  );
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>('dark');
  const [active, setActive] = useState(demoConnections[0]),
    [db, setDb] = useState(0),
    [view, setView] = useState<View>('browser');
  const [search, setSearch] = useState(''),
    [debounced, setDebounced] = useState(''),
    [type, setType] = useState(''),
    [tree, setTree] = useState(false),
    [collapsed, setCollapsed] = useState<string[]>([]);
  const [tabs, setTabs] = useState<{ id: string; name: string }[]>([
      { id: encode('users:1001'), name: 'users:1001' },
    ]),
    [selected, setSelected] = useState<string | null>(encode('users:1001'));
  const [dirtyWorkspace, setDirtyWorkspace] = useState(false);
  const [modal, setModal] = useState(''),
    [editingConnection, setEditingConnection] = useState<Connection>(),
    [loginPassword, setLoginPassword] = useState(''),
    [formError, setFormError] = useState(''),
    [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState(''),
    [newType, setNewType] = useState<KeyType>('string'),
    [newValue, setNewValue] = useState(''),
    [newTtl, setNewTtl] = useState('');
  const [toast, setToast] = useState<{ message: string; error: boolean }>(),
    [paletteSearch, setPaletteSearch] = useState(''),
    [panelWidth, setPanelWidth] = useState(328);
  const [opsHistory, setOpsHistory] = useState<number[]>([]),
    [visible, setVisible] = useState(!document.hidden),
    [mobilePanel, setMobilePanel] = useState<'keys' | 'editor'>('keys');
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined),
    listRef = useRef<HTMLDivElement>(null),
    searchRef = useRef<HTMLInputElement>(null);
  const sessionQuery = useQuery({
    queryKey: ['session'],
    queryFn: auth.session,
  });
  const session = sessionQuery.data ?? emptySession;
  const realConnections = useQuery({
    queryKey: ['connections'],
    queryFn: connections.list,
    enabled: session.authenticated,
  });
  const allConnections = [
    ...demoConnections,
    ...(session.authenticated ? (realConnections.data ?? []) : []),
  ];
  const isDemo = active.id.startsWith('demo-');
  const api = workspace(active.id, db);
  const summary = useQuery({
    queryKey: ['summary', active.id, db],
    queryFn: api.summary,
    enabled: visible && view !== 'settings',
    refetchInterval: visible && view !== 'settings' ? 5000 : false,
  });
  const keysQuery = useInfiniteQuery({
    queryKey: ['keys', active.id, db, debounced, type],
    queryFn: ({ pageParam, signal }) =>
      api.scan(pageParam, patternFor(debounced), type || undefined, signal),
    initialPageParam: '0',
    getNextPageParam: (page) => (page.complete ? undefined : page.cursor),
    enabled: view === 'browser',
  });
  const keys = useMemo(
    () =>
      [
        ...new Map(
          (keysQuery.data?.pages.flatMap((p) => p.keys) ?? []).map((k) => [k.id, k]),
        ).values(),
      ].sort((a, b) => a.name.localeCompare(b.name)),
    [keysQuery.data],
  );
  const rows = useMemo(() => {
    if (!tree) return keys.map((key) => ({ kind: 'key' as const, key }));
    const result: (
      { kind: 'key'; key: KeySummary } | { kind: 'folder'; name: string; count: number }
    )[] = [];
    const groups = new Map<string, KeySummary[]>();
    for (const key of keys) {
      const prefix = key.name.includes(':') ? key.name.split(':')[0] : 'Other keys';
      groups.set(prefix, [...(groups.get(prefix) ?? []), key]);
    }
    for (const [name, group] of groups) {
      result.push({ kind: 'folder', name, count: group.length });
      if (!collapsed.includes(name))
        result.push(...group.map((key) => ({ kind: 'key' as const, key })));
    }
    return result;
  }, [keys, tree, collapsed]);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 45,
    overscan: 10,
  });
  useEffect(() => {
    const index = rows.findIndex((row) => row.kind === 'key' && row.key.id === selected);
    if (index >= 0) virtual.scrollToIndex(index, { align: 'auto' });
  }, [selected, rows, virtual]);
  const notify = (message: string, error = false) => {
    clearTimeout(toastTimer.current);
    setToast({ message, error });
    toastTimer.current = setTimeout(() => setToast(undefined), error ? 8000 : 4000);
  };
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timeout);
  }, [search]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const t = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = t;
      document.documentElement.dataset.accent = accent;
      setResolvedTheme(t);
    };
    apply();
    localStorage.setItem('respdeck-theme', theme);
    localStorage.setItem('respdeck-accent', accent);
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme, accent]);
  useEffect(() => {
    const onVisible = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  useEffect(() => {
    if (summary.data) setOpsHistory((prev) => [...prev.slice(-29), summary.data.ops]);
  }, [summary.dataUpdatedAt]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteSearch('');
        setModal('palette');
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setView('browser');
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const canNavigate = () =>
    !dirtyWorkspace || window.confirm('Discard unsaved changes to this key?');
  const gotoView = (next: View) => {
    if (next === view || canNavigate()) setView(next);
  };
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyWorkspace) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirtyWorkspace]);
  const clearWorkspace = () => {
    setTabs([]);
    setSelected(null);
    setSearch('');
    setDebounced('');
    setType('');
    setCollapsed([]);
    setOpsHistory([]);
    setMobilePanel('keys');
  };
  const switchConnection = (c: Connection, force = false) => {
    if (c.id === active.id || (!force && !canNavigate())) return;
    setActive(c);
    setDb(0);
    clearWorkspace();
    setView('browser');
  };
  const openKey = (key: { id: string; name: string }) => {
    if (selected !== key.id && !canNavigate()) return;
    setSelected(key.id);
    setTabs((prev) => (prev.some((t) => t.id === key.id) ? prev : [...prev.slice(-9), key]));
    setView('browser');
    setMobilePanel('editor');
  };
  const closeTab = (id: string) => {
    if (selected === id && !canNavigate()) return;
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (selected === id) setSelected(next.at(-1)?.id ?? null);
  };
  const openModal = (name: string) => {
    setFormError('');
    setModal(name);
  };
  const addConnection = () => {
    setEditingConnection(undefined);
    openModal(session.authenticated ? 'connection' : 'login');
  };
  const refreshKeys = async () => {
    await client.resetQueries({ queryKey: ['keys', active.id, db] });
    await client.invalidateQueries({ queryKey: ['summary', active.id, db] });
  };
  const createKey = async () => {
    setBusy(true);
    setFormError('');
    try {
      const key = await api.create(newName, newType, newValue, newTtl ? Number(newTtl) : null);
      await refreshKeys();
      openKey({ id: key.id, name: newName });
      setModal('');
      notify('Key created.');
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const resize = (start: React.PointerEvent) => {
    start.preventDefault();
    const origin = start.clientX,
      width = panelWidth;
    const move = (e: PointerEvent) =>
      setPanelWidth(Math.max(260, Math.min(500, width + e.clientX - origin)));
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  };
  useEffect(() => {
    const expired = () => {
      client.setQueryData(['session'], { ...emptySession, configured: true });
      client.removeQueries({ queryKey: ['connections'] });
      switchConnection(demoConnections[0], true);
      setModal('login');
      notify('Your administrator session expired. Sign in again.', true);
    };
    window.addEventListener('respdeck-session-expired', expired);
    return () => window.removeEventListener('respdeck-session-expired', expired);
  }, [client, active.id]);
  const metricOps = isDemo
    ? [28, 32, 27, 45, 42, 30, 38, 52, 40, 58, 45, 48, 68, 53, 60, 72, 64, 82]
    : opsHistory;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => gotoView('browser')} aria-label="RESPdeck home">
          <span className="brand-mark">
            <Layers3 size={22} strokeWidth={2} />
          </span>
          <span>
            resp<span className="brand-light">deck</span>
            <span className="brand-period">.</span>
          </span>
        </button>
        <button className="workspace-switch" onClick={() => openModal('about')}>
          <span className="workspace-avatar">P</span>
          <span>
            Personal workspace<small>Self-hosted · v0.1.0</small>
          </span>
          <ChevronsUpDown size={14} />
        </button>
        <div className="sidebar-section-heading">
          <span>WORKSPACE</span>
          <button
            className="icon-button tiny"
            aria-label="Open command palette"
            onClick={() => openModal('palette')}
          >
            <Command size={12} />
          </button>
        </div>
        <nav aria-label="Workspace">
          <button
            className={`nav-item ${view === 'browser' ? 'active' : ''}`}
            onClick={() => gotoView('browser')}
          >
            <Database size={17} />
            Data browser
          </button>
          <button
            className={`nav-item ${view === 'overview' ? 'active' : ''}`}
            onClick={() => gotoView('overview')}
          >
            <Activity size={17} />
            Overview
          </button>
          <button
            className={`nav-item ${view === 'settings' ? 'active' : ''}`}
            onClick={() => gotoView('settings')}
          >
            <Settings2 size={17} />
            Settings
          </button>
        </nav>
        <div className="sidebar-section-heading connection-heading">
          <span>
            CONNECTIONS <span className="sidebar-count">{allConnections.length}</span>
          </span>
          <button
            className="icon-button tiny"
            aria-label="Add connection"
            title="Add connection"
            onClick={addConnection}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="connection-list">
          {allConnections.map((c) => (
            <button
              key={c.id}
              className={`connection-item ${active.id === c.id ? 'active' : ''}`}
              onClick={() => switchConnection(c)}
            >
              <span className={`connection-dot ${c.color}`} />
              <span className="connection-text">
                {c.name}
                <small>
                  {c.id.startsWith('demo-') ? 'Sample connection' : `${c.host}:${c.port}`}
                </small>
              </span>
              {c.readOnly ? (
                <LockKeyhole size={12} />
              ) : active.id === c.id ? (
                <ChevronRight size={13} />
              ) : null}
            </button>
          ))}
        </div>
        <button className="new-connection" onClick={addConnection}>
          <Plus size={14} />
          New connection
        </button>
        <div className="sidebar-bottom">
          <div className="tip-card">
            <span>
              <Sparkles size={15} />A little more flow.
            </span>
            <p>Jump between keys and actions without leaving your keyboard.</p>
            <button onClick={() => openModal('palette')}>
              Open command palette <kbd>⌘ K</kbd>
            </button>
          </div>
          <button className="sidebar-link" onClick={() => openModal('shortcuts')}>
            <BookOpen size={16} />
            Keyboard shortcuts
            <ArrowRight size={13} />
          </button>
          <button className="sidebar-link" onClick={() => openModal('about')}>
            <CircleHelp size={16} />
            About RESPdeck
            <ExternalLink size={13} />
          </button>
          <div className="profile-row">
            <span className="profile-avatar">A</span>
            <div>
              Your workspace<small>Everything stays with you</small>
            </div>
            <button
              className="icon-button"
              aria-label="Toggle color theme"
              title="Toggle color theme"
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            >
              {resolvedTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <Server size={15} />
            <label className="connection-selector">
              <select
                aria-label="Connection"
                value={active.id}
                onChange={(e) => {
                  const connection = allConnections.find((item) => item.id === e.target.value);
                  if (connection) switchConnection(connection);
                }}
              >
                {allConnections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={11} />
            </label>
            <ChevronRight size={13} />
            <label className="db-selector">
              <Database size={13} />
              <select
                aria-label="Database"
                value={db}
                onChange={(e) => {
                  if (canNavigate()) {
                    setDb(Number(e.target.value));
                    clearWorkspace();
                  }
                }}
              >
                {(summary.data?.databases ?? Array.from({ length: 16 }, (_, i) => i)).map((i) => (
                  <option key={i} value={i}>
                    db{i}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="topbar-right">
            {isDemo && (
              <span className="demo-badge">
                <span />
                Demo workspace
              </span>
            )}
            {active.readOnly && (
              <span className="read-only-badge">
                <LockKeyhole size={12} />
                Read only
              </span>
            )}
            <button
              className="icon-button"
              title="Connection settings"
              aria-label="Connection settings"
              disabled={isDemo}
              onClick={() => {
                setEditingConnection(active);
                openModal('connection');
              }}
            >
              <SlidersHorizontal size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="Help"
              onClick={() => openModal('shortcuts')}
            >
              <CircleHelp size={16} />
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR REDIS, IN FOCUS</div>
              <h1>
                {view === 'browser'
                  ? 'Data browser'
                  : view === 'overview'
                    ? 'Server overview'
                    : 'Make it yours'}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {view === 'browser'
                  ? 'Explore, understand, and shape your data.'
                  : view === 'overview'
                    ? 'A clear view of what’s happening on your server.'
                    : 'A workspace that feels right, in every light.'}
              </p>
            </div>
            <div className="page-heading-actions">
              {view !== 'settings' && (
                <button
                  className="button"
                  aria-label="Refresh workspace"
                  onClick={() => {
                    void refreshKeys();
                    void summary.refetch();
                  }}
                >
                  <RefreshCw size={14} />
                  <span>Refresh</span>
                </button>
              )}
              {view === 'browser' && (
                <button
                  className="button primary"
                  disabled={active.readOnly}
                  onClick={() => {
                    setNewName('');
                    setNewType('string');
                    setNewValue('');
                    setNewTtl('');
                    openModal('create');
                  }}
                >
                  <Plus size={16} />
                  New key
                </button>
              )}
            </div>
          </div>
          {view !== 'settings' && (
            <div className="metrics-grid">
              <div className="metric-card">
                <div className="metric-label">
                  <KeyRound size={14} />
                  TOTAL KEYS<span className="metric-db">db{db}</span>
                </div>
                <div className="metric-bottom">
                  <strong>{summary.data?.keys.toLocaleString() ?? '—'}</strong>
                  <span className="metric-note">
                    {isDemo ? 'Sample keyspace' : 'Current database'}
                  </span>
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-label">
                  <HardDrive size={14} />
                  MEMORY USAGE
                </div>
                <div className="metric-bottom">
                  <strong>{summary.data ? size(summary.data.memory) : '—'}</strong>
                  <span className="metric-note">
                    {summary.data?.maxMemory
                      ? `of ${size(summary.data.maxMemory)}`
                      : 'Server memory'}
                  </span>
                </div>
                <div className="memory-track">
                  <span
                    style={{
                      width: `${summary.data ? Math.min(100, (summary.data.memory / (summary.data.maxMemory || summary.data.memory)) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-label">
                  <Activity size={14} />
                  OPERATIONS / SEC
                </div>
                <div className="metric-bottom">
                  <strong>
                    {summary.data?.ops.toLocaleString() ?? '—'}
                    <small>ops</small>
                  </strong>
                  <Sparkline values={metricOps} className="teal" />
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-label">
                  <Users size={14} />
                  CONNECTED CLIENTS
                </div>
                <div className="metric-bottom">
                  <strong>{summary.data?.clients ?? '—'}</strong>
                  <span className="metric-note">
                    <span className={`status-dot ${summary.isError ? 'amber' : ''}`} />
                    {summary.isError
                      ? 'Unavailable'
                      : isDemo
                        ? 'Demo server'
                        : 'Active connections'}
                  </span>
                </div>
              </div>
            </div>
          )}
          {summary.isError && view !== 'settings' && (
            <div className="inline-banner error-banner" role="alert">
              {summary.error.message}
              <button onClick={() => void summary.refetch()}>Retry</button>
            </div>
          )}
          {view === 'browser' ? (
            <section
              className={`browser-workspace mobile-${mobilePanel}`}
              style={
                {
                  '--key-panel-width': `${panelWidth}px`,
                } as React.CSSProperties
              }
              aria-label="Redis data browser"
            >
              <div className="key-panel">
                <div className="key-panel-heading">
                  <div>
                    <KeyRound size={15} />
                    <h2>Keys</h2>
                    <span className="count-pill">{keys.length}</span>
                  </div>
                  <div className="view-switch" aria-label="Key list view">
                    <button
                      aria-label="Flat list"
                      aria-pressed={!tree}
                      className={!tree ? 'active' : ''}
                      onClick={() => setTree(false)}
                    >
                      <List size={14} />
                    </button>
                    <button
                      aria-label="Namespace groups"
                      aria-pressed={tree}
                      className={tree ? 'active' : ''}
                      title="Group loaded keys by namespace"
                      onClick={() => setTree(true)}
                    >
                      <FolderTree size={14} />
                    </button>
                  </div>
                </div>
                <div className="key-search-wrap">
                  <Search size={15} />
                  <input
                    ref={searchRef}
                    aria-label="Search keys"
                    placeholder="Search keys or pattern…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search ? (
                    <button
                      className="icon-button tiny"
                      aria-label="Clear search"
                      onClick={() => setSearch('')}
                    >
                      <X size={13} />
                    </button>
                  ) : (
                    <kbd>⌘ F</kbd>
                  )}
                </div>
                <div className="key-filters">
                  <label>
                    <SlidersHorizontal size={13} />
                    <select
                      aria-label="Filter key type"
                      value={type}
                      onChange={(e) => setType(e.target.value)}
                    >
                      <option value="">All types</option>
                      {keyTypes.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={12} />
                  </label>
                  <span>
                    <ArrowDownUp size={12} />
                    Name
                  </span>
                </div>
                <div className="key-list" ref={listRef} aria-label="Redis keys">
                  {keysQuery.isPending ? (
                    <div className="empty-state compact">
                      <Loader2 className="spin" />
                      <p>Scanning keys…</p>
                    </div>
                  ) : keysQuery.isError ? (
                    <div className="empty-state compact">
                      <CircleHelp />
                      <h3>Connection unavailable</h3>
                      <p>{keysQuery.error.message}</p>
                      <button className="button small" onClick={() => void keysQuery.refetch()}>
                        Try again
                      </button>
                    </div>
                  ) : rows.length ? (
                    <div
                      style={{
                        height: virtual.getTotalSize(),
                        position: 'relative',
                        width: '100%',
                      }}
                    >
                      {virtual.getVirtualItems().map((item) => {
                        const row = rows[item.index];
                        return (
                          <div
                            key={row.kind === 'key' ? row.key.id : row.name}
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              height: item.size,
                              transform: `translateY(${item.start}px)`,
                            }}
                          >
                            {row.kind === 'folder' ? (
                              <button
                                className="folder-row"
                                onClick={() =>
                                  setCollapsed((prev) =>
                                    prev.includes(row.name)
                                      ? prev.filter((n) => n !== row.name)
                                      : [...prev, row.name],
                                  )
                                }
                              >
                                {collapsed.includes(row.name) ? (
                                  <ChevronRight size={12} />
                                ) : (
                                  <ChevronDown size={12} />
                                )}
                                <Folder size={14} />
                                {row.name}
                                <span>{row.count}</span>
                              </button>
                            ) : (
                              <button
                                className={`key-row ${tree ? 'nested' : ''} ${selected === row.key.id ? 'selected' : ''}`}
                                aria-label={`Open key ${row.key.name}`}
                                aria-current={selected === row.key.id ? 'true' : undefined}
                                onClick={() => openKey(row.key)}
                                onKeyDown={(e) => {
                                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    const next = item.index + (e.key === 'ArrowDown' ? 1 : -1);
                                    const target = rows[next];
                                    if (target?.kind === 'key') {
                                      openKey(target.key);
                                      virtual.scrollToIndex(next);
                                      requestAnimationFrame(() =>
                                        listRef.current
                                          ?.querySelector<HTMLButtonElement>(
                                            `[aria-current="true"]`,
                                          )
                                          ?.focus(),
                                      );
                                    }
                                  }
                                }}
                              >
                                <span className={`key-type-icon type-${row.key.type}`}>
                                  {row.key.type === 'string' ? (
                                    <Braces size={14} />
                                  ) : row.key.type === 'hash' ? (
                                    <LayoutGrid size={14} />
                                  ) : row.key.type === 'stream' ? (
                                    <Activity size={14} />
                                  ) : (
                                    <List size={14} />
                                  )}
                                </span>
                                <span className="key-row-name" title={row.key.name}>
                                  {row.key.name || '(empty key)'}
                                </span>
                                <TypeBadge type={row.key.type} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="empty-state compact">
                      <Search size={25} />
                      <h3>
                        {keysQuery.hasNextPage ? 'No matches in this batch' : 'No keys found'}
                      </h3>
                      <p>
                        {search
                          ? 'Try another pattern or continue scanning.'
                          : 'Create a key to get started.'}
                      </p>
                    </div>
                  )}
                </div>
                {keysQuery.hasNextPage && (
                  <button
                    className="load-keys"
                    disabled={keysQuery.isFetchingNextPage}
                    onClick={() => void keysQuery.fetchNextPage()}
                  >
                    {keysQuery.isFetchingNextPage ? (
                      <Loader2 className="spin" size={13} />
                    ) : (
                      <ChevronDown size={13} />
                    )}
                    Continue scanning
                  </button>
                )}
                <div className="key-panel-footer">
                  <span>{keys.length} keys loaded</span>
                  <span>
                    <span className={`status-dot ${keysQuery.hasNextPage ? 'amber' : ''}`} />
                    {keysQuery.hasNextPage ? 'More available' : 'Scan complete'}
                  </span>
                </div>
              </div>
              <div
                className="panel-resizer"
                role="separator"
                aria-label="Resize key panel"
                aria-orientation="vertical"
                aria-valuenow={panelWidth}
                aria-valuemin={260}
                aria-valuemax={500}
                tabIndex={0}
                onPointerDown={resize}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    setPanelWidth((w) =>
                      Math.max(260, Math.min(500, w + (e.key === 'ArrowRight' ? 20 : -20))),
                    );
                  }
                }}
              />
              <div className="inspector">
                <div className="open-key-tabs">
                  <button
                    className="mobile-back icon-button"
                    aria-label="Back to keys"
                    onClick={() => setMobilePanel('keys')}
                  >
                    <List size={16} />
                  </button>
                  <div className="open-key-tab-list">
                    {tabs.map((t) => (
                      <div
                        className={`open-key-tab ${selected === t.id ? 'active' : ''}`}
                        key={t.id}
                      >
                        <button onClick={() => openKey(t)}>
                          <Braces size={12} />
                          <span title={t.name}>{t.name}</span>
                        </button>
                        <button
                          className="tab-close"
                          aria-label={`Close ${t.name}`}
                          onClick={() => closeTab(t.id)}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    className="icon-button tiny"
                    aria-label="Find a key"
                    onClick={() => openModal('palette')}
                  >
                    <Plus size={14} />
                  </button>
                </div>
                {selected ? (
                  <KeyEditor
                    key={`${active.id}:${db}:${selected}`}
                    connection={active.id}
                    db={db}
                    keyId={selected}
                    theme={resolvedTheme}
                    readOnly={active.readOnly}
                    onDirty={setDirtyWorkspace}
                    notify={notify}
                    onDeleted={() => {
                      const next = tabs.filter((t) => t.id !== selected);
                      setTabs(next);
                      setSelected(next.at(-1)?.id ?? null);
                    }}
                    onRenamed={(id, name) => {
                      setTabs((prev) => prev.map((t) => (t.id === selected ? { id, name } : t)));
                      setSelected(id);
                    }}
                  />
                ) : (
                  <div className="empty-state inspector-empty">
                    <div className="empty-illustration">
                      <Layers3 size={44} />
                    </div>
                    <h3>A closer look at your data</h3>
                    <p>
                      Select a key to explore its value, manage its expiration, or make a change.
                    </p>
                    <span className="empty-shortcut">
                      <Command size={13} /> K to find a key
                    </span>
                  </div>
                )}
              </div>
            </section>
          ) : view === 'overview' ? (
            <section className="overview-grid">
              <div className="overview-chart surface">
                <div className="section-heading">
                  <div>
                    <h2>Throughput</h2>
                    <p>
                      {isDemo
                        ? 'Illustrative demo activity'
                        : 'Live samples collected while this workspace is open'}
                    </p>
                  </div>
                  <span className="live-label">
                    <span className="status-dot" />
                    {isDemo ? 'DEMO' : 'LIVE'}
                  </span>
                </div>
                <div className="chart-metric">
                  {summary.data?.ops.toLocaleString() ?? '—'}
                  <span>operations / second</span>
                </div>
                <Sparkline values={metricOps} className="large-chart" />
                <div className="chart-labels">
                  <span>{isDemo ? 'Sample start' : 'First sample'}</span>
                  <span>{isDemo ? 'Sample end' : 'Latest sample'}</span>
                </div>
              </div>
              <div className="surface server-details">
                <h2>Server details</h2>
                <dl>
                  {[
                    ['Redis version', summary.data?.version ?? '—'],
                    ['Uptime', summary.data ? ttlLabel(summary.data.uptime) : '—'],
                    ['Endpoint', `${active.host}:${active.port}`],
                    ['Transport', active.tls ? 'TLS encrypted' : 'TCP'],
                    ['Access mode', active.readOnly ? 'Read only' : 'Read & write'],
                    ['Selected database', `db${db}`],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="surface overview-note">
                <ShieldCheck size={23} />
                <div>
                  <h3>Your data stays on your infrastructure.</h3>
                  <p>
                    Redis connections run on your RESPdeck server. No telemetry, no third-party
                    services, no data sent elsewhere.
                  </p>
                </div>
              </div>
            </section>
          ) : (
            <section className="settings-view">
              <div className="surface settings-card">
                <div className="section-heading">
                  <div>
                    <h2>Appearance</h2>
                    <p>Choose the atmosphere for your workspace.</p>
                  </div>
                  <Sun size={20} />
                </div>
                <div className="theme-options">
                  {(['light', 'dark', 'system'] as Theme[]).map((t) => (
                    <button
                      className={`theme-option ${theme === t ? 'selected' : ''}`}
                      key={t}
                      onClick={() => setTheme(t)}
                      aria-pressed={theme === t}
                    >
                      <div className={`theme-preview preview-${t}`}>
                        <div className="preview-sidebar" />
                        <div className="preview-main">
                          <span />
                          <span />
                          <div>
                            <i />
                            <i />
                          </div>
                        </div>
                      </div>
                      <span>
                        {t === 'light' ? (
                          <Sun size={15} />
                        ) : t === 'dark' ? (
                          <Moon size={15} />
                        ) : (
                          <Settings2 size={15} />
                        )}{' '}
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                        {theme === t && <Check size={15} />}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="settings-divider" />
                <h3>Accent color</h3>
                <p>A subtle signature across your workspace.</p>
                <div className="accent-options">
                  {(['violet', 'teal', 'amber'] as Accent[]).map((a) => (
                    <button
                      className={`accent-option ${accent === a ? 'selected' : ''}`}
                      key={a}
                      aria-pressed={accent === a}
                      onClick={() => setAccent(a)}
                    >
                      <span className={`accent-swatch ${a}`} />
                      {a.charAt(0).toUpperCase() + a.slice(1)}
                      {accent === a && <Check size={14} />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="surface settings-card">
                <div className="section-heading">
                  <div>
                    <h2>Connections & privacy</h2>
                    <p>Self-hosted. Single-user. Entirely yours.</p>
                  </div>
                  <ShieldCheck size={20} />
                </div>
                <div className="settings-info">
                  <span>Administrator session</span>
                  <strong>{session.authenticated ? 'Signed in' : 'Demo mode'}</strong>
                </div>
                <div className="settings-info">
                  <span>Saved credentials</span>
                  <strong>
                    {session.encryptionEnabled ? 'Encrypted at rest' : 'Session memory only'}
                  </strong>
                </div>
                <div className="settings-info">
                  <span>Telemetry</span>
                  <strong>None</strong>
                </div>
                <div className="settings-info">
                  <span>License</span>
                  <strong>MIT</strong>
                </div>
                <div className="settings-actions">
                  <button className="button" onClick={addConnection}>
                    <Plus size={15} />
                    Add connection
                  </button>
                  {session.authenticated && (
                    <button
                      className="button"
                      onClick={async () => {
                        try {
                          await auth.logout();
                          client.removeQueries({ queryKey: ['connections'] });
                          switchConnection(demoConnections[0], true);
                          await client.invalidateQueries({
                            queryKey: ['session'],
                          });
                          notify('Signed out. Session passwords cleared.');
                        } catch (e) {
                          notify((e as Error).message, true);
                        }
                      }}
                    >
                      <LogOut size={15} />
                      Sign out
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}
        </main>
        <footer className="statusbar">
          <div>
            <span className={`status-dot ${summary.isError ? 'amber' : ''}`} />
            {isDemo
              ? 'Demo connection'
              : summary.isError
                ? 'Connection unavailable'
                : summary.data
                  ? 'Connected'
                  : 'Connecting…'}
            <span className="statusbar-divider" />
            {summary.data ? `Redis ${summary.data.version}` : 'Redis'}
            <span className="statusbar-divider" />
            db{db}
          </div>
          <div>
            {isDemo
              ? 'Sample data · changes are temporary'
              : active.readOnly
                ? 'Read-only connection'
                : 'Your data stays on your server'}
            <span className="statusbar-divider" />
            <span>
              RESPdeck <span className="muted">0.1.0</span>
            </span>
          </div>
        </footer>
      </div>
      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <CircleHelp size={17} /> : <Check size={17} />}
          <span>{toast.message}</span>
          <button
            className="icon-button tiny"
            aria-label="Dismiss notification"
            onClick={() => setToast(undefined)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {modal === 'connection' && (
        <ConnectionDialog
          existing={editingConnection}
          session={session}
          onClose={() => setModal('')}
          onSaved={(c) => {
            void client.invalidateQueries({ queryKey: ['connections'] });
            setModal('');
            if (active.id === c.id) setActive(c);
            else switchConnection(c);
            void refreshKeys();
            notify('Connection saved.');
          }}
          onRemoved={() => {
            void client.invalidateQueries({ queryKey: ['connections'] });
            setModal('');
            switchConnection(demoConnections[0]);
            notify('Connection removed.');
          }}
        />
      )}
      {modal === 'login' && (
        <Dialog
          title={
            demoOnly
              ? 'Make it your workspace'
              : session.configured
                ? 'Unlock your workspace'
                : 'Enable real connections'
          }
          description={
            demoOnly
              ? 'This hosted demo uses sample data. Self-host RESPdeck to connect your Redis.'
              : session.configured
                ? 'Sign in with your administrator password.'
                : 'The demo is ready. Configure your self-hosted server to connect Redis.'
          }
          onClose={() => setModal('')}
        >
          {demoOnly ? (
            <>
              <div className="setup-icon">
                <ShieldCheck size={28} />
              </div>
              <p>
                Explore all six data types, edit sample keys, and try the themes. Demo edits reset
                when you reload. No real Redis credentials are needed here.
              </p>
              <div className="dialog-actions">
                <a
                  className="button primary"
                  href="https://github.com/aeke/respdeck#quick-start"
                  target="_blank"
                  rel="noreferrer"
                >
                  Self-host RESPdeck <ExternalLink size={14} />
                </a>
                <button className="button" onClick={() => setModal('')}>
                  Keep exploring
                </button>
              </div>
            </>
          ) : session.configured ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setFormError('');
                try {
                  const s = await auth.login(loginPassword);
                  client.setQueryData(['session'], s);
                  setLoginPassword('');
                  setModal('connection');
                } catch (e) {
                  setFormError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="field">
                Administrator password
                <input
                  type="password"
                  required
                  autoFocus
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                />
              </label>
              <FormError message={formError} />
              <div className="dialog-actions">
                <button className="button primary" disabled={busy}>
                  {busy ? <Loader2 size={14} className="spin" /> : <LockKeyhole size={14} />}
                  Sign in
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="setup-icon">
                <ShieldCheck size={28} />
              </div>
              <p>
                Add an administrator password of at least 12 characters to your server’s{' '}
                <code>.env</code> file, then restart RESPdeck.
              </p>
              <pre className="setup-code">RESPDECK_ADMIN_PASSWORD=your-strong-password</pre>
              <p className="form-hint">
                For Docker, set the same environment variable in your Compose configuration. You can
                keep exploring the demo while you set things up.
              </p>
              <div className="dialog-actions">
                <button className="button primary" onClick={() => setModal('')}>
                  Back to workspace
                </button>
              </div>
            </>
          )}
        </Dialog>
      )}
      {modal === 'create' && (
        <Dialog
          title="Create a key"
          description={`A new key in ${active.name}, database ${db}.`}
          onClose={() => {
            if (!busy) setModal('');
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createKey();
            }}
          >
            <label className="field">
              Key name
              <input
                required
                autoFocus
                placeholder="e.g. users:1004"
                value={newName}
                maxLength={4096}
                onChange={(e) => setNewName(e.target.value)}
              />
            </label>
            <label className="field">
              Data type
              <select value={newType} onChange={(e) => setNewType(e.target.value as KeyType)}>
                {keyTypes.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="field">
              {newType === 'string' ? 'Value' : 'Initial value'}
              <textarea
                className="mono"
                rows={5}
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder={
                  newType === 'string' ? '{ "hello": "world" }' : 'First member or field value'
                }
              />
            </label>
            {newType !== 'string' && (
              <p className="form-hint">
                {newType === 'hash'
                  ? 'Creates an initial field named “field”.'
                  : newType === 'zset'
                    ? 'Creates a member with score 0.'
                    : newType === 'stream'
                      ? 'Creates an entry with a “message” field.'
                      : 'Creates a collection with one member.'}{' '}
                You can add more after creation.
              </p>
            )}
            <label className="field">
              Time to live <span className="muted">optional, seconds</span>
              <input
                type="number"
                min={1}
                max={2147483647}
                placeholder="No expiration"
                value={newTtl}
                onChange={(e) => setNewTtl(e.target.value)}
              />
            </label>
            <FormError message={formError} />
            <div className="dialog-actions">
              <button type="button" className="button" onClick={() => setModal('')} disabled={busy}>
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
                Create key
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {modal === 'palette' && (
        <Dialog
          title="Command palette"
          description="Find a key or jump to an action."
          onClose={() => setModal('')}
        >
          <div className="palette-input">
            <Search size={18} />
            <input
              autoFocus
              aria-label="Search commands and loaded keys"
              placeholder="Search commands and loaded keys…"
              value={paletteSearch}
              onChange={(e) => setPaletteSearch(e.target.value)}
            />
            <kbd>ESC</kbd>
          </div>
          <div className="palette-results">
            {[
              {
                label: 'Create a new key',
                icon: Plus,
                action: () => {
                  setNewName('');
                  setNewValue('');
                  setNewType('string');
                  setNewTtl('');
                  setModal('create');
                },
                disabled: active.readOnly,
              },
              {
                label: 'Add Redis connection',
                icon: Server,
                action: addConnection,
              },
              {
                label: 'Open server overview',
                icon: Activity,
                action: () => {
                  gotoView('overview');
                  setModal('');
                },
              },
              {
                label: 'Appearance settings',
                icon: Sun,
                action: () => {
                  gotoView('settings');
                  setModal('');
                },
              },
              {
                label: 'Refresh key list',
                icon: RefreshCw,
                action: () => {
                  void refreshKeys();
                  setModal('');
                },
              },
            ]
              .filter((a) => a.label.toLowerCase().includes(paletteSearch.toLowerCase()))
              .map((a) => (
                <button
                  className="palette-result"
                  key={a.label}
                  disabled={a.disabled}
                  onClick={a.action}
                >
                  <a.icon size={17} />
                  {a.label}
                  <ArrowRight size={14} />
                </button>
              ))}
            <div className="palette-section">LOADED KEYS</div>
            {keys
              .filter((k) => k.name.toLowerCase().includes(paletteSearch.toLowerCase()))
              .slice(0, 10)
              .map((k) => (
                <button
                  key={k.id}
                  className="palette-result"
                  onClick={() => {
                    openKey(k);
                    setModal('');
                  }}
                >
                  <Braces size={16} />
                  <span className="mono">{k.name}</span>
                  <TypeBadge type={k.type} />
                </button>
              ))}
          </div>
        </Dialog>
      )}
      {modal === 'shortcuts' && (
        <Dialog
          title="A faster way around"
          description="Small shortcuts. A smoother workflow."
          onClose={() => setModal('')}
        >
          <div className="shortcut-list">
            {[
              ['Command palette', '⌘ / Ctrl K'],
              ['Search keys', '⌘ / Ctrl F'],
              ['Save string value', '⌘ / Ctrl S'],
              ['Move between keys', '↑ / ↓'],
              ['Close a dialog', 'Esc'],
            ].map(([label, shortcut]) => (
              <div key={label}>
                <span>{label}</span>
                <kbd>{shortcut}</kbd>
              </div>
            ))}
          </div>
          <p className="form-hint">
            Use Tab to move between controls. Resize the key panel with the arrow keys when its
            divider is focused.
          </p>
        </Dialog>
      )}
      {modal === 'about' && (
        <Dialog
          title="A thoughtful Redis workspace"
          description="RESPdeck · version 0.1.0"
          onClose={() => setModal('')}
        >
          <div className="about-brand">
            <span className="brand-mark">
              <Layers3 size={29} />
            </span>
            <h2>
              respdeck<span>.</span>
            </h2>
          </div>
          <p>
            Built for the moments between writing code and understanding your data. A modern,
            self-hosted Redis interface with a little more clarity.
          </p>
          <div className="about-pills">
            <span>
              <ShieldCheck size={14} />
              No telemetry
            </span>
            <span>
              <Layers3 size={14} />
              MIT licensed
            </span>
            <span>
              <Server size={14} />
              Self-hosted
            </span>
          </div>
          <p className="form-hint">
            The demo uses synthetic data. Connect your own server to manage real keys. RESPdeck is
            an independent project and is not affiliated with Redis Ltd.
          </p>
        </Dialog>
      )}
    </div>
  );
}
