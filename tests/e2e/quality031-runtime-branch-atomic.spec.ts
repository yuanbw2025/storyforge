import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })
test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  await page.route('**/*', route => {
    const request = route.request()
    return new URL(request.url()).origin === origin && ['GET', 'HEAD'].includes(request.method())
      ? route.continue() : route.abort()
  })
  await page.goto('./')
})

test('native generic lineage failure leaves no partial child; a complete retry survives reload and parent deletion', async ({ page }) => {
  const proof = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<unknown>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const { seedAiTownRuntimeFixture } = await importer('/storyforge/tests/helpers/ai-town-runtime.ts') as typeof import('../helpers/ai-town-runtime')
    const api = await importer('/storyforge/src/lib/product/runtime-api.ts') as typeof import('../../src/lib/product/runtime-api')
    const { PROJECT_TABLES } = await importer('/storyforge/src/lib/registry/project-tables.ts') as typeof import('../../src/lib/registry/project-tables')
    const f = await seedAiTownRuntimeFixture()
    const parent = (await db.productRuntimeSessions.get(f.session.id!))!
    const state = await api.readProductRuntimeState(parent.id!)
    const countsBefore = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
    const originalSessions = JSON.stringify(await db.productRuntimeSessions.toArray())
    const originalWorlds = JSON.stringify(await db.worldReleases.toArray())
    const creating = (_key: unknown, row: { parentSessionId?: number | null }) => {
      if (row.parentSessionId === parent.id) throw new Error('native031 final lineage failure')
    }
    const updating = (mods: { parentSessionId?: number | null }) => {
      if (mods.parentSessionId === parent.id) throw new Error('native031 final lineage failure')
    }
    db.productRuntimeSessions.hook('creating', creating)
    db.productRuntimeSessions.hook('updating', updating)
    let failure: string | null = null
    try {
      await api.branchProductRuntimeSession({ parentSessionId: parent.id!, throughSequence: state.lastSequence,
        title: '原生故障不可留下半个分支' })
    } catch (error) { failure = error instanceof Error ? error.message : String(error) }
    finally {
      db.productRuntimeSessions.hook('creating').unsubscribe(creating)
      db.productRuntimeSessions.hook('updating').unsubscribe(updating)
    }
    const countsAfterFault = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
    const sessionsAfterFault = JSON.stringify(await db.productRuntimeSessions.toArray())
    const child = await api.branchProductRuntimeSession({ parentSessionId: parent.id!, throughSequence: state.lastSequence,
      title: '完整提交、可恢复的分支' })
    return { failure, countsBefore, countsAfterFault, originalSessions, sessionsAfterFault,
      originalWorlds, worldsAfter: JSON.stringify(await db.worldReleases.toArray()),
      parentId: parent.id!, childId: child.id!, cut: state.lastSequence, originalParent: JSON.stringify(parent) }
  })
  expect(proof.failure).toContain('native031 final lineage failure')
  expect(proof.countsAfterFault).toEqual(proof.countsBefore)
  expect(proof.sessionsAfterFault).toBe(proof.originalSessions)
  expect(proof.worldsAfter).toBe(proof.originalWorlds)
  await page.reload()
  const restored = await page.evaluate(async ids => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<unknown>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const api = await importer('/storyforge/src/lib/product/runtime-api.ts') as typeof import('../../src/lib/product/runtime-api')
    const parent = await db.productRuntimeSessions.get(ids.parentId)
    const child = (await db.productRuntimeSessions.get(ids.childId))!
    const beforeDelete = { parent: JSON.stringify(parent), parentSessionId: child.parentSessionId,
      parentThroughSequence: child.parentThroughSequence, state: await api.readProductRuntimeState(child.id!) }
    await api.deleteProductRuntimeSession(ids.parentId)
    const retained = (await db.productRuntimeSessions.get(ids.childId))!
    return { beforeDelete, parentDeleted: await db.productRuntimeSessions.get(ids.parentId) === undefined,
      retainedParent: retained.parentSessionId, retainedCut: retained.parentThroughSequence,
      retainedState: await api.readProductRuntimeState(retained.id!) }
  }, { parentId: proof.parentId, childId: proof.childId })
  expect(restored.beforeDelete.parent).toBe(proof.originalParent)
  expect(restored.beforeDelete.parentSessionId).toBe(proof.parentId)
  expect(restored.beforeDelete.parentThroughSequence).toBe(proof.cut)
  expect(restored.beforeDelete.state.lastSequence).toBe(0)
  expect(restored.parentDeleted).toBe(true)
  expect(restored.retainedParent).toBeNull()
  expect(restored.retainedCut).toBeNull()
  expect(restored.retainedState).toEqual(restored.beforeDelete.state)
})

test('native legacy cache-free parent accepts a real later suffix and keeps the selected child cut', async ({ page }) => {
  const proof = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<unknown>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const { seedAiTownRuntimeFixture } = await importer('/storyforge/tests/helpers/ai-town-runtime.ts') as typeof import('../helpers/ai-town-runtime')
    const api = await importer('/storyforge/src/lib/product/runtime-api.ts') as typeof import('../../src/lib/product/runtime-api')
    const { appendProductRuntimeEvent } = await importer('/storyforge/src/lib/product/runtime-core.ts') as typeof import('../../src/lib/product/runtime-core')
    const f = await seedAiTownRuntimeFixture()
    const cut = (await api.readProductRuntimeState(f.session.id!)).lastSequence
    await db.productRuntimeSessions.update(f.session.id!, { runtimeHeadSequence: undefined,
      runtimeHeadStateJson: undefined, runtimeHeadStateHash: undefined })
    const prefix = JSON.stringify(await db.productRuntimeEvents.where('sessionId').equals(f.session.id!).toArray())
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle)
    let reached = false
    crypto.subtle.digest = async (algorithm, data) => {
      let preparedState = false
      try {
        const body = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>
        preparedState = body.lastSequence === 0 && 'town' in body && 'narratives' in body
      } catch { /* Keep every other real digest on its original path. */ }
      if (!reached && preparedState) {
        reached = true
        await appendProductRuntimeEvent({ sessionId: f.session.id!, type: 'narrative.recorded',
          payload: { text: '原生父存档后来追加的原话' } })
      }
      return originalDigest(algorithm, data)
    }
    let child: Awaited<ReturnType<typeof api.branchProductRuntimeSession>>
    try {
      child = await api.branchProductRuntimeSession({ parentSessionId: f.session.id!, throughSequence: cut,
        title: '真实旧档切点分支' })
    } finally { crypto.subtle.digest = originalDigest }
    return { reached, parentId: f.session.id!, childId: child.id!, cut, prefix,
      retainedPrefix: JSON.stringify((await db.productRuntimeEvents.where('sessionId').equals(f.session.id!).toArray())
        .filter(event => event.sequence <= cut)),
      parentState: await api.readProductRuntimeState(f.session.id!), childState: await api.readProductRuntimeState(child.id!) }
  })
  expect(proof.reached).toBe(true)
  expect(proof.retainedPrefix).toBe(proof.prefix)
  expect(proof.parentState.lastSequence).toBe(proof.cut + 1)
  expect(proof.parentState.narratives[proof.parentState.narratives.length - 1]!.text).toBe('原生父存档后来追加的原话')
  expect(proof.childState.lastSequence).toBe(0)
  expect(proof.childState.narratives.some(item => item.text === '原生父存档后来追加的原话')).toBe(false)
  await page.reload()
  const persisted = await page.evaluate(async ids => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<unknown>
    const api = await importer('/storyforge/src/lib/product/runtime-api.ts') as typeof import('../../src/lib/product/runtime-api')
    return { parent: await api.readProductRuntimeState(ids.parentId), child: await api.readProductRuntimeState(ids.childId) }
  }, { parentId: proof.parentId, childId: proof.childId })
  expect(persisted.parent).toEqual(proof.parentState)
  expect(persisted.child).toEqual(proof.childState)
})
