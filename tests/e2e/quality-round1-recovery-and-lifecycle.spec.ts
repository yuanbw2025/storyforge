/** Isolated round1 recovery and lifecycle regressions.
 * Never run against a user's browser profile. Uses Playwright's fresh context,
 * an explicitly loopback Vite server and synthetic data; no actual provider.
 * Case 1 drives real ScreenplayPipelinePanel controls. Case 2 intentionally
 * calls public lifecycle APIs in real browser IndexedDB, not deletion UI.
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { WorkspaceScope } from '../../src/lib/types'

test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' })
const STOP = 'SFQA017_BROWSER_STOP_BEFORE_CONFIRMATION'
const AUTHOR_FACT = '作者逐字确认：检票员把车票放进抽屉。\n他没有丢弃车票。'
const AUTHOR_BEAT = '作者确认的重新规划：检票员留下车票。'

async function attachJSON(info: TestInfo, name: string, value: unknown) {
  await info.attach(name, { body: Buffer.from(JSON.stringify(value, null, 2)), contentType: 'application/json' })
}

async function installOfflineBoundary(page: Page, baseURL: string | undefined) {
  if (!baseURL || !/^http:\/\/127\.0\.0\.1:\d+\/storyforge\/$/.test(baseURL)) {
    throw new Error('This draft requires an isolated loopback StoryForge test server')
  }
  const origin = new URL(baseURL).origin
  const state = { calls: 0, mode: 'facts', beats: [] as unknown[], blocked: [] as string[] }
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin === origin && ['GET', 'HEAD'].includes(route.request().method())) return route.continue()
    if (url.origin !== 'https://quality-round1.invalid') {
      state.blocked.push(url.origin)
      return route.abort('blockedbyclient')
    }
    state.calls++
    const body = JSON.stringify(route.request().postDataJSON())
    const key = body.match(/asu_[A-Za-z0-9_-]{8,64}/)?.[0]
    if (!key) throw new Error('Registered screenplay prompt did not contain a real frozen source unit')
    const facts = [
      { stableKey: 'fact.ticket', kind: 'event', statement: '模型提案：检票员丢弃车票。', subjectKeys: [], sourceUnitKeys: [key], confidence: 1 },
      { stableKey: 'fact.excluded', kind: 'event', statement: '作者排除的模型提案。', subjectKeys: [], sourceUnitKeys: [key], confidence: 1 },
      { stableKey: 'fact.drawer', kind: 'event', statement: '抽屉仍在检票室内。', subjectKeys: [], sourceUnitKeys: [key], confidence: 1 },
    ]
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      choices: [{ message: { role: 'assistant', content: JSON.stringify(state.mode === 'facts' ? facts : state.beats) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
    }) })
  })
  await page.addInitScript(expectedOrigin => {
    if (location.origin === expectedOrigin) localStorage.setItem('storyforge_guide_completed', 'e2e')
  }, origin)
  return state
}

/** Real IndexedDB failure, not fabricated intent/checkpoint/event bytes.
 * The actual UI accept path first saves the actual author's intent, then this
 * one-shot hook aborts only its next confirmation append transaction. Reload
 * creates a fresh module instance, so the test fault cannot affect recovery.
 */
async function interruptNextConfirmation(page: Page, workId: number, stage: string) {
  return page.evaluate(async ({ workId, stage, stop }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, production] = await Promise.all([
      load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/screenplay/durable-production.ts'),
    ])
    const root = await db.adaptationProjects.where('workId').equals(workId).first()
    if (!root) throw new Error('Synthetic screenplay root is missing')
    const scope = { projectId: root.projectId, worldId: root.worldId, workId }
    const pending = await production.readPendingScreenplayProfessionalCandidateV1(scope)
    if (!pending || pending.candidate.stage !== stage) throw new Error('Unexpected pending screenplay candidate')
    const runId = pending.snapshot.run.id
    const failOnce = (_key: unknown, row: { runId: number; type: string }) => {
      if (row.runId !== runId || row.type !== 'confirmation.recorded') return
      db.agentRunEvents.hook.creating.unsubscribe(failOnce)
      throw new Error(stop)
    }
    db.agentRunEvents.hook('creating', failOnce)
    return runId
  }, { workId, stage, stop: STOP })
}

async function readScreenplayState(page: Page, workId: number, runId: number) {
  return page.evaluate(async ({ workId, runId }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, { readAgentRunV1 }, { readLatestVerifiedAgentRunCheckpointV1 }] = await Promise.all([
      load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/agent/run/event-store.ts'), load('/storyforge/src/lib/agent/run/checkpoint.ts'),
    ])
    const root = await db.adaptationProjects.where('workId').equals(workId).first()
    if (!root) throw new Error('Synthetic screenplay root is missing')
    const scope = { projectId: root.projectId, worldId: root.worldId, workId }
    const snapshot = await readAgentRunV1(scope, runId)
    const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
    return {
      status: snapshot.projection.state, events: snapshot.events, receiptHash: snapshot.projection.terminalReceiptHash,
      intent: checkpoint?.resumePayload, checkpoints: await db.agentRunCheckpoints.where('runId').equals(runId).count(),
      facts: await db.adaptationSourceFacts.where('adaptationProjectId').equals(root.id).toArray(),
      beats: await db.screenplayBeats.where('adaptationProjectId').equals(root.id).toArray(),
      cards: await db.screenplaySceneCards.where('adaptationProjectId').equals(root.id).toArray(),
      scenes: await db.screenplayScenes.where('adaptationProjectId').equals(root.id).toArray(),
      sourceBytes: JSON.stringify(await db.adaptationSourceUnits.where('adaptationProjectId').equals(root.id).toArray()),
    }
  }, { workId, runId })
}

async function recoverThroughPanel(page: Page) {
  await page.reload()
  const tasks = page.locator('.screenplay-pipeline .sp-tasks')
  await expect(tasks).toContainText('等待恢复采纳')
  await tasks.locator('summary').click()
  await tasks.getByRole('button', { name: '恢复采纳', exact: true }).click()
}

function expectCompletedOnce(before: Awaited<ReturnType<typeof readScreenplayState>>, after: Awaited<ReturnType<typeof readScreenplayState>>) {
  expect(after.status).toBe('completed')
  expect(after.receiptHash).toMatch(/^[a-f0-9]{64}$/)
  expect(after.intent).toEqual(before.intent)
  expect(after.checkpoints).toBe(before.checkpoints)
  expect(after.events.slice(0, before.events.length)).toEqual(before.events)
  for (const type of ['confirmation.recorded', 'adoption.started', 'adoption.committed', 'verification.accepted']) {
    expect(after.events.filter((event: { type: string }) => event.type === type)).toHaveLength(1)
  }
  expect(after.sourceBytes).toBe(before.sourceBytes)
}

test('round1 UI: frozen screenplay edits, excluded fact and replacement authorization survive refresh/recovery', async ({ page, baseURL }, info) => {
  test.setTimeout(120_000)
  const transport = await installOfflineBoundary(page, baseURL)
  await page.goto('./script/library?create=1')
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { useAIConfigStore } = await load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts')
    useAIConfigStore.getState().setConfig({ provider: 'openai', baseUrl: 'https://quality-round1.invalid/v1', model: 'gpt-4o',
      apiKey: 'SYNTHETIC_ROUND1_ISOLATED_TEST_KEY', temperature: 0.2, maxTokens: 4000 })
  })
  await page.getByLabel('剧本名称', { exact: true }).fill('SFQA017 isolated browser screenplay')
  await page.getByLabel('来源方式', { exact: true }).selectOption('import')
  await page.getByLabel('导入原作内容').fill('清晨，检票员发现一张没有目的地的车票，并把它放进抽屉。抽屉仍在检票室内。')
  await page.getByLabel('单集目标分钟', { exact: true }).fill('2')
  await page.getByRole('button', { name: '冻结来源并创建剧本', exact: true }).click()
  await expect(page).toHaveURL(/script\/source\?work=\d+/)
  const workId = Number(new URL(page.url()).searchParams.get('work'))
  expect(Number.isSafeInteger(workId) && workId > 0).toBe(true)
  await page.getByRole('button', { name: /1 来源事实/ }).click()
  const candidate = page.locator('.screenplay-professional-candidate')
  await expect(candidate).toBeVisible()
  await candidate.locator('.screenplay-candidate-items input').nth(1).uncheck()
  await candidate.getByLabel('第1项 原作事实', { exact: true }).fill(AUTHOR_FACT)
  const factRunId = await interruptNextConfirmation(page, workId, 'source-analysis')
  await candidate.getByRole('button', { name: '作者确认并采纳', exact: true }).click()
  await expect(page.locator('.screenplay-pipeline-error')).toContainText(STOP)
  const factBefore = await readScreenplayState(page, workId, factRunId)
  expect(factBefore.status).toBe('awaiting_confirmation')
  expect(factBefore.facts).toEqual([])
  expect(factBefore.intent.kind).toBe('screenplay-professional-intent')
  expect(factBefore.intent.authorPayload.map((row: { stableKey: string }) => row.stableKey)).toEqual(['fact.ticket', 'fact.drawer'])
  expect(factBefore.intent.authorPayload[0].statement).toBe(AUTHOR_FACT)
  expect(factBefore.events.some((row: { type: string }) => row.type === 'confirmation.recorded')).toBe(false)
  expect(transport.calls).toBe(1)
  await attachJSON(info, '017-source-intent-before-recovery', factBefore)
  await recoverThroughPanel(page)
  await expect.poll(async () => (await readScreenplayState(page, workId, factRunId)).status).toBe('completed')
  const factAfter = await readScreenplayState(page, workId, factRunId)
  expectCompletedOnce(factBefore, factAfter)
  expect(factAfter.facts.map((row: { stableKey: string }) => row.stableKey).sort()).toEqual(['fact.drawer', 'fact.ticket'])
  expect(factAfter.facts.find((row: { stableKey: string }) => row.stableKey === 'fact.ticket')?.statement).toBe(AUTHOR_FACT)
  expect(factAfter.facts.find((row: { stableKey: string }) => row.stableKey === 'fact.drawer')?.statement).toBe('抽屉仍在检票室内。')
  expect(transport.calls).toBe(1)
  await attachJSON(info, '017-source-intent-after-recovery', factAfter)

  // Deterministic public-domain setup mirrors screenplay-production.spec.ts.
  // No model is invoked for these already-confirmed synthetic plan fixtures.
  transport.beats = await page.evaluate(async workId => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, source, analysis, production, scenes] = await Promise.all([
      load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/adaptation/source-manifest.ts'),
      load('/storyforge/src/lib/adaptation/analysis.ts'), load('/storyforge/src/lib/screenplay/production.ts'), load('/storyforge/src/lib/screenplay/service.ts'),
    ])
    let root = await db.adaptationProjects.where('workId').equals(workId).first()
    const scope = { projectId: root.projectId, worldId: root.worldId, workId }
    const fact = await db.adaptationSourceFacts.where('adaptationProjectId').equals(root.id).filter((row: { stableKey: string }) => row.stableKey === 'fact.ticket').first()
    const unit = (await source.listActiveSourceUnits(root.id)).find((row: { sourceUnitKey: string }) => row.sourceUnitKey === fact?.sourceUnitKeys[0])
    if (!unit) throw new Error('The confirmed fact must bind a real active source unit')
    await analysis.adoptAdaptationCausalEdgesV1({ scope, adaptationProjectId: root.id, expectedAdaptationRevision: root.revision,
      sourceManifestVersion: root.activeSourceManifestVersion, items: [{ authorStatus: 'confirmed', candidate: {
        stableKey: 'edge.ticket', fromFactKey: 'fact.ticket', toFactKey: 'fact.drawer', relation: 'enables', rationale: '保留车票使物件留在抽屉中。', sourceUnitKeys: [unit.sourceUnitKey],
      } }] })
    root = await db.adaptationProjects.get(root.id)
    root = await source.saveAdaptationBriefDraft({ adaptationProjectId: root.id, expectedRevision: root.revision, brief: {
      version: 1, coreTheme: '保留一个选择', dominantEmotion: '克制', mustKeep: ['车票'], mayCut: [], mayMerge: [], mayReorder: [], allowedAdditions: [],
      audience: '成年观众', rating: 'PG-13', targetScale: '两分钟短片', narrativePerspective: '检票员', timeBudget: '两分钟', costLimit: '单场景', deviationNotes: '', unresolvedQuestions: [], assumptions: [],
    } })
    root = await source.confirmAdaptationBrief({ adaptationProjectId: root.id, expectedRevision: root.revision })
    await analysis.adoptAdaptationDecisionsV1({ scope, adaptationProjectId: root.id, expectedAdaptationRevision: root.revision,
      sourceManifestVersion: root.activeSourceManifestVersion, items: [{ authorStatus: 'confirmed', candidate: {
        stableKey: 'decision.keep', action: 'keep', sourceFactKeys: ['fact.ticket'], targetKeys: [], rationale: '保留这个选择。',
      } }] })
    root = await db.adaptationProjects.get(root.id)
    const beat = { stableKey: 'beat.ticket', sectionKey: 'act-one', sectionTitle: '车票', scope: 'act', episodeNumber: 1, order: 0,
      objective: '旧规划：把车票放进抽屉。', conflict: '列车将离站。', turn: '收回丢弃的手。', outcome: '车票留在抽屉。',
      causalFactKeys: ['fact.ticket', 'fact.drawer'], decisionKeys: ['decision.keep'], sourceUnitKeys: [unit.sourceUnitKey], estimatedSeconds: 120 }
    await production.adoptScreenplayBeatsV1({ scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, candidates: [beat] })
    root = await db.adaptationProjects.get(root.id)
    await production.adoptScreenplaySceneCardsV1({ scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, candidates: [{
      stableKey: 'scene.ticket', beatKey: beat.stableKey, episodeNumber: 1, sceneNumber: 1, order: 0, purpose: '可见地保留车票。', conflict: '离站广播催促。',
      entryState: '车票在桌上。', exitState: '车票在抽屉中。', visibleAction: '检票员收好车票。', informationReveal: '他主动留下车票。', sourceUnitKeys: [unit.sourceUnitKey], estimatedSeconds: 120,
    }] })
    root = await db.adaptationProjects.get(root.id)
    await production.startScreenplayProductionV1({ scope, expectedAdaptationRevision: root.revision })
    await scenes.createScreenplayScene(scope, { stableKey: 'scene.ticket', planSectionKey: beat.sectionKey, episodeNumber: 1, sceneNumber: 1,
      intExt: 'INT', location: '检票室', timeOfDay: '清晨', summary: '检票员保留车票。', estimatedSeconds: 120, sourceUnitIds: [unit.id],
      blocks: [{ id: 'action.ticket', type: 'action', text: '检票员把车票放进抽屉。' }],
    })
    return [{ ...beat, objective: '模型重规划提案。' }]
  }, workId)
  transport.mode = 'beats'
  await page.getByRole('navigation', { name: '剧本页面导航', exact: true }).getByRole('button', { name: '结构与节拍', exact: true }).click()
  await page.reload() // Actual mounted panel must read the newly prepared public-domain state.
  await page.getByRole('button', { name: /5 Beat Sheet/ }).click()
  await expect(candidate).toBeVisible()
  await candidate.getByLabel('第1项 叙事目标', { exact: true }).fill(AUTHOR_BEAT)
  const beatRunId = await interruptNextConfirmation(page, workId, 'beat-sheet')
  await candidate.getByRole('button', { name: '作者确认并采纳', exact: true }).click()
  const backupEvent = page.waitForEvent('download')
  await page.getByRole('dialog').getByRole('button', { name: '备份并替换', exact: true }).click()
  const backup = await backupEvent
  await backup.saveAs(info.outputPath('017-before-authorized-replan.json'))
  await expect(page.locator('.screenplay-pipeline-error')).toContainText(STOP)
  const beatBefore = await readScreenplayState(page, workId, beatRunId)
  expect(beatBefore.status).toBe('awaiting_confirmation')
  expect(beatBefore.intent.allowReplaceDownstream).toBe(true)
  expect(beatBefore.intent.authorPayload[0].objective).toBe(AUTHOR_BEAT)
  expect(beatBefore.cards).toHaveLength(1)
  expect(beatBefore.scenes).toHaveLength(1)
  expect(transport.calls).toBe(2)
  await attachJSON(info, '017-replan-intent-and-old-downstream', beatBefore)
  await recoverThroughPanel(page)
  await expect.poll(async () => (await readScreenplayState(page, workId, beatRunId)).status).toBe('completed')
  const beatAfter = await readScreenplayState(page, workId, beatRunId)
  expectCompletedOnce(beatBefore, beatAfter)
  expect(beatAfter.beats).toHaveLength(1)
  expect(beatAfter.beats[0].objective).toBe(AUTHOR_BEAT)
  expect(beatAfter.cards).toEqual([])
  expect(beatAfter.scenes).toEqual([])
  expect(transport.calls).toBe(2) // Recovery must not dispatch another mock model call either.
  await page.reload()
  const readback = await readScreenplayState(page, workId, beatRunId)
  expect(readback.intent).toEqual(beatAfter.intent)
  expect(readback.beats).toEqual(beatAfter.beats)
  expect(readback.events).toEqual(beatAfter.events)
  await expect(page.getByRole('button', { name: '恢复采纳', exact: true })).toHaveCount(0)
  await attachJSON(info, '017-replan-final-readback', readback)
  expect(transport.blocked).toEqual([])
})

test('round1 browser API: deleting Work/World removes native-key original text and preserves other owners', async ({ page, baseURL }, info) => {
  const transport = await installOfflineBoundary(page, baseURL)
  await page.goto('./script/library')
  for (const owner of ['work', 'world'] as const) {
    const result = await page.evaluate(async owner => {
      const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
      const [{ db }, { createWorkspace }, works, { stampNewRecord }, { createReferenceAnalysisRun }, { generateWorkspaceScopeCode }] = await Promise.all([
        load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/workspace/create-workspace.ts'), load('/storyforge/src/lib/workspace/works.ts'),
        load('/storyforge/src/lib/workspace/scope.ts'), load('/storyforge/src/lib/reference-analysis/lifecycle.ts'), load('/storyforge/src/lib/workspace/identity.ts'),
      ])
      const create = (name: string) => createWorkspace({ name, description: '', genres: ['other'], status: 'drafting', targetWordCount: 100000 }, { kind: 'novel', novelProfile: 'long' })
      const target = await create(`014 browser ${owner} target`)
      const sibling = await works.createWorldWork(target.scope.projectId, { title: 'same-world survivor' })
      const now = Date.now()
      const worldId = await db.worlds.add({ projectId: target.scope.projectId, identityKind: 'workspace-scope', code: generateWorkspaceScopeCode(now), name: 'other World', description: '', currentVersion: 0, createdAt: now, updatedAt: now })
      const otherWork = works.buildWorkRecord({ projectId: target.scope.projectId, worldId, fallback: target.work, create: { title: 'other-World survivor' }, now })
      const otherWorkId = await db.works.add(otherWork)
      const foreign = await create(`014 browser ${owner} foreign project`)
      const scopes = [target.scope, { ...target.scope, workId: sibling.id }, { projectId: target.scope.projectId, worldId, workId: otherWorkId }, foreign.scope]
      const fixtures: Array<{ scope: WorkspaceScope; referenceId: number; runId: number; text: string }> = []
      for (const [index, scope] of scopes.entries()) {
        await works.switchActiveWork(scope.projectId, scope.workId)
        const referenceId = await db.references.add(stampNewRecord(scope, 'references', { projectId: scope.projectId, workId: scope.workId,
          title: `014 reference ${owner}-${index}`, author: 'synthetic', type: 'story', note: '', url: '', createdAt: 1, updatedAt: 1,
        }, { owner: 'work' }))
        const text = `synthetic original ${owner}-${index}\n逐字保留的隔离原文。`
        const run = await createReferenceAnalysisRun({ referenceId, depth: 'quick', sourceFilename: `synthetic-${owner}-${index}.txt`, fileHash: `synthetic-${owner}-${index}`,
          totalChars: text.length, expectedChunks: 1, sourceKind: 'own-work', usageScope: 'analysis-only', rightsConfirmed: true, sourceText: text })
        await db.referenceChunkAnalysis.add(stampNewRecord(scope, 'referenceChunkAnalysis', { referenceId, analysisRunId: run.id, chunkIndex: 0, label: 'synthetic chunk', openingTechnique: 'synthetic analysis', createdAt: 1 }, { owner: 'work' }))
        fixtures.push({ scope, referenceId, runId: run.id, text })
      }
      await works.switchActiveWork(target.scope.projectId, target.scope.workId)
      const snapshot = async () => Promise.all(fixtures.map(async f => ({
        fixture: f, work: await db.works.get(f.scope.workId), world: await db.worlds.get(f.scope.worldId),
        reference: await db.references.get(f.referenceId), run: await db.referenceAnalysisRuns.get(f.runId),
        source: await db.referenceAnalysisSources.get(f.runId), chunks: await db.referenceChunkAnalysis.where('analysisRunId').equals(f.runId).toArray(),
      })))
      const before = await snapshot()
      if (db.referenceAnalysisSources.schema.primKey.keyPath !== 'analysisRunId' || before.some(row => !row.source || Object.prototype.hasOwnProperty.call(row.source, 'id'))) throw new Error('Fixture must exercise a genuine non-id source table')
      return { owner, before, fixtures, target: target.scope }
    }, owner)
    for (const row of result.before) {
      expect(row.source.chunks.map((chunk: { text: string }) => chunk.text).join('')).toBe(row.fixture.text)
    }
    await attachJSON(info, `014-${owner}-original-bytes-before-deletion`, result)
    const after = await page.evaluate(async ({ owner, fixtures, target }) => {
      const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
      const [{ db }, lifecycle] = await Promise.all([load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/workspace/lifecycle.ts')])
      if (owner === 'work') await lifecycle.deleteWork(target.workId)
      else await lifecycle.deleteWorld(target.worldId, { confirm: true })
      return Promise.all(fixtures.map(async f => ({ fixture: f, work: await db.works.get(f.scope.workId), world: await db.worlds.get(f.scope.worldId),
        reference: await db.references.get(f.referenceId), run: await db.referenceAnalysisRuns.get(f.runId),
        source: await db.referenceAnalysisSources.get(f.runId), chunks: await db.referenceChunkAnalysis.where('analysisRunId').equals(f.runId).toArray(),
      })))
    }, { owner, fixtures: result.fixtures, target: result.target })
    for (let i = 0; i < result.before.length; i++) {
      const deleted = i === 0 || (owner === 'world' && i === 1)
      const before = result.before[i], actual = after[i]
      if (deleted) {
        expect(actual.work).toBeUndefined()
        expect(actual.reference).toBeUndefined()
        expect(actual.run).toBeUndefined()
        expect(actual.source).toBeUndefined()
        expect(actual.chunks).toEqual([])
      } else {
        expect(actual).toEqual(before)
      }
    }
    expect(after[0].world === undefined).toBe(owner === 'world')
    await attachJSON(info, `014-${owner}-native-key-before-after`, { ...result, after })
    await page.reload()
    const sources = await page.evaluate(async fixtures => {
      const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
      const { db } = await load('/storyforge/src/lib/db/schema.ts')
      return Promise.all(fixtures.map((f: { runId: number }) => db.referenceAnalysisSources.get(f.runId)))
    }, result.fixtures)
    for (let i = 0; i < sources.length; i++) {
      if (i === 0 || (owner === 'world' && i === 1)) expect(sources[i]).toBeUndefined()
      else expect(sources[i]).toEqual(result.before[i].source)
    }
  }
  expect(transport.calls).toBe(0)
  expect(transport.blocked).toEqual([])
})
