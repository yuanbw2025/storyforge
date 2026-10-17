import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedOpenBrowserProductionV1, runOpenBrowserProductionV1 } from '../helpers/open-ttrpg-production-browser'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { beginProductProductionEvolutionV1, publishProductProductionV1, recoverImportedProductProductionProofsV1 } from '../../src/lib/product-production/service'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { createProductRuntimeInstanceFromSource } from '../../src/lib/product/runtime-instances'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { verifyProductReleaseManifestV1 } from '../../src/lib/product-production/runtime-package'
import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { applyCrossBuildEvolutionReuseV1 } from '../../src/lib/product-production/scheduler'
import { carryForwardProductBuildArtifactsAcrossBuildsV1 } from '../../src/lib/product-production/artifact-store'

describe('R-TTRPGOPEN2 restored author evolution retains source and immutable history', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => db.close())
  it.each([
    { released: false,lanes: ['content','product'] as const },
    { released: true,lanes: ['content','product'] as const },
    { released: true,lanes: ['visual'] as const },
  ])('restores a complete backup and publishes a new authorized revision %j', async ({ released,lanes }) => {
    const source = await seedOpenBrowserProductionV1()
    await runOpenBrowserProductionV1(source);await runOpenBrowserProductionV1(source,true);await runOpenBrowserProductionV1(source,true)
    if (released) await publishProductProductionV1(source)
    const key = (await db.productProductions.get(source.productionId))!.productionKey
    const backup = await exportProjectJSON(source.scope.projectId)
    await db.delete();await db.open()
    for (let i = 0; i < 3; i++) await seedCurrentProductWorld(`other machine ${i}`)
    const projectId = await importProjectJSON(backup)
    const production = (await db.productProductions.where('projectId').equals(projectId).toArray()).find(p => p.productionKey === key)!
    const f = { scope: { projectId,worldId: production.worldId,workId: production.workId },productionId: production.id! }
    const originalBuild = (await db.productBuilds.where('[productionId+buildNumber]').equals([f.productionId,1]).first())!
    const originalBrief = (await db.productProductionBriefs.where('[productionId+revision]').equals([f.productionId,production.currentBriefRevision!]).first())!
    const originalRelease = released ? await db.productReleases.get(production.currentProductReleaseId!) : null
    const session = released ? await createProductRuntimeInstanceFromSource({ scope: f.scope,source: { kind: 'release',productReleaseId: originalRelease!.id! },title: '原版本试玩',seed: 'restored.original' }) : null
    const before = session ? await readProductRuntimeState(session.id!) : null
    expect((await recoverImportedProductProductionProofsV1(f)).terminal).toBe(true)
    if (released) {
      expect(await db.productBuilds.get(originalBuild.id!)).toEqual(originalBuild)
      expect(await db.productProductions.get(f.productionId)).toEqual(production)
    }
    await beginProductProductionEvolutionV1({ ...f,userText: '恢复后按本轮影响范围修订，沿用已确认的冻结世界',affectedLanes: [...lanes] })
    const revised = (await db.productProductions.get(f.productionId))!
    const brief = (await db.productProductionBriefs.where('[productionId+revision]').equals([f.productionId,revised.currentBriefRevision!]).first())!
    const saved = JSON.parse(brief.briefJson)
    expect(saved.source.worldReleaseId).toBe(brief.sourceWorldReleaseId)
    expect((await executeProductProductionCommand({ ...f,command: { type: 'authorize-start',commandId: 'restored.evolution.start',expectedStateRevision: revised.stateRevision,
      briefRevision: brief.revision,briefHash: brief.briefHash,authorizationNonce: 'restored.author.confirmed' } })).ok).toBe(true)
    let result = await runOpenBrowserProductionV1(f)
    for (let i = 0; i < 2 && !result.terminal; i++) result = await runOpenBrowserProductionV1(f,true)
    expect(result.terminal).toBe(true)
    if (lanes.length === 1) {
      expect(result.modelCalls).toBeLessThan(4)
      const carried = (await db.productBuildArtifacts.where('buildId').equals(result.buildId).toArray()).find(r => r.artifactKey === 'ttrpg.open.source-facts' && r.status === 'carried-forward')
      expect(carried?.carriedFrom?.buildNumber).toBe(1)
    }
    const published = await publishProductProductionV1(f), release = (await db.productReleases.get(published.receipt.productReleaseId))!
    const manifest = await verifyProductReleaseManifestV1(release.manifestJson,{ ttrpgProtocol: 2 })
    expect(manifest.sourceWorldRelease.contentHash).toBe(JSON.parse(originalBuild.previewManifestJson).runtimePackage.sourceWorld.contentHash)
    expect(release.version).toBe(released ? 2 : 1)
    expect((await db.productBuilds.get(originalBuild.id!))!.manifestHash).toBe(originalBuild.manifestHash)
    expect(await db.productProductionBriefs.get(originalBrief.id!)).toMatchObject({ briefJson: originalBrief.briefJson,briefHash: originalBrief.briefHash,
      sourcePlanJson: originalBrief.sourcePlanJson,sourcePlanHash: originalBrief.sourcePlanHash,sourceWorldReleaseId: originalBrief.sourceWorldReleaseId })
    if (released) {
      expect(await db.productBuilds.get(originalBuild.id!)).toEqual(originalBuild)
      expect(await db.productReleases.get(originalRelease!.id!)).toEqual(originalRelease)
      expect(await readProductRuntimeState(session!.id!)).toEqual(before)
    }
    if (lanes.length === 1) {
      // The next revision must follow two real carry layers, including the
      // restored original producer, rather than treating a copy as new bytes.
      await beginProductProductionEvolutionV1({ ...f,userText: '继续调整视觉呈现',affectedLanes: ['visual'] })
      const p = (await db.productProductions.get(f.productionId))!,b = (await db.productProductionBriefs.where('[productionId+revision]').equals([p.id!,p.currentBriefRevision!]).first())!
      expect((await executeProductProductionCommand({ ...f,command: { type: 'authorize-start',commandId: 'restored.evolution.third',expectedStateRevision: p.stateRevision,
        briefRevision: b.revision,briefHash: b.briefHash,authorizationNonce: 'author.third.revision' } })).ok).toBe(true)
      const third = await runOpenBrowserProductionV1(f)
      expect(third.terminal).toBe(true);expect(third.modelCalls).toBe(1)
      const receipt = await publishProductProductionV1(f)
      expect((await db.productReleases.get(receipt.receipt.productReleaseId))!.version).toBe(3)
      expect(await db.productBuilds.get(originalBuild.id!)).toEqual(originalBuild)
      expect(await readProductRuntimeState(session!.id!)).toEqual(before)
      const chainedBackup = await exportProjectJSON(f.scope.projectId)
      await db.delete();await db.open()
      for (let i = 0; i < 6; i++) await seedCurrentProductWorld(`third machine ${i}`)
      const thirdProject = await importProjectJSON(chainedBackup),restored = (await db.productProductions.where('projectId').equals(thirdProject).toArray()).find(p => p.productionKey === key)!
      const restoredBuild = (await db.productBuilds.where('[productionId+buildNumber]').equals([restored.id!,3]).first())!
      expect((await recoverImportedProductProductionProofsV1({ scope: { projectId: thirdProject,worldId: restored.worldId,workId: restored.workId },productionId: restored.id! })).terminal).toBe(true)
      expect(await db.productBuilds.get(restoredBuild.id!)).toEqual(restoredBuild)
      expect(await db.productProductions.get(restored.id!)).toEqual(restored)
    }
  })
  it.each(['origin','reuse-key','unbound-plan','changed-input','affected-lane'] as const)('rejects corrupt cross-build %s without adopting target artifacts', async mode => {
    const f = await seedOpenBrowserProductionV1()
    await runOpenBrowserProductionV1(f);await runOpenBrowserProductionV1(f,true);await runOpenBrowserProductionV1(f,true)
    const parent = (await db.productBuilds.where('[productionId+buildNumber]').equals([f.productionId,1]).first())!
    await beginProductProductionEvolutionV1({ ...f,userText: '只调整视觉',affectedLanes: ['visual'] })
    const p = (await db.productProductions.get(f.productionId))!,b = (await db.productProductionBriefs.where('[productionId+revision]').equals([p.id!,p.currentBriefRevision!]).first())!
    expect((await executeProductProductionCommand({ ...f,command: { type: 'authorize-start',commandId: 'negative.reuse.start',expectedStateRevision: p.stateRevision,
      briefRevision: b.revision,briefHash: b.briefHash,authorizationNonce: 'author.reuse.negative' } })).ok).toBe(true)
    const target = (await db.productBuilds.where('[productionId+buildNumber]').equals([f.productionId,2]).first())!,brief = parseProductProductionBriefV3(b.briefJson)
    const initial = await createProductProductionPlanV3({ brief,briefHash: b.briefHash,buildNumber: 2,controlEpoch: target.controlEpoch })
    const reuse = await applyCrossBuildEvolutionReuseV1({ scope: f.scope,build: target,brief,plan: initial })
    expect(reuse.reusableArtifactKeys).toContain('ttrpg.open.source-facts')
    if (mode === 'origin') {
      const origin = (await db.productBuildArtifacts.where('buildId').equals(parent.id!).toArray()).find(a => a.artifactKey === 'ttrpg.open.source-facts' && a.carriedFrom == null)!
      await db.productBuildArtifacts.update(origin.id!,{ producerRunId: null })
    }
    if (mode === 'reuse-key') reuse.plan.tasks.find(t => t.reuse)!.reuse!.reuseKey = 'f'.repeat(64)
    if (mode === 'unbound-plan') reuse.plan.briefHash = 'f'.repeat(64)
    if (mode === 'changed-input' || mode === 'affected-lane') {
      if (mode === 'changed-input') brief.intent.tone = [...brief.intent.tone,'需要重新确认的另一种基调']
      else brief.evolution!.affectedLanes = ['content']
      const hash = await hashProductProductionValueV2(brief)
      await db.productProductionBriefs.update(b.id!,{ briefJson: canonicalProductProductionJsonV2(brief),briefHash: hash })
      await db.productBuilds.update(target.id!,{ briefHash: hash })
      reuse.plan.briefHash = hash
      if (mode === 'affected-lane') {
        const rows = (await db.productBuildArtifacts.where('buildId').equals(parent.id!).toArray()).filter(a => a.controlEpoch === parent.controlEpoch)
        for (const task of reuse.plan.tasks.filter(t => t.reuse)) task.reuse!.reuseKey = await hashProductProductionValueV2({
          schema: 'storyforge.product-production-cross-build-reuse',version: 1,sourceBuildNumber: 1,targetBuildNumber: 2,
          sourceControlEpoch: parent.controlEpoch,invalidQualityReviewContentHash: null,taskKey: task.taskKey,userImpact: ['content'],
          artifacts: task.outputArtifactKeys.map(artifactKey => ({ artifactKey,contentHash: rows.find(a => a.artifactKey === artifactKey)!.contentHash })),
        })
      }
    }
    const beforeTarget = await db.productBuilds.get(target.id!)
    await expect(carryForwardProductBuildArtifactsAcrossBuildsV1({ scope: f.scope,sourceBuildId: parent.id!,targetBuildId: target.id!,targetControlEpoch: target.controlEpoch,
      artifactKeys: reuse.reusableArtifactKeys,pendingPlan: { plan: reuse.plan,planHash: await hashProductProductionValueV2(reuse.plan) } })).rejects.toThrow()
    expect(await db.productBuildArtifacts.where('buildId').equals(target.id!).count()).toBe(0)
    expect(await db.productBuilds.get(target.id!)).toEqual(beforeTarget)
  })
  it.each(['locator','world-hash','nested-reference'] as const)('rejects a changed restored %s before creating an author revision', async mode => {
    const source = await seedOpenBrowserProductionV1()
    await runOpenBrowserProductionV1(source);await runOpenBrowserProductionV1(source,true);await runOpenBrowserProductionV1(source,true)
    const projectId = await importProjectJSON(await exportProjectJSON(source.scope.projectId))
    const production = (await db.productProductions.where('projectId').equals(projectId).toArray())[0]
    const f = { scope: { projectId,worldId: production.worldId,workId: production.workId },productionId: production.id! }
    await recoverImportedProductProductionProofsV1(f)
    const brief = (await db.productProductionBriefs.where('[productionId+revision]').equals([f.productionId,production.currentBriefRevision!]).first())!
    if (mode === 'locator') await db.productProductionBriefs.update(brief.id!,{ sourceWorldReleaseId: 999999 })
    if (mode === 'world-hash') await db.productProductionBriefs.update(brief.id!,{ sourceWorldContentHash: 'f'.repeat(64) })
    if (mode === 'nested-reference') {
      const value = JSON.parse(brief.briefJson);value.ttrpgOpen.worldReference.localReleaseRecordId = 999999
      await db.productProductionBriefs.update(brief.id!,{ briefJson: JSON.stringify(value) })
    }
    const count = await db.productProductionBriefs.where('productionId').equals(f.productionId).count()
    await expect(beginProductProductionEvolutionV1({ ...f,userText: '不得更换世界',affectedLanes: ['content','product'] })).rejects.toThrow()
    expect(await db.productProductionBriefs.where('productionId').equals(f.productionId).count()).toBe(count)
    expect((await db.productProductions.get(f.productionId))!.currentBriefRevision).toBe(production.currentBriefRevision)
  })
})
