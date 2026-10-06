import { test, expect } from '@playwright/test';
import { createClient } from 'redis';

test('demo: create, edit, TTL, rename and delete a key', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Data browser.' })).toBeVisible();
  await page.getByRole('button', { name: 'New key', exact: true }).click();
  await page.getByLabel('Key name', { exact: true }).fill('test:workflow');
  await page
    .getByRole('dialog')
    .getByRole('textbox', { name: 'Value', exact: true })
    .fill('{"hello":"world"}');
  await page.getByRole('button', { name: 'Create key', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'test:workflow', exact: true })).toBeVisible();
  await page.locator('.cm-content').fill('{"hello":"redis"}');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Value saved');
  await page.getByRole('button', { name: 'No expiry', exact: true }).click();
  await page.getByRole('button', { name: '1 hour', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.ttl-button')).toContainText('1h');
  await page.getByRole('button', { name: 'Rename key', exact: true }).click();
  await page.getByLabel('New key name').fill('test:renamed');
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'test:renamed', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete key', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Delete key' })).toBeDisabled();
  await page.getByLabel('Type the key name to confirm').fill('test:renamed');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete key' }).click();
  await expect(page.getByRole('status')).toContainText('Key deleted');
  await page.getByLabel('Search keys').fill('test:renamed');
  await expect(page.getByRole('heading', { name: 'No keys found' })).toBeVisible();
});

test('search, namespace groups, collection edits and read-only mode', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Search keys').fill('users:1001:profile');
  await page.getByRole('button', { name: 'Open key users:1001:profile', exact: true }).click();
  await page.getByRole('button', { name: 'Add field', exact: true }).click();
  await page.getByLabel('Field name').fill('department');
  await page
    .getByRole('dialog')
    .getByRole('textbox', { name: 'Value', exact: true })
    .fill('Engineering');
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('cell', { name: 'Engineering', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit department', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('textbox', { name: 'Value', exact: true })
    .fill('Platform');
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('cell', { name: 'Platform', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Namespace groups', exact: true }).click();
  await expect(page.locator('.folder-row')).toContainText('users');
  await page.getByRole('button', { name: 'Staging Sample connection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New key', exact: true })).toBeDisabled();
  await page.getByLabel('Search keys').fill('config:app_version');
  await page.getByRole('button', { name: 'Open key config:app_version', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete key', exact: true })).toBeDisabled();
  await expect(page.locator('.editor-footer')).toContainText('Read-only value');
});

test('theme and accent persist across reload; palette works with keyboard', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.getByRole('button', { name: 'Teal', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'teal');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'teal');
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.getByLabel('Search commands and loaded keys').fill('overview');
  await page.getByRole('button', { name: 'Open server overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Server overview.' })).toBeVisible();
});

test('mobile layout shows panels sequentially without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page
    .getByRole('combobox', { name: 'Connection', exact: true })
    .selectOption('demo-staging');
  await expect(page.getByRole('button', { name: 'New key', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Connection', exact: true }).selectOption('demo-local');
  await page.getByLabel('Search keys').fill('users:1001');
  await page.getByRole('button', { name: 'Open key users:1001', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'users:1001', exact: true })).toBeVisible();
  await expect(page.getByLabel('Search keys')).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Back to keys', exact: true }).click();
  await expect(page.getByLabel('Search keys')).toBeVisible();
});

test('unsaved edits are protected when switching keys', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.cm-content').fill('unsaved draft');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByLabel('Search keys').fill('config:app_version');
  await page.getByRole('button', { name: 'Open key config:app_version', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'users:1001', exact: true })).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('unsaved draft');
});

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
    await page.goto('/');
    await page.getByRole('button', { name: 'Add connection', exact: true }).click();
    await page.getByLabel('Administrator password').fill('e2e-only-admin-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('Connection name').fill('E2E Redis');
    await page.getByLabel('Port', { exact: true }).fill(String(port));
    await page.getByRole('checkbox', { name: /Read-only connection/ }).uncheck();
    await page.getByRole('button', { name: 'Test connection', exact: true }).click();
    await expect(page.getByText('Connection successful', { exact: true })).toBeVisible();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Add connection', exact: true })
      .click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
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
    await page.goto('/');
    await page.getByRole('button', { name: 'Add connection', exact: true }).click();
    await page.getByLabel('Administrator password').fill('e2e-only-admin-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('Connection name').fill('Large keyspace');
    await page.getByLabel('Port', { exact: true }).fill(String(port));
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Add connection', exact: true })
      .click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
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
