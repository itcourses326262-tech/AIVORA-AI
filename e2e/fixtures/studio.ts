import { expect, type Locator, type Page } from '@playwright/test';
import type { ApiClient } from './api';

/** The credits chip of the header; its accessible name is `Credits: <balance>`. */
export function creditsChip(page: Page): Locator {
  return page.getByRole('link', { name: /^Credits: / });
}

/** The chip may add a hint after the number (`Credits: 5. Running low`), so only the number is pinned. */
export async function expectCredits(page: Page, balance: number): Promise<void> {
  await expect(creditsChip(page)).toHaveAccessibleName(new RegExp(`^Credits: ${balance}(?:\\.|$)`));
}

/** Opens the studio and waits until it has hydrated (the first paint is a skeleton). */
export async function openStudio(page: Page, query = ''): Promise<void> {
  await page.goto(`/studio${query}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Studio' })).toBeAttached();
  await expect(page.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
  // The models load after the first paint; until they have, Generate is disabled and the keyboard
  // shortcut does nothing, so a test that goes on earlier would be racing the catalogue.
  await expect(generateButton(page)).toBeEnabled();
}

export function promptBox(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Prompt' });
}

export function generateButton(page: Page): Locator {
  return page.getByRole('button', { name: /^Generate/ });
}

/** Types a prompt and presses Generate. */
export async function generate(page: Page, prompt: string): Promise<void> {
  await promptBox(page).fill(prompt);
  await generateButton(page).click();
}

/** The result card of one creation, found by its state and the start of its prompt. */
export function card(page: Page, status: string, prompt: string): Locator {
  return page.getByRole('article', { name: new RegExp(`${escapeRegExp(prompt)}.*\\. ${status}$`) });
}

export async function openCardMenu(card_: Locator): Promise<void> {
  await card_.getByRole('button', { name: 'More actions' }).click();
}

/**
 * The ledger is the account's book: every entry chains from the one before, the newest entry ends at
 * the balance, and the deltas add up to it. Returns the entries oldest first.
 */
export async function expectLedgerMatchesBalance(api: ApiClient, balance: number) {
  const newestFirst = await api.ledger();
  const entries = [...newestFirst].reverse();
  let running = 0;
  for (const entry of entries) {
    running += entry.delta;
    expect(entry.balanceAfter, `balanceAfter of ${entry.reason} ${entry.delta}`).toBe(running);
  }
  expect(running).toBe(balance);
  expect(await api.balance()).toBe(balance);
  return entries;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scrolls through the whole page so that sections that fade in when they come into view have done so,
 * waits for the web fonts, and returns to the top: what a reader sees after scrolling, not a half-built page.
 */
export async function settlePage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo(0, 0);
    await document.fonts.ready;
  });
}
