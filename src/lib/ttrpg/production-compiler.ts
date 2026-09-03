import type {
  FrozenRuntimeMediaAssetV2,
  ProductRuntimePackageV1,
  RulePackV1,
  TtrpgCampaignContentV1,
  TtrpgCharacterSheetV2,
  TtrpgCharacterTemplateV1,
  TtrpgProductionBriefV2,
  ProductWorldSourceSelectionV1,
} from '../types'
import type { ProductProductionWorldSourceCatalogV2 as ProductWorldSourceCatalog } from '../product-production/world-source'
import {
  parseTtrpgCampaignContentV1,
  validateTtrpgCampaignForPublicationV1,
} from './campaign'
import { createRankLiteQuickCardsV2 } from './rank-lite-rule-pack'
import { evaluateRuleNumberExpressionV1, parseRulePackV1 } from './rule-pack'
import { createCompleteTtrpgCharacterSheetV2 } from './character-sheet'
import { resolveTtrpgCampaignDesignV2, validateTtrpgCampaignDesignLocksV2 } from './campaign-proposal'

function fail(message: string): never { throw new Error(`[ttrpg-production-compiler] ${message}`) }
function safeKey(value: string, fallback: string): string {
  const normalized = value.normalize('NFKD').replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-|-$/g, '').slice(0, 160)
  return normalized || fallback
}

function productLocationKey(index: number): string {
  return `location.world.${String(index + 1).padStart(3, '0')}`
}

/** Bind governed production assets to stable TTRPG slots without changing slot identity. */
export function bindProductionMediaToTtrpgCampaignV1(
  value: TtrpgCampaignContentV1,
  assets: FrozenRuntimeMediaAssetV2[],
): TtrpgCampaignContentV1 {
  const campaign = structuredClone(value)
  if (!campaign.mediaManifest || !campaign.visualBible) return campaign
  const unbound = campaign.mediaManifest.slots.filter(slot => slot.assetKey == null)
  const compatible = (asset: FrozenRuntimeMediaAssetV2, slot: typeof unbound[number]) => {
    if (asset.kind === 'background' || asset.kind === 'cg') return slot.kind === 'scene' || slot.kind === 'map'
    if (asset.kind === 'character-pose') return slot.kind === 'character-portrait' || slot.kind === 'token'
    if (asset.kind === 'character-expression') return slot.kind === 'character-expression'
    if (asset.kind === 'ui') return ['map', 'token', 'item-icon', 'handout'].includes(slot.kind)
    return false
  }
  const used = new Set<string>()
  for (const asset of assets) {
    const tagged = unbound.find(slot => !used.has(slot.slotKey) && compatible(asset, slot)
      && (asset.characterTag === slot.targetRef || asset.sceneTag === slot.targetRef))
    const slot = tagged ?? unbound.find(candidate => !used.has(candidate.slotKey) && compatible(asset, candidate))
    if (!slot) continue
    slot.assetKey = asset.assetKey; used.add(slot.slotKey)
    const character = campaign.characterTemplates.find(item => item.characterKey === slot.targetRef)
    if (character && slot.kind === 'character-portrait') character.portraitAssetKey = asset.assetKey
    const visualCharacter = campaign.visualBible.characters.find(item => item.characterKey === slot.targetRef)
    if (visualCharacter && !visualCharacter.referenceAssetKeys.includes(asset.assetKey)) {
      visualCharacter.referenceAssetKeys.push(asset.assetKey)
    }
    const map = campaign.tabletop?.maps.find(item => item.mapKey === slot.targetRef)
    if (map && slot.kind === 'map') map.backgroundAssetKey = asset.assetKey
    const handout = campaign.handouts.find(item => item.handoutKey === slot.targetRef)
    if (handout && slot.kind === 'handout') handout.assetKey = asset.assetKey
  }
  return campaign
}

type Narrative = ProductRuntimePackageV1['narrative']

function resources(rulePack: RulePackV1, attributes: Record<string, number>): Record<string, number> {
  return Object.fromEntries(rulePack.resources.map(resource => {
    const maximum = evaluateRuleNumberExpressionV1(resource.maximumFormula, attributes)
    return [resource.key, resource.initialMode === 'maximum' ? maximum : resource.minimum]
  }))
}

function productionStartingProgression(input: {
  rulePack: RulePackV1
  startingLevelOrTier: string
  attributes: Record<string, number>
}): TtrpgCharacterSheetV2['rules']['progression'] {
  const model = input.rulePack.advancement.progressionModel ?? 'point-buy'
  const requested = input.startingLevelOrTier.trim()
  if (model === 'numeric-level') {
    const level = requested === '规则默认' ? 1 : Number(requested)
    const maximum = input.rulePack.advancement.maximumLevel ?? 20
    if (!Number.isInteger(level) || level < 1 || level > maximum) {
      fail(`初始等级必须是 1～${maximum} 的整数`)
    }
    return { model: 'numeric-level', level, rankKey: null, experience: 0, unspentPoints: 0 }
  }
  if (model === 'rank') {
    const order = input.rulePack.advancement.rankOrder?.length
      ? input.rulePack.advancement.rankOrder : ['D', 'C', 'B', 'A']
    const rankKey = order[Number(input.attributes.rankPower) - 1]
      ?? (requested === '规则默认' ? order[0] : requested)
    if (!rankKey || !order.includes(rankKey)) fail(`初始阶位必须属于 ${order.join('/')}`)
    return { model: 'rank', level: null, rankKey, experience: 0, unspentPoints: 0 }
  }
  return { model, level: null, rankKey: null, experience: 0, unspentPoints: 0 }
}

function characterFromSeat(input: {
  seat: TtrpgProductionBriefV2['table']['seats'][number]
  characterPolicy: TtrpgProductionBriefV2['characters']
  index: number
  rulePack: RulePackV1
  sourceCatalog: Pick<ProductWorldSourceCatalog, 'characters'>
  confirmed: boolean
}): TtrpgCharacterTemplateV1 {
  const source = input.seat.sourceCharacterResourceKey == null ? null
    : input.sourceCatalog.characters.find(character => character.resourceKey === input.seat.sourceCharacterResourceKey) ?? null
  let attributes = Object.fromEntries(input.rulePack.attributes.map(attribute => [attribute.key, attribute.defaultValue]))
  if (input.rulePack.ruleSystemId === 'storyforge.rank-lite' && input.seat.characterMode === 'quick-card' && input.seat.rankTier) {
    const card = createRankLiteQuickCardsV2().find(candidate => candidate.tier === input.seat.rankTier)
    if (card) attributes = Object.fromEntries(input.rulePack.attributes.map(attribute => [
      attribute.key, card.attributes[attribute.key as keyof typeof card.attributes] ?? attribute.defaultValue,
    ]))
  }
  if (input.rulePack.advancement.progressionModel === 'rank' && input.seat.characterMode !== 'quick-card') {
    const order = input.rulePack.advancement.rankOrder ?? []
    const requestedTier = input.characterPolicy.startingLevelOrTier
    const rankIndex = order.indexOf(requestedTier)
    if (rankIndex >= 0 && Object.prototype.hasOwnProperty.call(attributes, 'rankPower')) {
      attributes.rankPower = rankIndex + 1
    }
  }
  const progression = productionStartingProgression({
    rulePack: input.rulePack,
    startingLevelOrTier: input.characterPolicy.startingLevelOrTier,
    attributes,
  })
  if (
    progression.model === 'numeric-level'
    && progression.level != null
    && Object.prototype.hasOwnProperty.call(attributes, 'level')
  ) {
    attributes.level = progression.level
  }
  const sourceRefs = source ? [source.resourceKey] : [`seat:${input.seat.seatKey}`]
  const name = input.seat.characterName || source?.name || `${input.seat.label}角色`
  const description = source?.description || `${name} 是由${input.seat.characterMode === 'manual' ? '玩家手动完善' : input.seat.characterMode === 'quick-card' ? `${input.seat.rankTier}级快速卡` : 'AI 按规则生成'}的玩家角色。`
  const rank = attributes.rankPower ?? 1
  const template: Omit<TtrpgCharacterTemplateV1, 'characterSheet'> = {
    characterKey: source ? `character.world.${String(input.index + 1).padStart(3, '0')}`
      : safeKey(`pc.${input.seat.seatKey}`, `pc.${input.index + 1}`), name, description,
    seatKey: input.seat.seatKey, sourceRefs, role: 'player', controller: input.seat.controller, attributes,
    attributeMappings: Object.fromEntries(input.rulePack.attributes.map(attribute => [attribute.key, {
      value: attributes[attribute.key],
      derivationRule: source
        ? `依据冻结世界角色 ${source.name} 的叙事定位，采用 ${input.rulePack.ruleSystemId}@${input.rulePack.ruleSystemVersion} 的作者确认映射。`
        : `${input.seat.characterMode} 车卡采用冻结 RulePack 的合法初始值。`,
      sourceRefs, authorConfirmed: input.confirmed,
    }])),
    skills: Object.fromEntries(input.rulePack.actions.map((action, actionIndex) => [action.key, Math.max(0, rank + (actionIndex % 2))])),
    resources: resources(input.rulePack, attributes),
    itemKeys: input.rulePack.items.slice(0, Math.min(2, input.rulePack.items.length)).map(item => item.key),
    actionKeys: input.rulePack.actions.map(action => action.key), portraitAssetKey: null,
    playerProfile: {
      privateGoal: input.seat.privateGoal || '与团队协作推进当前战役目标，同时保留角色自主决定权。',
      secret: source ? `与 ${source.name} 的冻结背景相关、需由 KP 按信息规则逐步揭示的私人信息。` : '由玩家与 KP 在 Session Zero 确认的私人信息。',
      portrayal: `${input.seat.controller === 'ai' ? 'AI' : '真人'}控制；行动必须遵守角色已知信息、资源、状态和规则限制。`,
    },
  }
  return {
    ...template,
    characterSheet: createCompleteTtrpgCharacterSheetV2({
      template,
      rulePack: input.rulePack,
      authoringMode: source ? 'world-conversion'
        : input.seat.characterMode === 'manual' ? 'manual'
          : input.seat.characterMode === 'ai-generated' ? 'ai' : 'guided',
      identity: {
        name,
        shortTermGoal: input.seat.privateGoal || template.playerProfile!.privateGoal,
        desires: [input.seat.privateGoal || template.playerProfile!.privateGoal],
      },
      progression,
    }),
  }
}

function npcTemplate(input: {
  source: ProductWorldSourceCatalog['characters'][number] | null
  index: number
  rulePack: RulePackV1
  campaign: TtrpgProductionBriefV2['campaign']
  confirmed: boolean
}): TtrpgCharacterTemplateV1 {
  const attributes = Object.fromEntries(input.rulePack.attributes.map((attribute, attributeIndex) => [
    attribute.key,
    Math.max(attribute.minimum, Math.min(attribute.maximum, attribute.defaultValue + (attributeIndex === input.index % input.rulePack.attributes.length ? 1 : 0))),
  ]))
  const name = input.source?.name ?? '核心对手'
  const description = input.source?.description || `围绕“${input.campaign.coreConflict}”采取行动的关键 NPC。`
  const sourceRefs = input.source ? [input.source.resourceKey] : ['product:generated-npc']
  const template: Omit<TtrpgCharacterTemplateV1, 'characterSheet'> = {
    characterKey: input.source ? `npc.world.${String(input.index + 1).padStart(3, '0')}` : `npc.generated.${input.index + 1}`,
    name, description, sourceRefs, role: 'npc', controller: 'gm', attributes,
    attributeMappings: Object.fromEntries(input.rulePack.attributes.map(attribute => [attribute.key, {
      value: attributes[attribute.key], derivationRule: `按 NPC 在“${input.campaign.coreConflict}”中的阻力职能映射。`,
      sourceRefs, authorConfirmed: input.confirmed,
    }])),
    skills: Object.fromEntries(input.rulePack.actions.map((action, actionIndex) => [action.key, 1 + actionIndex % 3])),
    resources: resources(input.rulePack, attributes), itemKeys: input.rulePack.items.slice(0, 1).map(item => item.key),
    actionKeys: input.rulePack.actions.map(action => action.key), portraitAssetKey: null,
    gmProfile: {
      objective: `依照自身立场影响“${input.campaign.coreConflict}”的走向。`,
      leverage: input.source?.description || '掌握一项能改变局部局势的资源、关系或情报。',
      secret: '只有当玩家行动、证据或关系达到条件时才能揭示的关键信息。',
      portrayal: `保持${name}的目标、知识边界和既有关系一致，不替玩家决定。`,
      escalation: '玩家失败时推进局势并附加代价；不封死关键线索，不凭空改写已提交事实。',
    },
  }
  return {
    ...template,
    characterSheet: createCompleteTtrpgCharacterSheetV2({
      template,
      rulePack: input.rulePack,
      authoringMode: input.source ? 'world-conversion' : 'guided',
      identity: {
        name,
        shortTermGoal: template.gmProfile!.objective,
        desires: [template.gmProfile!.objective],
      },
    }),
  }
}

/**
 * Compile the model-authored narrative graph and frozen nine-step Brief into a
 * complete CampaignPack. Nothing here is a fixed showcase campaign: scene,
 * branch, ending, character and source counts all come from the current Build.
 */
export function compileProductionTtrpgCampaignV2(input: {
  productionKey: string
  brief: TtrpgProductionBriefV2
  selection: ProductWorldSourceSelectionV1
  narrative: Narrative
  sourceCatalog: Pick<ProductWorldSourceCatalog, 'characters' | 'locations' | 'artifacts' | 'storyArcs'>
  rulePack: RulePackV1
  worldContentHash: string
  worldSourceBundleHash: string
}): TtrpgCampaignContentV1 {
  const rulePack = parseRulePackV1(input.rulePack)
  const brief = input.brief
  const resolvedDesign = brief.campaignDesign ? resolveTtrpgCampaignDesignV2(brief.campaignDesign) : {
    background: brief.campaign.background,
    coreConflict: brief.campaign.coreConflict,
    opening: brief.story.openingScene,
    frontConcepts: [brief.campaign.coreConflict],
    secretConcepts: [`围绕“${brief.campaign.coreConflict}”存在尚未公开的真实动机。`],
    endingConcepts: ['公开真相并承担后果', '保护眼前的人并保留后续压力'],
    lockedSections: [],
  }
  const effectiveCampaign = { ...brief.campaign, background: resolvedDesign.background, coreConflict: resolvedDesign.coreConflict }
  const sourceRef = `world:${input.worldContentHash}`
  if (input.narrative.nodes.length < 3) fail('模型叙事不足以编译 CampaignPack')
  const playerCharacters = brief.table.seats.map((seat, index) => characterFromSeat({
    seat, characterPolicy: brief.characters, index, rulePack, sourceCatalog: input.sourceCatalog,
    confirmed: brief.confirmations.numericMappings,
  }))
  const usedSourceKeys = new Set(brief.table.seats.flatMap(seat => seat.sourceCharacterResourceKey == null ? [] : [seat.sourceCharacterResourceKey]))
  const selectedCharacterKeys = new Set(input.selection.roleBindings.participants ?? [])
  const npcSources = input.sourceCatalog.characters.filter(character => (
    selectedCharacterKeys.has(character.resourceKey) && !usedSourceKeys.has(character.resourceKey)
  ))
  const npcs = (npcSources.length ? npcSources : [null]).slice(0, 8).map((source, index) => npcTemplate({
    source, index, rulePack, campaign: effectiveCampaign, confirmed: brief.confirmations.numericMappings,
  }))
  const characters = [...playerCharacters, ...npcs]
  const participantKeys = characters.map(character => character.characterKey)
  const investigationAction = rulePack.actions.find(action => action.effects.some(effect => effect.kind === 'check'))?.key
    ?? rulePack.actions[0]?.key ?? fail('RulePack 缺少可用于场景的行动')
  const actionKeys = rulePack.actions.map(action => action.key)
  const nonEndingNodes = input.narrative.nodes.filter(node => node.kind !== 'ending')
  const clueNodes = nonEndingNodes.length ? nonEndingNodes : input.narrative.nodes.slice(0, 1)
  const clueKeys = new Map<string, string>()
  const clues = clueNodes.map((node, clueIndex) => {
    const clueKey = safeKey(`clue.${node.key}`, `clue.${clueIndex + 1}`)
    clueKeys.set(node.key, clueKey)
    const required = clueIndex < Math.max(1, Math.min(clueNodes.length, brief.story.targetQuestCount))
    const pathCount = required ? Math.max(2, brief.story.clueRedundancy) : 1
    return {
      clueKey, title: `${node.title}的线索`, description: node.summary,
      conclusionKey: safeKey(`conclusion.${node.key}`, `conclusion.${clueIndex + 1}`), required,
      discoveryPaths: Array.from({ length: pathCount }, (_, pathIndex) => {
        const pathNode = nonEndingNodes[(clueIndex + pathIndex) % nonEndingNodes.length]
        return {
          pathKey: `${clueKey}.path.${pathIndex + 1}`, sceneKey: pathNode.key,
          actionKey: actionKeys[pathIndex % actionKeys.length] ?? investigationAction,
          failForward: brief.story.failForward
            ? `即使检定失败，也提供较弱信息并推进时间、风险或资源代价；不得永久封死“${node.title}”。`
            : `失败后由 KP 给出新的可执行调查入口。`,
        }
      }),
      visibility: 'discoverable' as const, sourceRefs: [sourceRef],
    }
  })
  const locationResourceKeys = input.selection.roleBindings.locations ?? []
  for (const locationResourceKey of locationResourceKeys) {
    if (!input.sourceCatalog.locations.some(location => location.resourceKey === locationResourceKey)) {
      fail(`冻结素材选择引用了不存在的地点:${locationResourceKey}`)
    }
  }
  const scenes = input.narrative.nodes.map((node, index) => {
    const locationResourceKey = locationResourceKeys[index % Math.max(1, locationResourceKeys.length)] ?? null
    const directClue = clueKeys.get(node.key)
    return {
      sceneKey: node.key, title: node.title,
      description: node.key === input.narrative.entryNodeKey ? `${resolvedDesign.opening}\n${node.summary}` : node.summary,
      locationKey: locationResourceKey == null ? null
        : productLocationKey(locationResourceKeys.indexOf(locationResourceKey)),
      participantKeys, clueKeys: directClue ? [directClue] : [], actionKeys,
      nextSceneKeys: [...node.successorKeys],
      failureForward: brief.story.failForward
        ? `失败改变局势、消耗资源或增加危险，但保留至少一个进入后继场景的明确途径。`
        : '由 KP 根据当前事实提供替代行动。',
      gmSecret: `本场只可依据已冻结背景、玩家行动和已满足的揭示条件推进；核心隐情围绕“${resolvedDesign.coreConflict}”。`,
      sourceRefs: [sourceRef],
      ...(brief.media.maps ? { tabletopMapKey: `map.${index + 1}` } : {}),
    }
  })
  const requiredConclusions = clues.filter(clue => clue.required).map(clue => clue.conclusionKey)
  const questCount = Math.max(1, Math.min(brief.story.targetQuestCount, Math.max(1, requiredConclusions.length)))
  const quests = Array.from({ length: questCount }, (_, index) => ({
    questKey: `quest.${index + 1}`,
    title: input.sourceCatalog.storyArcs[index]?.name ?? `${brief.campaign.title} · 目标 ${index + 1}`,
    objective: input.sourceCatalog.storyArcs[index]?.description || brief.campaign.coreConflict,
    requiredConclusionKeys: requiredConclusions.filter((_, conclusionIndex) => conclusionIndex % questCount === index),
    failureForward: '任务受挫会改变代价、时间或阵营态度，但不会删除已经获得的线索、物品和成长记录。',
  }))
  const endingNodes = input.narrative.nodes.filter(node => node.kind === 'ending')
  const terminalSceneKeys = scenes.filter(scene => scene.nextSceneKeys.length === 0).map(scene => scene.sceneKey)
  const endings = endingNodes.map((node, index) => ({
    endingKey: safeKey(`ending.${node.key}`, `ending.${index + 1}`),
    title: resolvedDesign.endingConcepts[index % resolvedDesign.endingConcepts.length] ?? node.title,
    requirements: [`到达场景 ${node.key}`, ...(requiredConclusions.length ? [`处理关键结论：${requiredConclusions.join('、')}`] : [])],
    epilogue: `${resolvedDesign.endingConcepts[index % resolvedDesign.endingConcepts.length] ?? node.title}：${node.summary}`,
    trigger: {
      sceneKey: node.key,
      requiredConclusionKeys: index % 2 === 0 ? requiredConclusions : requiredConclusions.slice(0, Math.max(1, requiredConclusions.length - 1)),
      forbiddenConclusionKeys: [],
    },
  }))
  while (endings.length < 2) endings.push({
    endingKey: `ending.fail-forward.${endings.length + 1}`,
    title: resolvedDesign.endingConcepts[endings.length % resolvedDesign.endingConcepts.length]
      ?? (endings.length ? '付出代价后的延续' : '暂时撤离'),
    requirements: ['由 KP 依据已提交事实、资源与关系判断触发'],
    epilogue: `冲突没有凭空消失；角色保留已获得的奖励、惩罚、物品和关系变化，后续场次可从这一结果继续。`,
    trigger: {
      sceneKey: terminalSceneKeys[endings.length % Math.max(1, terminalSceneKeys.length)] ?? scenes[scenes.length - 1]?.sceneKey ?? fail('Campaign 缺少终止场景'),
      requiredConclusionKeys: [], forbiddenConclusionKeys: [],
    },
  })
  const worldSourceRef = sourceRef
  const clockCount = Math.max(1, Math.min(3, Math.max(npcs.length, resolvedDesign.frontConcepts.length)))
  const clocks: NonNullable<TtrpgCampaignContentV1['clocks']> = Array.from({ length: clockCount }, (_, index) => {
    const npc = npcs[index % npcs.length]
    return ({
    clockKey: `clock.front.${index + 1}`,
    title: `${npc.name}的推进`,
    description: `${npc.name}在玩家犹豫、失败或放弃代价时，持续推动“${brief.campaign.coreConflict}”。`,
    initialValue: 0, maximum: 6,
    advanceTriggers: [
      {
        triggerKey: `clock.front.${index + 1}.failed-action`,
        sceneKey: scenes[index % scenes.length]?.sceneKey ?? null,
        actionKey: investigationAction, amount: 1,
        reason: '关键行动失败或玩家选择以时间换取信息时推进。',
      },
      {
        triggerKey: `clock.front.${index + 1}.scene-pressure`,
        sceneKey: scenes[(index + 1) % scenes.length]?.sceneKey ?? null,
        actionKey: null, amount: 1,
        reason: '场景压力被忽略或队伍主动撤退时推进。',
      },
    ],
    onComplete: `${npc.name}取得局部主动权；KP 必须落实可观察后果，但不得抹除已发现线索或已提交事实。`,
    visibility: index === 0 ? 'party' as const : 'gm-only' as const,
    sourceRefs: [...new Set([...npc.sourceRefs, worldSourceRef])],
    })
  })
  const fronts: NonNullable<TtrpgCampaignContentV1['fronts']> = clocks.map((clock, index) => ({
    frontKey: `front.${index + 1}`, title: `${npcs[index]?.name ?? '对手'}的企图`,
    goal: resolvedDesign.frontConcepts[index % resolvedDesign.frontConcepts.length]
      ?? npcs[index]?.gmProfile?.objective ?? resolvedDesign.coreConflict,
    participantKeys: [npcs[index]?.characterKey ?? npcs[0].characterKey], clockKeys: [clock.clockKey],
    escalation: ['试探并隐瞒真实意图', '调动关系或资源制造压力', '公开行动并迫使玩家承担代价'],
    defeatConditions: ['玩家取得并正确运用关键结论', '玩家改变关键关系或切断对手资源'],
    sourceRefs: [...new Set([...(npcs[index]?.sourceRefs ?? npcs[0].sourceRefs), worldSourceRef])],
  }))
  const secretCount = Math.max(1, Math.min(6, Math.max(clues.length, resolvedDesign.secretConcepts.length)))
  const secrets: NonNullable<TtrpgCampaignContentV1['secrets']> = Array.from({ length: secretCount }, (_, index) => {
    const clue = clues[index % clues.length]
    return ({
    secretKey: `secret.${index + 1}`, title: `隐情：${clue.title}`,
    truth: `${resolvedDesign.secretConcepts[index % resolvedDesign.secretConcepts.length] ?? clue.description}；只有在满足线索揭示路径后，KP 才能把它作为确定事实公布。`,
    holderKeys: [npcs[index % npcs.length].characterKey], relatedClueKeys: [clue.clueKey],
    revealRule: `发现 ${clue.clueKey}，或由至少两条独立发现路径交叉验证后揭示。`,
    visibility: 'gm-only' as const, sourceRefs: [...new Set([...clue.sourceRefs, worldSourceRef])],
    })
  })
  const handouts = brief.media.handouts ? clues.map((clue, index) => ({
    handoutKey: `handout.${index + 1}`, title: clue.title, body: clue.description,
    revealClueKey: clue.clueKey, assetKey: null,
    fallbackText: `文字讲义：${clue.title}——${clue.description}`,
  })) : []
  const tabletop = brief.media.maps ? {
    maps: scenes.map((scene, sceneIndex) => ({
      mapKey: `map.${sceneIndex + 1}`, title: `${scene.title} · 桌面`, width: 24, height: 18,
      backgroundAssetKey: null, fallbackDescription: scene.description,
      grid: { kind: 'zone' as const, cellSize: 1, distancePerCell: 1, unit: '区域' },
      layers: [
        { layerKey: `map.${sceneIndex + 1}.terrain`, title: '场景', kind: 'terrain' as const, zIndex: 0, opacity: 1, gmOnly: false },
        { layerKey: `map.${sceneIndex + 1}.secrets`, title: 'KP 标记', kind: 'annotation' as const, zIndex: 10, opacity: 0.8, gmOnly: true },
      ],
      areas: [
        { areaKey: `map.${sceneIndex + 1}.entry`, title: '进入区', x: 0, y: 0, width: 30, height: 100, gmOnly: false },
        { areaKey: `map.${sceneIndex + 1}.focus`, title: '核心区', x: 30, y: 0, width: 40, height: 100, gmOnly: false },
        { areaKey: `map.${sceneIndex + 1}.secret`, title: '隐藏区', x: 70, y: 0, width: 30, height: 100, gmOnly: true },
      ],
      tokens: characters.map((character, characterIndex) => ({
        tokenKey: `map.${sceneIndex + 1}.token.${characterIndex + 1}`, entityKey: character.characterKey,
        x: Math.min(95, 10 + characterIndex * 8), y: character.role === 'player' ? 25 : 75, size: 1,
        controllerKey: character.role === 'player' ? character.characterKey : null, hidden: character.role === 'npc',
      })),
      fog: [{ fogKey: `map.${sceneIndex + 1}.fog.1`, title: '未探索区域', x: 70, y: 0, width: 30, height: 100 }],
    })),
  } : undefined
  const expressionBaselines = [
    { expressionKey: 'neutral', prompt: '自然、专注的中性表情' },
    { expressionKey: 'joy', prompt: '符合角色性格的克制喜悦' },
    { expressionKey: 'concerned', prompt: '警觉、担忧但仍保持角色身份' },
    { expressionKey: 'angry', prompt: '愤怒或决绝，保留相同五官、服装与标志物' },
  ]
  const locationKeys = [...new Set(scenes.flatMap(scene => scene.locationKey == null ? [] : [scene.locationKey]))]
  const visualBible: NonNullable<TtrpgCampaignContentV1['visualBible']> = {
    schema: 'storyforge.ttrpg-visual-bible', version: 1,
    style: {
      description: brief.media.visualStyle,
      medium: '叙事跑团插画与可读桌面素材',
      composition: '场景优先保证空间关系，角色优先保证身份、轮廓和标志物跨图一致。',
      colorPalette: ['主色延续冻结世界', '高对比交互焦点', '克制的危险警示色'],
      era: [...brief.campaign.genreTags, ...brief.campaign.tone].join('、') || '冻结世界对应时代',
      prohibitedElements: [...brief.safety.lines, '现代品牌水印', '无来源角色替换', '破坏角色身份连续性的随机服装'],
      referenceLicense: brief.confirmations.mediaRights ? 'author-confirmed-runtime-generation-v1' : 'rights-review-required',
    },
    characters: characters.map(character => ({
      characterKey: character.characterKey,
      identityPrompt: `${character.name}。${character.characterSheet?.identity.appearance || character.description}`,
      silhouette: character.characterSheet?.identity.appearance || '轮廓必须与首张确认立绘一致',
      attire: character.characterSheet?.identity.occupation || '服装符合冻结世界、身份和当前场景',
      markers: character.characterSheet?.identity.personalityTraits.slice(0, 4) ?? [],
      colorPalette: ['角色主色', '服装辅色', '标志物强调色'], expressionBaselines,
      referenceAssetKeys: character.portraitAssetKey ? [character.portraitAssetKey] : [],
    })),
    locations: locationKeys.map(locationKey => {
      const sourceIndex = Number(locationKey.replace(/^location\.world\./, '')) - 1
      const sourceResourceKey = locationResourceKeys[sourceIndex]
      const source = input.sourceCatalog.locations.find(location => location.resourceKey === sourceResourceKey)
      return {
        locationKey,
        identityPrompt: `${source?.name ?? locationKey}。${source?.description || '严格依据冻结世界地点设定。'}`,
        architecture: source?.description || '建筑与空间关系遵循冻结世界', weather: '随当前场景但不改变地标身份',
        timeOfDay: '随当前场景', lighting: '保证角色、出口、交互物和危险区域清晰可辨',
        anchors: [source?.name || locationKey, '固定地标轮廓', '稳定空间入口与出口'], referenceAssetKeys: [],
      }
    }),
    provenancePolicy: {
      rightsPolicyVersion: 'storyforge-runtime-media-rights-v1',
      allowedSources: ['frozen-world-release', 'author-owned-reference', 'provider-generated'],
      requirePromptReceipt: true, requireHumanAdoptionForRelease: true,
    },
  }
  const productionRequired = brief.media.generationTiming !== 'background-during-play'
  const slots: NonNullable<TtrpgCampaignContentV1['mediaManifest']>['slots'] = []
  if (brief.media.sceneImages) scenes.forEach(scene => slots.push({
    slotKey: `scene.${scene.sceneKey}`, kind: 'scene', targetRef: scene.sceneKey, audience: 'party',
    productionRequired, assetKey: null, fallbackText: scene.description, altText: `${scene.title}场景图`,
    promptTemplate: `场景：${scene.title}。${scene.description}`, width: 1536, height: 1024,
  }))
  if (brief.media.maps && tabletop) tabletop.maps.forEach(map => slots.push({
    slotKey: `map.${map.mapKey}`, kind: 'map', targetRef: map.mapKey, audience: 'party',
    productionRequired, assetKey: map.backgroundAssetKey, fallbackText: map.fallbackDescription,
    altText: `${map.title}地图`, promptTemplate: `可读的跑团区域地图：${map.title}。${map.fallbackDescription}`,
    width: 1536, height: 1024,
  }))
  if (brief.media.characterPortraits) characters.forEach(character => slots.push({
    slotKey: `portrait.${character.characterKey}`, kind: 'character-portrait', targetRef: character.characterKey,
    audience: 'party', productionRequired, assetKey: character.portraitAssetKey,
    fallbackText: character.characterSheet?.identity.appearance || character.description, altText: `${character.name}角色立绘`,
    promptTemplate: visualBible.characters.find(item => item.characterKey === character.characterKey)!.identityPrompt,
    width: 1024, height: 1536,
  }))
  if (brief.media.characterExpressions) characters.forEach(character => expressionBaselines.forEach(expression => slots.push({
    slotKey: `expression.${character.characterKey}.${expression.expressionKey}`, kind: 'character-expression',
    targetRef: character.characterKey, audience: 'party', productionRequired, assetKey: null,
    fallbackText: `${character.name}：${expression.prompt}`, altText: `${character.name}${expression.expressionKey}表情`,
    promptTemplate: `${visualBible.characters.find(item => item.characterKey === character.characterKey)!.identityPrompt}。${expression.prompt}`,
    width: 1024, height: 1536,
  })))
  if (brief.media.tokens) characters.forEach(character => slots.push({
    slotKey: `token.${character.characterKey}`, kind: 'token', targetRef: character.characterKey, audience: 'party',
    productionRequired, assetKey: null, fallbackText: character.name, altText: `${character.name}桌面 Token`,
    promptTemplate: `${character.name}的俯视桌面 Token，透明背景，身份轮廓与角色视觉圣经一致。`, width: 512, height: 512,
  }))
  if (brief.media.itemIcons) rulePack.items.forEach(item => slots.push({
    slotKey: `item.${item.key}`, kind: 'item-icon', targetRef: item.key, audience: 'party', productionRequired,
    assetKey: null, fallbackText: item.description, altText: `${item.name}物品图标`,
    promptTemplate: `跑团物品图标：${item.name}。${item.description}`, width: 512, height: 512,
  }))
  if (brief.media.handouts) handouts.forEach(handout => slots.push({
    slotKey: `handout.${handout.handoutKey}`, kind: 'handout', targetRef: handout.handoutKey, audience: 'party',
    productionRequired, assetKey: handout.assetKey, fallbackText: handout.fallbackText, altText: `${handout.title}手记`,
    promptTemplate: `跑团 Handout：${handout.title}。正文依据：${handout.body}`, width: 1024, height: 1536,
  }))
  const mediaManifest: NonNullable<TtrpgCampaignContentV1['mediaManifest']> = {
    schema: 'storyforge.ttrpg-media-manifest', version: 1, slots,
    runtimePolicy: {
      enabled: brief.media.backgroundGeneration && brief.media.maximumGeneratedAssets > 0,
      networkPolicy: brief.media.backgroundGeneration ? 'any' : 'disabled',
      maximumSessionCostUsd: Math.min(100, Math.max(0, brief.media.maximumGeneratedAssets * 0.25)),
      maximumConcurrentRequests: 2, maximumAttempts: 3,
      maximumGeneratedAssets: brief.media.backgroundGeneration ? brief.media.maximumGeneratedAssets : 0,
      allowProviderFallback: true,
    },
  }
  const campaign: TtrpgCampaignContentV1 = {
    schema: 'storyforge.ttrpg-campaign', version: 1,
    campaignKey: safeKey(`campaign.${input.productionKey}`, 'campaign.production'),
    gmMode: brief.table.gmMode,
    title: brief.campaign.title, pitch: brief.campaign.premise,
    playerCount: { minimum: brief.table.seats.length, maximum: brief.table.seats.length },
    estimatedMinutes: brief.campaign.targetSessions * brief.campaign.targetSessionMinutes,
    tags: [...new Set([...brief.campaign.genreTags, ...brief.campaign.tone, 'production-campaign-v2'])],
    difficulty: brief.campaign.difficulty, contentWarnings: brief.safety.contentWarnings,
    sessionZero: {
      premise: brief.campaign.premise, consentChecklist: brief.safety.consentChecklist,
      lines: brief.safety.lines, veils: brief.safety.veils, pauseSignal: brief.safety.pauseSignal,
      openDoor: brief.safety.openDoor,
    },
    bible: {
      premise: brief.campaign.premise,
      background: resolvedDesign.background,
      coreConflict: resolvedDesign.coreConflict,
      themes: [...new Set([...brief.campaign.genreTags, ...brief.campaign.tone])],
      canonInvariants: [
        '冻结 WorldRelease 的已知事实不得被临场叙述静默改写。',
        '规则结果、资源、物品、次数、奖励与惩罚只以确定性事件账本为准。',
        ...brief.safety.lines.map(line => `内容边界：${line}`),
      ],
      sourceRefs: [worldSourceRef],
    },
    clocks, fronts, secrets,
    ...(brief.campaignDesign ? {
      designProvenance: {
        origin: brief.campaignDesign.origin,
        proposalKeys: brief.campaignDesign.proposals.map(proposal => proposal.proposalKey),
        baseProposalKey: brief.campaignDesign.selection.baseProposalKey,
        sectionSources: structuredClone(brief.campaignDesign.selection.sectionSources),
        lockedSections: [...brief.campaignDesign.selection.lockedSections],
        candidateHash: brief.campaignDesign.candidateEvidence?.candidateHash ?? null,
      },
    } : {}),
    informationPolicy: structuredClone(brief.information),
    openingSceneKey: input.narrative.entryNodeKey, characterTemplates: characters, scenes, clues, quests,
    endings, handouts,
    advancementMilestones: quests.map((quest, index) => ({
      milestoneKey: `milestone.${index + 1}`, title: `完成：${quest.title}`, award: rulePack.advancement.awardPerMilestone,
    })),
    ...(tabletop ? { tabletop } : {}),
    visualBible, mediaManifest,
    sourceWorld: { contentHash: input.worldContentHash, bundleHash: input.worldSourceBundleHash },
  }
  const parsed = parseTtrpgCampaignContentV1(campaign, rulePack)
  const report = validateTtrpgCampaignForPublicationV1(parsed, rulePack)
  if (!report.valid) fail(`CampaignPack 发布预检失败:${report.errors.join('；')}`)
  if (brief.campaignDesign) {
    const lockErrors = validateTtrpgCampaignDesignLocksV2({ design: brief.campaignDesign, campaign: parsed })
    if (lockErrors.length) fail(`战役提案锁定内容未保持:${lockErrors.join('；')}`)
  }
  return parsed
}
