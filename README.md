<p align="center"><img src="apps/web/public/favicon.svg" width="68" alt="RESPdeck logo"></p>
<h1 align="center">RESPdeck</h1>
<p align="center">A thoughtful workspace for your Redis data.</p>
<p align="center">Self-hosted · Browser-based · TypeScript · MIT</p>

![RESPdeck dark workspace](docs/screenshots/dark.png)

Explore, understand, and shape your Redis data in a calm, modern interface. Run RESPdeck on your own infrastructure. No telemetry, external fonts, or third-party data services.

**v0.1.0 is an initial release candidate.** Standalone Redis is supported. Cluster, Sentinel, SSH tunnels, RedisJSON modules, and multi-user access are on the roadmap.

## Features

- Light, dark, and system themes, with violet, teal, and amber accents.
- Multiple standalone connections, ACL credentials, verified TLS and custom CA certificates.
- Cursor-based SCAN browsing, pattern/type filters, virtualized lists, and namespace groups.
- Tabbed inspection and editing for strings, hashes, lists, sets, sorted sets, and streams.
- JSON formatting, binary hex previews, TTL management, collision-safe renaming and explicit deletion confirmation.
- Read-only connections enforced by the API, checked string/hash/list edits, and TTL-preserving writes.
- Live server summary, command palette, keyboard navigation, and a resizable key panel.
- A fully local demo with synthetic data. Demo edits reset on page reload.

## Quick start

### Docker

```sh
docker compose up --build -d
```

Open **http://localhost:4310**. The demo works immediately.

To connect a real Redis server, copy `.env.example` to `.env` and set a strong administrator password (at least 12 characters). Optionally generate a 32-byte credential encryption key with `openssl rand -base64 32`, put it in `RESPDECK_ENCRYPTION_KEY`, and recreate the container:

```sh
cp .env.example .env
# Edit .env, then:
docker compose up --build -d
```

Click **New connection**, sign in, and enter your Redis endpoint. Connections default to read-only; uncheck that option to enable editing.

You can also launch an isolated Redis alongside RESPdeck:

```sh
docker compose --profile redis up --build -d
```

Use host `redis`, port `6379` in the connection form. A Redis server on your host can be reached with `host.docker.internal` on Docker Desktop. On Linux, configure the equivalent host gateway or use a shared Docker network.

### Development

Requires Node.js **22.22+** or Node.js 24 and pnpm 10.28.2. SQLite is built into Node; Node 22 may print an experimental SQLite warning.

```sh
corepack enable
pnpm install
pnpm dev
```

Open **http://127.0.0.1:5173**. Vite proxies `/api` to Fastify on port 4310. For real connections, configure `.env` as above and restart `pnpm dev`. `HOST`, `PORT`, and `DATA_DIR` refer to the API; Vite's development proxy expects the API on port 4310.

```sh
pnpm build
pnpm start
```

The production server serves the built UI and API at **http://127.0.0.1:4310**.

## Security and data behavior

- Real Redis endpoints are disabled until an administrator password is configured. One administrator session is supported; signing in invalidates the previous session. Sessions expire after eight hours.
- Redis connections are opened by the backend, never directly by the browser. Only trusted administrators should have access to this tool.
- Session cookies are HttpOnly and SameSite Strict. Writes require an allowed Origin and session CSRF token. Sign-in is rate limited.
- Saved passwords use AES-256-GCM if an encryption key is configured. Without one, they remain in server memory and are cleared on sign-out, expiry, or restart. Connection names, hosts and CA certificates are saved in SQLite.
- Back up both the data volume and the encryption key. Losing the key requires re-entering saved Redis passwords. Passwords and key values are not logged.
- For remote access, put RESPdeck behind an HTTPS reverse proxy, set `RESPDECK_ORIGIN=https://your-host`, and set `COOKIE_SECURE=true`. The Docker example binds the published port to localhost.
- New key names are limited to 4096 UTF-8 bytes. Values and collection pages are limited to 1 MiB. Oversized strings are previewed and cannot be edited; binary strings are shown as hex and cannot be edited. Binary collection entries are shown but cannot be edited in the UI. Key-level TTL/delete operations remain available on writable connections.
- SCAN is incremental, may return empty batches, and is not a database snapshot. Loaded keys are deduplicated. Namespace groups represent loaded keys, not a full-tree index. Continue scanning when more results are available.
- String edits use version checks. Hash fields and list entries compare the original value before updating. Set/sorted-set/stream operations act on the named member or ID and follow Redis semantics; RESPdeck does not provide transactions spanning multiple UI actions.
- ACL permissions must cover the operations you use. Bounded collection reads and checked mutations use `EVAL` plus the underlying commands. `INFO`, `DBSIZE`, `SCAN`, `TYPE`, and `TTL` are used for browsing; `CONFIG GET databases` is optional (falls back to 16 visible databases if denied, capped at 64).
- Redis module-specific types are identified but are not editable in this release. There is no arbitrary command console or FLUSH action.

Authenticated API documentation: **`/api/docs`**. Health endpoint: **`/health`**.

## Quality checks

```sh
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
```

Real Redis tests require a **dedicated disposable Redis server**. Integration tests clear database 15 and modify a temporary ACL user; the large-keyspace E2E test and benchmark clear database 14; never point them at a shared server.

```sh
docker run --rm -d --name respdeck-test-redis -p 127.0.0.1:6399:6379 redis:8.2-alpine
pnpm test:integration
RUN_REDIS_E2E=1 pnpm test:e2e
docker stop respdeck-test-redis
```

Use `REDIS_TEST_PORT` to change the test port. `pnpm test:tls` starts an isolated TLS Redis on port 6396, verifies a custom CA and rejects an untrusted certificate (Docker and OpenSSL required). `RUN_REDIS_BENCHMARK=1 pnpm benchmark` exercises 100,000 synthetic keys and clears database 14 on the dedicated test server. CI exercises Redis 7.2 and 8.2. The E2E server uses its own temporary data directory and an explicit test password.

## Project structure

| Package              | Purpose                                                                |
| -------------------- | ---------------------------------------------------------------------- |
| `apps/web`           | React, Vite, themes, virtualized browser, CodeMirror editors           |
| `apps/api`           | Fastify, session authentication, SQLite credential store, node-redis   |
| `packages/contracts` | Shared API and UI types                                                |
| `tests`              | API/security tests, real Redis integration tests, Playwright workflows |

[Validation](docs/VALIDATION.md) · [Roadmap](docs/ROADMAP.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Research and open-source benefits (Türkçe)](docs/ARASTIRMA-VE-KAZANIMLAR.md)

## License

MIT © 2026 Abdullah EKE. RESPdeck is an independent project and is not affiliated with Redis Ltd. Redis is a trademark of Redis Ltd. Bundled Inter and JetBrains Mono fonts are distributed under the SIL Open Font License; see [third-party notices](docs/THIRD-PARTY-NOTICES.md).
