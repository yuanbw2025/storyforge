import { expect, test } from '@playwright/test'

test('a persisted quest location conflict survives reload and an explicit author retry targets the quest', async ({ page }) => {
  await page.goto('./')
  const state = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { seedQuestLocationConflict } = await load('/storyforge/tests/helpers/quest-location-conflict.ts') as typeof import('../helpers/quest-location-conflict')
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const { hashProductProductionValueV2 } = await load('/storyforge/src/lib/product-production/hash.ts') as typeof import('../../src/lib/product-production/hash')
    const { build, scope, productionId, current, recovery, rows } = await seedQuestLocationConflict('native-quest-location')
    const failure = { taskKey: 'integration.package', detail: '文字冒险叙事质量审查未通过' }
    await db.productBuilds.update(build.id!, {
      status: 'recovery-required', planJson: JSON.stringify(current), planHash: await hashProductProductionValueV2(current),
      failureJson: JSON.stringify(failure),
    })
    const production = (await db.productProductions.get(productionId))!
    return { buildId: build.id!, scope, productionId, stateRevision: production.stateRevision, epoch: build.controlEpoch,
      recovery, originalQuest: rows.find(row => row.artifactKey === 'content.main-quest-plan')! }
  })
  await page.reload()
  const result = await page.evaluate(async state => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { executeProductProductionCommand } = await load('/storyforge/src/lib/product-production/commands.ts') as typeof import('../../src/lib/product-production/commands')
    const { recoveryInvalidatedTaskKeys } = await load('/storyforge/src/lib/product-production/scheduler.ts') as typeof import('../../src/lib/product-production/scheduler')
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const reply = await executeProductProductionCommand({ scope: state.scope, productionId: state.productionId, command: {
      type: 'resolve-blocker', commandId: 'native-quest-location.retry', expectedStateRevision: state.stateRevision,
      blockerKey: 'integration.package', resolution: { action: 'retry', note: '修正主线地点' },
    } })
    if (!reply.ok) throw Error(JSON.stringify(reply.result))
    const updated = (await db.productBuilds.get(state.buildId))!
    const tasks = await recoveryInvalidatedTaskKeys({ buildId: state.buildId, plan: state.recovery,
      previousControlEpoch: state.epoch, failureJson: updated.failureJson })
    return { epoch: updated.controlEpoch, tasks: [...tasks], original: await db.productBuildArtifacts.get(state.originalQuest.id!) }
  }, state)
  expect(result.epoch).toBe(state.epoch + 1)
  expect(result.tasks).toEqual(expect.arrayContaining(['content.main-quest-plan', 'content.quest-script', 'content.adventure-quality-review', 'integration.package']))
  expect(result.tasks).not.toContain('content.adventure-architecture')
  expect(result.tasks).not.toContain('media.requirements')
  expect(result.original).toEqual(state.originalQuest)
})
