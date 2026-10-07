import { test, expect } from '@playwright/test';
import { createClient } from 'redis';
import { addRealConnection, signIn } from './support/self-hosted';

test('real Redis: sign in, connect, edit, expire and delete', async ({ page }) => {
  test.skip(
    process.env.RUN_REDIS_E2E !== '1',
    'Requires a dedicated test Redis on REDIS_TEST_PORT (default 6399).',
  );
  const port = Number(process.env.REDIS_TEST_PORT ?? 6399);
  const raw = createClient({ url: `redis://127.0.0.1:${port}/15` });
  await raw.connect();
  const name = `respdeck-e2e:${Date.now()}`;
  try {
    await signIn(page);
    await addRealConnection(page, 'E2E Redis', port);
    await expect(page.locator('.breadcrumb')).toContainText('E2E Redis');
    await page.getByLabel('Database', { exact: true }).selectOption('15');
    await expect(page.locator('.statusbar')).toContainText('db15');
    await page.getByRole('button', { name: 'New key', exact: true }).click();
    await page.getByLabel('Key name', { exact: true }).fill(name);
    await page
      .getByRole('dialog')
      .getByRole('textbox', { name: 'Value', exact: true })
      .fill('first');
    await page.getByLabel(/Time to live/).fill('3600');
    await page.getByRole('button', { name: 'Create key', exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.locator('.cm-content').fill('updated');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Value saved');
    expect(await raw.get(name)).toBe('updated');
    expect(await raw.ttl(name)).toBeGreaterThan(3500);
    await page.getByRole('button', { name: 'Delete key', exact: true }).click();
    await page.getByLabel('Type the key name to confirm').fill(name);
    await page.getByRole('dialog').getByRole('button', { name: 'Delete key' }).click();
    await expect(page.getByRole('status')).toContainText('Key deleted');
    expect(await raw.exists(name)).toBe(0);
  } finally {
    await raw.del(name);
    raw.destroy();
  }
});

test('100,000 keys: first batch is incremental and rows remain virtualized', async ({ page }) => {
  test.skip(process.env.RUN_REDIS_E2E !== '1', 'Requires a disposable Redis; clears database 14.');
  const port = Number(process.env.REDIS_TEST_PORT ?? 6399);
  const raw = createClient({ url: `redis://127.0.0.1:${port}/14` });
  await raw.connect();
  try {
    await raw.flushDb();
    for (let batch = 0; batch < 100; batch++) {
      const args: string[] = [];
      for (let i = 0; i < 1000; i++) args.push(`benchmark:${batch * 1000 + i}`, 'synthetic');
      await raw.sendCommand(['MSET', ...args]);
    }
    await signIn(page);
    await addRealConnection(page, 'Large keyspace', port);
    await page.getByLabel('Database', { exact: true }).selectOption('14');
    await expect(page.locator('.metric-card').first()).toContainText('100,000');
    await expect(
      page.getByRole('button', { name: 'Continue scanning', exact: true }),
    ).toBeVisible();
    const keyRows = page.locator('.key-list .key-row');
    await expect(keyRows.first()).toBeVisible();
    expect(await keyRows.count()).toBeLessThan(60);
    const loaded = Number((await page.locator('.key-panel-footer').innerText()).match(/\d+/)![0]);
    expect(loaded).toBeGreaterThan(0);
    expect(loaded).toBeLessThan(500);
    await page.getByRole('button', { name: 'Continue scanning', exact: true }).click();
    await expect
      .poll(async () =>
        Number((await page.locator('.key-panel-footer').innerText()).match(/\d+/)![0]),
      )
      .toBeGreaterThan(loaded);
    expect(await keyRows.count()).toBeLessThan(60);
  } finally {
    await raw.flushDb();
    raw.destroy();
  }
});
