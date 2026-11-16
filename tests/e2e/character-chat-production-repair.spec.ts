import {expect, test} from '@playwright/test'
import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'

for (const failure of ['opening', 'review-output-limit'] as const) test(failure === 'opening'
  ? 'rejected opening stays stopped after refresh and explicit repair receives its original error'
  : 'truncated opening review keeps paid evidence and explicit independent review excludes the rejected report', async ({page, browser}) => {
  test.setTimeout(120_000)
  registerBrowserFixtureAIConfigV1(page, { provider: 'openai', model: 'test', baseUrl: 'https://chat-repair.invalid/v1', maxTokens: 16000, apiKey: 'isolated-test-key' })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  const requests: string[] = []
  let rejected = ''
  await page.route('https://chat-repair.invalid/**', async route => {
    const body = route.request().postDataJSON(), prompt = body.messages.map((m: {content: string}) => m.content).join('\n')
    requests.push(prompt)
    const review = prompt.includes('开场的语义审查者')
    const limited = failure === 'review-output-limit' && review && requests.length === 2
    if (review) {
      expect(body.max_tokens).toBe(10_000)
      expect(prompt).not.toContain('REJECTED_REVIEW_NOT_SOURCE')
      expect(prompt).not.toContain('storyforge.product-production.repair-feedback')
    }
    const output = await page.evaluate(async ({first, review, limited}) => {
      const load = new Function('p', 'return import(p)'), db = (await load('/storyforge/src/lib/db/schema.ts')).db
      const source = JSON.parse((await db.productBuildArtifacts.filter((r: {artifactKey: string}) => r.artifactKey === 'design.game').last()).payloadJson)
      const helper = await load('/storyforge/tests/helpers/chat-narrative-production-fixture.ts'), candidates = review ? JSON.parse((await db.productBuildArtifacts.filter((row: {artifactKey: string}) => row.artifactKey === 'content.chat-candidates').last()).payloadJson) : helper.chatSituationCandidatesFixture(source)
      if (first) {candidates.options[0].situation.facts[0].origin = 'author-private'; candidates.options[0].situation.facts[0].sourceKnowledgeKey = 'unknown-world-evidence'}
      const result = review ? helper.chatOpeningPerspectiveReviewFixture(source, candidates) : candidates
      if (limited) result.options[candidates.options[0].optionKey].checks['seed-purpose'].reason = 'REJECTED_REVIEW_NOT_SOURCE'
      return JSON.stringify(result)
    }, {first: failure === 'opening' && requests.length === 1, review, limited})
    if (failure === 'opening' && requests.length === 1 || limited) rejected = output
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: output}, finish_reason: limited ? 'length' : 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 100, total_tokens: 200}})})
  })
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), f = await (await load('/storyforge/tests/helpers/chat-narrative-production-fixture.ts')).seedChatNarrativeProductionFixture()
    const execute = (await load('/storyforge/src/lib/product-production/commands.ts')).executeProductProductionCommand
    const created = await execute({scope: f.scope, command: {type: 'create-intent', commandId: 'e2e.repair.create', productionKey: 'e2e.repair', productType: 'character-interaction', worldReleaseId: f.confirmed.worldReleaseId, userText: '制作角色聊天'}})
    const saved = await execute({scope: f.scope, productionId: created.productionId, command: {type: 'save-brief-revision', commandId: 'e2e.repair.brief', expectedStateRevision: 0, parentRevision: null, brief: f.brief}})
    if (!created.ok || !saved.ok) throw Error('Failed to prepare author production')
    return {scope: f.scope, productionId: created.productionId}
  })
  const read = () => page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), db = (await load('/storyforge/src/lib/db/schema.ts')).db
    const build = await db.productBuilds.where('productionId').equals(f.productionId).last()
    return {status: build?.status ?? null, failure: build ? JSON.parse(build.failureJson) : {}, world: JSON.stringify(await db.worldReleases.toArray()),
      raw: (await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId).toArray()).filter((a: {artifactKind: string}) => a.artifactKind === 'raw-response').map((a: {content: string}) => a.content),
      inputs: (await db.productBuildArtifacts.where('projectId').equals(f.scope.projectId).toArray())
        .filter((a: {artifactKey: string}) => ['design.game', 'content.chat-candidates'].includes(a.artifactKey))
        .map((a: {artifactKey: string; payloadJson: string; contentHash: string}) => ({key: a.artifactKey, payload: a.payloadJson, hash: a.contentHash})),
      releases: await db.productReleases.count(), sessions: await db.productRuntimeSessions.count()}
  }, f)
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/production?project=${f.scope.projectId}&work=${f.scope.workId}&production=${f.productionId}`)
  await page.getByRole('button', {name: '启用自动制作', exact: true}).click()
  await page.getByRole('button', {name: '作者授权并开始自动制作', exact: true}).click()
  await expect.poll(async () => (await read()).failure.code).toBe('task-draft-rejected')
  const initialCalls = failure === 'opening' ? 1 : 2
  expect(requests).toHaveLength(initialCalls)
  const before = await read()
  expect(before.raw).toContain(rejected)
  expect(before).toMatchObject({status: 'recovery-required', releases: 0, sessions: 0})
  await reloadWithBrowserFixtureAIConfigV1(page)
  const retry = page.getByRole('button', {name: '重试失败任务', exact: true})
  await expect(retry).toBeVisible()
  expect(await read()).toEqual(before)
  expect(requests).toHaveLength(initialCalls)
  if (failure === 'review-output-limit') expect(before.failure.detail).toContain('提供商报告输出达到上限')
  const backup = await page.evaluate(async projectId => {
    const load = new Function('p', 'return import(p)')
    return (await load('/storyforge/src/lib/export/json-export.ts')).exportProjectJSON(projectId)
  }, f.scope.projectId)
  const restoredContext = await browser.newContext({baseURL: new URL('/storyforge/', page.url()).href})
  try {
    const restoredPage = await restoredContext.newPage(), restoredCalls: string[] = []
    await restoredPage.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e-import'))
    await restoredPage.route('**/*', route => {
      if (route.request().method() === 'POST') {
        restoredCalls.push(route.request().url())
        return route.abort('blockedbyclient')
      }
      return route.continue()
    })
    await gotoWithBrowserFixtureAIConfigV1(restoredPage, './chat/library')
    const restored = await restoredPage.evaluate(async backup => {
      const load = new Function('p', 'return import(p)'), db = (await load('/storyforge/src/lib/db/schema.ts')).db
      const projectId = await (await load('/storyforge/src/lib/export/json-export.ts')).importProjectJSON(
        typeof backup === 'string' ? JSON.parse(backup) : backup)
      const production = await db.productProductions.where('projectId').equals(projectId).first()
      return {projectId, workId: production.workId, productionId: production.id}
    }, backup)
    await gotoWithBrowserFixtureAIConfigV1(restoredPage, `./chat/production?project=${restored.projectId}&work=${restored.workId}&production=${restored.productionId}`)
    const design = restoredPage.locator('article').filter({has: restoredPage.locator('code').filter({hasText: /^content\.design$/})})
    await expect(design).toContainText('待核对')
    await expect(design).toContainText('导入的已完成步骤待核对，尚未重新执行。')
    await expect(design).not.toContainText('执行中')
    await reloadWithBrowserFixtureAIConfigV1(restoredPage)
    await expect(design).toContainText('待核对')
    expect(restoredCalls).toEqual([])
  } finally {
    await restoredContext.close()
  }
  await retry.click()
  await expect(page.getByTestId('chat-situation-selection')).toBeVisible()
  expect(requests).toHaveLength(3)
  if (failure === 'opening') {
    expect(requests[1]).toContain('私域事实不能伪造世界证据')
    expect(requests[1]).toContain(JSON.stringify(rejected))
  } else {
    expect(requests[2]).not.toContain(JSON.stringify(rejected))
  }
  const after = await read()
  expect(after.raw).toContain(rejected)
  expect(after.world).toBe(before.world)
  if (failure === 'review-output-limit') {
    for (const artifact of before.inputs) expect(after.inputs).toContainEqual(artifact)
  }
  expect(after).toMatchObject({releases: 0, sessions: 0})
})

for (const {rejectedRepair, referenceWire, invalidOption = false, privateKnownFact = false} of [
  {rejectedRepair: false, referenceWire: false}, {rejectedRepair: true, referenceWire: false},
  {rejectedRepair: false, referenceWire: true}, {rejectedRepair: true, referenceWire: true},
  {rejectedRepair: false, referenceWire: true, invalidOption: true}, {rejectedRepair: true, referenceWire: true, invalidOption: true},
  {rejectedRepair: false, referenceWire: true, privateKnownFact: true},
]) test(`one automatic targeted opening repair, then author choice or a durable stop (rejected=${rejectedRepair}, references=${referenceWire}, invalidOption=${invalidOption}, private=${privateKnownFact})`, async ({page}) => {
  test.setTimeout(120_000)
  registerBrowserFixtureAIConfigV1(page, { provider: privateKnownFact ? 'agnes' : 'openai', model: 'test', baseUrl: 'https://chat-auto-repair.invalid/v1', maxTokens: 16000, apiKey: 'isolated-test-key' })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  const requests: string[] = []
  let firstRaw = ''
  await page.route('https://chat-auto-repair.invalid/**', async route => {
    const body = route.request().postDataJSON()
    const prompt = body.messages.map((message: {content: string}) => message.content).join('\n')
    expect(body.response_format).toMatchObject(privateKnownFact && prompt.includes('开场的语义审查者')
      ? {type: 'json_schema', json_schema: {name: 'chat_opening_review_perspectives_v1', strict: true}}
      : privateKnownFact && requests.length === 0
        ? {type: 'json_schema', json_schema: {name: 'chat_opening_source_complete_v1', strict: true}}
        : {type: 'json_object'})
    requests.push(prompt)
    const output = await page.evaluate(async ({reject, review, attempt, referenceWire, opening, invalidOption}) => {
      if (!opening && !review) return JSON.stringify({schema: 'storyforge.product-media-requirements-artifact', version: 2, visual: [], audio: []})
      const load = new Function('p', 'return import(p)')
      const db = (await load('/storyforge/src/lib/db/schema.ts')).db
      const source = JSON.parse((await db.productBuildArtifacts.filter((row: {artifactKey: string}) => row.artifactKey === 'design.game').last()).payloadJson)
      const helper = await load('/storyforge/tests/helpers/chat-narrative-production-fixture.ts')
      const candidates = review ? JSON.parse((await db.productBuildArtifacts.filter((row: {artifactKey: string}) => row.artifactKey === 'content.chat-candidates').last()).payloadJson) : helper.chatSituationCandidatesFixture(source)
      const references = referenceWire ? await helper.chatSituationReferenceDraftFixture(source, candidates) : null
      const knowledge = source.source.knowledge.find((item: {source: {purpose: string}; audienceKeys: string[]}) => item.source.purpose === 'identity' && item.audienceKeys.includes('player'))
      candidates.options[0].situation.facts.push({
        factKey: 'known-identity', text: knowledge.content, audienceKeys: [...knowledge.audienceKeys],
        origin: reject ? 'author-private' : 'reviewed-world', sourceKnowledgeKey: knowledge.key, sourceEventSequence: 0,
      })
      const draft = references ?? candidates
      if (attempt === 1) {
        if (invalidOption) {
          references.options[2].situation.localFacts[0].audienceKeys = ['participant.001']
          return JSON.stringify(references)
        }
        return JSON.stringify({...draft, options: draft.options.slice(0, 1), ...draft.options[1]})
      }
      if (!review) {
        // Locate the exact persisted plan, not a test-generated correction.
        const all = await db.agentRunArtifacts.toArray()
        const plans = all.filter((row: {artifactKind: string}) => row.artifactKind === 'tool-result')
          .flatMap((row: {content: string}) => {try {const value = JSON.parse(row.content); return value.schema === 'storyforge.chat-opening-targeted-repair' ? [value] : []} catch {return []}})
        const repair = plans.at(-1)
        const replacementOptions = (repair.invalidOptions ?? []).map((item: {optionIndex: number}) => {
          const option = structuredClone(references.options[item.optionIndex])
          if (reject) option.situation.localFacts[0].audienceKeys = ['participant.001']
          return {optionIndex: item.optionIndex, option}
        })
        return JSON.stringify({schema: 'storyforge.chat-opening-repair-patch', version: referenceWire ? 2 : 1,
          rawResponseHash: repair.rawResponseHash, recoverRootOption: repair.recoverRootOption,
          applyRepairs: reject ? [] : repair.repairs.map((item: {path: string}) => item.path),
          appendedOptions: referenceWire && reject ? [] : draft.options.slice(repair.originalOptionCount),
          ...(referenceWire ? {replacementOptions} : {})})
      }
      const accepted = JSON.parse((await db.productBuildArtifacts.filter((row: {artifactKey: string}) => row.artifactKey === 'content.chat-candidates').last()).payloadJson)
      return JSON.stringify(helper.chatOpeningPerspectiveReviewFixture(source, accepted))
    }, {reject: requests.length === 1 || rejectedRepair, review: prompt.includes('开场的语义审查者'), opening: prompt.includes('初始情境编辑'), attempt: requests.length, referenceWire, invalidOption})
    if (requests.length === 1) firstRaw = output
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({
      choices: [{message: {role: 'assistant', content: output}, finish_reason: 'stop'}],
      usage: {prompt_tokens: 100, completion_tokens: 100, total_tokens: 200},
    })})
  })
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async ({referenceWire, privateKnownFact}) => {
    const load = new Function('p', 'return import(p)')
    const f = await (await load('/storyforge/tests/helpers/chat-narrative-production-fixture.ts')).seedChatNarrativeProductionFixture({worldDiscovery: referenceWire && !privateKnownFact, privateKnownFact})
    const execute = (await load('/storyforge/src/lib/product-production/commands.ts')).executeProductProductionCommand
    const created = await execute({scope: f.scope, command: {type: 'create-intent', commandId: 'e2e.auto.create', productionKey: 'e2e.auto', productType: 'character-interaction', worldReleaseId: f.confirmed.worldReleaseId, userText: '制作角色聊天'}})
    const saved = await execute({scope: f.scope, productionId: created.productionId, command: {type: 'save-brief-revision', commandId: 'e2e.auto.brief', expectedStateRevision: 0, parentRevision: null, brief: f.brief}})
    if (!created.ok || !saved.ok) throw Error('Failed to prepare author production')
    const db = (await load('/storyforge/src/lib/db/schema.ts')).db
    return {scope: f.scope, productionId: created.productionId, world: JSON.stringify(await db.worldReleases.toArray())}
  }, {referenceWire, privateKnownFact})
  const read = () => page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), db = (await load('/storyforge/src/lib/db/schema.ts')).db
    const build = await db.productBuilds.where('productionId').equals(f.productionId).last()
    const artifacts = await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId).toArray()
    return {
      // Start authorization creates the build asynchronously; poll its actual
      // failure instead of throwing before the build has been persisted.
      failure: build ? JSON.parse(build.failureJson) : {}, ledger: build ? JSON.parse(build.budgetLedgerJson) : null,
      evidence: artifacts.map((row: {artifactKind: string; content: string}) => ({kind: row.artifactKind, content: row.content})),
      world: JSON.stringify(await db.worldReleases.toArray()), releases: await db.productReleases.count(), sessions: await db.productRuntimeSessions.count(),
    }
  }, f)
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/production?project=${f.scope.projectId}&work=${f.scope.workId}&production=${f.productionId}`)
  await page.getByRole('button', {name: '启用自动制作', exact: true}).click()
  await page.getByRole('button', {name: '作者授权并开始自动制作', exact: true}).click()
  if (rejectedRepair) await expect.poll(async () => (await read()).failure.code).toBe('task-draft-rejected')
  else await expect(page.getByTestId('chat-situation-selection')).toBeVisible()
  expect(requests).toHaveLength(rejectedRepair ? 2 : 3)
  expect(requests[1]).toContain('"automaticOpeningRepair"')
  if (referenceWire) {
    expect(requests[1]).toContain('design.chat-fact-catalog')
    expect(requests[1]).toContain('"format":"references"')
    expect(firstRaw).toContain('"schema":"storyforge.chat-situation-reference-draft"')
    if (invalidOption) expect(requests[1]).toContain('"optionIndex":2')
  } else expect(requests[1]).toContain('/options/0/situation/facts/1/origin')
  expect(requests[1]).toContain(JSON.stringify(firstRaw))
  const before = await read()
  expect(before.evidence).toContainEqual({kind: 'raw-response', content: firstRaw})
  expect(before.evidence.some((row: {kind: string; content: string}) => row.kind === 'tool-result' && row.content.includes('"schema":"storyforge.chat-opening-targeted-repair"'))).toBe(true)
  expect(before.ledger.attempts.filter((row: {taskKey: string}) => row.taskKey === 'content.product-module')).toMatchObject([
    {attempt: 1, usageKnown: true, outcome: 'failed', usage: {modelCalls: 1}},
    {attempt: 2, usageKnown: true, outcome: rejectedRepair ? 'failed' : 'settled', usage: {modelCalls: 1}},
  ])
  await reloadWithBrowserFixtureAIConfigV1(page)
  if (rejectedRepair) await expect(page.getByRole('button', {name: '重试失败任务', exact: true})).toBeVisible()
  else await expect(page.getByTestId('chat-situation-selection')).toBeVisible()
  expect(await read()).toEqual(before)
  expect(requests).toHaveLength(rejectedRepair ? 2 : 3)
  expect(before.world).toBe(f.world)
  expect(before).toMatchObject({releases: 0, sessions: 0})
  if (referenceWire && !rejectedRepair) {
    await page.setViewportSize({width: 390, height: 844})
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', {name: '选择「旧账本」并继续', exact: true}).click()
    await expect(page.getByRole('button', {name: '复验并原子发布', exact: true})).toBeEnabled({timeout: 30_000})
    expect(requests).toHaveLength(4)
    await page.getByRole('button', {name: '复验并原子发布', exact: true}).click()
    const releaseId = () => page.evaluate(async f => {
      const load = new Function('p', 'return import(p)'), db = (await load('/storyforge/src/lib/db/schema.ts')).db
      return (await db.productProductions.get(f.productionId)).currentProductReleaseId
    }, f)
    await expect.poll(releaseId).toBeGreaterThan(0)
    const restored = await page.evaluate(async f => {
      const load = new Function('p', 'return import(p)'), db = (await load('/storyforge/src/lib/db/schema.ts')).db
      const productReleaseId = (await db.productProductions.get(f.productionId)).currentProductReleaseId
      const session = await (await load('/storyforge/src/lib/product/runtime-instances.ts')).createCharacterInteractionInstance({
        scope: f.scope, productReleaseId, title: '引用式开场恢复',
      })
      const readState = (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState
      const state = await readState(session.id)
      const view = (await load('/storyforge/src/lib/character-interaction/runtime.ts')).interactionVisibilityView(state.interaction, 'player')
      const source = JSON.parse((await db.productBuildArtifacts.filter((row: {artifactKey: string}) => row.artifactKey === 'design.game').last()).payloadJson)
      const complete = source.source.knowledge.filter((item: {source: {purpose: string}}) => ['identity', 'knowledge'].includes(item.source.purpose))
        .every((item: {key: string; content: string; audienceKeys: string[]}) => {
          const matching = state.interaction.chatNarrative.situation.facts.filter((fact: {sourceKnowledgeKey: string}) => fact.sourceKnowledgeKey === item.key)
          return matching.length === 1 && matching[0].text === item.content && JSON.stringify(matching[0].audienceKeys) === JSON.stringify(item.audienceKeys)
        })
      const backup = await load('/storyforge/src/lib/export/json-export.ts')
      const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(f.scope.projectId))
      db.close(); await db.open()
      const copy = await db.productRuntimeSessions.where('projectId').equals(projectId).first()
      return {title: state.interaction.chatNarrative.situation.title, playerView: JSON.stringify(view), complete,
        original: state.interaction.chatNarrative, restored: (await readState(copy.id)).interaction.chatNarrative,
        world: JSON.stringify(await db.worldReleases.bulkGet(JSON.parse(f.world).map((row: {id: number}) => row.id)))}
    }, f)
    expect(restored.title).toBe('旧账本')
    expect(restored.playerView).not.toContain('红铜钥匙')
    expect(restored.playerView).not.toContain('自己保存了一块能试用的旧发条')
    expect(restored.complete).toBe(true)
    expect(restored.restored).toEqual(restored.original)
    expect(restored.world).toBe(f.world)
    expect(requests).toHaveLength(4)
  }
})
