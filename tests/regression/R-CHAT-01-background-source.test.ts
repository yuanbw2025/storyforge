import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {seedChatBackgroundSourceFixture, compileChatBackgroundSourceFixture, chatStructuredWorldRulesFixture} from '../helpers/chat-background-source'
import {createChatSourceProjectionDraftV1, readChatSourceProjectionViewV1, readPreparedChatSourceProjectionViewV1} from '../../src/lib/character-interaction/source-projection'
import {createInitialInteractionState, interactionVisibilityView, buildInteractionContextWindow, parseFrozenChatSourceV1} from '../../src/lib/character-interaction/runtime'
import {formatInteractionRuntimeContextV1} from '../../src/lib/character-interaction/context-format'
import {parseChatAuthoringSettings} from '../../src/lib/character-interaction/authoring-contract'
import {saveChatDraftV1, loadChatSourceProjectionV1, confirmChatSourceReviewV1, selectChatWorldV1} from '../../src/lib/character-interaction/draft-service'
import {compileInteractionModulesV1} from '../../src/lib/product-production/product-module-compilers'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {seedCurrentProductBuild} from '../helpers/current-product-build'
import {seedCurrentProductWorld} from '../helpers/current-product-world'
import {readProductRuntimeState} from '../../src/lib/character-interaction/runtime-api'
import {createProductProductionSourcePlanV1, executeProductProductionWorldGatewayV1} from '../../src/lib/product-production/source-contracts'
import {createProductProductionPlanV3} from '../../src/lib/product-production/plan'
import {hashProductProductionValueV2} from '../../src/lib/product-production/hash'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())

it('carries separately authorized structured source leaves through confirmation, runtime and portable restoration', async () => {
  const original = chatStructuredWorldRulesFixture()
  const f = await seedChatBackgroundSourceFixture(original)
  const rules = f.projection.background!.find(r => r.resourceKind === 'world-rules')!
  expect(rules.fragments.every(p => p.valueJson.length <= 6000)).toBe(true)
  expect(rules.fragments.filter(p => p.pointer.startsWith('/customNodes/'))).toHaveLength(12)
  expect(rules.fragments.filter(p => p.pointer === '/entries/harbor~1public/historicalAnchors').map(p => JSON.parse(p.valueJson)).join('')).toBe(original.entries['harbor/public'].historicalAnchors)
  const allowed = new Set(rules.fragments.filter(p => p.pointer.startsWith('/entries/harbor~1public/') || p.pointer === '/customNodes/11').map(p => p.fragmentKey))
  for (const decision of f.review.classifications) if (allowed.has(decision.fragmentKey)) {
    decision.visibility = 'participants'; decision.audienceKeys = [f.keys[0]]
  }
  const {compiled, confirmed, settings, compilerInput} = await compileChatBackgroundSourceFixture(f)
  const state = createInitialInteractionState(compiled), actor = compiled.profiles.find(p => p.characterKey === f.keys[0])!
  const own = formatInteractionRuntimeContextV1(actor, buildInteractionContextWindow(state, actor.participantKey))
  expect(own).toContain('末段规则：蓝铃响起时先检查水尺')
  expect(own).toContain('末项线索：晚班记录放在蓝色柜中')
  expect(own).toContain('字段=/customNodes/11')
  expect(JSON.stringify(compiled)).not.toContain('作者秘密')
  for (const key of ['player', ...compiled.profiles.filter(p => p !== actor).map(p => p.participantKey)]) {
    expect(JSON.stringify(interactionVisibilityView(state, key))).not.toContain('蓝色柜')
  }
  const release = (await db.worldReleases.get(confirmed.worldReleaseId!))!
  const {session} = await seedCurrentProductBuild({scope: f.scope, worldRelease: release, title: '结构化资料往返', runtimePackage: {
    schema: 'storyforge.product-runtime-package', version: 1, productType: 'character-interaction',
    definition: {productKey: 'chat.structured', title: '结构化资料往返', description: '结构来源工程验证', enabledCapabilities: ['narrative', 'interaction'], rulesetVersion: 1, initialVariables: {}},
    sourceWorld: {contentHash: release.contentHash, selection: compilerInput.brief.source.selection},
    narrative: {...compilerInput.narrative, choices: [{choiceKey: 'finish', sourceNodeKey: 'opening', targetNodeKey: 'end', text: '结束核对', description: '完成验证', unavailableReason: '', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0}]}, interaction: compiled,
  }})
  const installed = await readProductRuntimeState(session.id!)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const restored = (await db.chatAuthoringDrafts.where('projectId').equals(projectId).first())!
  expect(JSON.parse(restored.settingsJson)).toEqual(settings)
  const projection = await loadChatSourceProjectionV1({projectId, workId: restored.workId, worldId: restored.worldId}, restored.revision)
  expect(projection.projectionHash).toBe(f.projection.projectionHash)
  expect(projection.background!.find(r => r.resourceKind === 'world-rules')).toEqual(rules)
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).first())!
  expect((await readProductRuntimeState(imported.id!)).interaction!.knowledge).toEqual(installed.interaction!.knowledge)
  const portable = JSON.parse(JSON.stringify(compiled))
  expect(createInitialInteractionState(portable)).toEqual(state)
  const broken = structuredClone(compiled)
  broken.chatSource!.knowledge.find(k => k.source.pointer === '/entries/harbor~1public/historicalAnchors')!.source.textRange!.end++
  expect(() => createInitialInteractionState(broken)).toThrow('片段范围')
  expect((await db.worldReleases.get(confirmed.worldReleaseId!))!.contentHash).toBe(f.world.release.contentHash)
})

it('loads selected non-character resources losslessly and defaults all new background to no audience', async () => {
  const f = await seedChatBackgroundSourceFixture()
  expect(f.projection.background!.map(r => r.resourceKey)).toEqual([...f.settings.backgroundResourceKeys].sort())
  expect(f.projection.background!.map(r => r.resourceKind)).toEqual(expect.arrayContaining(['location', 'codex-entry', 'character-relation', 'story-core', 'world-rules']))
  expect(f.options.some(o => o.resourceKind === 'character')).toBe(false)
  expect(f.projection.background!.flatMap(r => r.fragments).some(fragment => fragment.pointer.startsWith('/_'))).toBe(false)
  expect(await readChatSourceProjectionViewV1({draft: f.projection, classifications: [], viewerKey: 'player'})).toEqual([])
  const {compilerInput} = await compileChatBackgroundSourceFixture(f)
  for (const resource of f.projection.background!) {
    const source = compilerInput.sourceCatalog.resources.find(r => r.descriptor.resourceKey === resource.resourceKey)!
    expect(resource.sourceHash).toBe(source.descriptor.contentHash)
    expect(Object.fromEntries(resource.fragments.map(fragment => [fragment.pointer.slice(1), JSON.parse(fragment.valueJson)])))
      .toEqual(Object.fromEntries(Object.entries(source.value).filter(([key]) => !key.startsWith('_'))))
  }
})

it('freezes explicit background and carries only confirmed facts to the right runtime and actual role input', async () => {
  const f = await seedChatBackgroundSourceFixture(), {compiled, compilerInput} = await compileChatBackgroundSourceFixture(f)
  expect(compilerInput.brief.source.selection.roleBindings.chatBackground).toEqual([...f.settings.backgroundResourceKeys].sort())
  expect(compiled.chatSource!.version).toBe(2)
  expect(compiled.chatSource!.backgroundSources!.map(s => s.resourceKind)).toEqual(expect.arrayContaining(['location', 'codex-entry']))
  expect(compiled.chatSource!.backgroundSources!.some(s => ['story-core', 'character-relation'].includes(s.resourceKind))).toBe(false)
  const state = createInitialInteractionState(compiled)
  const owner = compiled.profiles.find(p => p.characterKey === f.keys[0])!
  const other = compiled.profiles.find(p => p.characterKey === f.keys[1])!
  const ownerInput = formatInteractionRuntimeContextV1(owner, buildInteractionContextWindow(state, owner.participantKey))
  expect(ownerInput).toContain('世界背景来源=')
  expect(ownerInput).toContain('钥匙齿纹对应旧档案中的潮位')
  for (const key of ['player', other.participantKey]) {
    const view = JSON.stringify(interactionVisibilityView(state, key))
    expect(view).toContain('潮门关闭前仍可进入的调查起点')
    expect(view).not.toContain('钥匙齿纹')
  }
  expect(JSON.stringify(compiled)).not.toContain('彼此隐瞒动机')
  expect(JSON.stringify(compiled)).not.toContain('追查信号、修复潮汐钟并决定真相是否公开')
  expect(compiled.profiles.map(p => p.characterKey)).toEqual([...f.keys].sort())
  expect((await db.worldReleases.get(f.world.release.id!))!.contentHash).toBe(f.world.release.contentHash)
})

it('rejects foreign, character, duplicate or over-limit background selections without broadening the read', async () => {
  const f = await seedChatBackgroundSourceFixture()
  for (const backgroundResourceKeys of [['foreign'], [f.keys[0]]]) {
    const draft = await saveChatDraftV1(f.scope, f.draft.revision, {...f.settings, backgroundResourceKeys})
    await expect(loadChatSourceProjectionV1(f.scope, draft.revision)).rejects.toThrow()
    f.draft = draft
  }
  for (const keys of [[f.options[0].resourceKey, f.options[0].resourceKey], Array.from({length: 129}, (_, i) => `key.${i}`)])
    expect(() => parseChatAuthoringSettings({...f.settings, backgroundResourceKeys: keys})).toThrow('背景资料')
})

it('rejects background as a new voice or identity and validates the same source at compile and install', async () => {
  const f = await seedChatBackgroundSourceFixture()
  const decision = f.review.classifications.find(d => f.projection.background!.some(r => r.fragments.some(fragment => fragment.fragmentKey === d.fragmentKey)))!
  for (const purpose of ['voice', 'identity', 'motivation'] as const) {
    await expect(confirmChatSourceReviewV1(f.scope, f.draft.revision, {...f.review, classifications: f.review.classifications.map(d => d === decision ? {...d, purpose} : d)})).rejects.toThrow('世界背景资料只能')
  }
  const {compiled, compilerInput} = await compileChatBackgroundSourceFixture(f)
  for (const change of ['purpose', 'hash', 'foreign', 'version'] as const) {
    const source = structuredClone(compiled.chatSource!)
    const seed = source.knowledge.find(k => source.backgroundSources!.some(s => s.resourceKey === k.source.resourceKey))!
    if (change === 'purpose') seed.source.purpose = 'voice'
    if (change === 'hash') seed.source.sourceHash = 'f'.repeat(64)
    if (change === 'foreign') seed.source.resourceKey = 'foreign'
    if (change === 'version') source.version = 1
    expect(() => parseFrozenChatSourceV1(source, compiled.profiles.map(p => p.participantKey), compiled.profiles.map(p => p.characterKey))).toThrow()
  }
  compilerInput.sourceCatalog.chatSourceProjection!.background![0].fragments[0].valueJson = '"篡改背景"'
  expect(() => compileInteractionModulesV1(compilerInput)).toThrow('重新核验')
})

it('invalidates confirmation when background changes and clears it when changing worlds', async () => {
  const f = await seedChatBackgroundSourceFixture(), {confirmed, settings} = await compileChatBackgroundSourceFixture(f)
  if (settings.version === 1) throw new Error('expected reviewed settings')
  const updated = await saveChatDraftV1(f.scope, confirmed.revision, {...settings, backgroundResourceKeys: settings.backgroundResourceKeys!.slice(1)})
  expect(JSON.parse(updated.settingsJson).sourceReview).toBeNull()
  const changed = await loadChatSourceProjectionV1(f.scope, updated.revision)
  expect(changed.projectionHash).not.toBe(f.projection.projectionHash)
  expect(() => readPreparedChatSourceProjectionViewV1({draft: changed, review: f.review, viewerKey: 'player'})).toThrow('重新检查')
  const nextWorld = await seedCurrentProductWorld('OTHER-WORLD')
  const switched = await selectChatWorldV1(f.scope, updated.revision, nextWorld.release.id!)
  expect(JSON.parse(switched.settingsJson)).toMatchObject({characters: [], backgroundResourceKeys: [], sourceReview: null})
})

it('retains portable relationship endpoints only with the explicitly authorized relationship text', async () => {
  const f = await seedChatBackgroundSourceFixture()
  const relation = f.projection.background!.find(source => source.resourceKind === 'character-relation')!
  expect(relation.relatedResourceKeys).toEqual([...f.keys].sort())
  for (const decision of f.review.classifications) if (relation.fragments.some(fragment => fragment.fragmentKey === decision.fragmentKey)) {
    decision.visibility = 'participants'; decision.audienceKeys = [f.keys[0]]
  }
  const {compiled} = await compileChatBackgroundSourceFixture(f), state = createInitialInteractionState(compiled)
  const owner = compiled.profiles.find(p => p.characterKey === f.keys[0])!
  const knowledge = interactionVisibilityView(state, owner.participantKey).knowledge.find(k => k.content.includes('彼此隐瞒动机'))!
  expect(knowledge.content).toContain('关联人物来源=')
  for (const profile of compiled.profiles) expect(knowledge.content).toContain(`${profile.participantKey}（${profile.characterKey}）`)
  expect(JSON.stringify(interactionVisibilityView(state, 'player'))).not.toContain('彼此隐瞒动机')
  const altered = structuredClone(compiled)
  altered.chatSource!.backgroundSources!.find(source => source.resourceKind === 'character-relation')!.relatedResourceKeys = ['x', 'x']
  expect(() => createInitialInteractionState(altered)).toThrow('端点无效')
})

it('preserves historical character-only projection shape and rejects tampered original background before confirmation', async () => {
  const f = await seedChatBackgroundSourceFixture(), {compilerInput} = await compileChatBackgroundSourceFixture(f)
  const input = {worldReferenceHash: f.projection.worldReferenceHash, worldReleaseHash: f.projection.worldReleaseHash, characterResourceKeys: f.keys, resources: compilerInput.sourceCatalog.resources}
  const old = await createChatSourceProjectionDraftV1(input)
  expect(old).not.toHaveProperty('background')
  expect(await createChatSourceProjectionDraftV1({...input, backgroundResourceKeys: []})).toEqual(old)
  const altered = structuredClone(input)
  altered.resources.find(r => r.descriptor.resourceKey === f.settings.backgroundResourceKeys[0])!.value.description = '伪造资料'
  await expect(createChatSourceProjectionDraftV1({...altered, backgroundResourceKeys: f.settings.backgroundResourceKeys})).rejects.toThrow('原文与资源证据不一致')
})

it('keeps published background permissions and portable source identity across installation and project round-trip', async () => {
  const f = await seedChatBackgroundSourceFixture(), {compiled, compilerInput, confirmed, settings} = await compileChatBackgroundSourceFixture(f)
  const release = (await db.worldReleases.get(confirmed.worldReleaseId!))!
  const {session} = await seedCurrentProductBuild({scope: f.scope, worldRelease: {...release, id: confirmed.worldReleaseId!}, title: '背景运行往返', runtimePackage: {
    schema: 'storyforge.product-runtime-package', version: 1, productType: 'character-interaction',
    definition: {productKey: 'chat.background', title: '背景运行往返', description: '背景工程验证', enabledCapabilities: ['narrative', 'interaction'], rulesetVersion: 1, initialVariables: {}},
    sourceWorld: {contentHash: release.contentHash, selection: compilerInput.brief.source.selection},
    narrative: {...compilerInput.narrative, choices: [{choiceKey: 'finish', sourceNodeKey: 'opening', targetNodeKey: 'end', text: '结束核对', description: '完成验证', unavailableReason: '', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0}]}, interaction: compiled,
  }})
  const original = await readProductRuntimeState(session.id!)
  const id = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const draft = (await db.chatAuthoringDrafts.where('projectId').equals(id).first())!
  expect(JSON.parse(draft.settingsJson)).toEqual(settings)
  expect((await loadChatSourceProjectionV1({projectId: id, worldId: draft.worldId, workId: draft.workId}, draft.revision)).projectionHash).toBe(f.projection.projectionHash)
  const imported = (await db.productRuntimeSessions.where('projectId').equals(id).first())!
  expect((await readProductRuntimeState(imported.id!)).interaction!.knowledge).toEqual(original.interaction!.knowledge)
})

it('records the full background compilation reads within the frozen product SourcePlan and refuses an insufficient budget', async () => {
  const f = await seedChatBackgroundSourceFixture(), {compilerInput: {brief}} = await compileChatBackgroundSourceFixture(f)
  const sourcePlan = await createProductProductionSourcePlanV1({scope: f.scope, productionKey: 'background-gateway', brief})
  const plan = await createProductProductionPlanV3({buildNumber: 1, briefHash: await hashProductProductionValueV2(brief), brief})
  const task = plan.tasks.find(t => t.kind === 'runtime-package')!
  const execution = await executeProductProductionWorldGatewayV1({scope: f.scope, sourcePlan, brief, task, requireCompilationResources: true, budgetTokens: 50000})
  for (const key of f.settings.backgroundResourceKeys) {
    const selected = execution.selector.selected.find(row => row.resourceKey === key)!
    expect(selected.hardRequirement).toBe(true)
    expect(['full', 'original']).toContain(selected.depth)
    expect(execution.sourceSnapshots.find(row => row.resourceKey === key)?.content.length).toBeGreaterThan(0)
  }
  expect(execution.metrics.additionalPlanningModelCalls).toBe(0)
  await expect(executeProductProductionWorldGatewayV1({scope: f.scope, sourcePlan, brief, task, requireCompilationResources: true, budgetTokens: 1})).rejects.toThrow()
})
