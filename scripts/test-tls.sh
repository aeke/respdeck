#!/bin/sh
set -eu
tls_dir=$(mktemp -d)
tls_container="respdeck-tls-test-$$"
cleanup() { docker rm -f "$tls_container" >/dev/null 2>&1 || true; rm -rf "$tls_dir"; }
trap cleanup EXIT INT TERM
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$tls_dir/ca.key" -out "$tls_dir/ca.crt" -days 1 -subj '/CN=RESPdeck Test CA' >"$tls_dir/generation.log" 2>&1
openssl req -newkey rsa:2048 -nodes -keyout "$tls_dir/server.key" -out "$tls_dir/server.csr" -subj '/CN=localhost' >>"$tls_dir/generation.log" 2>&1
printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' >"$tls_dir/extensions.conf"
openssl x509 -req -in "$tls_dir/server.csr" -CA "$tls_dir/ca.crt" -CAkey "$tls_dir/ca.key" -CAcreateserial -out "$tls_dir/server.crt" -days 1 -extfile "$tls_dir/extensions.conf" >>"$tls_dir/generation.log" 2>&1
chmod 755 "$tls_dir"
chmod 644 "$tls_dir/server.key"
docker run -d --name "$tls_container" -p 127.0.0.1:6396:6379 -v "$tls_dir:/tls:ro" redis:8.2-alpine redis-server --port 0 --tls-port 6379 --tls-cert-file /tls/server.crt --tls-key-file /tls/server.key --tls-ca-cert-file /tls/ca.crt --tls-auth-clients no >/dev/null
attempt=0
until docker exec "$tls_container" redis-cli --tls --cacert /tls/ca.crt ping >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 20 ]; then echo 'TLS test Redis did not start.' >&2; exit 1; fi
  sleep 0.25
done
REDIS_TLS_TEST_PORT=6396 REDIS_TLS_TEST_CA="$tls_dir/ca.crt" pnpm exec vitest run tests/tls.test.ts
