import type {ProductRuntimePackageV1} from '../../src/lib/types'
import {chatNarrativeShellV1} from '../../src/lib/character-interaction/narrative-production'
import {readProductRuntimeStateVersion, startInteractionScene} from '../../src/lib/character-interaction/runtime-api'
import {chatNarrativeFixture} from './chat-narrative-fixture'
import {seedCurrentProductWorld, loadCurrentProductWorldSourceCatalogV1, currentProductSelection} from './current-product-world'
import {seedCurrentProductBuild} from './current-product-build'

/** Synthetic source and release for isolation/capacity tests; never a human or model-quality sample. */
export async function seedChatEnsembleFixture(count: 3 | 8 = 3) {
  const {scope, release} = await seedCurrentProductWorld('CHAT-06 ensemble engineering fixture', {minimumCharacters: count})
  const catalog = await loadCurrentProductWorldSourceCatalogV1({scope, worldReleaseId: release.id!, productType: 'character-interaction'})
  const keys = catalog.characters.slice(0, count).map(c => c.resourceKey)
  const interaction = chatNarrativeFixture(release.contentHash, keys), story = interaction.chatNarrative!
  const extra = [
    ['courier', '唐巡', '送药人', '保住药箱', '药箱在门边，旁边有可供垫高的木凳。'],
    ['cook', '曾澈', '厨师', '照顾灶火', '灶边有已经准备好的干柴。'],
    ['doctor', '梅宁', '医师', '整理药材', '台上有待分类的药材包。'],
    ['keeper', '陆亭', '守店人', '照明', '柜边放着待修剪灯芯的油灯。'],
    ['scribe', '尹平', '抄写员', '保管路单', '路单放在一张需要擦干的桌面上。'],
    ['porter', '卫冬', '搬运工', '固定行李', '门内有靠在墙边的行李架。'],
  ]
  for (let i = 2; i < count; i++) {
    const [participantKey, name, roleLabel, desire, fact] = extra[i - 2]
    interaction.profiles.push({...structuredClone(interaction.profiles[0]), participantKey, characterKey: keys[i], name, roleLabel})
    story.initialSituation.facts.push({factKey: `prepared-${participantKey}`, text: fact, audienceKeys: ['player', participantKey], origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0})
    story.initialSituation.goals.push({goalKey: `care-${participantKey}`, actorKey: participantKey, desire, concern: '暴雨持续，需先处理眼前事项。', boundary: '不要求玩家参与，不抢占别人所需物品。', evidenceFactKeys: [`prepared-${participantKey}`], status: 'active', updatedSequence: 0})
  }
  const audience = ['player', ...interaction.profiles.map(p => p.participantKey)]
  for (const fact of story.initialSituation.facts.filter(f => f.factKey.startsWith('prepared-'))) fact.audienceKeys = [...audience]
  for (const [actor, text] of [['guard', '柜台上有散开的账页和可用的镇纸。'], ['artisan', '门边有松散堆放的备用绳索。']]) {
    story.initialSituation.facts.push({factKey: `prepared-${actor}`, text, audienceKeys: [...audience], origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0})
  }
  interaction.sceneTemplates[0].participantKeys = audience.slice(1)
  interaction.chatSource!.knowledge[0].audienceKeys = [...audience]
  story.initialSituation.facts.find(f => f.factKey === 'lost')!.audienceKeys = [...audience]
  story.initialSituation.facts.find(f => f.factKey === 'road')!.audienceKeys = [...audience]
  story.permissions.maxActionsPerTrigger = 3
  const {schema: _schema, version: _version, ...narrative} = chatNarrativeShellV1(story)
  const runtimePackage: ProductRuntimePackageV1 = {schema: 'storyforge.product-runtime-package', version: 1, productType: 'character-interaction',
    definition: {productKey: 'chat.ensemble.contract', title: '群像工程夹具', description: '独立目标、私聊与局部失败验证；不是文学质量样本。', enabledCapabilities: ['narrative', 'interaction'], rulesetVersion: 1, initialVariables: {}},
    sourceWorld: {contentHash: release.contentHash, selection: currentProductSelection('character-interaction', {participants: keys}, catalog.worldReference.referenceHash)}, narrative, interaction}
  const {session} = await seedCurrentProductBuild({scope, worldRelease: release as typeof release & {id: number}, runtimePackage, title: '群像工程核验'})
  const v = await readProductRuntimeStateVersion(session.id!)
  const scene = await startInteractionScene({sessionId: session.id!, commandId: 'ensemble-scene', baseSequence: v.sequence, baseStateHash: v.stateHash, sceneId: 'inn.ensemble', sceneKey: 'inn'})
  return {scope, sessionId: session.id!, sceneSequence: scene.sequence}
}
