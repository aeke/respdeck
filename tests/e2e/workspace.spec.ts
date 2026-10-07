import { test, expect } from '@playwright/test';

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
