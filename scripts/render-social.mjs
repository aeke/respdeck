import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'landing/assets/social-preview.png');
await mkdir(resolve(root, 'landing/assets'), { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 640 },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(resolve(root, 'landing/social-preview.html')).href);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
  });
  await page.screenshot({ path: output });
  const { size } = await stat(output);
  if (size >= 1_000_000) throw new Error('GitHub social preview must be smaller than 1 MB.');
  console.log(`Social preview ready: ${output} (1280 × 640, ${size} bytes)`);
} finally {
  await browser.close();
}
