import type { Page } from '@playwright/test'

type TextAdventureScope = {
  projectId: number
  workId: number
}

/** Open the product-owned text-adventure surface with an explicit workspace binding. */
export async function openTextAdventurePage(
  page: Page,
  scope: TextAdventureScope,
  view: 'library' | 'production' | 'play' = 'library',
) {
  const params = new URLSearchParams({
    project: String(scope.projectId),
    work: String(scope.workId),
  })
  await page.goto(`./adventure/${view}?${params.toString()}`, { waitUntil: 'domcontentloaded' })
}
