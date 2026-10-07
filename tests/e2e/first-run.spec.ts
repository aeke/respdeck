import { test, expect } from '@playwright/test';
import { adminPassword, createAdministrator, setupCodeFromServerLog } from './support/self-hosted';

// Runs first against a pristine data directory shared by the self-hosted project.
test('first run: wizard secures the workspace, tests Redis inline and can be skipped', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Secure your workspace' })).toBeVisible();
  await expect(page.getByText('Demo workspace')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Setup progress' })).toContainText('Secure workspace');

  await page.getByLabel('Setup code').fill('x'.repeat(43));
  await page.getByLabel('Administrator password', { exact: true }).fill('short');
  await page.getByLabel('Confirm password').fill('short');
  await page.getByRole('button', { name: 'Create administrator' }).click();
  await expect(page.getByRole('alert')).toContainText('at least 12');

  await page.getByLabel('Administrator password', { exact: true }).fill(adminPassword);
  await page.getByLabel('Confirm password').fill(`${adminPassword}-different`);
  await page.getByRole('button', { name: 'Create administrator' }).click();
  await expect(page.getByRole('alert')).toContainText('do not match');

  await page.getByLabel('Confirm password').fill(adminPassword);
  await page.getByRole('button', { name: 'Create administrator' }).click();
  await expect(page.getByRole('alert')).toContainText(/setup code/i);
  await expect(page.getByRole('heading', { name: 'Secure your workspace' })).toBeVisible();

  await createAdministrator(page, setupCodeFromServerLog());

  // Reload resumes onboarding rather than showing a workspace or setup again.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Connect Redis' })).toBeVisible();

  await page.getByLabel('Connection name').fill('Unreachable');
  await page.getByLabel('Host', { exact: true }).fill('redis.invalid');
  await expect(page.getByRole('button', { name: 'Save and continue' })).toBeDisabled();
  await page.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Connection name')).toHaveValue('Unreachable');
  await expect(page.getByRole('button', { name: 'Save and continue' })).toBeDisabled();

  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('heading', { name: 'No Redis connections yet' })).toBeVisible();
  await expect(page.getByText('Demo workspace')).toHaveCount(0);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Unlock your workspace' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Administrator password Show administrator password' }).fill('wrong-password-123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('textbox', { name: 'Administrator password Show administrator password' }).fill(adminPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No Redis connections yet' })).toBeVisible();

  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(stored).not.toContain(adminPassword);
});
