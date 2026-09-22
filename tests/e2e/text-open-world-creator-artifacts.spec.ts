import { expect, test, type Locator, type Page } from '@playwright/test'

interface ArtifactBrowserFixtureV1 {
  productionTitle: string
  regionTitle: string
  regionKey: string
  artifactKey: string
  artifactContentHash: string
  producerRunId: number
}

async function openProductHub(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-open-world-creator-artifacts-e2e')
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./')
  await expect(page.getByRole('heading', { name: '首页', exact: true }))
    .toBeVisible({ timeout: 20_000 })
}

async function seedArtifactBrowserFixture(page: Page): Promise<ArtifactBrowserFixtureV1> {
  return page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [
      { db },
      { seedCurrentProductWorld },
      { seedAuthorizedTextOpenWorldCreatorBuildV1 },
      { canonicalProductProductionJsonV2, hashProductProductionValueV2 },
      { createAgentRunV1, appendAgentRunEventV1 },
      { createAgentRunCheckpointV1 },
      { hashProductProductionTaskCandidateV1, hashProductProductionTaskReceiptV1 },
      { acceptProductBuildArtifact },
    ] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/tests/helpers/current-product-world.ts'),
      importer('/storyforge/tests/helpers/text-open-world-creator-build.ts'),
      importer('/storyforge/src/lib/product-production/hash.ts'),
      importer('/storyforge/src/lib/agent/run/event-store.ts'),
      importer('/storyforge/src/lib/agent/run/checkpoint.ts'),
      importer('/storyforge/src/lib/product-production/task-evidence.ts'),
      importer('/storyforge/src/lib/product-production/artifact-store.ts'),
    ])

    const owned = await seedCurrentProductWorld('G5-05 浏览器 Artifact 验收世界')
    const creator = await seedAuthorizedTextOpenWorldCreatorBuildV1({
      source: {
        kind: 'world-release',
        scope: owned.scope,
        localReleaseRecordId: owned.release.id,
        expectedReleaseHash: owned.release.contentHash,
      },
      sessionKey: 'g5-05-artifact-browser-e2e',
    })

    const productionTitle = '盐脊受治理内容工作台'
    await db.productProductions.update(creator.productionId, { title: productionTitle })
    const build = await db.productBuilds.get(creator.buildId)
    if (!build?.id) throw new Error('G5-05 fixture 缺少已授权 Build')
    const plan = JSON.parse(build.planJson)
    const planHash = build.planHash
    await db.productBuilds.update(build.id, {
      status: 'building',
      stateRevision: build.stateRevision + 1,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    })

    const append = async (snapshot: any, type: string, payload: unknown) => appendAgentRunEventV1({
      scope: owned.scope,
      runId: snapshot.run.id,
      type,
      payload,
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    let root = await createAgentRunV1({
      scope: owned.scope,
      productBuildId: build.id,
      contract: {
        version: 1,
        objective: `负责 ProductBuild ${build.buildNumber} 的浏览器验收 DAG 所有权`,
        workflowKind: 'long-running-resumable',
        scope: {
          projectId: owned.scope.projectId,
          worldGroupId: null,
          productProduction: {
            productBuildId: build.id,
            buildNumber: build.buildNumber,
            controlEpoch: build.controlEpoch,
            planHash,
            taskKey: '$root',
          },
        },
        permissions: { contextSourceKeys: ['product-production.brief'], writeTargets: [] },
        runtimeBindingHash: await hashProductProductionValueV2({
          fixture: 'g5-05-browser-root',
          planHash,
        }),
        dependencyReceiptPolicy: {
          requiredForJoin: true,
          verifierSetVersion: 'product-production-root-v1',
        },
        budget: {
          maxModelCalls: 1,
          maxToolCalls: 0,
          maxInputTokens: 1,
          maxOutputTokens: 1,
          maxAttemptsPerStep: 1,
        },
        acceptance: [
          { id: 'product-production.children', kind: 'deterministic-check', required: true },
          { id: 'product-production.package', kind: 'gate-passed', required: true },
        ],
        verificationPlan: [{
          id: 'product-production.root-terminal',
          kind: 'terminal',
          verifier: 'product-production-root-v1',
          criterionIds: ['product-production.children', 'product-production.package'],
        }],
        failurePolicy: {
          onProtocolError: 'fail',
          onVerificationFailure: 'fail',
          onStaleInput: 'pause-for-author',
        },
      },
    })
    root = await append(root, 'step.scheduled', { stepId: '$join' })
    root = await append(root, 'step.started', { stepId: '$join', attempt: 1 })
    await db.productBuilds.update(build.id, {
      budgetLedgerJson: canonicalProductProductionJsonV2({
        schema: 'storyforge.product-production-budget-ledger',
        version: 2,
        rootRunId: root.run.id,
        rootClaim: null,
        charges: {},
        reservations: {},
        tasks: {},
      }),
      updatedAt: Date.now(),
    })

    const task = plan.tasks.find((item: any) => item.taskKey === 'p4.region-skeleton')
    if (!task || task.outputArtifactKeys.length !== 1) {
      throw new Error('G5-05 fixture 找不到内置 p4.region-skeleton 单输出任务')
    }
    const regionTitle = '盐脊外港'
    const regionKey = 'region.salt-ridge-harbor'
    const payloadBody = {
      schema: 'storyforge.text-open-world-region-skeleton',
      version: 1,
      productType: 'text-open-world',
      productInstanceKey: creator.productionKey,
      createdAt: Date.now(),
      regions: [{
        key: regionKey,
        order: 0,
        title: regionTitle,
        description: '盐雾笼罩的旧港，也是主线逐步展开的第一处地区。',
        theme: '盐雾与旧渠',
        locationKeys: [],
        fastTravelPointKey: null,
        initialKnowledge: '公开',
      }],
      locations: [],
      edges: [],
      fastTravelPoints: [],
    }
    const payload = {
      ...payloadBody,
      regionSkeletonHash: await hashProductProductionValueV2(payloadBody),
    }
    const artifactKey = task.outputArtifactKeys[0]
    const artifact = {
      artifactKey,
      kind: 'text-open-world.region-skeleton',
      payload,
      metadata: { source: 'g5-05-browser-e2e' },
      quality: { validated: true },
      rights: { basis: 'author-owned' },
    }
    const usage = {
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      mediaCalls: 0,
      costUsd: 0,
      durationMs: 1,
      storageBytes: 0,
    }
    const result = {
      artifacts: [artifact],
      passedGateIds: [...task.acceptanceGateIds],
      usage,
    }
    const candidateHash = await hashProductProductionTaskCandidateV1(result)
    const inputHash = await hashProductProductionValueV2({
      fixture: 'g5-05-region-skeleton',
      planHash,
    })

    let child = await createAgentRunV1({
      scope: owned.scope,
      productBuildId: build.id,
      contract: {
        version: 1,
        objective: `执行 ProductBuild ${build.buildNumber} 的任务 ${task.taskKey}`,
        workflowKind: 'long-running-resumable',
        ownership: { parentRunId: root.run.id, relation: `task:${task.taskKey}` },
        scope: {
          projectId: owned.scope.projectId,
          worldGroupId: null,
          productProduction: {
            productBuildId: build.id,
            buildNumber: build.buildNumber,
            controlEpoch: build.controlEpoch,
            planHash,
            taskKey: task.taskKey,
          },
        },
        permissions: { contextSourceKeys: ['product-production.brief'], writeTargets: [] },
        runtimeBindingHash: await hashProductProductionValueV2({
          fixture: 'g5-05-browser-task',
          planHash,
          taskKey: task.taskKey,
        }),
        dependencyReceiptPolicy: {
          requiredForJoin: true,
          verifierSetVersion: 'product-production-task-v1',
        },
        budget: {
          maxModelCalls: Math.max(1, task.budgetReservation.modelCalls),
          maxToolCalls: task.budgetReservation.mediaCalls,
          maxInputTokens: Math.max(1, task.budgetReservation.inputTokens),
          maxOutputTokens: Math.max(1, task.budgetReservation.outputTokens),
          maxAttemptsPerStep: task.maxAttempts,
        },
        acceptance: [
          { id: `${task.taskKey}.output`, kind: 'output-present', required: true },
          { id: `${task.taskKey}.gates`, kind: 'gate-passed', required: true },
        ],
        verificationPlan: [{
          id: `${task.taskKey}.terminal`,
          kind: 'terminal',
          verifier: 'product-production-task-v1',
          criterionIds: [`${task.taskKey}.output`, `${task.taskKey}.gates`],
        }],
        failurePolicy: {
          onProtocolError: task.maxAttempts > 1 ? 'retry' : 'fail',
          onVerificationFailure: 'fail',
          onStaleInput: 'pause-for-author',
        },
      },
    })
    child = await append(child, 'step.scheduled', { stepId: task.taskKey })
    child = await append(child, 'step.started', { stepId: task.taskKey, attempt: 1 })
    child = await append(child, 'candidate.persisted', {
      stepId: task.taskKey,
      attempt: 1,
      candidateHash,
      requiresConfirmation: false,
    })
    const candidate = {
      schema: 'storyforge.product-production-task-candidate',
      version: 1,
      taskKey: task.taskKey,
      attempt: 1,
      controlEpoch: build.controlEpoch,
      inputHash,
      candidateHash,
      result,
    }
    child = (await createAgentRunCheckpointV1({
      scope: owned.scope,
      runId: child.run.id,
      expectedLastSequence: child.projection.lastSequence,
      resumePayload: candidate,
    })).snapshot
    child = await append(child, 'budget.settled', {
      stepId: task.taskKey,
      modelCalls: 0,
      toolCalls: 0,
      tokens: 0,
    })
    child = await append(child, 'step.succeeded', {
      stepId: task.taskKey,
      attempt: 1,
      outputHash: candidateHash,
    })
    child = await append(child, 'verification.started', {
      verifierSetVersion: 'product-production-task-v1',
    })
    const producerReceiptHash = await hashProductProductionTaskReceiptV1({
      taskKey: task.taskKey,
      attempt: 1,
      inputHash,
      candidateHash,
      passedGateIds: result.passedGateIds,
      usage,
      controlEpoch: build.controlEpoch,
    })
    child = await append(child, 'verification.accepted', { receiptHash: producerReceiptHash })

    const accepted = await acceptProductBuildArtifact({
      scope: owned.scope,
      buildId: build.id,
      controlEpoch: build.controlEpoch,
      artifactKey,
      kind: artifact.kind,
      payload,
      metadata: artifact.metadata,
      quality: artifact.quality,
      rights: artifact.rights,
      producerRunId: child.run.id,
      producerReceiptHash,
      inputHash,
    })
    const currentBuild = await db.productBuilds.get(build.id)
    const ledger = JSON.parse(currentBuild.budgetLedgerJson)
    ledger.tasks[task.taskKey] = {
      runId: child.run.id,
      attempt: 1,
      status: 'settled',
      idempotencyKey: inputHash,
      candidateHash,
      terminalReceiptHash: producerReceiptHash,
      passedGateIds: [...task.acceptanceGateIds],
      usage,
      errorCode: null,
    }
    const now = Date.now()
    await db.productBuilds.update(build.id, {
      status: 'paused',
      resumeState: 'building',
      budgetLedgerJson: canonicalProductProductionJsonV2(ledger),
      stateRevision: currentBuild.stateRevision + 1,
      updatedAt: now,
    })
    const currentProduction = await db.productProductions.get(creator.productionId)
    await db.productProductions.update(creator.productionId, {
      title: productionTitle,
      status: 'paused',
      stateRevision: currentProduction.stateRevision + 1,
      updatedAt: now,
    })

    return {
      projectId: owned.scope.projectId,
      productionTitle,
      regionTitle,
      regionKey,
      artifactKey,
      artifactContentHash: accepted.contentHash,
      producerRunId: child.run.id,
    }
  })
}

async function openCreatorProduction(page: Page, projectId: number) {
  await page.goto(`./openworld/runtime?project=${projectId}&mode=production`)
  await expect(page.getByRole('heading', { name: '制作与试玩', exact: true }))
    .toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('product-production-studio')).toBeVisible({ timeout: 30_000 })
  const browser = page.getByTestId('text-open-world-creator-artifact-browser')
  await expect(browser).toBeVisible({ timeout: 30_000 })
  await expect(browser).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
  return browser
}

function rowByText(list: Locator, text: string) {
  return list.getByRole('button').filter({ hasText: text })
}

test('Creator 受治理内容浏览器在桌面与窄屏覆盖内容、Artifact、诊断、搜索和分页', async ({ page }) => {
  test.setTimeout(180_000)
  await openProductHub(page)
  const fixture = await seedArtifactBrowserFixture(page)
  const browser = await openCreatorProduction(page, fixture.projectId)

  await expect(browser.getByRole('heading', { name: fixture.productionTitle, exact: true })).toBeVisible()
  await expect(browser.getByText('生产验证 Artifact', { exact: true }).locator('..')).toContainText('1')
  await expect(browser.getByText('仅完整性 Artifact', { exact: true }).locator('..')).toContainText('0')
  await expect(browser.getByText('实体 / 问题', { exact: true }).locator('..')).toContainText('1 /')

  const contentTab = browser.getByRole('tab', { name: '内容', exact: true })
  await expect(contentTab).toHaveAttribute('aria-selected', 'true')
  const contentList = browser.getByRole('list', { name: '内容实体列表' })
  const regionRow = rowByText(contentList, fixture.regionTitle)
  await expect(regionRow).toBeVisible()
  await regionRow.click()
  const entityDetail = browser.getByTestId('text-open-world-creator-entity-detail')
  await expect(entityDetail).toContainText(fixture.regionTitle)
  await expect(entityDetail).toContainText(fixture.regionKey)
  await expect(entityDetail).toContainText(fixture.artifactKey)
  await expect(entityDetail).toContainText(fixture.artifactContentHash)

  const search = browser.getByRole('searchbox', { name: /安全搜索/ })
  await search.fill('完全不存在的地区')
  await expect(browser.getByText('当前筛选下没有内容。', { exact: true })).toBeVisible()
  await search.fill(fixture.regionTitle)
  await expect(rowByText(browser.getByRole('list', { name: '内容实体列表' }), fixture.regionTitle)).toBeVisible()
  await search.fill('')

  await contentTab.focus()
  await contentTab.press('ArrowRight')
  const artifactTab = browser.getByRole('tab', { name: 'Artifact', exact: true })
  await expect(artifactTab).toBeFocused()
  await expect(artifactTab).toHaveAttribute('aria-selected', 'true')
  await artifactTab.press('End')
  const diagnosticsTab = browser.getByRole('tab', { name: '诊断', exact: true })
  await expect(diagnosticsTab).toBeFocused()
  await expect(diagnosticsTab).toHaveAttribute('aria-selected', 'true')

  await artifactTab.click()
  await browser.locator('label').filter({ hasText: '每页' }).locator('select').selectOption('20')
  let artifactList = browser.getByRole('list', { name: 'Artifact 列表' })
  await expect(artifactList.getByRole('button')).toHaveCount(20)
  const pagination = browser.getByRole('navigation', { name: '受治理内容分页' })
  await expect(pagination.getByRole('button', { name: '上一页', exact: true })).toBeDisabled()
  await expect(pagination.getByRole('button', { name: '下一页', exact: true })).toBeEnabled()
  await pagination.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(browser).toContainText('第 2/')
  await expect(pagination.getByRole('button', { name: '上一页', exact: true })).toBeEnabled()

  await search.fill(fixture.artifactKey)
  artifactList = browser.getByRole('list', { name: 'Artifact 列表' })
  const artifactRow = rowByText(artifactList, fixture.artifactKey)
  await expect(artifactRow).toBeVisible()
  await artifactRow.click()
  const artifactDetail = browser.getByTestId('text-open-world-creator-artifact-detail')
  await expect(artifactDetail).toContainText('生产验证通过')
  await expect(artifactDetail).toContainText('生产 Run')
  await expect(artifactDetail).toContainText(`#${fixture.producerRunId}`)
  await expect(artifactDetail).toContainText(fixture.artifactContentHash)
  await expect(artifactDetail).toContainText('text-open-world.p4.region-skeleton.production-contract.v1')

  await diagnosticsTab.click()
  await search.fill('')
  const diagnosticsList = browser.getByRole('list', { name: 'Artifact 列表' })
  await expect(diagnosticsList.getByRole('button').first()).toBeVisible()
  await expect(diagnosticsList).toContainText('待完成')
  await browser.getByRole('button', { name: '刷新受治理 Artifact 快照' }).click()
  await expect(browser).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
  await expect(browser.getByRole('heading', { name: fixture.productionTitle, exact: true })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await contentTab.click()
  const narrowContentList = browser.getByRole('list', { name: '内容实体列表' })
  const narrowRegionRow = rowByText(narrowContentList, fixture.regionTitle)
  await narrowRegionRow.click()
  await expect(entityDetail).toBeVisible()
  const returnButton = browser.getByRole('button', { name: '返回列表', exact: true })
  await expect(returnButton).toBeVisible()
  const geometry = await browser.evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1)
  await returnButton.click()
  await expect(narrowContentList).toBeVisible()
  await expect(narrowRegionRow).toBeFocused()
})
