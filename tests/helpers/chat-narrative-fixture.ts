import {canonicalStringify} from '../../src/lib/agent/run/hash'
import {CHAT_ACTION_REVIEW_CHECKS_V1, type ChatNarrativeActionV1, type ChatNarrativeActionReviewV1} from '../../src/lib/types/chat-narrative'
import type { FrozenInteractionRuntimeV2 } from '../../src/lib/types/product-release'
import type { ChatMessage, ProductRuntimePackageV1 } from '../../src/lib/types'
import { readProductRuntimeStateVersion, startInteractionScene } from '../../src/lib/character-interaction/runtime-api'
import { seedCurrentProductBuild } from './current-product-build'
import { currentProductSelection, loadCurrentProductWorldSourceCatalogV1, seedCurrentProductWorld } from './current-product-world'
import {chatNarrativeShellV1} from '../../src/lib/character-interaction/narrative-production'
import {chatActionOutcomeFixture, chatActionChoiceFixture} from './chat-action-outcome'

/** Keep expression/review fixtures focused on the rule they exercise while
 * still running the real choice step, its evidence, budgets and recovery.
 * The permitted empty proposal adds no facts or permission. The supplied
 * callback counts expression calls only; the run ledger counts all calls.
 * Choice-content/error tests use their own explicit model fixtures instead. */
export function withChatActionChoiceFixture(runAI: (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>) {
  return async (messages: ChatMessage[], signal?: AbortSignal): Promise<string> => {
    if (messages[0]?.content.startsWith('这是尚未发生的角色行动选择草稿')) {
      return JSON.stringify(chatActionChoiceFixture(messages, {directions: [], selectedId: null, decisionSummary: '本工程用例不增加方向建议；表达仍须按原角色视角独立校验。'}))
    }
    const output = await runAI(messages, signal)
    let parsed: unknown
    try {parsed = JSON.parse(output)} catch {return output}
    const wire = chatActionOutcomeFixture(messages, parsed)
    return wire === parsed ? output : JSON.stringify(wire)
  }
}

/** Engineering fixture for contract/visibility tests, never real-model acceptance. */
export function chatNarrativeFixture(worldReleaseHash = '1'.repeat(64), characterKeys = ['character:guard', 'character:artisan']): FrozenInteractionRuntimeV2 {
  return {
    playerKey: 'player',
    profiles: ['guard', 'artisan'].map((participantKey, i) => ({
      participantKey, characterKey: characterKeys[i], name: i === 0 ? '叶岑' : '程素', roleLabel: i === 0 ? '守卫' : '修理师',
      voiceRules: '不替玩家决定。', initialKnowledge: [], relationshipDimensions: [], maxMemoryEntries: 30,
    })),
    sceneTemplates: [{sceneKey: 'inn', title: '暴雨驿站', purpose: '一起处理丢失物品', location: '驿站', timeLabel: '傍晚',
      participantKeys: ['guard', 'artisan'], publicKnowledgeKeys: ['source.lost'], goals: ['寻找铜印'], endingConditions: [], safetyBoundaries: ['不替玩家决定'],
      relationshipRules: [], openingNodeKey: null, endingNodeKey: null, maxTurns: 80, directorBudget: 100, order: 0}],
    chatSource: {schema: 'storyforge.chat-runtime-source', version: 1, projectionHash: '2'.repeat(64), worldReleaseHash, playerRole: '旅人沈禾',
      knowledge: [{key: 'source.lost', content: '铜印失踪。', audienceKeys: ['player', 'guard', 'artisan'],
        source: {resourceKey: characterKeys[0], sourceHash: '3'.repeat(64), pointer: '/background', purpose: 'knowledge'}}]},
    chatNarrative: {
      schema: 'storyforge.chat-narrative-content', version: 1, worldReleaseHash,
      persona: {playerKey: 'player', name: '沈禾', description: '途经驿站的旅人；没有承诺帮助搜查。', origin: 'product-private'},
      permissions: {mode: 'story', triggers: ['scene-start', 'player-response', 'continue', 'return', 'player-seed'],
        allowedNewFactKinds: ['observation', 'object'], maxNewFactsPerAction: 2, maxActiveThreads: 2, maxActionsPerTrigger: 1, maxActionCharacters: 1600, intensity: 'tension'},
      initialSituation: {
        situationKey: 'missing-seal', sceneKey: 'inn', title: '暴雨驿站', location: '驿站', timeLabel: '傍晚',
        seed: {text: '导演内化种子：找到藏在柜台下的铜印，但不能预定玩家路线。', origin: 'author-confirmed', sourceEventSequence: 0, sourceThreadKey: null},
        facts: [
          {factKey: 'lost', text: '铜印失踪。', audienceKeys: ['player', 'guard', 'artisan'], origin: 'reviewed-world', sourceKnowledgeKey: 'source.lost', sourceEventSequence: 0},
          {factKey: 'road', text: '山路被倒树挡住，驿站里暂时安全。', audienceKeys: ['player', 'guard', 'artisan'], origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0},
          {factKey: 'secret', text: '掌柜把铜印留在柜台下的木箱里。', audienceKeys: [], origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0},
          {factKey: 'regret', text: '叶岑曾误指控一位无辜旅人，始终后悔。', audienceKeys: ['guard'], origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0},
        ],
        goals: [
          {goalKey: 'find-seal', actorKey: 'guard', desire: '找回铜印', concern: '担心再次错怪人', boundary: '不逼迫旅人接受搜查', evidenceFactKeys: ['lost', 'regret'], status: 'active', updatedSequence: 0},
          {goalKey: 'fix-road', actorKey: 'artisan', desire: '恢复山路通行', concern: '天黑后不宜搬动倒树', boundary: '不要求玩家冒险', evidenceFactKeys: ['road'], status: 'active', updatedSequence: 0},
        ],
        beliefs: [{beliefKey: 'borrowed', actorKey: 'guard', text: '猜测铜印可能被某人借用，还未求证。', evidenceFactKeys: ['lost'], updatedSequence: 0}],
        threads: [{threadKey: 'investigate', title: '失踪的铜印', question: '铜印去了哪里，如何处理离开需求？', audienceKeys: ['player', 'guard', 'artisan'], participantKeys: ['guard', 'artisan'],
          evidenceFactKeys: ['lost', 'road'], closureSignals: ['找到铜印', '决定暂缓寻找并说明理由'], status: 'open', updatedSequence: 0}],
        possibilities: [{actorKey: 'guard', text: '可以建议查看后门，也可以先一起处理山路。', evidenceFactKeys: ['lost', 'road']}],
      },
    },
  }
}

export function enableChatFactDiscoveryFixture(content: FrozenInteractionRuntimeV2): void {
  const story = content.chatNarrative!
  story.permissions.allowActorSituationExpansion = true
  story.permissions.maxDiscoveriesPerSituation = 2
  story.initialSituation.facts.push({factKey: 'box', text: '柜台下有一只获准让守卫检查的木箱。', audienceKeys: ['player', 'guard', 'artisan'], origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0})
  const secret = story.initialSituation.facts.find(f => f.factKey === 'secret')!
  secret.text = '铜印在柜台下的木箱里。'
  secret.discovery = {sceneKey: 'inn', actorKeys: ['guard'], prerequisiteFactKeys: ['lost', 'box'], condition: '守卫实际打开并查看获准检查的木箱内部；打算检查或只打开而未查看不足以发现。'}
}

/** Formal isolated release/instance, with a scene-start event and no fabricated player input. */
export async function seedChatNarrativeRuntimeFixture(options: {inquiryResults?: boolean; knownDestination?: boolean; maxMemoryEntries?: number; factDiscovery?: boolean; maxActionsPerTrigger?: number; relationships?: boolean; additionalGuardGoal?: boolean; actorSituationExpansion?: boolean; actorThreadFollowup?: boolean; onlyGuard?: boolean; playerFollowup?: boolean; directorBudget?: number; contextKnowledge?: Array<{key: string; content: string; audienceKeys: string[]}>} = {}) {
  const {scope, release} = await seedCurrentProductWorld('CHAT-02 narrative contract')
  const catalog = await loadCurrentProductWorldSourceCatalogV1({scope, worldReleaseId: release.id!, productType: 'character-interaction'})
  const keys = catalog.characters.slice(0, 2).map(c => c.resourceKey)
  const interaction = chatNarrativeFixture(release.contentHash, keys)
  for (const [index, item] of (options.contextKnowledge ?? []).entries()) interaction.chatSource!.knowledge.push({
    ...item, source: {...interaction.chatSource!.knowledge[0].source, pointer: `/context-fixture/${index}`},
  })
  if (options.knownDestination) interaction.chatNarrative!.initialSituation.facts.push({factKey: 'courtyard', text: '后院就在驿站旁边，仍可通行。', audienceKeys: ['player', 'guard'], origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0})
  if (options.onlyGuard) interaction.sceneTemplates[0].participantKeys = ['guard']
  if (options.factDiscovery) enableChatFactDiscoveryFixture(interaction)
  if (options.inquiryResults) {
    const story = interaction.chatNarrative!
    story.permissions.allowInquiryResults = true
    story.permissions.allowActorSituationExpansion = true
    story.initialSituation.facts.push({factKey: 'clerk-present', text: '掌柜在柜台另一端，可以当面交谈。', audienceKeys: ['player', 'guard', 'artisan'], origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0})
    // Frozen synthetic condition for inquiry tests only. Physical discovery fixtures stay unchanged.
    if (options.factDiscovery) story.initialSituation.facts.find(f => f.factKey === 'secret')!.discovery!.condition = '掌柜亲口说明铜印仍在柜台下的木箱里；他是保管者，明确确认位置时可以确认这一项，不涉及经手用途。'
    story.initialSituation.facts.push({factKey: 'purpose', text: '铜印用于拓印破损的通行单。', audienceKeys: [], origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0})
  }
  if (options.actorSituationExpansion) interaction.chatNarrative!.permissions.allowActorSituationExpansion = true
  if (options.actorThreadFollowup) {interaction.chatNarrative!.permissions.allowActorSituationExpansion = true; interaction.chatNarrative!.permissions.allowActorThreadFollowups = true}
  if (options.playerFollowup) {interaction.chatNarrative!.permissions.allowActorSituationExpansion = true; interaction.chatNarrative!.permissions.allowPlayerFollowupSituations = true}
  if (options.additionalGuardGoal) interaction.chatNarrative!.initialSituation.goals.push({
    ...interaction.chatNarrative!.initialSituation.goals[0], goalKey: 'clarify', desire: '向旅人澄清寻找结果及猜测的依据',
  })
  if (options.relationships) for (const profile of interaction.profiles) profile.relationshipDimensions = [
    {key: 'trust', label: '信任', minimum: -100, maximum: 100, initial: 0, largeChangeThreshold: 20},
    {key: 'respect', label: '尊重', minimum: -100, maximum: 100, initial: 0, largeChangeThreshold: 20},
  ]
  if (options.maxMemoryEntries != null) for (const profile of interaction.profiles) profile.maxMemoryEntries = options.maxMemoryEntries
  if (options.maxActionsPerTrigger != null) interaction.chatNarrative!.permissions.maxActionsPerTrigger = options.maxActionsPerTrigger
  if (options.directorBudget != null) interaction.sceneTemplates[0].directorBudget = options.directorBudget
  for (const item of options.contextKnowledge ?? []) if (['player', ...interaction.profiles.map(p => p.participantKey)].every(key => item.audienceKeys.includes(key))) {
    interaction.sceneTemplates[0].publicKnowledgeKeys.push(item.key)
  }
  const {schema: _schema, version: _version, ...narrative} = chatNarrativeShellV1(interaction.chatNarrative!)
  const runtimePackage: ProductRuntimePackageV1 = {
    schema: 'storyforge.product-runtime-package', version: 1, productType: 'character-interaction',
    definition: {productKey: 'chat.narrative.contract', title: '驿站工程核验', description: '合同工程夹具', enabledCapabilities: ['narrative', 'interaction'], rulesetVersion: 1, initialVariables: {}},
    sourceWorld: {contentHash: release.contentHash, selection: currentProductSelection('character-interaction', {participants: keys}, catalog.worldReference.referenceHash)},
    narrative, interaction,
  }
  const {session} = await seedCurrentProductBuild({scope, worldRelease: release as typeof release & {id: number}, runtimePackage, title: '驿站'})
  const version = await readProductRuntimeStateVersion(session.id!)
  const scene = await startInteractionScene({sessionId: session.id!, commandId: 'narrative.scene', baseSequence: version.sequence, baseStateHash: version.stateHash, sceneId: 'inn.current', sceneKey: 'inn'})
  return {scope, sessionId: session.id!, sceneSequence: scene.sequence}
}


/** Synthetic review for engineering tests only; never narrative quality evidence. */
export function chatActionReviewOutputFixture() {
  return {checks: CHAT_ACTION_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程审查夹具，不是模型质量验收'}))}
}
export function chatActionReviewFixture(action: ChatNarrativeActionV1): ChatNarrativeActionReviewV1 {
  return {reviewedActionJson: canonicalStringify(action), ...chatActionReviewOutputFixture()}
}
