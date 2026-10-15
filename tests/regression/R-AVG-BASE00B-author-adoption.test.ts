import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { applyAvgAuthorArtifactAdoptionV1, stageAvgAuthorArtifactV1 } from '../../src/lib/avg/author-artifacts'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { createAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { scopeTransactionTables } from '../../src/lib/workspace/scope'
import type { AvgDialoguePatchV1 } from '../../src/lib/avg/artifact-contract'
import { seedAvgAuthorArtifacts, stageAuthorFixture, authorFixtureCommand, acceptAuthorPrefix, originalAuthorPayload } from '../helpers/avg-author-artifact-fixture'

describe('AVG-BASE-00B · author candidate, durable confirmation and revision persistence', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('keeps a valid candidate pending until a real command confirms it, replays without double adoption and restores bytes across backup', async () => {
    const s = await seedAvgAuthorArtifacts()
    const candidate = await stageAuthorFixture(s, 0)
    expect(candidate.status).toBe('pending')
    expect(await stageAuthorFixture(s, 0)).toEqual(candidate)
    expect(await db.productBuildArtifacts.filter(row => row.status === 'accepted').count()).toBe(0)
    const command = await authorFixtureCommand(s, candidate, 'author.confirm')
    const accepted = await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId, command })
    expect(accepted.ok).toBe(true)
    expect(accepted.result.contentHash).toBe(await hashProductProductionValueV2(originalAuthorPayload(0)))
    const replay = await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId, command })
    expect(replay).toMatchObject({ ok: true, replayed: true, result: accepted.result })
    expect(await db.productBuildArtifacts.count()).toBe(1)
    const row = (await db.productBuildArtifacts.get(candidate.id!))!
    expect(row.status).toBe('accepted'); expect(row.payloadJson).toBe(candidate.payloadJson)
    expect(JSON.parse(row.metadataJson).receiptHash).toBe(accepted.result.authorReceiptHash)
    const importedId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const restored = (await db.productBuildArtifacts.where('projectId').equals(importedId).first())!
    expect(restored.buildId).not.toBe(s.buildId); expect(restored.workId).not.toBe(s.scope.workId)
    expect(restored.payloadJson).toBe(row.payloadJson); expect(restored.metadataJson).toBe(row.metadataJson)
    const build = (await db.productBuilds.get(restored.buildId))!
    const restoredScope = { projectId: importedId, worldId: restored.worldId, workId: restored.workId }
    const recovered = { ...s, scope: restoredScope, productionId: build.productionId, buildId: build.id! }
    // Actual restored authority/receipt, rather than a bytes-only comparison.
    expect((await stageAuthorFixture(recovered, 1)).status).toBe('pending')
    await deleteWork(importedId, restored.workId)
    expect(await db.productBuildArtifacts.where('projectId').equals(importedId).count()).toBe(0)
    expect(await db.productBuildArtifacts.get(candidate.id!)).toBeDefined()
  })

  it('rejects missing author claims, cross-Work inputs, wrong key/schema and unregistered AI tasks without adopting', async () => {
    const s = await seedAvgAuthorArtifacts()
    const candidate = await stageAuthorFixture(s, 0)
    const command = await authorFixtureCommand(s, candidate)
    await expect(applyAvgAuthorArtifactAdoptionV1({ scope: s.scope, production: (await db.productProductions.get(s.productionId)) as any, command, now: Date.now() })).rejects.toThrow(/命令事务/)
    await expect(db.transaction('rw', scopeTransactionTables(db.productProductionCommands), () =>
      applyAvgAuthorArtifactAdoptionV1({ scope: s.scope, production: { ...(candidate as any), id: s.productionId, stateRevision: command.expectedStateRevision }, command, now: Date.now() }))).rejects.toThrow(/claim/)
    const other = await createAvgDraftV1('另一个 AVG')
    await expect(stageAvgAuthorArtifactV1({ scope: other.scope, buildId: s.buildId, expectedBuildRevision: 0, controlEpoch: 0,
      taskKey: 'author.0', artifactKey: candidate.artifactKey, kind: 'narrative', payload: originalAuthorPayload(0), declaration: '自有' })).rejects.toThrow(/跨 Work/)
    await expect(stageAvgAuthorArtifactV1({ scope: s.scope, buildId: s.buildId, expectedBuildRevision: 0, controlEpoch: 0,
      taskKey: 'author.0', artifactKey: 'avg.content.story-bible', kind: 'narrative', payload: originalAuthorPayload(0), declaration: '自有' })).rejects.toThrow(/岗位/)
    const altered = structuredClone(s.plan); altered.tasks[0]!.executionMode = 'model'; altered.tasks[0]!.skillId = 'avg.production-supervision.v1'
    await db.productBuilds.update(s.buildId, { planJson: canonicalProductProductionJsonV2(altered), planHash: await hashProductProductionValueV2(altered) })
    await expect(stageAuthorFixture(s, 0)).rejects.toThrow(/作者输入写域/)
    expect((await db.productBuildArtifacts.get(candidate.id!))!.status).toBe('pending')
  })

  it('recovers a pending author candidate after backup remapping and adopts it once in the restored Work', async () => {
    const s = await seedAvgAuthorArtifacts(); const candidate = await stageAuthorFixture(s, 0)
    const command = await authorFixtureCommand(s, candidate, 'restored.author.confirm')
    const importedId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const build = (await db.productBuilds.where('projectId').equals(importedId).first())!
    const scope = { projectId: importedId, worldId: build.worldId, workId: build.workId }
    const restored = (await db.productBuildArtifacts.where('buildId').equals(build.id!).first())!
    expect(restored.metadataJson).toBe(candidate.metadataJson)
    const result = await executeProductProductionCommand({ scope, productionId: build.productionId, command })
    expect(result.ok).toBe(true)
    expect((await db.productBuildArtifacts.get(restored.id!))!.status).toBe('accepted')
    expect((await db.productBuildArtifacts.get(candidate.id!))!.status).toBe('pending')
    await expect(executeProductProductionCommand({ scope, productionId: build.productionId,
      command: { ...command, candidateHash: 'f'.repeat(64) } })).rejects.toThrow(/payload 不同/)
    expect(await db.productBuildArtifacts.where('buildId').equals(build.id!).count()).toBe(1)
  })

  it('rejects invented source references and edits to a frozen preview without creating candidates', async () => {
    const s = await seedAvgAuthorArtifacts(); await acceptAuthorPrefix(s, 1)
    const source = originalAuthorPayload(1)
    if (source.schema !== 'storyforge.avg.source-audit') throw new Error('fixture')
    const count = await db.productBuildArtifacts.count()
    await expect(stageAuthorFixture(s, 1, { ...source, facts: [{ factKey: 'fake', resourceKeys: ['world:invented'], statement: '伪造来源', disclosure: 'public' }] })).rejects.toThrow(/冻结初始资源/)
    await db.productBuilds.update(s.buildId, { status: 'preview-ready', previewHash: 'a'.repeat(64) })
    await expect(stageAuthorFixture(s, 1)).rejects.toThrow(/已冻结/)
    expect(await db.productBuildArtifacts.count()).toBe(count)
  })

  it.each(['candidate', 'source', 'epoch', 'base', 'work'] as const)('rejects %s races atomically and records the failed confirmation', async mode => {
    const s = await seedAvgAuthorArtifacts(); const candidate = await stageAuthorFixture(s, 0)
    const command = await authorFixtureCommand(s, candidate)
    if (mode === 'candidate') await db.productBuildArtifacts.update(candidate.id!, { payloadJson: '{"forged":true}' })
    if (mode === 'source') await db.productProductionBriefs.where('productionId').equals(s.productionId).modify({ sourcePlanHash: 'f'.repeat(64) })
    if (mode === 'epoch') await db.productBuilds.update(s.buildId, { controlEpoch: 99 })
    if (mode === 'base') {
      const prior = await stageAuthorFixture(s, 0, { ...originalAuthorPayload(0), goal: '另一个作者方案' } as any)
      await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId, command: await authorFixtureCommand(s, prior) })
      command.expectedStateRevision++; command.expectedBuildRevision++
    }
    if (mode === 'work') await db.works.update(s.scope.workId, { kind: 'novel' })
    const before = await db.productBuildArtifacts.toArray()
    const receipt = await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId, command })
    expect(receipt).toMatchObject({ ok: false, errorCode: 'avg-artifact-invalid' })
    expect(await db.productBuildArtifacts.toArray()).toEqual(before)
    expect((await db.productProductionCommands.where('[productionId+commandId]').equals([s.productionId, command.commandId]).first())!.status).toBe('failed')
  })

  it('persists expression-only patches as new scripts, preserves identities and invalidates dependent accepted inputs', async () => {
    const s = await seedAvgAuthorArtifacts(); await acceptAuthorPrefix(s)
    const script = (await db.productBuildArtifacts.where('buildId').equals(s.buildId).filter(row => row.artifactKey === 'avg.content.scene-script.archive').first())!
    const old = JSON.parse(script.payloadJson)
    const patch: AvgDialoguePatchV1 = { schema: 'storyforge.avg.dialogue-patch', version: 1, sceneKey: 'archive', baseScriptHash: script.contentHash,
      changes: [{ targetKey: old.lines[0].lineKey, field: 'text', oldValueHash: await hashProductProductionValueV2(old.lines[0].text), newText: '别急，封口还在。', reason: '作者选用更自然的回应' }] }
    const candidate = await stageAuthorFixture(s, 6, patch)
    const receipt = await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId, command: await authorFixtureCommand(s, candidate) })
    expect(receipt.ok).toBe(true)
    const scripts = await db.productBuildArtifacts.where('buildId').equals(s.buildId).filter(row => row.artifactKey === script.artifactKey).toArray()
    expect(scripts).toHaveLength(2)
    expect(scripts[0]).toMatchObject({ status: 'invalid', payloadJson: script.payloadJson })
    expect(scripts[1]).toMatchObject({ status: 'accepted', version: 2, parentArtifactHash: script.contentHash })
    expect(JSON.parse(scripts[1]!.payloadJson).lines[0]).toEqual({ ...old.lines[0], text: '别急，封口还在。' })
    expect(JSON.parse(scripts[1]!.payloadJson).choices).toEqual(old.choices)
    const review = await stageAuthorFixture(s, 7)
    expect((await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId, command: await authorFixtureCommand(s, review) })).ok).toBe(true)
    await expect(stageAuthorFixture(s, 6, patch)).rejects.toThrow(/stale/)
    // Replacing the writer's script invalidates its patch/review consumers.
    const replacement = await stageAuthorFixture(s, 5, { ...old, lines: [{ ...old.lines[0], text: '作者再改一句。' }] })
    const changed = await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId, command: await authorFixtureCommand(s, replacement) })
    expect(changed.ok).toBe(true)
    expect((await db.productBuildArtifacts.get(review.id!))!.status).toBe('invalid')
    expect((await db.productBuildArtifacts.get(candidate.id!))!.status).toBe('invalid')
    expect(await db.agentRuns.count()).toBe(0); expect(await db.mediaBlobObjects.count()).toBe(0)
  })
})
