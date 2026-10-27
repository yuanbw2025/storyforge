import { expect, test } from '@playwright/test'

test('native v11 memory store migration failure rolls back and an explicit retry preserves the original manuscript', async ({ page }) => {
  await page.goto('./')
  const result = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/ttrpg-memory-schema.ts')
    return helper.ttrpgMemorySchemaFailureFixtureV1()
  })
  expect(result.failed).toBe(true)
  expect(result.beforeRetry).toEqual(result.original)
  expect(result.afterRetry).toEqual(result.original)
  expect(result.version).toBe(13)
  expect(result.memoryCount).toBe(0)
})
