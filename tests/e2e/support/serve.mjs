// Starts the real self-hosted dev stack for browser tests and tees its output to
// E2E_SERVER_LOG so the test process (only) can read the one-time setup code.
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
const log = process.env.E2E_SERVER_LOG;
if (!log) throw new Error('E2E_SERVER_LOG is required');
writeFileSync(log, '');
const child = spawn('pnpm', ['dev'], { stdio: ['ignore', 'pipe', 'pipe'] });
for (const [stream, sink] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr],
]) {
  stream.on('data', (chunk) => {
    appendFileSync(log, chunk);
    sink.write(chunk);
  });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
