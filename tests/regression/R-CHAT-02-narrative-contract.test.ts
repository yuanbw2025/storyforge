import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chatNarrativeFixture } from '../helpers/chat-narrative-fixture'
import { buildInteractionContextWindow, createInitialInteractionState, interactionVisibilityView, parseInteractionState, rebaseInteractionStateForBranch } from '../../src/lib/character-interaction/runtime'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { branchProductRuntimeSession, createProductRuntimeCheckpoint, readProductRuntimeState, readProductRuntimeStateVersion, startInteractionScene } from '../../src/lib/character-interaction/runtime-api'
import { seedCurrentProductWorld, currentProductSelection, loadCurrentProductWorldSourceCatalogV1 } from '../helpers/current-product-world'
import { seedCurrentProductBuild } from '../helpers/current-product-build'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import type { ProductRuntimePackageV1 } from '../../src/lib/types'
import {chatNarrativeShellV1} from '../../src/lib/character-interaction/narrative-production'

it('keeps determined truth, mistaken beliefs, goals and future possibilities in separate role views', () => {
  const fixture = chatNarrativeFixture()
  const state = createInitialInteractionState(fixture)
  expect(parseInteractionState(JSON.parse(JSON.stringify(state)))).toEqual(state)
  const guard = interactionVisibilityView(state, 'guard').chatNarrative!
  const artisan = interactionVisibilityView(state, 'artisan').chatNarrative!
  const player = interactionVisibilityView(state, 'player').chatNarrative!
  expect(guard.goals.map(g => g.goalKey)).toEqual(['find-seal'])
  expect(artisan.goals.map(g => g.goalKey)).toEqual(['fix-road'])
  expect(player.goals).toEqual([])
  expect(state.knowledge.some(item => item.knowledgeKey === 'chat.player-role')).toBe(false)
  expect(guard.beliefs[0].text).toContain('猜测')
  expect(guard.facts.some(f => f.text.includes('被某人借用'))).toBe(false)
  expect(guard.possibilities[0].text).toContain('建议')
  expect(player.possibilities).toEqual([])
  for (const view of [guard, artisan, player]) {
    expect(JSON.stringify(view)).not.toContain('柜台下')
    expect(JSON.stringify(view)).not.toContain('导演内化种子')
    expect(view.persona.name).toBe('沈禾')
  }
  expect(JSON.stringify(artisan)).not.toContain('曾误指控')
  expect(JSON.stringify(player)).not.toContain('曾误指控')
  expect(() => interactionVisibilityView(state, 'outsider')).toThrow()
  expect(fixture.chatNarrative!.initialSituation.facts).toHaveLength(4)
})

it.each([
  ['导演秘密成为人物目标依据', (f: ReturnType<typeof chatNarrativeFixture>) => { f.chatNarrative!.initialSituation.goals[0].evidenceFactKeys = ['secret'] }, '视角不可知'],
  ['替玩家设定感受和目标', f => { f.chatNarrative!.initialSituation.goals[0].actorKey = 'player' }, '替玩家'],
  ['初始世界证据改写', f => { f.chatNarrative!.initialSituation.facts[0].text = '已经找到了铜印' }, '原文证据'],
  ['把角色私有世界事实公开', f => { f.chatSource!.knowledge[0].audienceKeys = ['guard'] }, '扩大'],
  ['动机伪装成世界事实', f => { f.chatSource!.knowledge[0].source.purpose = 'motivation' }, '用途不符'],
  ['缺少来源确认', f => { delete f.chatSource }, '已确认'],
  ['切换世界', f => { f.chatNarrative!.worldReleaseHash = '4'.repeat(64) }, '来源世界不同'],
  ['跳过初始候选确认', f => { f.chatNarrative!.initialSituation.seed.origin = 'player-request' }, '作者确认'],
  ['预设已完成事件', f => { f.chatNarrative!.initialSituation.facts[1].origin = 'runtime-consequence' }, '已提交事件'],
  ['预定解决剧情', f => { f.chatNarrative!.initialSituation.threads[0].status = 'resolved' }, '剧情线状态'],
  ['超范围自动演绎', f => { f.chatNarrative!.permissions.maxActionsPerTrigger = 500 }, '动作上限'],
  ['离线触发未授权', f => { (f.chatNarrative!.permissions.triggers as string[]).push('offline') }, '主动触发'],
  ['包外场景', f => { f.chatNarrative!.initialSituation.sceneKey = 'foreign' }, '包外场景'],
] as const)('rejects %s', (_name, mutate, message) => {
  const fixture = chatNarrativeFixture()
  mutate(fixture)
  expect(() => createInitialInteractionState(fixture)).toThrow(message)
})

it('rebases every narrative causal reference and refuses future events without mutating the parent', () => {
  const state = createInitialInteractionState(chatNarrativeFixture())
  const narrative = state.chatNarrative!
  narrative.revision = 2; narrative.lastEventSequence = 7
  narrative.situation.seed = {text: '玩家要求先修路', origin: 'player-request', sourceEventSequence: 3, sourceThreadKey: null}
  narrative.situation.facts.push({factKey: 'checked', text: '后门已经检查，没有发现铜印。', audienceKeys: ['guard'], origin: 'runtime-consequence', sourceKnowledgeKey: null, sourceEventSequence: 7})
  narrative.situation.goals[0].updatedSequence = 7
  narrative.situation.beliefs[0].updatedSequence = 7
  narrative.situation.threads[0].status = 'paused'; narrative.situation.threads[0].updatedSequence = 7
  const child = rebaseInteractionStateForBranch(state, 9)
  expect(child.chatNarrative!.lastEventSequence).toBe(-3)
  expect(child.chatNarrative!.situation.seed.sourceEventSequence).toBe(-7)
  expect(child.chatNarrative!.situation.facts.at(-1)!.sourceEventSequence).toBe(-3)
  expect(child.chatNarrative!.situation.goals[0].updatedSequence).toBe(-3)
  expect(child.chatNarrative!.situation.beliefs[0].updatedSequence).toBe(-3)
  expect(child.chatNarrative!.situation.threads[0].updatedSequence).toBe(-3)
  expect(parseInteractionState(child)).toEqual(child)
  expect(state.chatNarrative!.lastEventSequence).toBe(7)
  expect(() => rebaseInteractionStateForBranch(state, 6)).toThrow('目标序号之后')
  const future = structuredClone(state)
  future.chatNarrative!.situation.goals[0].updatedSequence = 8
  expect(() => parseInteractionState(future)).toThrow('尚未发生')
})

it('does not enable a narrative state for an old package', () => {
  const fixture = chatNarrativeFixture()
  delete fixture.chatNarrative
  const state = createInitialInteractionState(fixture)
  expect(state).not.toHaveProperty('chatNarrative')
  expect(interactionVisibilityView(state, 'guard')).not.toHaveProperty('chatNarrative')
})

it('pauses context assembly for an unrelated active scene and rejects a conflicting player identity', () => {
  const fixture = chatNarrativeFixture()
  expect(() => createInitialInteractionState({...fixture, playerKey: 'someone-else'})).toThrow('玩家身份标识')
  const state = createInitialInteractionState(fixture)
  state.activeScene = {...state.sceneTemplates[0], sceneKey: 'other-scene', sceneId: 'scene.other', status: 'active', activeParticipantKeys: ['guard'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  expect(() => buildInteractionContextWindow(state, 'guard')).toThrow('尚未衔接')
})

describe('formal runtime persistence and registered context', () => {
  beforeEach(async () => { db.close(); await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('preserves the chosen situation through the package, instance, checkpoint, branch, refresh and project roundtrip', async () => {
    const owned = await seedCurrentProductWorld('CHAT-02 contract engineering')
    const catalog = await loadCurrentProductWorldSourceCatalogV1({scope: owned.scope, worldReleaseId: owned.release.id!, productType: 'character-interaction'})
    const keys = catalog.characters.slice(0, 2).map(c => c.resourceKey)
    const interaction = chatNarrativeFixture(owned.release.contentHash, keys)
    const {schema: _schema, version: _version, ...narrative} = chatNarrativeShellV1(interaction.chatNarrative!)
    const pkg: ProductRuntimePackageV1 = {
      schema: 'storyforge.product-runtime-package', version: 1, productType: 'character-interaction',
      definition: {productKey: 'chat.narrative.contract', title: '驿站工程核验', description: '合同工程夹具', enabledCapabilities: ['narrative', 'interaction'], rulesetVersion: 1, initialVariables: {}},
      sourceWorld: {contentHash: owned.release.contentHash, selection: currentProductSelection('character-interaction', {participants: keys}, catalog.worldReference.referenceHash)},
      narrative,
      interaction,
    }
    expect(parseProductRuntimePackageV1(JSON.stringify(pkg)).interaction!.chatNarrative).toEqual(interaction.chatNarrative)
    const foreign = {...pkg, productType: 'ai-town', interaction: {...interaction, chatSource: undefined}}
    expect(() => parseProductRuntimePackageV1(foreign)).toThrow('只属于角色聊天')
    const {session} = await seedCurrentProductBuild({scope: owned.scope, worldRelease: owned.release as typeof owned.release & {id: number}, runtimePackage: pkg, title: '驿站'})
    const version = await readProductRuntimeStateVersion(session.id!)
    await startInteractionScene({sessionId: session.id!, commandId: 'narrative.scene', baseSequence: version.sequence, baseStateHash: version.stateHash, sceneId: 'inn.current', sceneKey: 'inn'})
    const before = await readProductRuntimeState(session.id!)
    const context = await assembleContext({projectId: owned.scope.projectId, scope: owned.scope, productRuntimeSessionId: session.id!, interactionParticipantKey: 'guard', sourceKeys: ['interactionRuntime']})
    expect(context.text).toContain('当前情境的单一角色视角')
    expect(context.text).toContain('担心再次错怪人')
    expect(context.text).not.toContain('柜台下')
    expect(context.text).not.toContain('天黑后不宜')
    const checkpoint = await createProductRuntimeCheckpoint({sessionId: session.id!, name: '开场'})
    const child = await branchProductRuntimeSession({parentSessionId: session.id!, throughSequence: checkpoint.throughSequence, title: '另一选择'})
    expect((await readProductRuntimeState(child.id!)).interaction!.chatNarrative).toEqual(before.interaction!.chatNarrative)
    db.close(); await db.open()
    expect((await readProductRuntimeState(session.id!)).interaction!.chatNarrative).toEqual(before.interaction!.chatNarrative)
    const importedId = await importProjectJSON(await exportProjectJSON(owned.scope.projectId))
    const restored = (await db.productRuntimeSessions.where('projectId').equals(importedId).toArray()).find(s => s.title === session.title)!
    expect((await readProductRuntimeState(restored.id!)).interaction!.chatNarrative).toEqual(before.interaction!.chatNarrative)
  })
})
