import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('workspace, settings and dialogs meet automated WCAG AA checks in both themes', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  for (const theme of ['dark', 'light']) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page
      .getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true })
      .click();
    let results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ html: n.html, reason: n.failureSummary })),
      })),
    ).toEqual([]);
    await page.getByRole('button', { name: 'Data browser', exact: true }).click();
    await expect(page.locator('.cm-content')).toBeVisible();
    results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ html: n.html, reason: n.failureSummary })),
      })),
    ).toEqual([]);
    await page.getByRole('button', { name: 'New key', exact: true }).click();
    await page.getByRole('dialog').evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ html: n.html, reason: n.failureSummary })),
      })),
    ).toEqual([]);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  }
});
