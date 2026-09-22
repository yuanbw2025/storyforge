import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import { projectTextOpenWorldPlayerInventoryV1 } from '../../src/lib/open-world/player-inventory'
import { projectTextOpenWorldPlayerMapV1 } from '../../src/lib/open-world/map-view'
import { projectTextOpenWorldPlayerMapScreenV1 } from '../../src/lib/open-world/player-map'
import { projectTextOpenWorldPlayerQuestLogV1 } from '../../src/lib/open-world/player-quest-log'
import {
  deriveTextOpenWorldContextsV1,
  parseTextOpenWorldSessionProjectionV1,
} from '../../src/lib/open-world/session-projection'
import { parseTextOpenWorldRuntimePackageV1 } from '../../src/lib/open-world/runtime-package'
import {
  createProductRuntimeCheckpoint,
  readProductRuntimeState,
  verifyProductRuntimeCheckpoint,
} from '../../src/lib/product/runtime-core'
import type { ProductRuntimeEvent } from '../../src/lib/types'
import {
  createLargeTextOpenWorldRuntimePackageV1,
  createLargeTextOpenWorldSessionFixtureV1,
  TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1,
} from '../helpers/text-open-world-large-state'

const BUDGET_MS = {
  packageParse: 250,
  sessionStartup: 6_000,
  actionProjection: 1_800,
  questProjection: 1_000,
  inventoryProjection: 2_200,
  mapProjection: 500,
  mapScreenProjection: 3_000,
  replay: 1_000,
  checkpointCreateAndVerify: 2_000,
  projectExport: 1_000,
  projectImport: 2_500,
} as const

function measure<T>(operation: () => T): { value: T; durationMs: number } {
  const startedAt = performance.now()
  const value = operation()
  return { value, durationMs: performance.now() - startedAt }
}

async function measureAsync<T>(operation: () => Promise<T>): Promise<{ value: T; durationMs: number }> {
  const startedAt = performance.now()
  const value = await operation()
  return { value, durationMs: performance.now() - startedAt }
}

function report(name: string, durationMs: number, budgetMs: number) {
  console.info(`[text-open-world-performance] ${JSON.stringify({ name, durationMs: Math.round(durationMs * 100) / 100, budgetMs })}`)
  expect(durationMs, `${name}超过当前自动化基线${budgetMs}ms`).toBeLessThan(budgetMs)
}

describe('Text Open World G7 · large-state performance and IndexedDB gate', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('大Release解析、Session启动、Action、任务、背包和地图投影保持在登记基线内', async () => {
    const largePackage = createLargeTextOpenWorldRuntimePackageV1()
    const parsed = measure(() => parseTextOpenWorldRuntimePackageV1(largePackage))
    expect((parsed.value.modules.world.payload as any).locations).toHaveLength(TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1.locations)
    expect((parsed.value.modules.items.payload as any).items).toHaveLength(TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1.inventoryItems)
    report('release-package-parse', parsed.durationMs, BUDGET_MS.packageParse)

    const started = await measureAsync(() => createLargeTextOpenWorldSessionFixtureV1())
    report('formal-session-startup', started.durationMs, BUDGET_MS.sessionStartup)
    const projection = parseTextOpenWorldSessionProjectionV1(started.value.projection)

    const actionProjection = measure(() => createTextOpenWorldActionRegistryV1(projection.runtimePackage)
      .project(deriveTextOpenWorldContextsV1(projection).action))
    expect(actionProjection.value.length).toBeGreaterThan(0)
    report('large-history-action-projection', actionProjection.durationMs, BUDGET_MS.actionProjection)

    const questProjection = measure(() => projectTextOpenWorldPlayerQuestLogV1({
      sessionId: started.value.session.id!,
      projection,
      events: [],
    }))
    expect(questProjection.value.visibleTotal).toBe(TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1.questInstances + 1)
    report('large-quest-log-projection', questProjection.durationMs, BUDGET_MS.questProjection)

    const inventoryProjection = measure(() => projectTextOpenWorldPlayerInventoryV1(projection))
    expect(inventoryProjection.value.summary.distinctItemCount).toBe(TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1.inventoryItems - 3)
    report('large-inventory-projection', inventoryProjection.durationMs, BUDGET_MS.inventoryProjection)

    const mapProjection = measure(() => projectTextOpenWorldPlayerMapV1({
      runtimePackage: projection.runtimePackage,
      state: projection.state,
    }))
    expect(mapProjection.value.locations).toHaveLength(TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1.locations)
    expect(mapProjection.value.listFallback).toHaveLength(TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1.locations)
    report('large-map-projection', mapProjection.durationMs, BUDGET_MS.mapProjection)

    const mapScreenProjection = measure(() => projectTextOpenWorldPlayerMapScreenV1(projection))
    expect(mapScreenProjection.value.locations).toHaveLength(TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1.locations)
    report('large-map-screen-projection', mapScreenProjection.durationMs, BUDGET_MS.mapScreenProjection)
  }, 60_000)

  it('160条事件的完整重放与Checkpoint恢复保持可验且在登记基线内', async () => {
    const created = await createLargeTextOpenWorldSessionFixtureV1({ seed: 'large-replay-v1' })
    const session = created.session
    const base = Date.now()
    const events: ProductRuntimeEvent[] = Array.from(
      { length: TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1.replayEvents },
      (_, index) => ({
        projectId: session.projectId,
        worldGroupId: session.worldGroupId ?? null,
        sessionId: session.id!,
        sequence: index + 1,
        type: 'narrative.recorded',
        actorKey: null,
        targetKey: null,
        payloadJson: JSON.stringify({ text: `规模回放叙事记录 ${index + 1}` }),
        createdAt: base + index,
      }),
    )
    await db.productRuntimeEvents.bulkAdd(events)
    await db.productRuntimeSessions.update(session.id!, {
      runtimeHeadSequence: 0,
      updatedAt: base + events.length,
    })

    const replayed = await measureAsync(() => readProductRuntimeState(session.id!))
    expect(replayed.value.lastSequence).toBe(TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1.replayEvents)
    expect(replayed.value.narratives).toHaveLength(TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1.replayEvents)
    expect(replayed.value.textOpenWorld?.state.quests.instancesByKey)
      .toBeDefined()
    report('event-replay-160', replayed.durationMs, BUDGET_MS.replay)

    const checkpoint = await measureAsync(async () => {
      const row = await createProductRuntimeCheckpoint({
        sessionId: session.id!,
        name: 'G7大状态重放检查点',
      })
      expect(await verifyProductRuntimeCheckpoint(row.id!)).toBe(true)
      return row
    })
    expect(checkpoint.value.throughSequence).toBe(TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1.replayEvents)
    report('checkpoint-create-and-verify', checkpoint.durationMs, BUDGET_MS.checkpointCreateAndVerify)
  }, 60_000)

  it('含大状态Session、事件和Checkpoint的项目可在IndexedDB中导出导入并重映射', async () => {
    const created = await createLargeTextOpenWorldSessionFixtureV1({ seed: 'large-portability-v1' })
    await db.productRuntimeEvents.bulkAdd(Array.from(
      { length: TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1.replayEvents },
      (_, index): ProductRuntimeEvent => ({
        projectId: created.session.projectId,
        worldGroupId: created.session.worldGroupId ?? null,
        sessionId: created.session.id!,
        sequence: index + 1,
        type: 'narrative.recorded',
        actorKey: null,
        targetKey: null,
        payloadJson: JSON.stringify({ text: `可移植叙事记录 ${index + 1}` }),
        createdAt: Date.now() + index,
      }),
    ))
    await createProductRuntimeCheckpoint({ sessionId: created.session.id!, name: '导出前检查点' })

    const exported = await measureAsync(() => exportProjectJSON(created.scope.projectId))
    expect(JSON.stringify(exported.value).length).toBeGreaterThan(100_000)
    report('indexeddb-project-export', exported.durationMs, BUDGET_MS.projectExport)

    const imported = await measureAsync(() => importProjectJSON(exported.value))
    report('indexeddb-project-import', imported.durationMs, BUDGET_MS.projectImport)
    expect(imported.value).not.toBe(created.scope.projectId)
    const importedSessions = await db.productRuntimeSessions.where('projectId').equals(imported.value).toArray()
    expect(importedSessions).toHaveLength(1)
    const importedSession = importedSessions[0]
    expect(importedSession.productReleaseId).not.toBe(created.session.productReleaseId)
    expect(await db.productRuntimeEvents.where('sessionId').equals(importedSession.id!).count())
      .toBe(TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1.replayEvents)
    expect(await db.productRuntimeCheckpoints.where('sessionId').equals(importedSession.id!).count()).toBe(1)
    expect((await readProductRuntimeState(importedSession.id!)).lastSequence)
      .toBe(TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1.replayEvents)
  }, 60_000)
})
