import { cp, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'landing/dist');
const base = (process.env.PAGES_BASE_PATH ?? '/respdeck') || '/';
if (!/^\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]*$/.test(base)) {
  throw new Error('PAGES_BASE_PATH must be an absolute URL path without a trailing slash.');
}
const demoBase = `${base === '/' ? '' : base}/demo/`;
execFileSync(
  'pnpm',
  [
    '--filter',
    '@respdeck/web',
    'exec',
    'vite',
    'build',
    '--base',
    demoBase,
    '--outDir',
    '../../landing/dist/demo',
    '--emptyOutDir',
  ],
  {
    cwd: root,
    env: { ...process.env, VITE_DEMO_ONLY: 'true' },
    stdio: 'inherit',
  },
);
await mkdir(resolve(output, 'assets'), { recursive: true });
for (const name of ['index.html', 'styles.css', 'site.js']) {
  await copyFile(resolve(root, 'landing', name), resolve(output, name));
}
for (const name of ['dark', 'light']) {
  await copyFile(
    resolve(root, `docs/screenshots/${name}.png`),
    resolve(output, `assets/${name}.png`),
  );
}
await copyFile(resolve(root, 'apps/web/public/favicon.svg'), resolve(output, 'assets/favicon.svg'));
const require = createRequire(resolve(root, 'apps/web/package.json'));
const fontRoot = dirname(require.resolve('@fontsource/inter/package.json'));
for (const weight of [400, 600]) {
  await copyFile(
    resolve(fontRoot, `files/inter-latin-${weight}-normal.woff2`),
    resolve(output, `assets/inter-${weight}.woff2`),
  );
}
await cp(resolve(root, 'docs/licenses'), resolve(output, 'licenses'), { recursive: true });
await copyFile(
  resolve(root, 'docs/THIRD-PARTY-NOTICES.md'),
  resolve(output, 'licenses/THIRD-PARTY-NOTICES.md'),
);
await writeFile(resolve(output, '.nojekyll'), '');
console.log(`Pages site ready: ${output} (demo base: ${demoBase})`);
