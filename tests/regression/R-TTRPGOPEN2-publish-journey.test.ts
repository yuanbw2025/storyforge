import * as productionPlan from '../../src/lib/product-production/plan'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedOpenBrowserProductionV1, runOpenBrowserProductionV1 } from '../helpers/open-ttrpg-production-browser'
import { prepareProductProductionAdoption } from '../../src/lib/product-production/adoption'
import { publishProductProductionV1, beginProductProductionEvolutionV1, recoverImportedProductProductionProofsV1 } from '../../src/lib/product-production/service'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { verifyProductReleaseManifestV1 } from '../../src/lib/product-production/runtime-package'
import { createProductRuntimeInstanceFromSource } from '../../src/lib/product/runtime-instances'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { verifyImportedWorldContextBindingV1 } from '../../src/lib/product/world-context-portability'

async function produce() {
  const f = await seedOpenBrowserProductionV1()
  await runOpenBrowserProductionV1(f);await runOpenBrowserProductionV1(f,true);await runOpenBrowserProductionV1(f,true)
  return f
}
describe.each([2, 3] as const)('R-TTRPGOPEN2 normal author production adoption publication and release play profile=%s', { timeout: 60000 }, profile => {
  const retainedPlanFactory = productionPlan.createProductProductionPlanV3
  beforeEach(async () => {
    await db.delete(); await db.open()
    // Emulate the complete original constructor for the retained generation;
    // suppliedPlan would intentionally skip the normal cross-Build carry path.
    if (profile === 2) vi.spyOn(productionPlan, 'createProductProductionPlanV3')
      .mockImplementation(input => retainedPlanFactory({ ...input, ttrpgOpenExecutionProfile: 2 }))
  });afterEach(() => { vi.restoreAllMocks();db.close() })
  it('publishes only a governed release-ready open Build and starts from the exact immutable author release', async () => {
    const f = await produce(), build = (await db.productBuilds.where('productionId').equals(f.productionId).first())!
    expect(build.status).toBe('release-ready')
    const prepared = await prepareProductProductionAdoption(f)
    expect(await db.productReleases.count()).toBe(0)
    expect(prepared.intent.packageHash).toBe(build.packageHash)
    const published = await publishProductProductionV1(f)
    const release = (await db.productReleases.get(published.receipt.productReleaseId))!
    const manifest = await verifyProductReleaseManifestV1(release.manifestJson,{ ttrpgProtocol: 2 })
    expect(manifest.runtimePackage.ttrpg!.campaign).toMatchObject({ version: 2,runFormat: 'open' })
    expect(manifest.productionProvenance).toMatchObject({ buildNumber: build.buildNumber,buildManifestHash: build.manifestHash,rootTerminalReceiptHash: build.rootTerminalReceiptHash })
    expect(manifest.packageHash).toBe(build.packageHash)
    expect(manifest.lineage.parentRelease).toBeNull()
    expect(manifest.lineage.compatibility.protocolVersion).toBe(2)
    const session = await createProductRuntimeInstanceFromSource({ scope: f.scope,source: { kind: 'release',productReleaseId: release.id! },title: '正常作者发布试玩',seed: 'author.published.play' })
    expect(session.productBuildId).toBeNull();expect(session.runtimeSourceHash).toBe(build.packageHash)
    expect((await readProductRuntimeState(session.id!)).ttrpg).toMatchObject({ version: 2,runFormat: 'open' })
    expect((await db.productBuilds.get(build.id!))!.status).toBe('released')
  })
  it('creates an explicit second author revision and preserves the first immutable release and its playtest', async () => {
    const f = await produce(), first = await publishProductProductionV1(f)
    const originalRelease = (await db.productReleases.get(first.receipt.productReleaseId))!
    const session = await createProductRuntimeInstanceFromSource({ scope: f.scope,source: { kind: 'release',productReleaseId: originalRelease.id! },title: '第一版仍可游玩',seed: 'first.release' })
    const before = await readProductRuntimeState(session.id!)
    await beginProductProductionEvolutionV1({ ...f,userText: '修订灯塔开场与局势描述，保留原世界来源',affectedLanes: ['content','product'] })
    const production = (await db.productProductions.get(f.productionId))!, row = (await db.productProductionBriefs.where('[productionId+revision]').equals([f.productionId,production.currentBriefRevision!]).first())!
    expect((await executeProductProductionCommand({ ...f,command: { type: 'authorize-start',commandId: 'author.second.start',expectedStateRevision: production.stateRevision,
      briefRevision: row.revision,briefHash: row.briefHash,authorizationNonce: 'author.second.confirmed' } })).ok).toBe(true)
    let result = await runOpenBrowserProductionV1(f)
    for (let i = 0; i < 2 && !result.terminal; i++) result = await runOpenBrowserProductionV1(f,true)
    expect(result.terminal).toBe(true);expect(result.buildId).not.toBe(first.receipt.buildId)
    const second = await publishProductProductionV1(f), release = (await db.productReleases.get(second.receipt.productReleaseId))!
    const [oldManifest,newManifest] = await Promise.all([verifyProductReleaseManifestV1(originalRelease.manifestJson,{ ttrpgProtocol: 2 }),verifyProductReleaseManifestV1(release.manifestJson,{ ttrpgProtocol: 2 })])
    expect(release.version).toBe(2)
    expect(newManifest.lineage.parentRelease).toEqual({ releaseUid: oldManifest.lineage.releaseUid,releaseHash: oldManifest.lineage.releaseHash })
    expect(newManifest.productionProvenance!.buildNumber).toBe(2)
    expect(await db.productReleases.get(originalRelease.id!)).toEqual(originalRelease)
    expect(await readProductRuntimeState(session.id!)).toEqual(before)
  })
  it('preserves original byte provenance across a further pause/resume epoch without another model call', async () => {
    const f = await produce(), original = (await db.productBuilds.where('productionId').equals(f.productionId).first())!
    let production = (await db.productProductions.get(f.productionId))!
    expect((await executeProductProductionCommand({ ...f,command: { type: 'pause',commandId: 'publish.pause',expectedStateRevision: production.stateRevision,reason: '检查发布前恢复' } })).ok).toBe(true)
    production = (await db.productProductions.get(f.productionId))!
    expect((await executeProductProductionCommand({ ...f,command: { type: 'resume',commandId: 'publish.resume',expectedStateRevision: production.stateRevision } })).ok).toBe(true)
    const resumed = await runOpenBrowserProductionV1(f)
    expect(resumed.terminal).toBe(true);expect(resumed.modelCalls).toBe(profile === 2 ? 4 : 3)
    expect((await db.productBuilds.get(original.id!))!.controlEpoch).toBeGreaterThan(original.controlEpoch)
    const prepared = await prepareProductProductionAdoption(f)
    expect(prepared.intent.packageHash).toBe(original.packageHash)
    expect((await publishProductProductionV1(f)).receipt.releaseVersion).toBe(1)
  })
  it('rolls back immutable carry with a failed Plan commit and resumes without discarding content or repeating a paid call', async () => {
    const f = await seedOpenBrowserProductionV1()
    await runOpenBrowserProductionV1(f);await runOpenBrowserProductionV1(f,true)
    const previousBuild = (await db.productBuilds.where('productionId').equals(f.productionId).first())!
    const previousArtifacts = await db.productBuildArtifacts.where('buildId').equals(previousBuild.id!).toArray()
    const update = db.productBuilds.update.bind(db.productBuilds)
    let failed = false
    const spy = vi.spyOn(db.productBuilds,'update').mockImplementation(async (key,changes) => {
      if (!failed && typeof changes === 'object' && changes !== null && 'planRevision' in changes && 'planJson' in changes) {
        failed = true;throw new Error('SIMULATED_PLAN_COMMIT_INTERRUPTED')
      }
      return update(key,changes)
    })
    await expect(runOpenBrowserProductionV1(f,true)).rejects.toThrow('SIMULATED_PLAN_COMMIT_INTERRUPTED')
    spy.mockRestore()
    const build = (await db.productBuilds.where('productionId').equals(f.productionId).first())!
    // Plan and epoch carry share one transaction: interruption preserves the
    // original rows and Plan instead of leaving a partially committed carry.
    expect(build.planRevision).toBe(previousBuild.planRevision)
    expect(build.planJson).toBe(previousBuild.planJson)
    expect(build.planHash).toBe(previousBuild.planHash)
    const interruptedArtifacts = await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
    expect(interruptedArtifacts).toEqual(previousArtifacts)
    expect(interruptedArtifacts.some(r => r.controlEpoch === build.controlEpoch && r.status === 'carried-forward')).toBe(false)
    const resumed = await runOpenBrowserProductionV1(f)
    expect(resumed.terminal).toBe(true);expect(resumed.modelCalls).toBe(profile === 2 ? 4 : 3)
    expect((await publishProductProductionV1(f)).receipt.releaseVersion).toBe(1)
  })
  it.each(['origin-producer','origin-input','parent-proof','synthetic-ledger'] as const)('rejects %s tampering after real author reviews without publishing', async mode => {
    const f = await produce(), build = (await db.productBuilds.where('productionId').equals(f.productionId).first())!
    const carry = (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()).find(r => r.controlEpoch === build.controlEpoch && r.status === 'carried-forward' && r.artifactKey === 'ttrpg.open.source-facts')!
    expect(carry.carriedFrom).not.toBeNull()
    if (mode === 'origin-producer') await db.productBuildArtifacts.update(carry.id!,{ producerRunId: JSON.parse(build.budgetLedgerJson).tasks['ttrpg.open.source-facts'].runId })
    if (mode === 'origin-input') await db.productBuildArtifacts.update(carry.id!,{ inputHash: 'f'.repeat(64) })
    if (mode === 'parent-proof') await db.productBuildArtifacts.update(carry.id!,{ carriedFrom: { ...carry.carriedFrom!,proofHash: 'f'.repeat(64) } })
    if (mode === 'synthetic-ledger') {
      const ledger = JSON.parse(build.budgetLedgerJson);ledger.tasks['ttrpg.open.source-facts'].idempotencyKey = 'f'.repeat(64)
      await db.productBuilds.update(build.id!,{ budgetLedgerJson: JSON.stringify(ledger) })
    }
    await expect(prepareProductProductionAdoption(f)).rejects.toThrow()
    expect(await db.productReleases.count()).toBe(0)
  })
  it('restores a release-ready author Build and revalidates imported provenance before publication without new model usage', async () => {
    const f = await produce(), originalProduction = (await db.productProductions.get(f.productionId))!
    const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const production = (await db.productProductions.where('projectId').equals(projectId).toArray()).find(p => p.productionKey === originalProduction.productionKey)!
    const restored = { scope: { projectId,worldId: production.worldId,workId: production.workId },productionId: production.id! }
    const complete = await recoverImportedProductProductionProofsV1(restored)
    expect(complete.terminal).toBe(true)
    const build = (await db.productBuilds.get(complete.buildId))!, ledger = JSON.parse(build.budgetLedgerJson)
    expect(ledger.attempts.reduce((n: number,a: { usage: { modelCalls: number } | null }) => n + (a.usage?.modelCalls ?? 0),0)).toBe(profile === 2 ? 4 : 3)
    expect((await publishProductProductionV1(restored)).receipt.releaseVersion).toBe(1)
    expect((await db.productProductions.get(f.productionId))!.status).toBe('preview-ready')
  })
  it('moves the complete author backup across two clean databases with different local IDs and preserves the exact original world-read manifests', async () => {
    const f = await produce(), productionKey = (await db.productProductions.get(f.productionId))!.productionKey
    let backup = await exportProjectJSON(f.scope.projectId)
    const originalBindings = backup.agentRuns.filter(r => r.portableWorldContextBindingsJson).flatMap(r => JSON.parse(r.portableWorldContextBindingsJson!))
    expect(originalBindings.length).toBeGreaterThan(0)
    for (let round = 0; round < 2; round++) {
      await db.delete();await db.open()
      for (let i = 0; i < 3 + round; i++) await seedCurrentProductWorld(`unrelated local data ${i}`)
      const projectId = await importProjectJSON(backup)
      const production = (await db.productProductions.where('projectId').equals(projectId).toArray()).find(p => p.productionKey === productionKey)!
      const restored = { scope: { projectId,worldId: production.worldId,workId: production.workId },productionId: production.id! }
      expect(projectId).not.toBe(f.scope.projectId)
      expect((await recoverImportedProductProductionProofsV1(restored)).terminal).toBe(true)
      backup = await exportProjectJSON(projectId)
      const bindings = backup.agentRuns.filter(r => r.portableWorldContextBindingsJson).flatMap(r => JSON.parse(r.portableWorldContextBindingsJson!))
      expect(bindings).toEqual(originalBindings)
      if (round === 1) expect((await publishProductProductionV1(restored)).receipt.releaseVersion).toBe(1)
    }
  })
  it.each(['missing','hash-corrupt','wrong-world'] as const)('refuses %s portable world-read proof instead of accepting a different source scope', async mode => {
    const f = await produce(), backup = await exportProjectJSON(f.scope.projectId)
    const sources = backup.agentRuns.filter(r => r.portableWorldContextBindingsJson)
    expect(sources.length).toBeGreaterThan(0)
    for (const row of sources) {
      if (mode === 'missing') delete row.portableWorldContextBindingsJson
      else {
        const bindings = JSON.parse(row.portableWorldContextBindingsJson!)
        for (const binding of bindings) {
          if (mode === 'hash-corrupt') binding.bindingHash = 'f'.repeat(64)
          else { binding.worldReleaseUid += '.unrelated';const { bindingHash: _old,...body } = binding;binding.bindingHash = await hashCanonicalValue(body) }
        }
        row.portableWorldContextBindingsJson = JSON.stringify(bindings)
      }
    }
    const projectsBefore = await db.projects.count()
    if (mode === 'hash-corrupt') {
      await expect(importProjectJSON(backup)).rejects.toThrow(/世界读取证明/)
      expect(await db.projects.count()).toBe(projectsBefore)
    } else {
      const projectId = await importProjectJSON(backup), production = (await db.productProductions.where('projectId').equals(projectId).toArray())[0]
      const restored = { scope: { projectId,worldId: production.worldId,workId: production.workId },productionId: production.id! }
      await recoverImportedProductProductionProofsV1(restored)
      await expect(publishProductProductionV1(restored)).rejects.toThrow(/run-manifest-binding/)
      expect(await db.productReleases.where('projectId').equals(projectId).count()).toBe(0)
      if (mode === 'missing') expect((await exportProjectJSON(projectId)).agentRuns.length).toBeGreaterThan(0)
    }
  })
  it('requires a real import and explicit local proof recovery even when a valid portable binding is copied onto a live run', async () => {
    const f = await produce(), backup = await exportProjectJSON(f.scope.projectId)
    const portable = backup.agentRuns.find(r => r.portableWorldContextBindingsJson)!, binding = JSON.parse(portable.portableWorldContextBindingsJson!)[0]
    const runs = await db.agentRuns.where('projectId').equals(f.scope.projectId).toArray()
    const target = runs.find(r => r.productBuildId && r.parentRelation?.startsWith('task:') && r.portableWorldContextBindingsJson === undefined)!
    await db.agentRuns.update(target.id!,{ portableWorldContextBindingsJson: portable.portableWorldContextBindingsJson })
    expect(await verifyImportedWorldContextBindingV1({ snapshot: await readAgentRunV1(f.scope,target.id!),manifestHash: binding.manifestHash,
      sourceScopeFingerprint: binding.sourceScopeFingerprint,worldReleaseUid: binding.worldReleaseUid,worldReleaseHash: binding.worldReleaseHash })).toBe(false)
  })
})
