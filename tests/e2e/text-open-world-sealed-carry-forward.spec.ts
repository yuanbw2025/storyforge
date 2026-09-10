import { expect, test, type Page } from '@playwright/test'

interface SealedCarryResultV1 {
  carryError: { name: string; message: string } | null
  dagTaskCount: number
  sourceUnitCount: number
  sourceArtifactCount: number
  carriedArtifactCount: number
  storedTargetArtifactCount: number
  digestCallCount: number
  digestInsideTransactionCount: number
  transactionDetectorObserved: boolean
  firstCarriedProofHash: string | null
}

async function openWorkspace(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-open-world-sealed-carry-e2e')
  })
  await page.goto('./')
  await expect(page.getByRole('heading', { name: '你的创作与游玩空间', exact: true }))
    .toBeVisible({ timeout: 20_000 })
}

test('512-unit sealed Build 在原生 IndexedDB 中跨 Build 携带，且 WebCrypto 不进入 Dexie 写事务', async ({ page }) => {
  test.setTimeout(120_000)
  await openWorkspace(page)

  const result = await page.evaluate(async (): Promise<SealedCarryResultV1> => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [
      { db },
      { seedCurrentProductWorld },
      { inspectTextOpenWorldCreatorWorldSourceV1 },
      { startTextOpenWorldCreatorBriefSessionV1 },
      {
        consultProductProductionStartV1,
        compileProductProductionBriefV3,
        beginProductProductionEvolutionV1,
      },
      { executeProductProductionCommand },
      {
        createTextOpenWorldProductionPlanV1,
        textOpenWorldProductionArtifactKindForKeyV1,
      },
      {
        canonicalProductProductionJsonV2,
        hashProductProductionValueV2,
      },
      { parseProductProductionBriefV3 },
      { createProductBuildRootTerminalReceiptV1 },
      { validateTextOpenWorldSourcePinUnitV1 },
      { carryForwardProductBuildArtifactsAcrossBuildsV1 },
      { stampNewRecord },
    ] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/tests/helpers/current-product-world.ts'),
      importer('/storyforge/src/lib/open-world/creator-source.ts'),
      importer('/storyforge/src/lib/open-world/creator-brief.ts'),
      importer('/storyforge/src/lib/product-production/service.ts'),
      importer('/storyforge/src/lib/product-production/commands.ts'),
      importer('/storyforge/src/lib/open-world/production-contract.ts'),
      importer('/storyforge/src/lib/product-production/hash.ts'),
      importer('/storyforge/src/lib/product-production/contracts.ts'),
      importer('/storyforge/src/lib/product-production/receipts.ts'),
      importer('/storyforge/src/lib/open-world/source-pin.ts'),
      importer('/storyforge/src/lib/product-production/artifact-store.ts'),
      importer('/storyforge/src/lib/workspace/scope.ts'),
    ])

    const owned = await seedCurrentProductWorld('G5-05 512-unit sealed carry 浏览器回归')
    const sourcePreview = await inspectTextOpenWorldCreatorWorldSourceV1({
      scope: owned.scope,
      localReleaseRecordId: owned.release.id,
      expectedReleaseHash: owned.release.contentHash,
    })
    const session = await startTextOpenWorldCreatorBriefSessionV1({
      selection: {
        sourceKind: 'world-release',
        sourceScope: owned.scope,
        localReleaseRecordId: owned.release.id,
        expectedReleaseHash: owned.release.contentHash,
        preview: sourcePreview,
      },
      sessionKey: 'g5-05-512-unit-sealed-carry',
    })
    const consultation = await consultProductProductionStartV1({
      scope: owned.scope,
      worldReleaseId: owned.release.id,
    })
    const startingPoint = consultation.suggestions.find((item: any) => (
      item.recommendedProductTypes.includes('text-open-world')
    )) ?? consultation.suggestions[0]
    if (!startingPoint) throw new Error('sealed carry fixture 缺少冻结世界起点')
    const brief = await compileProductProductionBriefV3({
      scope: owned.scope,
      worldReleaseId: owned.release.id,
      suggestionKey: startingPoint.suggestionKey,
      productType: 'text-open-world',
      qualityProfile: 'prototype',
      scale: 'campaign',
      visualLevel: 'none',
      audioLevel: 'none',
      playerRole: '巡盐人',
      openingSituation: '盐井失去回声。',
      coreExperience: ['验证大量冻结来源的生产演进'],
      requiredFacts: ['来源版本不可被静默改写'],
      forbiddenChanges: ['不得把候选内容回写世界引擎'],
      contentBoundaries: ['测试不生成真实叙事内容'],
    })
    const saved = await executeProductProductionCommand({
      scope: owned.scope,
      productionId: session.production.id,
      command: {
        type: 'save-brief-revision',
        commandId: 'g5-05-512-unit-sealed-carry.save',
        expectedStateRevision: session.production.stateRevision,
        parentRevision: null,
        brief,
      },
    })
    if (!saved.ok) throw new Error(`sealed carry fixture 保存 Brief 失败:${saved.errorCode ?? 'unknown'}`)
    const authorized = await executeProductProductionCommand({
      scope: owned.scope,
      productionId: session.production.id,
      command: {
        type: 'authorize-start',
        commandId: 'g5-05-512-unit-sealed-carry.authorize',
        expectedStateRevision: saved.stateRevision,
        briefRevision: saved.result.briefRevision,
        briefHash: saved.result.briefHash,
        authorizationNonce: 'g5-05-512-unit-sealed-carry.author',
      },
    })
    if (!authorized.ok) throw new Error(`sealed carry fixture 授权失败:${authorized.errorCode ?? 'unknown'}`)
    const sourceBuild = await db.productBuilds.get(authorized.result.buildId)
    if (!sourceBuild?.id) throw new Error('sealed carry fixture 缺少来源 Build')

    const sourceUnitArtifactKeys = Array.from({ length: 512 }, (_, index) => index === 0
      ? 'text-open-world.source-pin-unit'
      : `text-open-world.source-pin-unit.${String(index + 1).padStart(5, '0')}`)
    const plan = await createTextOpenWorldProductionPlanV1({
      buildNumber: sourceBuild.buildNumber,
      controlEpoch: sourceBuild.controlEpoch,
      briefHash: saved.result.briefHash,
      brief,
      sourceUnitArtifactKeys,
      sourceTotalChars: 0,
      mediaCostAuthorized: false,
    })
    const planJson = canonicalProductProductionJsonV2(plan)
    const planHash = await hashProductProductionValueV2(plan)

    // This fixture is deliberately about the portable sealed-Build proof, not
    // paid content generation. Use the real Creator production and exact
    // production Plan, then materialize every declared output and task-ledger
    // member. The carry boundary itself rejects any incomplete Plan/manifest/
    // ledger/root-receipt closure before it is allowed to write the successor.
    const zeroUsage = {
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      mediaCalls: 0,
      costUsd: 0,
      durationMs: 0,
      storageBytes: 0,
    }
    const ledgerEntries = await Promise.all(plan.tasks.map(async (task: any, taskIndex: number) => {
      const idempotencyKey = await hashProductProductionValueV2({
        fixture: 'g5-05-512-unit-sealed-carry.input',
        taskKey: task.taskKey,
      })
      const candidateHash = await hashProductProductionValueV2({
        fixture: 'g5-05-512-unit-sealed-carry.candidate',
        taskKey: task.taskKey,
      })
      const terminalReceiptHash = await hashProductProductionValueV2({
        fixture: 'g5-05-512-unit-sealed-carry.receipt',
        taskKey: task.taskKey,
      })
      return [task.taskKey, {
        runId: taskIndex + 1,
        attempt: 1,
        status: 'settled',
        idempotencyKey,
        candidateHash,
        terminalReceiptHash,
        passedGateIds: [...task.acceptanceGateIds],
        usage: zeroUsage,
        errorCode: null,
      }] as const
    }))
    const ledgerTasks = Object.fromEntries(ledgerEntries)
    const budgetLedgerJson = canonicalProductProductionJsonV2({
      schema: 'storyforge.product-production-budget-ledger',
      version: 2,
      rootRunId: 1,
      rootClaim: null,
      charges: {},
      reservations: {},
      tasks: ledgerTasks,
    })

    const unitPayloads = await Promise.all(sourceUnitArtifactKeys.map(async (artifactKey, index) => {
      const sourceContentHash = await hashProductProductionValueV2(`resource.${String(index + 1).padStart(5, '0')}`)
      const payload = {
        schema: 'storyforge.text-open-world-source-pin-unit',
        version: 1,
        productInstanceKey: session.production.productionKey,
        sourceKind: 'world-release',
        unitKey: `world-resource.${String(index + 1).padStart(5, '0')}`,
        artifactKey,
        kind: 'world-resource',
        label: `冻结资源 ${index + 1}`,
        order: index,
        partIndex: 1,
        partCount: 1,
        readDepth: 'index',
        sourceResourceKey: `resource.${String(index + 1).padStart(5, '0')}`,
        sourceArea: 'foundation',
        sourceResourceKind: 'sealed-carry-fixture',
        sourceContentHash,
        contentText: null,
        charCount: 0,
        wordCount: 0,
        capturedAt: 1,
      }
      return validateTextOpenWorldSourcePinUnitV1(payload)
    }))
    const unitPayloadByKey = new Map(unitPayloads.map((payload: any) => [payload.artifactKey, payload]))
    const runtimePackagePayload = {
      schema: 'storyforge.g5-05-sealed-carry-runtime-fixture',
      version: 1,
      sourceUnitCount: sourceUnitArtifactKeys.length,
    }
    const packageHash = await hashProductProductionValueV2(runtimePackagePayload)
    const quality = {
      schema: 'storyforge.product-build-quality-report',
      version: 1,
      buildNumber: sourceBuild.buildNumber,
      packageHash,
      hardGateResults: [{
        gateId: 'g5-05.sealed-carry-fixture',
        passed: true,
        evidence: [packageHash],
      }],
      softGateResults: [],
      mediaCoverage: 1,
      playable: true,
      releaseReady: true,
      warnings: ['仅验证封存证据与跨 Build 携带，不表示叙事质量通过。'],
    }
    const qualityReportJson = canonicalProductProductionJsonV2(quality)
    const qualityReportHash = await hashProductProductionValueV2(quality)
    const ownerByArtifactKey = new Map<string, any>()
    for (const task of plan.tasks) {
      for (const artifactKey of task.outputArtifactKeys) ownerByArtifactKey.set(artifactKey, task)
    }
    const artifactRows = await Promise.all([...ownerByArtifactKey].map(async ([artifactKey, ownerTask]) => {
      const payload = unitPayloadByKey.get(artifactKey)
        ?? (artifactKey === 'text-open-world.runtime-package'
          ? runtimePackagePayload
          : artifactKey === 'text-open-world.quality-report'
            ? quality
            : {
                schema: 'storyforge.g5-05-sealed-carry-artifact-fixture',
                version: 1,
                artifactKey,
                ownerTaskKey: ownerTask.taskKey,
              })
      const payloadJson = canonicalProductProductionJsonV2(payload)
      const contentHash = artifactKey === 'text-open-world.runtime-package'
        ? packageHash
        : artifactKey === 'text-open-world.quality-report'
          ? qualityReportHash
          : await hashProductProductionValueV2(payload)
      return stampNewRecord(owned.scope, 'productBuildArtifacts', {
        ...owned.scope,
        buildId: sourceBuild.id,
        artifactKey,
        requirementKey: artifactKey.startsWith('text-open-world.source-pin-unit')
          ? 'text-open-world.source-pin'
          : null,
        version: 1,
        kind: textOpenWorldProductionArtifactKindForKeyV1(artifactKey),
        mediaKind: null,
        status: 'accepted',
        producerRunId: null,
        producerReceiptHash: ledgerTasks[ownerTask.taskKey].terminalReceiptHash,
        controlEpoch: sourceBuild.controlEpoch,
        inputHash: ledgerTasks[ownerTask.taskKey].idempotencyKey,
        contentHash,
        payloadJson,
        metadataJson: '{}',
        qualityJson: '{}',
        rightsJson: '{}',
        blobObjectId: null,
        mimeType: null,
        byteSize: new TextEncoder().encode(payloadJson).byteLength,
        parentArtifactHash: null,
        carriedFrom: null,
        createdAt: 1,
        updatedAt: 1,
      }, { owner: 'work' })
    }))
    artifactRows.sort((left: any, right: any) => left.artifactKey.localeCompare(right.artifactKey))
    await db.productBuildArtifacts.bulkAdd(artifactRows)

    const artifactReceipts = artifactRows.map((row: any) => ({
      artifactKey: row.artifactKey,
      version: row.version,
      contentHash: row.contentHash,
      producerReceiptHash: row.producerReceiptHash,
    }))
    const manifest = {
      schema: 'storyforge.product-build-manifest',
      version: 1,
      productionKey: session.production.productionKey,
      buildNumber: sourceBuild.buildNumber,
      briefRevision: sourceBuild.briefRevision,
      briefHash: sourceBuild.briefHash,
      planHash,
      controlEpoch: sourceBuild.controlEpoch,
      runtimePackageHash: packageHash,
      artifactReceipts,
      completedGateIds: [...new Set(plan.tasks.flatMap((task: any) => task.acceptanceGateIds))].sort(),
      fallbackSummary: [],
    }
    const manifestJson = canonicalProductProductionJsonV2(manifest)
    const manifestHash = await hashProductProductionValueV2(manifest)
    const rootTerminalReceiptHash = await createProductBuildRootTerminalReceiptV1({
      planHash,
      manifestHash,
      packageHash,
      qualityReportHash,
      controlEpoch: sourceBuild.controlEpoch,
      budgetLedgerJson,
      artifacts: artifactRows,
    })
    await db.productBuilds.update(sourceBuild.id, {
      status: 'release-ready',
      planRevision: 1,
      planJson,
      planHash,
      budgetLedgerJson,
      manifestJson,
      manifestHash,
      packageHash,
      qualityReportJson,
      qualityReportHash,
      rootTerminalReceiptHash,
      completedAt: 2,
      updatedAt: 2,
    })
    await db.productProductions.update(session.production.id, {
      status: 'preview-ready',
      updatedAt: 2,
    })

    const sealedSourceBuild = await db.productBuilds.get(sourceBuild.id)
    if (!sealedSourceBuild) throw new Error('sealed carry fixture 来源 Build 封存后消失')
    const evolution = await beginProductProductionEvolutionV1({
      scope: owned.scope,
      productionId: session.production.id,
      userText: '仅验证完整父 Build 的可移植复用证明，不改写冻结来源。',
      affectedLanes: ['product'],
    })
    const evolvedProduction = await db.productProductions.get(session.production.id)
    const evolvedBriefRow = await db.productProductionBriefs
      .where('[productionId+revision]')
      .equals([session.production.id, evolution.briefRevision])
      .first()
    if (!evolvedProduction || !evolvedBriefRow) throw new Error('sealed carry fixture 缺少演化 Brief')
    const targetAuthorization = await executeProductProductionCommand({
      scope: owned.scope,
      productionId: session.production.id,
      command: {
        type: 'authorize-start',
        commandId: 'g5-05-512-unit-sealed-carry.authorize-target',
        expectedStateRevision: evolvedProduction.stateRevision,
        briefRevision: evolvedBriefRow.revision,
        briefHash: evolvedBriefRow.briefHash,
        authorizationNonce: 'g5-05-512-unit-sealed-carry.target-author',
      },
    })
    if (!targetAuthorization.ok) throw new Error('sealed carry fixture 目标 Build 授权失败')
    const targetBuildId = targetAuthorization.result.buildId as number
    const targetBuild = await db.productBuilds.get(targetBuildId)
    if (!targetBuild?.id) throw new Error('sealed carry fixture 缺少目标 Build')
    const targetControlEpoch = targetBuild.controlEpoch
    const evolvedBrief = parseProductProductionBriefV3(evolvedBriefRow.briefJson)
    const targetPlanBase = await createTextOpenWorldProductionPlanV1({
      buildNumber: targetBuild.buildNumber,
      controlEpoch: targetBuild.controlEpoch,
      briefHash: evolvedBriefRow.briefHash,
      brief: evolvedBrief,
      sourceUnitArtifactKeys,
      sourceTotalChars: 0,
      mediaCostAuthorized: false,
    })
    const sourceArtifactByKey = new Map(artifactRows.map((row: any) => [row.artifactKey, row]))
    const targetTasks = await Promise.all(targetPlanBase.tasks.map(async (task: any) => {
      const taskSources = task.outputArtifactKeys.map((artifactKey: string) => sourceArtifactByKey.get(artifactKey))
      if (taskSources.some((row: any) => !row)) {
        throw new Error(`sealed carry fixture 目标 task 缺少来源 sibling:${task.taskKey}`)
      }
      const reuseKey = await hashProductProductionValueV2({
        schema: 'storyforge.product-production-cross-build-reuse',
        version: 1,
        sourceBuildNumber: sealedSourceBuild.buildNumber,
        targetBuildNumber: targetBuild.buildNumber,
        taskKey: task.taskKey,
        userImpact: evolvedBrief.evolution.affectedLanes,
        artifacts: taskSources.map((row: any) => ({
          artifactKey: row.artifactKey,
          contentHash: row.contentHash,
        })),
      })
      return {
        ...task,
        reuse: {
          sourceBuildNumber: sealedSourceBuild.buildNumber,
          sourceArtifactKey: taskSources[0].artifactKey,
          sourceContentHash: taskSources[0].contentHash,
          reuseKey,
          requiresRevalidation: true,
          reason: '浏览器夹具显式冻结完整 task sibling 复用证明',
        },
      }
    }))
    const targetPlan = { ...targetPlanBase, tasks: targetTasks }
    const targetPlanJson = canonicalProductProductionJsonV2(targetPlan)
    const targetPlanHash = await hashProductProductionValueV2(targetPlan)
    await db.productBuilds.update(targetBuild.id, {
      planJson: targetPlanJson,
      planHash: targetPlanHash,
      planRevision: 1,
      updatedAt: 3,
    })

    const DexieConstructor = db.constructor as typeof db.constructor & {
      currentTransaction?: unknown
    }
    // Prove the detector observes this exact Dexie instance before relying on
    // it to police the production call below.
    let transactionDetectorObserved = false
    await db.transaction('r', db.productBuilds, async () => {
      transactionDetectorObserved = Boolean(DexieConstructor.currentTransaction)
      await db.productBuilds.get(sourceBuild.id)
    })

    const subtle = crypto.subtle
    const nativeDigest = subtle.digest.bind(subtle)
    let digestCallCount = 0
    let digestInsideTransactionCount = 0
    const instrumentedDigest = async (algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> => {
      digestCallCount += 1
      if (DexieConstructor.currentTransaction) {
        digestInsideTransactionCount += 1
        throw new Error('g5-05-webcrypto-inside-dexie-transaction')
      }
      return nativeDigest(algorithm, data)
    }
    Object.defineProperty(subtle, 'digest', {
      configurable: true,
      value: instrumentedDigest,
    })

    let carried: any[] = []
    let carryError: SealedCarryResultV1['carryError'] = null
    try {
      carried = await carryForwardProductBuildArtifactsAcrossBuildsV1({
        scope: owned.scope,
        sourceBuildId: sourceBuild.id,
        targetBuildId,
        targetControlEpoch,
        artifactKeys: artifactRows.map((row: any) => row.artifactKey),
      })
    } catch (error) {
      carryError = {
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
      }
    } finally {
      Object.defineProperty(subtle, 'digest', {
        configurable: true,
        value: nativeDigest,
      })
    }

    return {
      carryError,
      dagTaskCount: plan.tasks.length,
      sourceUnitCount: artifactRows.filter((row: any) => row.kind === 'text-open-world.source-pin-unit').length,
      sourceArtifactCount: artifactRows.length,
      carriedArtifactCount: carried.length,
      storedTargetArtifactCount: await db.productBuildArtifacts.where('buildId').equals(targetBuildId).count(),
      digestCallCount,
      digestInsideTransactionCount,
      transactionDetectorObserved,
      firstCarriedProofHash: carried[0]?.carriedFrom?.proofHash ?? null,
    }
  })

  expect(result.transactionDetectorObserved).toBe(true)
  expect(result.dagTaskCount).toBeGreaterThan(20)
  expect(result.sourceUnitCount).toBe(512)
  expect(result.sourceArtifactCount).toBeGreaterThan(512)
  expect(result.carryError).toBeNull()
  expect(result.carriedArtifactCount).toBe(result.sourceArtifactCount)
  expect(result.storedTargetArtifactCount).toBe(result.sourceArtifactCount)
  expect(result.digestCallCount).toBeGreaterThan(result.sourceArtifactCount * 4)
  expect(result.digestInsideTransactionCount).toBe(0)
  expect(result.firstCarriedProofHash).toMatch(/^[a-f0-9]{64}$/)
})
