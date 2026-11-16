import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { branchProductRuntimeSession, readProductRuntimeState, readSessionEvents } from '../../src/lib/product/runtime-core'
import { createTtrpgOpenContinuationFromPlanV1, previewTtrpgOpenContinuationV1 } from '../../src/lib/ttrpg/continuity'
import { confirmTtrpgOpenTableContinuationV1, prepareTtrpgOpenTableContinuationV1 } from '../../src/lib/ttrpg/open-table-service'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import type { WorkspaceScope } from '../../src/lib/types'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedOpenFixtureReleaseV1 } from '../helpers/open-ttrpg-release'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { setupClosedStageOpeningV1 } from '../helpers/open-ttrpg-stage-opening'

function addWorldGroup(scope: WorkspaceScope, name: string) {
  return db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
    projectId: scope.projectId, name, description: '', type: 'primary' as const,
    order: 0, createdAt: 1, updatedAt: 1,
  }, { owner: 'world' }))
}

async function continuationFixture(grouped: boolean) {
  const { f, input } = await setupClosedStageOpeningV1(true)
  const { scope, runtimePackage, published } = f.f
  const parentId = f.command.sessionId
  const worldGroupId = grouped ? await addWorldGroup(scope, '028原团局世界组') : null
  if (worldGroupId != null) {
    // Use a coherent grouped version of the existing frozen parent fixture.
    // Production still creates and verifies the child through its public APIs.
    await db.transaction('rw', db.productRuntimeSessions, db.productRuntimeEvents, async () => {
      await db.productRuntimeSessions.update(parentId, { worldGroupId })
      await db.productRuntimeEvents.where('sessionId').equals(parentId).modify({ worldGroupId })
    })
  }
  const pkg = structuredClone(runtimePackage)
  const campaign = pkg.ttrpg?.campaign
  if (campaign?.version !== 2) throw Error('Expected an actual open-format continuation fixture')
  campaign.stageClosurePolicy.triggers[0].summaryPrompt = '第二阶段沿用已确认的世界组。'
  const target = await seedOpenFixtureReleaseV1(scope, pkg, published!)
  const preview = await previewTtrpgOpenContinuationV1({ scope, parentSessionId: parentId, targetProductReleaseId: target.id,
    transitionKey: 'sfqa028.continue', approvedBy: input.viewerKey, reason: '沿用原团局并进入新阶段。',
    openingTemplateKeys: input.templateKeys })
  return { scope, parentId, worldGroupId, target, preview, viewerKey: input.viewerKey, openingTemplateKeys: input.templateKeys }
}

describe('SFQA028 open continuation session and event owner', { timeout: 60_000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('creates a publicly readable child when the nonempty parent group is omitted', async () => {
    const { scope, parentId, worldGroupId, preview } = await continuationFixture(true)
    const before = await readProductRuntimeState(parentId)
    const child = await createTtrpgOpenContinuationFromPlanV1({ scope, preview, title: '028续团' })
    expect(child.worldGroupId).toBe(worldGroupId)
    await expect(readProductRuntimeState(child.id!)).resolves.toMatchObject({ entities: before.entities })
    const events = await readSessionEvents(child)
    expect(events.length).toBeGreaterThan(0)
    expect(events.every(event => event.worldGroupId === worldGroupId && event.projectId === scope.projectId)).toBe(true)
    expect(await readProductRuntimeState(parentId)).toEqual(before)
  })

  it('inherits the verified parent group after its mutable world row is removed', async () => {
    const f = await continuationFixture(true)
    const before = await readProductRuntimeState(f.parentId)
    // Removing a live world row cannot rewrite the already frozen product owner.
    await db.worldGroups.delete(f.worldGroupId!)
    const child = await createTtrpgOpenContinuationFromPlanV1({ scope: f.scope, preview: f.preview, title: '028原团局归属不变' })
    expect(child.worldGroupId).toBe(f.worldGroupId)
    expect((await readSessionEvents(child)).every(event => event.worldGroupId === f.worldGroupId
      && event.projectId === f.scope.projectId)).toBe(true)
    expect((await readProductRuntimeState(child.id!)).entities).toEqual(before.entities)
    expect(await readProductRuntimeState(f.parentId)).toEqual(before)
    expect(await db.worldGroups.get(f.worldGroupId!)).toBeUndefined()
  })

  it('inherits an omitted or null group and accepts the desktop’s explicit group without duplicate creation', async () => {
    const f = await continuationFixture(true)
    const desktop = { scope: f.scope, sessionId: f.parentId, viewerKey: f.viewerKey }
    const preview = await prepareTtrpgOpenTableContinuationV1({ ...desktop, targetProductReleaseId: f.target.id,
      reason: '通过桌面确认续团。', openingTemplateKeys: [...f.openingTemplateKeys] })
    const command = { scope: f.scope, preview, title: '028同时确认续团' }
    const [inherited, explicit, nullGroup] = await Promise.all([
      createTtrpgOpenContinuationFromPlanV1(command),
      confirmTtrpgOpenTableContinuationV1({ ...desktop, preview }),
      createTtrpgOpenContinuationFromPlanV1({ ...command, worldGroupId: null }),
    ])
    expect([explicit.id, nullGroup.id]).toEqual([inherited.id, inherited.id])
    expect(await db.productRuntimeSessions.where('parentSessionId').equals(f.parentId).count()).toBe(1)
    expect(inherited.worldGroupId).toBe(f.worldGroupId)
    const anotherGroup = await addWorldGroup(f.scope, '028同世界的另一个组')
    await expect(createTtrpgOpenContinuationFromPlanV1({ ...command, worldGroupId: anotherGroup }))
      .rejects.toThrow('此续团确认已绑定另一个世界组')
    expect(await db.productRuntimeSessions.where('parentSessionId').equals(f.parentId).count()).toBe(1)
    const before = await readProductRuntimeState(inherited.id!)
    const branch = await branchProductRuntimeSession({ parentSessionId: inherited.id!,
      throughSequence: before.lastSequence, title: '028续团分支' })
    expect(branch.worldGroupId).toBe(f.worldGroupId)
    expect((await readProductRuntimeState(branch.id!)).entities).toEqual(before.entities)
    const importedProject = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const importedChild = await db.productRuntimeSessions.where('projectId').equals(importedProject)
      .filter(session => session.title === inherited.title).first()
    expect(importedChild?.worldGroupId).not.toBeNull()
    expect(importedChild?.worldGroupId).not.toBe(f.worldGroupId)
    expect(await readProductRuntimeState(importedChild!.id!)).toEqual(before)
  })

  it('keeps a group-less parent and its initial events group-less', async () => {
    const f = await continuationFixture(false)
    const child = await createTtrpgOpenContinuationFromPlanV1({ scope: f.scope, preview: f.preview,
      title: '028无组续团', worldGroupId: null })
    expect(child.worldGroupId).toBeNull()
    const events = await readSessionEvents(child)
    expect(events.length).toBeGreaterThan(0)
    expect(events.every(event => event.worldGroupId === null)).toBe(true)
  })

  it('rolls back the child and all opening events if persisting the second event fails', async () => {
    const f = await continuationFixture(true)
    const snapshots = () => Promise.all([
      db.productRuntimeSessions.toArray(), db.productRuntimeEvents.toArray(), db.ttrpgSessionParticipants.toArray(),
    ])
    const before = await snapshots()
    const failOpening = (_key: unknown, event: { type: string; sessionId: number }) => {
      if (event.sessionId !== f.parentId && event.type === 'narrative.node.entered') {
        throw new Error('028 opening event write failed')
      }
    }
    db.productRuntimeEvents.hook('creating', failOpening)
    try {
      await expect(createTtrpgOpenContinuationFromPlanV1({
        scope: f.scope, preview: f.preview, title: '028原子创建',
      })).rejects.toThrow(/028 opening event write failed/)
    } finally {
      db.productRuntimeEvents.hook('creating').unsubscribe(failOpening)
    }
    expect(await snapshots()).toEqual(before)
    const child = await createTtrpgOpenContinuationFromPlanV1({
      scope: f.scope, preview: f.preview, title: '028原子创建',
    })
    const events = await readSessionEvents(child)
    expect(events.map(event => event.type)).toEqual(expect.arrayContaining(['narrative.started', 'narrative.node.entered']))
    expect(events.every(event => event.worldGroupId === f.worldGroupId)).toBe(true)
  })

  it('rejects a foreign explicit group and a foreign caller without partially writing an instance', async () => {
    const f = await continuationFixture(true)
    const foreign = await seedCurrentWorkspace('028其他作品')
    const worldGroupId = await addWorldGroup(foreign.scope, '028外部世界组')
    const counts = () => Promise.all([db.productRuntimeSessions.count(), db.productRuntimeEvents.count(),
      db.ttrpgSessionParticipants.count()])
    const before = await counts()
    const command = { scope: f.scope, preview: f.preview, title: '028拒绝串组' }
    const sameWorldOtherGroup = await addWorldGroup(f.scope, '028同世界未授权的另一组')
    await expect(createTtrpgOpenContinuationFromPlanV1({ ...command, worldGroupId: sameWorldOtherGroup })).rejects.toThrow('世界组')
    expect(await counts()).toEqual(before)
    await expect(createTtrpgOpenContinuationFromPlanV1({ ...command, worldGroupId })).rejects.toThrow('世界组')
    expect(await counts()).toEqual(before)
    await expect(createTtrpgOpenContinuationFromPlanV1({ ...command, scope: foreign.scope })).rejects.toThrow()
    expect(await counts()).toEqual(before)
  })
})
