import { expect, test } from '@playwright/test'

for (const budgetBoundary of ['build-cost', 'source-input'] as const) {
  test(`预算续建在原生 IndexedDB 中原子提交并保留父 Build 账本：${budgetBoundary}`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.addInitScript(() => {
      localStorage.setItem('storyforge_guide_completed', 'text-open-world-budget-recovery-e2e')
    })
    await page.goto('./')
    await expect(page.getByRole('heading', { name: '首页', exact: true })).toBeVisible({ timeout: 20_000 })
    const result = await page.evaluate(async budgetBoundary => {
      const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
      const [
        { db }, { seedCurrentProductWorld }, { seedAuthorizedTextOpenWorldCreatorBuildV1 },
        { createTextOpenWorldProductionExecutorV1 }, { runProductProductionSchedulerCycleV1 },
        { previewTextOpenWorldCreatorBudgetRecoveryV1, authorizeTextOpenWorldCreatorBudgetRecoveryV1,
          setProductProductionPausedV1, readProductProductionTaskEvidenceV1 },
        { carryForwardProductBuildArtifactsAcrossBuildsV1 }, { canonicalProductProductionJsonV2: json },
        { createTextOpenWorldSourceCurationExecutorV1 },
      ] = await Promise.all([
        importer('/storyforge/src/lib/db/schema.ts'),
        importer('/storyforge/tests/helpers/current-product-world.ts'),
        importer('/storyforge/tests/helpers/text-open-world-creator-build.ts'),
        importer('/storyforge/src/lib/open-world/production-executor.ts'),
        importer('/storyforge/src/lib/product-production/scheduler.ts'),
        importer('/storyforge/src/lib/product-production/service.ts'),
        importer('/storyforge/src/lib/product-production/artifact-store.ts'),
        importer('/storyforge/src/lib/product-production/hash.ts'),
        importer('/storyforge/src/lib/open-world/source-curation.ts'),
      ])
      const world = await seedCurrentProductWorld('预算续建原生事务回归')
      const creator = await seedAuthorizedTextOpenWorldCreatorBuildV1({
        source: { kind: 'world-release', scope: world.scope,
          localReleaseRecordId: world.release.id, expectedReleaseHash: world.release.contentHash },
        sessionKey: 'budget-recovery-native-idb',
      })
      const production = await db.productProductions.get(creator.productionId)
      let inputTokens = 0
      let modelCalls = 0
      const source = createTextOpenWorldSourceCurationExecutorV1({ runModel: async (input: any) => {
        modelCalls++
        return { output: '{}', usage: { inputTokens, outputTokens: 1 }, bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: input.requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'test', model: 'test-model', endpointOrigin: 'https://example.invalid',
          executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: 'b'.repeat(64), boundAt: Date.now(), receiptHash: 'a'.repeat(64),
        } }
      } })
      const executor = createTextOpenWorldProductionExecutorV1({ production, brief: creator.start.executionBrief,
        taskExecutors: { 'p1.source-curation': budgetBoundary === 'source-input' ? source
          : async () => { throw new Error('test must not contact a provider') } } })
      const cycleInput = { scope: creator.scope, productionId: creator.productionId, executor,
        capabilityBindings: [{ requirementKey: 'text-open-world.production.text.v1',
          adapterId: 'configured-text-provider.v1', bindingHash: 'b'.repeat(64) }] }
      await runProductProductionSchedulerCycleV1(cycleInput)
      const first = await db.productBuilds.get(creator.buildId)
      let failurePauseResumeVerified = false
      if (budgetBoundary === 'source-input') {
        // A synthetic paid schema failure followed by a real zero-dispatch retry
        // in the same Run, with all authority/ledger writes owned by the scheduler.
        inputTokens = JSON.parse(first.planJson).tasks.find((task: any) => task.taskKey === 'p1.source-curation')
          .budgetReservation.inputTokens - 1
        for (let cycle = 0; cycle < 3; cycle++) {
          if ((await runProductProductionSchedulerCycleV1(cycleInput)).buildStatus === 'recovery-required') break
        }
      } else {
        const ledger = JSON.parse(first.budgetLedgerJson)
        // Isolated test-only historical usage. The real scheduler must produce
        // its own pre-dispatch refusal; this is not real model/acceptance evidence.
        ledger.attempts.push({ taskKey: 'p9.scene-scripts', runId: ledger.rootRunId,
          controlEpoch: 0, attempt: 1, idempotencyKey: 'f'.repeat(64), outcome: 'failed',
          errorCode: 'task-budget-exceeded', usageKnown: true,
          usage: { modelCalls: 1, inputTokens: 1, outputTokens: 1, mediaCalls: 0,
            costUsd: creator.start.executionBrief.productionBudget.maximumCostUsd,
            durationMs: 1, storageBytes: 0 } })
        await db.productBuilds.update(creator.buildId, { budgetLedgerJson: json(ledger) })
        const blocked = await runProductProductionSchedulerCycleV1(cycleInput)
        if (blocked.buildStatus !== 'recovery-required') throw new Error('fixture did not reach the real budget boundary')
      }
      const originalParent = await db.productBuilds.get(creator.buildId)
      const input = { scope: creator.scope, productionId: creator.productionId, buildId: creator.buildId }
      const prepared = await previewTextOpenWorldCreatorBudgetRecoveryV1(input)
      const receipt = await authorizeTextOpenWorldCreatorBudgetRecoveryV1({ prepared })
      const child = await db.productBuilds.where('[productionId+buildNumber]').equals([creator.productionId, 2]).first()
      if (!receipt.ok || !child) throw new Error('native authorization did not commit its child')
      const copied = await carryForwardProductBuildArtifactsAcrossBuildsV1({ scope: creator.scope,
        sourceBuildId: creator.buildId, targetBuildId: child.id, targetControlEpoch: child.controlEpoch,
        artifactKeys: prepared.prefix.artifacts.map((row: any) => row.artifactKey) })
      if (budgetBoundary === 'source-input') {
        await runProductProductionSchedulerCycleV1(cycleInput)
        for (let cycle = 0; cycle < 3; cycle++) {
          if ((await runProductProductionSchedulerCycleV1(cycleInput)).buildStatus === 'recovery-required') break
        }
        const blockedChild = await db.productBuilds.get(child.id)
        const failure = JSON.parse(blockedChild.failureJson)
        if (failure.code !== 'task-draft-rejected' || !failure.detail.includes('P1本次attempt剩余预算')) {
          throw new Error('child did not execute P1 through its derived authority')
        }
        const evidenceInput = { scope: creator.scope, productionId: creator.productionId, taskKey: 'p1.source-curation' }
        const beforeEvidence = await readProductProductionTaskEvidenceV1(evidenceInput)
        for (const expected of ['paused', 'resumed']) {
          const state = await setProductProductionPausedV1({ scope: creator.scope,
            production: await db.productProductions.get(creator.productionId),
            build: await db.productBuilds.get(child.id) })
          if (state !== expected) throw new Error('native failed-Build pause/resume did not commit')
        }
        const resumed = await db.productBuilds.get(child.id)
        const resumedFailure = JSON.parse(resumed.failureJson)
        failurePauseResumeVerified = resumed.status === 'recovery-required'
          && resumedFailure.code === failure.code && resumedFailure.taskKey === failure.taskKey
          && json(resumedFailure.failureProvenance) === json(failure.failureProvenance)
          && resumed.budgetLedgerJson === blockedChild.budgetLedgerJson
          && json(await readProductProductionTaskEvidenceV1(evidenceInput)) === json(beforeEvidence)
          && (await runProductProductionSchedulerCycleV1(cycleInput)).buildStatus === 'recovery-required'
        if (!failurePauseResumeVerified) throw new Error('native recovery lost failure identity, ledger or evidence')
      }
      let staleRejected = false
      try { await authorizeTextOpenWorldCreatorBudgetRecoveryV1({ prepared }) }
      catch { staleRejected = true }
      const commands = await db.productProductionCommands.where('productionId').equals(creator.productionId).toArray()
      return {
        ok: receipt.ok, staleRejected, modelCalls, failurePauseResumeVerified,
        parentUnchanged: json(await db.productBuilds.get(creator.buildId)) === json(originalParent),
        buildCount: await db.productBuilds.where('productionId').equals(creator.productionId).count(),
        currentBuild: (await db.productProductions.get(creator.productionId)).currentBuildNumber,
        successfulAuthorizations: commands.filter((row: any) => row.type === 'authorize-text-open-world-creator-budget-recovery'
          && row.status === 'succeeded').length,
        claimedAuthorizations: commands.filter((row: any) => row.type === 'authorize-text-open-world-creator-budget-recovery'
          && row.status === 'claimed').length,
        carried: copied.length, expectedCarried: prepared.prefix.artifacts.length,
      }
    }, budgetBoundary)
    expect(result).toEqual({ ok: true, staleRejected: true, parentUnchanged: true,
      modelCalls: budgetBoundary === 'source-input' ? 2 : 0,
      failurePauseResumeVerified: budgetBoundary === 'source-input',
      buildCount: 2, currentBuild: 2, successfulAuthorizations: 1, claimedAuthorizations: 0,
      carried: result.expectedCarried, expectedCarried: result.expectedCarried })
    expect(result.carried).toBeGreaterThan(0)
  })
}
