import { afterEach, beforeEach, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { seedCurrentProductBuild } from '../helpers/current-product-build'
import { readProductRuntimeState } from '../../src/lib/character-interaction/runtime-api'
import { characterChatBaselineInput } from '../helpers/character-chat-baseline'
import { DEFAULT_CHAT_SETTINGS, parseChatAuthoringSettings } from '../../src/lib/character-interaction/authoring-contract'
import { confirmChatSourceReviewV1, createChatDraftV1, loadChatSourceProjectionV1, readChatDraftV1, saveChatDraftV1, selectChatWorldV1 } from '../../src/lib/character-interaction/draft-service'
import { loadProductProductionConsultationSourceV2, loadProductProductionWorldSourceCatalogV2 } from '../../src/lib/product-production/world-source'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { compileInteractionModulesV1 } from '../../src/lib/product-production/product-module-compilers'
import { applyInteractionEvent, buildInteractionContextWindow, createInitialInteractionState, interactionVisibilityView, parseInteractionState } from '../../src/lib/character-interaction/runtime'
import { formatInteractionRuntimeContextV1 } from '../../src/lib/character-interaction/context-format'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {generateChatConsultationV2} from '../../src/lib/character-interaction/consultation-harness'
import type { ChatSourceReviewV1 } from '../../src/lib/character-interaction/source-projection'

beforeEach(async () => { db.close(); await db.delete(); await db.open() })
afterEach(() => db.close())

async function setup(characterDetails?: {background?: string; personality?: string}) {
  const world = await seedCurrentProductWorld('CHAT-REVIEW', {characterDetails})
  const {scope} = await createChatDraftV1('完整人物资料')
  const linked = await selectChatWorldV1(scope, 0, world.release.id!)
  const index = await loadProductProductionConsultationSourceV2({scope, worldReleaseId: linked.worldReleaseId!})
  const keys = [...index.selectionOptions.characters].sort((a, b) => Number(b.label === '林舟') - Number(a.label === '林舟')).map(c => c.resourceKey)
  const draft = await saveChatDraftV1(scope, linked.revision, {...DEFAULT_CHAT_SETTINGS, mode: 'multi', playerRole: '修钟学徒沈禾',
    characters: keys.map(sourceKey => ({sourceKey, voiceRules: '', privateKnowledge: '', initialTrust: 0}))})
  const projection = await loadChatSourceProjectionV1(scope, draft.revision)
  const review: ChatSourceReviewV1 = {projectionHash: projection.projectionHash, classifications: projection.characters.flatMap(c => c.fragments.map(f => ({
    projectionHash: projection.projectionHash, fragmentKey: f.fragmentKey,
    purpose: f.pointer === '/background' ? 'motivation' as const : f.pointer === '/personality' ? 'voice' as const : 'identity' as const,
    visibility: f.pointer === '/name' ? 'public' as const : ['/background', '/personality'].includes(f.pointer) ? 'participants' as const : 'unclassified' as const,
    audienceKeys: ['/background', '/personality'].includes(f.pointer) ? [c.resourceKey] : [],
  })))}
  return {world, scope, keys, draft, projection, review}
}

async function compile(input: Awaited<ReturnType<typeof setup>>) {
  const confirmed = await confirmChatSourceReviewV1(input.scope, input.draft.revision, input.review)
  const settings = parseChatAuthoringSettings(JSON.parse(confirmed.settingsJson))
  const starting = await suggestProductStartingPoints({scope: input.scope, worldReleaseId: confirmed.worldReleaseId!})
  const brief = await draftProductProductionBriefV3({scope: input.scope, worldReleaseId: confirmed.worldReleaseId!,
    suggestionKey: starting.suggestions[0].suggestionKey, productType: 'character-interaction', characterChat: settings,
    playerRole: settings.playerRole, openingSituation: '共同修理潮汐钟', visualLevel: 'none', audioLevel: 'none'})
  const sourceCatalog = await loadProductProductionWorldSourceCatalogV2({scope: input.scope, worldReleaseId: confirmed.worldReleaseId!, selection: brief.source.selection})
  const baseline = characterChatBaselineInput()
  // Future ending lines use the new real source identity; neither becomes an initial fact.
  baseline.narrative.beats[0].speakerKey = input.keys[0]
  const compilerInput = {brief, sourceCatalog, narrative: baseline.narrative}
  return {confirmed, settings, compilerInput, compiled: compileInteractionModulesV1(compilerInput)}
}

it('carries confirmed source identities, full selected fields and player role into separately filtered runtime views', async () => {
  const input = await setup()
  const {compiled} = await compile(input)
  expect(compiled.profiles.map(p => p.characterKey)).toEqual([...input.keys].sort())
  expect(compiled.chatSource?.worldReleaseHash).toBe(input.world.release.contentHash)
  const firstRole = compiled.profiles.find(p => p.characterKey === input.keys[0])!
  const otherRole = compiled.profiles.find(p => p.characterKey === input.keys[1])!
  expect(firstRole.voiceRules).toContain('谨慎而固执')
  const state = createInitialInteractionState(compiled)
  const player = JSON.stringify(interactionVisibilityView(state, 'player'))
  const first = JSON.stringify(interactionVisibilityView(state, firstRole.participantKey))
  const other = JSON.stringify(interactionVisibilityView(state, otherRole.participantKey))
  expect(player).toContain('修钟学徒沈禾')
  expect(player).not.toContain('熟悉潮汐钟结构')
  expect(first).toContain('熟悉潮汐钟结构')
  expect(first).toContain('意愿，不代表已经发生')
  const firstView = interactionVisibilityView(state, firstRole.participantKey)
  const ownBackground = firstView.knowledge.find(item => item.content.includes('熟悉潮汐钟结构'))!
  expect(ownBackground.content).toContain(`所属角色=${firstRole.participantKey}；字段=/background`)
  const otherName = firstView.knowledge.find(item => item.content.includes(`字段=/name】"${otherRole.name}"`))!
  expect(otherName.content).toContain(`所属角色=${otherRole.participantKey}`)
  expect(other).not.toContain('熟悉潮汐钟结构')
  expect(JSON.stringify(compiled)).not.toContain('真正拿走物品的是掌柜')
  expect(JSON.stringify(compiled)).not.toContain('知道失踪船队真相')
  expect(parseInteractionState(JSON.parse(JSON.stringify(state)))).toEqual(state)
  expect((await db.worldReleases.get(input.world.release.id!))?.contentHash).toBe(input.world.release.contentHash)
})

it('refuses stale, forged and model-authored confirmations; cast changes invalidate a saved review', async () => {
  const input = await setup()
  const {confirmed, settings} = await compile(input)
  expect(settings.version).toBe(2)
  const worksBefore = await db.works.count()
  await expect(createChatDraftV1('不可复制资料授权', settings)).rejects.toThrow('新作品须选择来源')
  expect(await db.works.count()).toBe(worksBefore)
  await expect(confirmChatSourceReviewV1(input.scope, input.draft.revision, input.review)).rejects.toThrow('方案已变化')
  await expect(saveChatDraftV1(input.scope, confirmed.revision, DEFAULT_CHAT_SETTINGS)).rejects.toThrow('旧版方案候选')
  if (settings.version !== 2) throw new Error('missing upgrade')
  const forged = {...settings, sourceReview: {...input.review, projectionHash: '0'.repeat(64), classifications: []}}
  await expect(saveChatDraftV1(input.scope, confirmed.revision, forged)).rejects.toThrow('资料检查')
  const request = {draftRevision: confirmed.revision, question: '讨论资料范围', source: null, priorRunId: null}
  const rejected = await generateChatConsultationV2({scope: input.scope, request, runAI: async () => JSON.stringify({answer: '公开秘密', changes: [{field: 'sourceReview', value: forged.sourceReview, reason: '公开', basis: 'proposal', evidence: []}]})})
  expect(rejected.status).toBe('blocked')
  const candidate = await generateChatConsultationV2({scope: input.scope, request, runAI: async () => JSON.stringify({answer: '资料范围保留，等待作者选择。', changes: []})})
  expect(candidate.status).toBe('ready')
  const afterModel = await readChatDraftV1(input.scope)
  expect(JSON.parse(afterModel.settingsJson)).toEqual(settings)
  const changed = await saveChatDraftV1(input.scope, afterModel.revision, {...settings, characters: [...settings.characters].reverse()})
  expect(JSON.parse(changed.settingsJson).sourceReview).toBeNull()
})

it('preserves portable review identity across project export/import without copying mutable characters', async () => {
  const input = await setup()
  const {settings} = await compile(input)
  const importedId = await importProjectJSON(await exportProjectJSON(input.scope.projectId))
  const restored = (await db.chatAuthoringDrafts.where('projectId').equals(importedId).first())!
  const scope = {projectId: importedId, worldId: restored.worldId, workId: restored.workId}
  expect(restored.worldReleaseId).not.toBe(input.draft.worldReleaseId)
  expect(JSON.parse(restored.settingsJson)).toEqual(settings)
  expect((await loadChatSourceProjectionV1(scope, restored.revision)).projectionHash).toBe(input.review.projectionHash)
  expect(await db.characters.where('projectId').equals(importedId).count()).toBe(0)
})

it('rejects altered source bodies, missing reviews and runtime recipients outside the package', async () => {
  const input = await setup()
  const {compiled, compilerInput} = await compile(input)
  const projection = compilerInput.sourceCatalog.chatSourceProjection!
  projection.characters[0].fragments[0].valueJson = '"forged"'
  expect(() => compileInteractionModulesV1(compilerInput)).toThrow('重新核验')
  const malformed = structuredClone(compiled)
  malformed.chatSource!.knowledge[0].audienceKeys = ['foreign-participant']
  expect(() => createInitialInteractionState(malformed)).toThrow('可见性')
  const oversized = structuredClone(compiled)
  oversized.chatSource!.knowledge[0].content = '长'.repeat(7900)
  oversized.chatSource!.knowledge[0].source.pointer = `/${'field'.repeat(100)}`
  expect(() => createInitialInteractionState(oversized)).toThrow('人物与字段归属超过')
  if (compilerInput.brief.characterChat?.version !== 2) throw new Error('missing upgrade')
  compilerInput.brief.characterChat.sourceReview = null
  expect(() => compileInteractionModulesV1(compilerInput)).toThrow('作者确认')
})

it('supports player-only source knowledge without granting it to any character', async () => {
  const input = await setup()
  const fragment = input.projection.characters.find(c => c.resourceKey === input.keys[0])!.fragments.find(f => f.pointer === '/background')!
  const decision = input.review.classifications.find(c => c.fragmentKey === fragment.fragmentKey)!
  decision.audienceKeys = ['player']
  const {compiled} = await compile(input)
  const state = createInitialInteractionState(compiled)
  expect(JSON.stringify(interactionVisibilityView(state, 'player'))).toContain('熟悉潮汐钟结构')
  for (const role of compiled.profiles) expect(JSON.stringify(interactionVisibilityView(state, role.participantKey))).not.toContain('熟悉潮汐钟结构')
  for (const scene of compiled.sceneTemplates) {
    const body = {commandId: 'scene', baseSequence: 0, baseStateHash: '0'.repeat(64), sceneId: `active:${scene.sceneKey}`, sceneKey: scene.sceneKey}
    const started = applyInteractionEvent(structuredClone(state), {projectId: input.scope.projectId, sessionId: 1, sequence: 1,
      type: 'interaction.scene.started', actorKey: null, targetKey: scene.sceneKey, commandId: body.commandId,
      baseSequence: 0, baseStateHash: body.baseStateHash, payloadJson: JSON.stringify(body), createdAt: Date.now()})!
    for (const role of compiled.profiles) expect(JSON.stringify(interactionVisibilityView(started, role.participantKey))).not.toContain('熟悉潮汐钟结构')
  }
  const forged = structuredClone(compiled)
  forged.sceneTemplates[0].publicKnowledgeKeys.push(forged.chatSource!.knowledge.find(k => k.audienceKeys.length === 1 && k.audienceKeys[0] === 'player')!.key)
  expect(() => createInitialInteractionState(forged)).toThrow('不能扩大')
})

it('preserves long background and voice passages through confirmed compilation, runtime context and portable backup', async () => {
  const background = '他按日期记录每一次守灯经历。\n'.repeat(620) + '末尾线索：蓝色铃绳通向旧档案间。'
  const personality = '说话先核对证据，避免替别人作主。\n'.repeat(500) + '末尾口吻：我会先查清，再给你答复。'
  const input = await setup({background, personality})
  const {compiled, settings, confirmed, compilerInput} = await compile(input)
  const profile = compiled.profiles.find(p => p.characterKey === input.keys[0])!
  const state = createInitialInteractionState(compiled)
  for (const [pointer, original] of [['/background', background], ['/personality', personality]]) {
    const fragments = compiled.chatSource!.knowledge.filter(k => k.source.resourceKey === input.keys[0] && k.source.pointer === pointer)
    expect(fragments.length).toBeGreaterThan(1)
    expect(fragments.map(k => JSON.parse(k.content)).join('')).toBe(original)
    expect(fragments.every(k => k.content.length <= 6000 && k.source.textRange)).toBe(true)
  }
  expect(profile.voiceRules.length).toBeLessThanOrEqual(8000)
  expect(profile.voiceRules).toContain('完整语言样本')
  const context = formatInteractionRuntimeContextV1(profile, buildInteractionContextWindow(state, profile.participantKey))
  expect(context).toContain('末尾线索：蓝色铃绳通向旧档案间。')
  expect(context).toContain('末尾口吻：我会先查清，再给你答复。')
  expect(JSON.stringify(interactionVisibilityView(state, 'player'))).not.toContain('蓝色铃绳')
  expect(parseInteractionState(JSON.parse(JSON.stringify(state)))).toEqual(state)
  const release = (await db.worldReleases.get(confirmed.worldReleaseId!))!
  const {session} = await seedCurrentProductBuild({scope: input.scope, worldRelease: {...release, id: confirmed.worldReleaseId!}, title: '长资料运行往返', runtimePackage: {
    schema: 'storyforge.product-runtime-package', version: 1, productType: 'character-interaction',
    definition: {productKey: 'chat.long-source', title: '长资料运行往返', description: '长资料工程验证', enabledCapabilities: ['narrative', 'interaction'], rulesetVersion: 1, initialVariables: {}},
    sourceWorld: {contentHash: release.contentHash, selection: compilerInput.brief.source.selection},
    narrative: {...compilerInput.narrative, choices: [{choiceKey: 'finish', sourceNodeKey: 'opening', targetNodeKey: 'end', text: '结束核对', description: '完成本次资料验证', unavailableReason: '', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0}]}, interaction: compiled,
  }})
  expect((await readProductRuntimeState(session.id!)).interaction!.knowledge).toEqual(state.knowledge)
  const importedId = await importProjectJSON(await exportProjectJSON(input.scope.projectId))
  const restored = (await db.chatAuthoringDrafts.where('projectId').equals(importedId).first())!
  const projection = await loadChatSourceProjectionV1({projectId: importedId, worldId: restored.worldId, workId: restored.workId}, restored.revision)
  expect(projection.projectionHash).toBe(input.projection.projectionHash)
  expect(JSON.parse(restored.settingsJson)).toEqual(settings)
  const importedSession = (await db.productRuntimeSessions.where('projectId').equals(importedId).first())!
  expect((await readProductRuntimeState(importedSession.id!)).interaction!.knowledge).toEqual(state.knowledge)
})

it('classifies long passages independently; author-only tail cannot leak through role voice rules', async () => {
  const input = await setup({personality: '他将查证放在表态之前。\n'.repeat(1100) + '幕后秘密：他的旧名字是守潮议员。'})
  const owner = input.projection.characters.find(c => c.resourceKey === input.keys[0])!
  const passages = owner.fragments.filter(f => f.pointer === '/personality')
  const last = passages.at(-1)!
  const decision = input.review.classifications.find(d => d.fragmentKey === last.fragmentKey)!
  decision.visibility = 'author-only'; decision.audienceKeys = []
  const {compiled} = await compile(input)
  expect(JSON.stringify(compiled)).not.toContain('守潮议员')
  expect(compiled.chatSource!.knowledge.filter(k => k.source.resourceKey === input.keys[0] && k.source.pointer === '/personality')).toHaveLength(passages.length - 1)
})

it('rejects malformed, duplicate, overlapping and forged text-range provenance before runtime starts', async () => {
  const input = await setup({background: '守灯经历。'.repeat(2000)})
  const {compiled, compilerInput} = await compile(input)
  const key = compiled.chatSource!.knowledge.find(k => k.source.textRange)!.key
  for (const range of [{start: -1, end: 4}, {start: 0, end: 0}, {start: 0.5, end: 1}, {start: 0, end: 4, foreign: true}, null]) {
    const altered = structuredClone(compiled)
    const seed = altered.chatSource!.knowledge.find(k => k.key === key)!
    Object.assign(seed.source, {textRange: range})
    expect(() => createInitialInteractionState(altered)).toThrow('片段范围')
  }
  const duplicate = structuredClone(compiled)
  const seed = duplicate.chatSource!.knowledge.find(k => k.key === key)!
  duplicate.chatSource!.knowledge.push({...structuredClone(seed), key: 'duplicate-range'})
  expect(() => createInitialInteractionState(duplicate)).toThrow('重复或重叠')
  const draft = compilerInput.sourceCatalog.chatSourceProjection!
  draft.characters.flatMap(c => c.fragments).find(f => f.textRange)!.textRange!.start++
  expect(() => compileInteractionModulesV1(compilerInput)).toThrow('重新核验')
})
