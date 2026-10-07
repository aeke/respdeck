import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

export const adminPassword = 'e2e-only-admin-password';

/** Reads the one-time setup code printed by the server under test, if still unclaimed. */
export function setupCodeFromServerLog() {
  const log = readFileSync(process.env.E2E_SERVER_LOG!, 'utf8');
  return [...log.matchAll(/RESPdeck setup code: ([A-Za-z0-9_-]{43})/g)].at(-1)?.[1];
}

export async function createAdministrator(page: Page, code = setupCodeFromServerLog()) {
  expect(code, 'setup code in server log').toBeTruthy();
  await page.getByLabel('Setup code').fill(code!);
  await page.getByLabel('Administrator password', { exact: true }).fill(adminPassword);
  await page.getByLabel('Confirm password').fill(adminPassword);
  await page.getByRole('button', { name: 'Create administrator', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect Redis' })).toBeVisible();
}

/** Claims a fresh server or signs in, then finishes onboarding without saving Redis. */
export async function signIn(page: Page) {
  await page.goto('/');
  const setup = page.getByRole('heading', { name: 'Secure your workspace' });
  const login = page.getByRole('heading', { name: 'Unlock your workspace' });
  await expect(setup.or(login).or(page.getByRole('heading', { name: 'Connect Redis' }))).toBeVisible();
  if (await setup.isVisible()) await createAdministrator(page);
  else if (await login.isVisible()) {
    await page.getByLabel('Administrator password').fill(adminPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  const skip = page.getByRole('button', { name: 'Skip for now', exact: true });
  const empty = page.getByRole('heading', { name: 'No Redis connections yet' });
  const workspace = page.getByRole('button', { name: 'New connection', exact: true });
  await expect(skip.or(empty).or(workspace)).toBeVisible();
  if (await skip.isVisible()) await skip.click();
}

/** Adds a real connection from either the empty state or the workspace sidebar. */
export async function addRealConnection(page: Page, name: string, port: number) {
  await expect(
    page
      .getByRole('heading', { name: 'No Redis connections yet' })
      .or(page.getByRole('button', { name: 'New connection', exact: true })),
  ).toBeVisible();
  const empty = page.getByRole('heading', { name: 'No Redis connections yet' });
  if (await empty.isVisible()) await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  else await page.getByRole('button', { name: 'New connection', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Connection name').fill(name);
  await dialog.getByLabel('Port', { exact: true }).fill(String(port));
  await dialog.getByRole('checkbox', { name: /Read-only connection/ }).uncheck();
  await dialog.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(dialog.getByText('Connection successful', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Add connection', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
