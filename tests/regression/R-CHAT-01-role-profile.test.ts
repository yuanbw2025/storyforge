import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {seedChatRoleProfileFixture, chatRoleProfileCompilerInput} from '../helpers/chat-role-profile'
import {confirmChatRoleProfileV1, readChatRoleProfilesV1, removeChatRoleProfileV1} from '../../src/lib/character-interaction/role-profile-store'
import {composeChatRoleVoiceRulesV1, parseChatRoleProfileCandidateV1, parseChatRoleProfileSetV1, prepareChatRoleProfileV1} from '../../src/lib/character-interaction/role-profile'
import {readChatSourceReviewContextV1} from '../../src/lib/character-interaction/source-review-context'
import * as drafts from '../../src/lib/character-interaction/draft-service'
import {parseChatAuthoringSettings} from '../../src/lib/character-interaction/authoring-contract'
import {compileInteractionModulesV1} from '../../src/lib/product-production/product-module-compilers'
import {createInitialInteractionState, buildInteractionContextWindow} from '../../src/lib/character-interaction/runtime'
import {formatInteractionRuntimeContextV1} from '../../src/lib/character-interaction/context-format'
import {parseProductProductionBriefV3} from '../../src/lib/product-production/contracts'
import {adopt} from '../../src/lib/registry/adopt'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {deleteWorkspace} from '../../src/lib/workspace/lifecycle'
import {seedCurrentProductBuild} from '../helpers/current-product-build'
import {readProductRuntimeState} from '../../src/lib/character-interaction/runtime-api'
import {seedChatNarrativeProductionFixture} from '../helpers/chat-narrative-production-fixture'
import {createProductProductionPlanV3} from '../../src/lib/product-production/plan'
import {hashProductProductionValueV2} from '../../src/lib/product-production/hash'
import {executeProductProductionCommand} from '../../src/lib/product-production/commands'
import {executeChatSituationDeterministicTaskV1} from '../../src/lib/product-production/chat-situation-tasks'
import {validateChatNarrativeProductionSourceV1} from '../../src/lib/character-interaction/narrative-production'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

it('adopts only product interpretations and compiles them into their own actor input without changing world facts', async () => {
  const f = await seedChatRoleProfileFixture(), world = await db.worldReleases.toArray()
  const before = compileInteractionModulesV1(await chatRoleProfileCompilerInput(f.scope))
  const saved = await confirmChatRoleProfileV1(f.scope, f.request, f.candidate)
  expect(saved.settingsJson).toBe(f.draft.settingsJson); expect(saved.revision).toBe(f.draft.revision + 1)
  const set = (await readChatRoleProfilesV1(f.scope))!
  expect(set.profiles[0].sourceFragments).toHaveLength(2) // Retain uncited input too.
  expect(set.profiles[0].candidate).toEqual(f.candidate)
  const input = await chatRoleProfileCompilerInput(f.scope)
  expect(parseProductProductionBriefV3(input.brief).characterChatProfiles).toEqual(set)
  const compiled = compileInteractionModulesV1(input), state = createInitialInteractionState(compiled)
  const actor = compiled.profiles.find(row => row.characterKey === f.actor.resourceKey)!
  expect(formatInteractionRuntimeContextV1(actor, buildInteractionContextWindow(state, actor.participantKey))).toContain(f.candidate.traits[0].text)
  expect(actor.voiceRules).toContain('不是世界新增事实')
  for (const other of compiled.profiles.filter(row => row !== actor)) expect(other.voiceRules).not.toContain(f.candidate.traits[0].text)
  expect(compiled.chatSource).toEqual(before.chatSource)
  expect(state.knowledge).toEqual(createInitialInteractionState(before).knowledge)
  expect(await db.worldReleases.toArray()).toEqual(world)
  expect(await db.agentRuns.count()).toBe(0)
})

it('rejects invented quotations, foreign-only evidence, unsupported categories and malformed registry writes', async () => {
  const f = await seedChatRoleProfileFixture(), context = await readChatSourceReviewContextV1(f.scope, f.request)
  const original = await drafts.readChatDraftV1(f.scope)
  for (const candidate of [
    {traits: []}, {traits: [{...f.candidate.traits[0], kind: 'truth'}]},
    {traits: [{...f.candidate.traits[0], evidence: [{fragmentKey: f.personality.fragmentKey, quote: '神谕已经应验'}]}]},
    {traits: [{...f.candidate.traits[0], evidence: [{fragmentKey: 'foreign', quote: '谨慎而固执'}]}]},
    {traits: [{...f.candidate.traits[0], audienceKeys: ['player']}]},
  ]) await expect(confirmChatRoleProfileV1(f.scope, f.request, candidate)).rejects.toThrow()
  expect(await drafts.readChatDraftV1(f.scope)).toEqual(original)
  const wrongSubject = structuredClone(context)
  wrongSubject.perspective!.actorKey = f.keys.find(key => key !== f.actor.resourceKey)!
  wrongSubject.cast.push({resourceKey: wrongSubject.perspective!.actorKey, role: 'actor'})
  expect(() => prepareChatRoleProfileV1({candidate: f.candidate, context: wrongSubject, sourceReview: f.review})).toThrow('本人的原文依据')
  const rejected = await adopt({projectId: f.scope.projectId, scope: f.scope, target: 'chatAuthoringDrafts', recordId: f.draft.id!, mode: 'replace', data: {roleProfilesJson: '{"profiles":[]}'}})
  expect(rejected.written).toEqual([])
  expect(rejected.typeErrors).toEqual([{field: 'roleProfilesJson', expected: 'json', got: '角色整理无效：字段不在允许范围'}])
  expect(await drafts.readChatDraftV1(f.scope)).toEqual(original)
})

it('rejects stale draft edits and cross-Work writes while preserving the already saved interpretation', async () => {
  const f = await seedChatRoleProfileFixture(), saved = await confirmChatRoleProfileV1(f.scope, f.request, f.candidate)
  await expect(confirmChatRoleProfileV1(f.scope, f.request, f.candidate)).rejects.toThrow('方案已变化')
  const other = await drafts.createChatDraftV2('其他角色聊天')
  const result = await adopt({projectId: other.scope.projectId, scope: other.scope, target: 'chatAuthoringDrafts', recordId: saved.id!, mode: 'replace', data: {roleProfilesJson: saved.roleProfilesJson}})
  expect(result.written).toHaveLength(0)
  expect(await drafts.readChatDraftV1(f.scope)).toEqual(saved)
})

it('uses an atomic revision check when another author changes settings after evidence preparation', async () => {
  const f = await seedChatRoleProfileFixture(), original = drafts.loadChatSourceProjectionV1
  let reads = 0
  vi.spyOn(drafts, 'loadChatSourceProjectionV1').mockImplementation(async (...args) => {
    const projection = await original(...args)
    if (++reads === 2) await drafts.saveChatDraftV1(f.scope, f.draft.revision, {...parseChatAuthoringSettings(JSON.parse(f.draft.settingsJson)), playerRole: '最新玩家身份'})
    return projection
  })
  await expect(confirmChatRoleProfileV1(f.scope, f.request, f.candidate)).rejects.toThrow('没有写入')
  expect((await drafts.readChatDraftV1(f.scope)).roleProfilesJson).toBeUndefined()
  expect((await drafts.readChatDraftV1(f.scope)).settingsJson).toContain('最新玩家身份')
})

it('invalidates even uncited input permission changes and allows explicit removal without changing a frozen build', async () => {
  const f = await seedChatRoleProfileFixture(), saved = await confirmChatRoleProfileV1(f.scope, f.request, f.candidate)
  const input = await chatRoleProfileCompilerInput(f.scope), frozen = compileInteractionModulesV1(input)
  const review = structuredClone(f.review), decision = review.classifications.find(row => row.fragmentKey === f.background.fragmentKey)!
  decision.visibility = 'author-only'; decision.audienceKeys = []
  const changed = await drafts.confirmChatSourceReviewV1(f.scope, saved.revision, review)
  await expect(chatRoleProfileCompilerInput(f.scope)).rejects.toThrow('知情范围已变化')
  expect(compileInteractionModulesV1(input)).toEqual(frozen)
  expect((await readChatRoleProfilesV1(f.scope))!.profiles).toHaveLength(1)
  await removeChatRoleProfileV1(f.scope, changed.revision, f.actor.resourceKey)
  expect((await readChatRoleProfilesV1(f.scope))!.profiles).toHaveLength(0)
  expect(compileInteractionModulesV1(await chatRoleProfileCompilerInput(f.scope)).profiles.some(row => row.voiceRules.includes(f.candidate.traits[0].text))).toBe(false)
})

it('preserves the portable profile through export/import and follows Work deletion without touching the original', async () => {
  const f = await seedChatRoleProfileFixture()
  await confirmChatRoleProfileV1(f.scope, f.request, f.candidate)
  const original = await readChatRoleProfilesV1(f.scope)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const draft = (await db.chatAuthoringDrafts.where('projectId').equals(projectId).first())!
  const scope = {projectId, worldId: draft.worldId, workId: draft.workId}
  expect(await readChatRoleProfilesV1(scope)).toEqual(original)
  const compiled = compileInteractionModulesV1(await chatRoleProfileCompilerInput(scope))
  expect(compiled.profiles.some(row => row.voiceRules.includes(f.candidate.traits[0].text))).toBe(true)
  await deleteWorkspace(projectId)
  expect(await db.chatAuthoringDrafts.where('projectId').equals(projectId).count()).toBe(0)
  expect(await readChatRoleProfilesV1(f.scope)).toEqual(original)
})

it('enforces bounded role traits and never silently drops interpretations when voice source passages are long', async () => {
  const f = await seedChatRoleProfileFixture(), context = await readChatSourceReviewContextV1(f.scope, f.request)
  const profile = prepareChatRoleProfileV1({candidate: f.candidate, context, sourceReview: f.review})
  expect(() => parseChatRoleProfileSetV1({schema: 'storyforge.chat-role-profiles', version: 1, profiles: [profile, profile]})).toThrow('角色或来源')
  expect(() => parseChatRoleProfileCandidateV1({traits: Array.from({length: 6}, (_, i) => ({...f.candidate.traits[0], text: String(i) + '字'.repeat(599)}))})).toThrow('合计最多')
  const bounded = composeChatRoleVoiceRulesV1('很长的语言样本'.repeat(2000), '作者原有补充', '必须保留的人物整理')
  expect(bounded).toContain('必须保留的人物整理'); expect(bounded).toContain('作者原有补充'); expect(bounded.length).toBeLessThanOrEqual(8000)
  expect(() => composeChatRoleVoiceRulesV1('长'.repeat(9000), '补充'.repeat(2500), '整理'.repeat(1700))).toThrow('合计过长')
})

it('freezes interpretations into an installed release and restores the same actor input after the author removes the draft profile', async () => {
  const f = await seedChatRoleProfileFixture(), saved = await confirmChatRoleProfileV1(f.scope, f.request, f.candidate)
  const input = await chatRoleProfileCompilerInput(f.scope), compiled = compileInteractionModulesV1(input)
  const release = (await db.worldReleases.get(saved.worldReleaseId!))!
  const {session} = await seedCurrentProductBuild({scope: f.scope, worldRelease: {...release, id: saved.worldReleaseId!}, title: '人物整理发布往返', runtimePackage: {
    schema: 'storyforge.product-runtime-package', version: 1, productType: 'character-interaction',
    definition: {productKey: 'chat.role-profile', title: '人物整理发布往返', description: '工程验证', enabledCapabilities: ['narrative', 'interaction'], rulesetVersion: 1, initialVariables: {}},
    sourceWorld: {contentHash: release.contentHash, selection: input.brief.source.selection},
    narrative: {...input.narrative, choices: [{choiceKey: 'finish', sourceNodeKey: 'opening', targetNodeKey: 'end', text: '结束核对', description: '完成验证', unavailableReason: '', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0}]}, interaction: compiled,
  }})
  const original = await readProductRuntimeState(session.id!)
  expect(original.interaction!.profiles.some(row => row.voiceRules.includes(f.candidate.traits[0].text))).toBe(true)
  await removeChatRoleProfileV1(f.scope, saved.revision, f.actor.resourceKey)
  expect(await readProductRuntimeState(session.id!)).toEqual(original)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).first())!
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(original.interaction)
  const draft = (await db.chatAuthoringDrafts.where('projectId').equals(projectId).first())!
  expect((await readChatRoleProfilesV1({projectId, worldId: draft.worldId, workId: draft.workId}))!.profiles).toEqual([])
  expect(await db.agentRuns.count()).toBe(0)
})

it('delivers the confirmed profile to the v3 opening situation task and rejects its use by other products or legacy settings', async () => {
  const f = await seedChatNarrativeProductionFixture(), projection = await drafts.loadChatSourceProjectionV1(f.scope, f.confirmed.revision)
  const actor = projection.characters[0], fragment = actor.fragments.find(row => row.pointer === '/personality')!
  const candidate = {traits: [{kind: 'value', text: '先谨慎判断，再坚持自己的意见。', evidence: [{fragmentKey: fragment.fragmentKey, quote: '谨慎而固执'}]}]}
  await confirmChatRoleProfileV1(f.scope, {actorKey: actor.resourceKey, fragmentKeys: [fragment.fragmentKey], draftRevision: f.confirmed.revision, projectionHash: projection.projectionHash}, candidate)
  const {brief} = await chatRoleProfileCompilerInput(f.scope)
  const plan = await createProductProductionPlanV3({buildNumber: 1, briefHash: await hashProductProductionValueV2(brief), brief})
  const created = await executeProductProductionCommand({scope: f.scope, command: {
    type: 'create-intent', commandId: 'profile.intent', productionKey: 'profile.production', productType: 'character-interaction', worldReleaseId: f.confirmed.worldReleaseId!, userText: '用人物整理制作开场',
  }})
  expect(created.ok).toBe(true)
  const saved = await executeProductProductionCommand({scope: f.scope, productionId: created.productionId, command: {
    type: 'save-brief-revision', commandId: 'profile.brief', expectedStateRevision: 0, parentRevision: null, brief,
  }})
  expect(saved.ok, JSON.stringify(saved.result)).toBe(true)
  const authorized = await executeProductProductionCommand({scope: f.scope, productionId: created.productionId, command: {
    type: 'authorize-start', commandId: 'profile.start', expectedStateRevision: 1, briefRevision: 1,
    briefHash: saved.result.briefHash as string, authorizationNonce: 'profile.author-click',
  }})
  expect(authorized.ok, JSON.stringify(authorized.result)).toBe(true)
  const production = (await db.productProductions.get(created.productionId))!
  const build = (await db.productBuilds.where('[productionId+buildNumber]').equals([production.id!, production.currentBuildNumber!]).first())!
  expect(build).toBeDefined()
  const input = {scope: f.scope, productionId: production.id!, buildId: build.id!, buildNumber: build.buildNumber, controlEpoch: build.controlEpoch,
    planHash: await hashProductProductionValueV2(plan), task: plan.tasks.find(row => row.taskKey === 'content.design')!, attempt: 1, idempotencyKey: 'profile.design',
    contextText: '', inputArtifacts: [], capabilityBindings: [], authorResolution: null, signal: new AbortController().signal}
  await expect(executeChatSituationDeterministicTaskV1({...input, buildId: build.id! + 1000}, {production, brief})).rejects.toThrow('世界来源作用域不一致')
  const result = await executeChatSituationDeterministicTaskV1(input, {production, brief})
  const source = result.artifacts.find(row => row.artifactKey === 'design.game')!.payload
  validateChatNarrativeProductionSourceV1(source)
  expect(JSON.stringify(source)).toContain(candidate.traits[0].text)
  expect(result.usage.modelCalls).toBe(0)
  expect(() => parseProductProductionBriefV3({...brief, intent: {...brief.intent, productType: 'ai-town'}, source: {...brief.source, selection: {...brief.source.selection, productType: 'ai-town'}}, characterChat: undefined})).toThrow('人物整理')
  expect(() => parseProductProductionBriefV3({...brief, characterChat: {...brief.characterChat, version: 1, sourceReview: undefined}})).toThrow()
})
