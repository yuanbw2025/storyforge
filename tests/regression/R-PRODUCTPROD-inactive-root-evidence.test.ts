import { afterAll, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { createProductRuntimeInstance } from '../../src/lib/product/runtime-instances'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { verifyStoredProductBuildRootBudgetEvidenceV1 } from '../../src/lib/product-production/root-budget-evidence-store'
import { createTextOpenWorldCreatorReleaseFixtureV1 } from '../helpers/text-open-world-creator-release'

afterAll(() => db.close())

it.each(['keep-build', 'discard-unreleased', 'archive'] as const)(
  'retains inactive %s audit bytes through two imports without granting current authority',
  async action => {
    await db.delete()
    await db.open()
    const fixture = await createTextOpenWorldCreatorReleaseFixtureV1('world-release', 1, { portableRoot: true })
    await db.productBuilds.update(fixture.creator.buildId, { status: 'preview-ready' })
    await db.productProductions.update(fixture.creator.productionId, { status: 'preview-ready' })
    const importedId = await importProjectJSON(await exportProjectJSON(fixture.scope.projectId))
    const build = (await db.productBuilds.where('projectId').equals(importedId).first())!
    const production = (await db.productProductions.get(build.productionId))!
    const scope = { projectId: importedId, worldId: build.worldId, workId: build.workId }
    const preview = await createProductRuntimeInstance({
      scope, kind: 'text-open-world', title: 'retained preview',
      productSource: { kind: 'build', productBuildId: build.id!, expectedPreviewHash: build.previewHash! },
    })
    const command = action === 'archive'
      ? { type: 'archive' as const, commandId: 'inactive.archive',
        expectedStateRevision: production.stateRevision, reason: 'archive candidate' }
      : { type: 'stop' as const, commandId: 'inactive.stop',
        expectedStateRevision: production.stateRevision, retention: action }
    const receipt = await executeProductProductionCommand({ scope, productionId: production.id!, command })
    expect(receipt.ok).toBe(true)
    expect((await db.productBuilds.get(build.id!))!.rootBudgetEvidenceJson).toBe(build.rootBudgetEvidenceJson)

    const backup = await exportProjectJSON(importedId)
    const restoredId = await importProjectJSON(backup)
    const restoredBuild = (await db.productBuilds.where('projectId').equals(restoredId).first())!
    expect(restoredBuild.status).toBe(action === 'archive' ? 'archived' : 'cancelled')
    expect(restoredBuild.rootBudgetEvidenceJson).toBe(build.rootBudgetEvidenceJson)
    const restoredSession = (await db.productRuntimeSessions.where('projectId').equals(restoredId).first())!
    expect(restoredSession.stateJson).toBe(preview.stateJson)
    expect(restoredSession.productBuildId).toBe(restoredBuild.id)
    const restoredScope = { projectId: restoredId, worldId: restoredBuild.worldId, workId: restoredBuild.workId }
    await expect(createProductRuntimeInstance({
      scope: restoredScope, kind: 'text-open-world', title: 'forbidden new preview',
      productSource: { kind: 'build', productBuildId: restoredBuild.id!, expectedPreviewHash: restoredBuild.previewHash! },
    })).rejects.toThrow('尚未达到可预览状态')

    const secondRestoredId = await importProjectJSON(await exportProjectJSON(restoredId))
    expect((await db.productBuilds.where('projectId').equals(secondRestoredId).first())!.rootBudgetEvidenceJson)
      .toBe(build.rootBudgetEvidenceJson)
    await expect(verifyStoredProductBuildRootBudgetEvidenceV1({
      scope: restoredScope, build: restoredBuild,
      artifacts: await db.productBuildArtifacts.where('buildId').equals(restoredBuild.id!).toArray(),
    })).rejects.toThrow('历史封存证据不授予当前 Build 权限')

    const countBeforeRejectedImports = await db.projects.count()
    const forged = structuredClone(backup)
    forged.productBuilds[0].status = 'preview-ready'
    await expect(importProjectJSON(forged)).rejects.toThrow()
    const corrupt = structuredClone(backup)
    corrupt.productBuilds[0].rootBudgetEvidenceJson = '{}'
    await expect(importProjectJSON(corrupt)).rejects.toThrow('封存证据合同无效')
    const wrongReceipt = structuredClone(backup)
    wrongReceipt.productBuilds[0].rootTerminalReceiptHash = 'f'.repeat(64)
    await expect(importProjectJSON(wrongReceipt)).rejects.toThrow('历史封存证据回执不匹配')
    const unfinished = structuredClone(backup)
    unfinished.productBuilds[0].status = 'building'
    await expect(importProjectJSON(unfinished)).rejects.toThrow('封存证据出现在非封存 Build')
    expect(await db.projects.count()).toBe(countBeforeRejectedImports)
  },
  30_000,
)
