# Changelog

## 0.1.0-rc.1

The first public release candidate of RESPdeck: a self-hosted, single-user Redis web workspace.

### Highlights

- Light, dark, and system themes with violet, teal, and amber accents.
- Multiple standalone Redis connections, ACL authentication, verified TLS, and custom CA certificates.
- Incremental SCAN browsing, pattern/type filters, namespace groups, and virtualized key lists.
- Inspect and edit strings, hashes, lists, sets, sorted sets, and streams.
- JSON formatting, binary hex previews, TTL management, collision-safe renaming, and deletion confirmation.
- API-enforced read-only connections, checked string/hash/list edits, and TTL-preserving writes.
- Single administrator session, CSRF protection, and optional encrypted credential storage.
- Docker packaging, API documentation, and GitHub Actions checks against Redis 7.2 and 8.2.
- GitHub Pages website and a browser-only demo with synthetic data.

### Current scope

Standalone Redis and single-user installations are supported. Cluster, Sentinel, SSH tunnels,
RedisJSON modules, and multi-user access are outside this release. This is a release candidate;
feedback from real installations is welcome.
