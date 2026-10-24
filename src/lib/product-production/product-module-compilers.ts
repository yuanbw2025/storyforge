import { parseAdventureContent } from '../adventure/runtime'
import { parseAiTownRuntimeContentV1 } from '../ai-town/runtime'
import { assertPreparedChatPrivateCharactersV1, chatProjectionResourcesV1, readPreparedChatSourceProjectionViewV1 } from '../character-interaction/source-projection'
import {chatPrivateCharacterKeysV1} from '../character-interaction/private-character'
import type {ChatCharacterCardCreditsV1} from '../character-interaction/card-credits'
import {composeChatRoleVoiceRulesV1, formatChatRoleProfileV1, validateChatRoleProfilesForSourceV1} from '../character-interaction/role-profile'
import {validateChatSourceUnitSetForProjectionV1} from '../character-interaction/source-unit-authorization'
import {compileChatSourceUnitKnowledgeV1} from '../character-interaction/source-unit-runtime'
import type { FrozenChatSourceProjectionV1 } from '../types/character-interaction'
import type { FrozenChatNarrativeV1 } from '../types/chat-narrative'
import { parseFrozenChatNarrativeV1 } from '../character-interaction/narrative-contract'
import {createChatPersonaV1} from '../character-interaction/persona-source'
import { canonicalStringify } from '../agent/run/hash'
import type {
  AdventureContentV1,
  FrozenInteractionCharacterProfile,
  FrozenInteractionSceneTemplate,
  ProductProductionBriefV3,
  ProductRuntimePackageV1,
  AiTownRuntimeContentV1,
} from '../types'
import type { ProductProductionWorldSourceCatalogV2 as ProductWorldSourceCatalog } from './world-source'

export interface ProductModuleCompilerInputV1 {
  brief: ProductProductionBriefV3
  narrative: ProductRuntimePackageV1['narrative']
  /** Selected, author-confirmed initial situation; required by chat settings v3. */
  chatNarrative?: FrozenChatNarrativeV1
  sourceCatalog?: Pick<ProductWorldSourceCatalog,
    'storySources' | 'characters' | 'relationships' | 'locations' | 'artifacts' | 'loreEntries' | 'storyArcs' | 'chatSourceProjection'>
}

function fail(message: string): never {
  throw new Error(`[product-module-compiler] ${message}`)
}

function pad(index: number): string {
  return String(index + 1).padStart(3, '0')
}

function sources(input: ProductModuleCompilerInputV1) {
  const result = input.narrative.nodes.filter(node => node.kind !== 'ending')
  if (!result.length) fail('产品玩法模块需要至少一个非结局节点')
  return result
}

function endings(input: ProductModuleCompilerInputV1) {
  const result = input.narrative.nodes.filter(node => node.kind === 'ending')
  if (!result.length) fail('叙事图没有可达结局')
  return result
}

function participants(input: Pick<ProductModuleCompilerInputV1, 'brief'>): string[] {
  const keys = interactionCharacterKeys(input).slice(0, 8)
  return keys.length ? keys.map((_, index) => `participant.${pad(index)}`) : ['participant.001']
}

function interactionCharacterKeys(input: Pick<ProductModuleCompilerInputV1, 'brief'>): string[] {
  return [...(input.brief.source.selection.roleBindings.characters
    ?? input.brief.source.selection.roleBindings.participants
    ?? input.brief.source.selection.roleBindings.residents ?? []), ...chatPrivateCharacterKeysV1(input.brief.characterChat)]
}

function characterKey(input: Pick<ProductModuleCompilerInputV1, 'brief'>, index: number): string {
  const key = interactionCharacterKeys(input)[index]
  if (key == null) return `generated:participant.${pad(index)}`
  // AI Town residents already carry the immutable WorldRelease resource key.
  // Preserve that same portable identity in the interaction profile so the
  // runtime can prove which resident a participant represents after export,
  // import, refresh and device transfer.
  return input.brief.intent.productType === 'ai-town' || (input.brief.characterChat && input.brief.characterChat.version !== 1) ? key : `character:${index + 1}`
}

function selectedRows<T extends { resourceKey: string }>(
  rows: readonly T[] | undefined,
  resourceKeys: readonly string[],
): T[] {
  if (!rows?.length || !resourceKeys.length) return []
  const byKey = new Map(rows.map(row => [row.resourceKey, row]))
  return resourceKeys.flatMap(resourceKey => {
    const row = byKey.get(resourceKey)
    return row ? [row] : []
  })
}

function selectedCharacters(input: ProductModuleCompilerInputV1) {
  return selectedRows(input.sourceCatalog?.characters,
    input.brief.source.selection.roleBindings.characters
      ?? input.brief.source.selection.roleBindings.participants
      ?? input.brief.source.selection.roleBindings.residents ?? [])
}

function selectedLocations(input: ProductModuleCompilerInputV1) {
  return selectedRows(input.sourceCatalog?.locations,
    input.brief.source.selection.roleBindings.locations
      ?? input.brief.source.selection.roleBindings.regions ?? [])
}

function selectedArtifacts(input: ProductModuleCompilerInputV1) {
  return selectedRows(input.sourceCatalog?.artifacts,
    input.brief.source.selection.roleBindings.items
      ?? input.brief.source.selection.roleBindings.artifacts ?? [])
}

function selectedStoryArcs(input: ProductModuleCompilerInputV1) {
  return selectedRows(input.sourceCatalog?.storyArcs,
    input.brief.source.selection.roleBindings.quests
      ?? input.brief.source.selection.roleBindings.issues
      ?? input.brief.source.selection.roleBindings.ending ?? [])
}

function selectedStorySources(input: ProductModuleCompilerInputV1) {
  return selectedRows(input.sourceCatalog?.storySources,
    input.brief.source.selection.roleBindings.ending
      ?? input.brief.source.selection.roleBindings.story ?? [])
}

export function compileAiTownModuleV1(input: ProductModuleCompilerInputV1): AiTownRuntimeContentV1 {
  if (input.brief.intent.productType !== 'ai-town' || !input.brief.aiTown) {
    fail('AI 小镇 compiler 需要 AiTownProductionBriefV1')
  }
  const brief = input.brief.aiTown
  const sourceCharacters = selectedCharacters(input).slice(0, 8)
  if (sourceCharacters.length < 4) fail('AI 小镇需要 4..8 名冻结来源居民')
  const selectedWorldLocations = selectedLocations(input).slice(0, brief.town.majorLocationTarget)
  const fallbackLocations = [
    { name: '归来广场', description: '居民交换消息、共同吃饭和举行小型活动的公共空间。' },
    { name: '灯火工坊', description: '共同项目的工作地点，也容纳日常修补与手作。' },
    { name: '山坡住区', description: '安静的住宅区，保留独处、拜访和邻里照料的边界。' },
    { name: '旧路茶屋', description: '连接原作过去与当下生活的休息处。' },
  ]
  const locationCount = Math.max(4, brief.town.majorLocationTarget)
  const locations: AiTownRuntimeContentV1['map']['locations'] = Array.from({ length: locationCount }, (_, index) => {
    const source = selectedWorldLocations[index] ?? fallbackLocations[index % fallbackLocations.length]
    return {
      key: `town.location.${pad(index)}`,
      title: source.name,
      description: source.description || `后日谈共同体中的${source.name}。`,
      parentKey: null,
      x: 15 + (index % 2) * 55,
      y: 18 + Math.floor(index / 2) * 55,
      capacity: Math.max(4, sourceCharacters.length + 1),
      openSlots: ['morning', 'late-morning', 'noon', 'afternoon', 'evening', 'midnight'],
      tags: [selectedWorldLocations[index] ? 'world-grounded' : 'product-private', index === 0 ? 'public' : index === 2 ? 'home' : 'work'],
    }
  })
  const routes: AiTownRuntimeContentV1['map']['routes'] = locations.slice(1).map((location, index) => ({
    key: `town.route.${pad(index)}`,
    fromLocationKey: locations[0].key,
    toLocationKey: location.key,
    bidirectional: true,
    travelSlots: 1,
  }))
  const sourceByResourceKey = new Map(sourceCharacters.map((character, index) => [character.resourceKey, index]))
  const residents: AiTownRuntimeContentV1['residents'] = sourceCharacters.map((character, index) => {
    const home = locations[(index + 2) % locations.length]
    const work = locations[(index + 1) % locations.length]
    const locationAt = (offset: number) => locations[(index + offset) % locations.length].key
    return {
      residentKey: `town.resident.${pad(index)}`,
      sourceCharacterResourceKey: character.resourceKey,
      name: character.name,
      summary: character.description || `${character.name}从原作结局走入了新的日常。`,
      migrationReason: `${character.name}在原作结束三个月后，因为“${brief.town.premise}”来到这里，并保留原有身份、关系与责任。`,
      identityLocks: [character.description || `${character.name}的冻结原作身份`, ...input.brief.intent.requiredFacts].slice(0, 20),
      voiceRules: `保持${character.name}的原作经历、立场和独立意志；可以拒绝玩家；不得泄露自己不知道的秘密。`,
      homeLocationKey: home.key,
      workLocationKey: work.key,
      schedule: [
        { slot: 'morning', locationKey: home.key, activity: '整理住处与自己的计划' },
        { slot: 'late-morning', locationKey: work.key, activity: '处理个人工作与长期愿望' },
        { slot: 'noon', locationKey: locationAt(0), activity: '在公共空间吃饭或短暂交谈' },
        { slot: 'afternoon', locationKey: work.key, activity: '继续工作或参与共同建设' },
        { slot: 'evening', locationKey: locationAt(0), activity: '与邻里交流或独自休息' },
        { slot: 'midnight', locationKey: home.key, activity: '休息并整理当天经历' },
      ],
      startingKnowledge: [{
        factKey: `town.fact.identity.${pad(index)}`,
        statement: character.description || `${character.name}知道自己的原作经历与身份。`,
        visibility: 'private',
      }, {
        factKey: 'town.fact.arrival',
        statement: `原作结束约 ${brief.continuity.elapsedDays} 天后，居民开始在这里共同生活。`,
        visibility: 'public',
      }],
      goals: [`在不否定过去的前提下建立新的日常`, `关心${brief.management.sharedProjectConcept}会如何影响共同体`],
    }
  })
  const sourceRelationships = (input.sourceCatalog?.relationships ?? []).filter(relationship => (
    sourceByResourceKey.has(relationship.fromCharacterResourceKey)
    && sourceByResourceKey.has(relationship.toCharacterResourceKey)
  ))
  const relationships: AiTownRuntimeContentV1['relationships'] = sourceRelationships.flatMap((relationship, index) => {
    const fromIndex = sourceByResourceKey.get(relationship.fromCharacterResourceKey)!
    const toIndex = sourceByResourceKey.get(relationship.toCharacterResourceKey)!
    const forward = {
      key: `town.relationship.${pad(index)}.forward`,
      fromResidentKey: residents[fromIndex].residentKey,
      toResidentKey: residents[toIndex].residentKey,
      trust: 50, intimacy: 35, wariness: 15,
      reason: relationship.description || relationship.label || `冻结关系：${relationship.relationType}`,
      evidenceRefs: [relationship.resourceKey],
    }
    return relationship.isBidirectional ? [forward, { ...forward, key: `town.relationship.${pad(index)}.reverse`, fromResidentKey: forward.toResidentKey, toResidentKey: forward.fromResidentKey }] : [forward]
  })
  if (!relationships.length) {
    residents.forEach((resident, index) => relationships.push({
      key: `town.relationship.generated.${pad(index)}`,
      fromResidentKey: resident.residentKey,
      toResidentKey: residents[(index + 1) % residents.length].residentKey,
      trust: 45, intimacy: 25, wariness: 20,
      reason: '这是产品私域的谨慎起始关系；需要通过共同经历继续生长。', evidenceRefs: [],
    }))
  }
  residents.forEach((resident, index) => relationships.push({
    key: `town.relationship.player.${pad(index)}`,
    fromResidentKey: resident.residentKey,
    toResidentKey: 'player',
    trust: 40,
    intimacy: 15,
    wariness: 25,
    reason: '玩家刚加入共同体，关系需要通过可观察经历建立。',
    evidenceRefs: [],
  }))
  const lifeThreads: AiTownRuntimeContentV1['lifeThreads'] = residents.map((resident, index) => ({
    key: `town.thread.${pad(index)}`, ownerResidentKey: resident.residentKey,
    title: `${resident.name}的新生活`, description: resident.goals[0], initialStage: index < 2 ? 'active' : 'dormant',
    locationKeys: [resident.homeLocationKey, resident.workLocationKey ?? locations[0].key],
    participantKeys: [resident.residentKey, residents[(index + 1) % residents.length].residentKey],
  }))
  const communalEventSeeds: AiTownRuntimeContentV1['eventSeeds'] = [{
    key: 'town.event.morning-routine', category: 'ambient', title: '寻常的早晨',
    summary: '居民按自己的习惯开始一天，细小变化会留下可观察的痕迹。', intensity: 1,
    minimumDay: 1, cooldownDays: 1, eligibleSlots: ['morning'], locationKeys: locations.map(location => location.key),
    participantKeys: residents.map(resident => resident.residentKey), lifeThreadKeys: [],
  }, {
    key: 'town.event.shared-work', category: 'community', title: '共同建设日',
    summary: `居民围绕“${brief.management.sharedProjectConcept}”提出不同意见并决定是否协作。`, intensity: 3,
    minimumDay: 2, cooldownDays: 3, eligibleSlots: ['late-morning', 'afternoon'], locationKeys: [locations[1].key],
    participantKeys: residents.map(resident => resident.residentKey), lifeThreadKeys: lifeThreads.slice(0, 3).map(thread => thread.key),
  }, {
    key: 'town.event.old-memory-friction', category: 'resident-friction', title: '过去留下的分歧',
    summary: '一件日常小事触及原作经历，两名居民可能选择沟通、回避或坚持自己的立场。', intensity: 2,
    minimumDay: 3, cooldownDays: 4, eligibleSlots: ['noon', 'evening'], locationKeys: [locations[0].key],
    participantKeys: residents.slice(0, 2).map(resident => resident.residentKey), lifeThreadKeys: lifeThreads.slice(0, 2).map(thread => thread.key),
  }, {
    key: 'town.event.small-festival', category: 'festival', title: '小镇纪念日',
    summary: '居民用各自的方式纪念过去，也讨论共同体接下来想成为什么。', intensity: 4,
    minimumDay: 7, cooldownDays: 14, eligibleSlots: ['afternoon', 'evening'], locationKeys: [locations[0].key],
    participantKeys: residents.map(resident => resident.residentKey), lifeThreadKeys: lifeThreads.map(thread => thread.key),
  }]
  const residentEventSeeds: AiTownRuntimeContentV1['eventSeeds'] = residents.map((resident, index) => {
    const thread = lifeThreads[index]
    const counterpart = residents[(index + 1) % residents.length]
    return {
      key: `town.event.resident-opportunity.${pad(index)}`,
      category: 'resident-opportunity',
      title: `${resident.name}想推进一件自己的事`,
      summary: `${resident.name}正围绕“${thread.title}”尝试跨出一小步；${counterpart.name}可能参与，但两人都保留自己的立场。`,
      intensity: index % 3 === 2 ? 3 : 2,
      minimumDay: 2 + index,
      cooldownDays: 4 + (index % 3),
      eligibleSlots: index % 2 === 0 ? ['late-morning', 'afternoon'] : ['noon', 'evening'],
      locationKeys: [...new Set(thread.locationKeys)],
      participantKeys: [...new Set([resident.residentKey, counterpart.residentKey])],
      lifeThreadKeys: [thread.key],
    } satisfies AiTownRuntimeContentV1['eventSeeds'][number]
  })
  const eventSeeds = [...communalEventSeeds, ...residentEventSeeds]
  const storyEvidence = [...selectedStorySources(input), ...selectedStoryArcs(input)].slice(0, 20)
  return parseAiTownRuntimeContentV1({
    schema: 'storyforge.ai-town-runtime-content', version: 1,
    title: brief.town.title, premise: brief.town.premise, elapsedCanonDays: brief.continuity.elapsedDays,
    player: { ...brief.player },
    canonLocks: storyEvidence.length ? storyEvidence.map((source, index) => ({ key: `town.canon.${pad(index)}`, statement: source.description || source.name, evidenceRefs: [source.resourceKey] })) : [{ key: 'town.canon.author-confirmed', statement: input.brief.source.startingPoint.summary, evidenceRefs: input.brief.source.startingPoint.sourceRefs }],
    residents, relationships, map: { locations, routes, playerHomeLocationKey: locations[2]?.key ?? locations[0].key },
    lifeThreads, eventSeeds,
    clock: { slots: [...brief.clock.slots], actionsPerDay: brief.clock.actionsPerDay },
    offline: { enabled: brief.autonomy.offlineEnabled, maximumDays: brief.autonomy.offlineMaximumDays },
    economy: {
      resources: brief.management.resourceKeys.map((key, index) => ({ key, title: ['材料', '食材', '照料'][index] ?? key, initial: 3, maximum: 99 })),
      startingMoney: brief.management.startingMoney, startingEnergy: 80, maximumEnergy: 100,
      sharedProject: { key: 'town.project.shared', title: brief.management.sharedProjectConcept, description: '共同建设会改变地点用途、居民日程和未来事件条件。', targetProgress: 100, milestoneLocationKey: locations[1].key },
    },
    cadence: { dailyIntensityBudget: 6, highIntensityStreakLimit: 2, rareCrisisCooldownDays: 14 },
    safety: { boundaries: brief.safety.boundaries, majorChangeKinds: ['death-or-permanent-incapacity', 'marriage-or-family', 'permanent-departure', 'major-facility-change', 'world-rule-change'], romance: brief.continuity.romance },
  })
}

function choiceMap(input: ProductModuleCompilerInputV1) {
  const result = new Map<string, ProductRuntimePackageV1['narrative']['choices']>()
  for (const choice of input.narrative.choices) {
    result.set(choice.sourceNodeKey, [...(result.get(choice.sourceNodeKey) ?? []), choice])
  }
  return result
}

export function compileInteractionModulesV1(input: ProductModuleCompilerInputV1) {
  const chat = input.brief.characterChat
  const participantKeys = chat?.mode === 'single' ? participants(input).slice(0,1) : participants(input)
  const sourceCharacters = selectedCharacters(input)
  const projected = chat && chat.version !== 1 ? compileReviewedChatSource(input, participantKeys) : null
  const profiles: FrozenInteractionCharacterProfile[] = participantKeys.map((participantKey, index) => {
    const frozenCharacterKey = characterKey(input, index)
    const sourceCharacter = sourceCharacters[index]
    const settings = chat?.characters.find(c=>c.sourceKey===sourceCharacter?.resourceKey)
    const spoken = input.narrative.beats.filter(beat => beat.speakerKey === frozenCharacterKey)
      .slice(0, 12).map(beat => beat.text)
    const reviewedVoice = projected ? composeChatRoleVoiceRulesV1(projected.voices[index], settings?.voiceRules ?? '', projected.roleProfiles[index]) : ''
    return {
      participantKey, characterKey: frozenCharacterKey,
      name: projected?.names[index] ?? sourceCharacter?.name ?? `产品角色 ${index + 1}`,
      roleLabel: index === 0 ? '核心互动角色' : '相关角色',
      voiceRules: projected ? reviewedVoice
        : `保持 ${sourceCharacter?.description || frozenCharacterKey} 的冻结事实和知识边界；遵守：${input.brief.intent.contentBoundaries.join('；')}。${settings?.voiceRules ?? ''}`,
      initialKnowledge: [...(projected ? [] : [{
        key: `profile.${pad(index)}`,
        content: [sourceCharacter?.description, ...spoken].filter(Boolean).join('\n') || input.brief.intent.openingSituation,
        visibility: 'public' as const, importance: index === 0 ? 100 : 70,
      }]), ...(settings?.privateKnowledge ? [{key:`private.${pad(index)}`,content:settings.privateKnowledge,visibility:'private' as const,importance:100}] : [])],
      relationshipDimensions: [
        { key: 'trust', label: '信任', minimum: -100, maximum: 100, initial: settings?.initialTrust ?? 0, largeChangeThreshold: chat?.relationshipThreshold ?? 20 },
        { key: 'respect', label: '尊重', minimum: -100, maximum: 100, initial: 0, largeChangeThreshold: 20 },
      ],
      maxMemoryEntries: chat?.maxMemoryEntries ?? Math.max(40, Math.min(240, input.brief.scale.targetPlayMinutes * 2)),
    }
  })
  if (chat?.version === 3) {
    if (!input.chatNarrative || !projected) fail('主动叙事需要作者选定的初始情境，不能回退为旧版回复包')
    const content = parseFrozenChatNarrativeV1(input.chatNarrative, {source: projected.content,
      participantKeys, characterKeys: profiles.map(p => p.characterKey), sceneKeys: [input.chatNarrative.initialSituation.sceneKey]})
    const expectedPersona = createChatPersonaV1(chat, projected.content)
    if (canonicalStringify(content.persona) !== canonicalStringify(expectedPersona)
      || canonicalStringify(content.permissions) !== canonicalStringify(chat.narrative.permissions)
      || content.initialSituation.seed.text !== chat.openingSituation
      || chat.narrative.location && content.initialSituation.location !== chat.narrative.location
      || chat.narrative.timeLabel && content.initialSituation.timeLabel !== chat.narrative.timeLabel) fail('选定情境改变了作者的身份、种子、时地或运行权限')
    const situation = content.initialSituation
    const cardCredits: ChatCharacterCardCreditsV1['characters'] = (chat.privateCharacters ?? []).flatMap(character => {
      if (!character.cardOrigin) return []
      const profile = profiles.find(profile => profile.characterKey === character.characterKey)
      const source = projected.content.privateCharacterSources?.find(source => source.resourceKey === character.characterKey)
      if (!profile || !source) fail('外部角色卡缺少已确认的人物来源')
      return [{participantKey: profile.participantKey, characterKey: character.characterKey, sourceHash: source.sourceHash,
        cardContentHash: character.cardOrigin.contentHash, creator: character.cardOrigin.creator, characterVersion: character.cardOrigin.characterVersion}]
    })
    return {playerKey: 'player' as const, profiles, chatSource: projected.content, chatNarrative: content,
      ...(cardCredits.length ? {chatCardCredits: {version: 1 as const, characters: cardCredits}} : {}),
      ...(chat.experienceInfo ? {chatExperienceInfo: structuredClone(chat.experienceInfo)} : {}),
      sceneTemplates: [{sceneKey: situation.sceneKey, title: situation.title, purpose: chat.experience || situation.title,
        location: situation.location, timeLabel: situation.timeLabel, participantKeys,
        publicKnowledgeKeys: projected.content.knowledge.filter(k => ['player', ...participantKeys].every(viewer => k.audienceKeys.includes(viewer))).map(k => k.key),
        goals: situation.threads.filter(t => t.audienceKeys.includes('player')).map(t => t.question), endingConditions: [],
        safetyBoundaries: [...input.brief.intent.contentBoundaries, '不替玩家决定感受或行动'], relationshipRules: [],
        openingNodeKey: null, endingNodeKey: null, maxTurns: chat.maxTurns, directorBudget: chat.replyBudget, order: 0}]}
  }
  const endingNodes = endings(input)
  const choices = choiceMap(input)
  const sourceNodes = sources(input)
  const sceneTemplates: FrozenInteractionSceneTemplate[] = sourceNodes.map((node, index) => {
    const speakers = new Set(input.narrative.beats.filter(beat => beat.nodeKey === node.key)
      .flatMap(beat => beat.speakerKey == null ? [] : [beat.speakerKey]))
    const speakingParticipants = participantKeys.filter((_, participantIndex) => speakers.has(characterKey(input, participantIndex)))
    const activeParticipants = input.brief.intent.productType === 'ai-town'
      ? participantKeys
      : speakingParticipants.length ? speakingParticipants : participantKeys.slice(0, 3)
    const outgoing = choices.get(node.key) ?? []
    const directEnding = outgoing.map(choice => endingNodes.find(ending => ending.key === choice.targetNodeKey)).find(Boolean)
    return {
      sceneKey: `scene.${pad(index)}`, title: node.title,
      purpose: node.summary || input.brief.intent.openingSituation,
      location: `冻结场景：${node.title}`, timeLabel: index === 0 ? '故事开始时' : `阶段 ${index + 1}`,
      participantKeys: activeParticipants,
      publicKnowledgeKeys: projected ? projected.content.knowledge.filter(k => ['player', ...participantKeys].every(viewer => k.audienceKeys.includes(viewer))).map(k => k.key)
        : profiles.map((_, profileIndex) => `profile.${pad(profileIndex)}`),
      goals: outgoing.length ? outgoing.map(choice => choice.text).slice(0, 8) : [...input.brief.intent.coreExperience],
      endingConditions: outgoing.map(choice => `玩家确认选择：${choice.text}`).slice(0, 8),
      safetyBoundaries: [...input.brief.intent.contentBoundaries, '不替玩家决定感受或行动'],
      relationshipRules: activeParticipants.flatMap((participantKey, participantIndex) => ([
        {
          ruleKey: `relationship.${pad(index)}.${pad(participantIndex)}.trust`,
          label: `向${profiles.find(profile => profile.participantKey === participantKey)?.name ?? participantKey}坦诚说明`,
          playerText: '坦诚说明已掌握的事实，并允许对方保留自己的立场。',
          fromParticipantKey: participantKey, toParticipantKey: 'player', dimensionKey: 'trust' as const,
          delta: 2, reason: '玩家以公开事实和尊重边界的方式推进对话。', significantEventKey: null,
        },
        {
          ruleKey: `relationship.${pad(index)}.${pad(participantIndex)}.pressure`,
          label: `向${profiles.find(profile => profile.participantKey === participantKey)?.name ?? participantKey}施压`,
          playerText: '以当前证据要求对方立刻作出回应。',
          fromParticipantKey: participantKey, toParticipantKey: 'player', dimensionKey: 'trust' as const,
          delta: -2, reason: '玩家用压力换取即时回应，关系信任因此承受代价。', significantEventKey: null,
        },
      ])), openingNodeKey: node.key,
      endingNodeKey: directEnding?.key ?? endingNodes[0].key,
      maxTurns: chat?.maxTurns ?? Math.max(8, Math.min(80, Math.ceil(input.brief.scale.targetPlayMinutes / Math.max(1, sourceNodes.length)) * 4)),
      directorBudget: chat?.replyBudget ?? (input.brief.intent.productType === 'character-interaction' ? Math.max(60, input.brief.scale.targetPlayMinutes * activeParticipants.length * 4) : Math.max(1, Math.min(activeParticipants.length * 2, 12))), order: index,
    }
  })
  return { playerKey: 'player' as const, profiles, sceneTemplates, ...(projected ? {chatSource: projected.content} : {}) }
}

/** Production-only source projection, before any situation is chosen. */
export function prepareChatNarrativeCompilerSourceV1(input: Pick<ProductModuleCompilerInputV1, 'brief' | 'sourceCatalog'>) {
  const participantKeys = input.brief.characterChat?.mode === 'single' ? participants(input).slice(0, 1) : participants(input)
  return {...compileReviewedChatSource(input, participantKeys), participantKeys, characterKeys: participantKeys.map((_, i) => characterKey(input, i))}
}

function compileReviewedChatSource(input: Pick<ProductModuleCompilerInputV1, 'brief' | 'sourceCatalog'>, participantKeys: string[]) {
  const chat = input.brief.characterChat
  const draft = input.sourceCatalog?.chatSourceProjection
  if (input.brief.intent.productType !== 'character-interaction' || !chat || chat.version === 1 || !chat.sourceReview || !draft) {
    fail('角色聊天需要作者确认的完整资料投影')
  }
  const keys = interactionCharacterKeys(input)
  assertPreparedChatPrivateCharactersV1(draft, chat.version === 3 ? chat.privateCharacters : undefined)
  if (JSON.stringify([...keys].sort()) !== JSON.stringify(draft.characters.map(c => c.resourceKey).sort())
    || keys.length !== participantKeys.length || input.brief.source.worldContentHash !== draft.worldReleaseHash
    || input.brief.source.selection.worldReferenceHash !== draft.worldReferenceHash) fail('角色投影与冻结选择不一致')
  const backgroundKeys = [...(chat.backgroundResourceKeys ?? [])].sort()
  const playerKey = chat.version === 3 ? chat.narrative.playerCharacterKey : undefined
  if (playerKey !== draft.playerCharacter?.resourceKey
    || JSON.stringify(playerKey ? [playerKey] : []) !== JSON.stringify(input.brief.source.selection.roleBindings.chatPlayer ?? [])) fail('玩家人物投影与冻结选择不一致')
  if (JSON.stringify(backgroundKeys) !== JSON.stringify((draft.background ?? []).map(resource => resource.resourceKey))
    || JSON.stringify(backgroundKeys) !== JSON.stringify([...(input.brief.source.selection.roleBindings.chatBackground ?? [])].sort())) fail('背景资料投影与冻结选择不一致')
  const viewers = ['player', ...keys]
  const views = viewers.map(viewerKey => readPreparedChatSourceProjectionViewV1({draft, review: chat.sourceReview!, viewerKey}))
  const roleProfiles = input.brief.characterChatProfiles ? validateChatRoleProfilesForSourceV1(input.brief.characterChatProfiles, draft, chat.sourceReview) : undefined
  const sourceUnits = input.brief.characterChatSourceUnits?.bundles.length ? validateChatSourceUnitSetForProjectionV1(input.brief.characterChatSourceUnits, draft, chat.sourceReview) : undefined
  const interpreted = new Set(sourceUnits?.bundles.flatMap(bundle => bundle.candidate.fragments.map(row => row.fragmentKey)) ?? [])
  const visibleByFragment = new Map<string, string[]>()
  for (const [index, view] of views.entries()) for (const fragment of view) {
    visibleByFragment.set(fragment.fragmentKey, [...(visibleByFragment.get(fragment.fragmentKey) ?? []), index === 0 ? 'player' : participantKeys[index - 1]])
  }
  const purposes = new Map(chat.sourceReview.classifications.map(item => [item.fragmentKey, item.purpose]))
  const discoveries = new Map(chat.sourceReview.classifications.filter(item => item.discovery).map(item => [item.fragmentKey, item.discovery!]))
  if (discoveries.size && (chat.version !== 3 || !chat.narrative.permissions.maxDiscoveriesPerSituation)) fail('世界隐情没有作品级发现授权')
  if (sourceUnits?.bundles.some(bundle => bundle.permissions.some(row => row.discovery)) && (chat.version !== 3 || !chat.narrative.permissions.maxDiscoveriesPerSituation)) fail('逐项事实发现没有作品级授权')
  const fragments = chatProjectionResourcesV1(draft).flatMap(resource => resource.fragments)
  const sourceKeys = new Map(fragments.map((fragment, index) => [fragment.fragmentKey, `chat-source.${draft.projectionHash}.${index}`]))
  const privateSources = draft.characters.filter(c => c.origin === 'product-private').map(({resourceKey, sourceHash}) => ({resourceKey, sourceHash}))
  const content: FrozenChatSourceProjectionV1 = {
    schema: 'storyforge.chat-runtime-source', version: sourceUnits ? 6 : privateSources.length ? 5 : discoveries.size ? 4 : draft.playerCharacter ? 3 : draft.background?.length ? 2 : 1, projectionHash: draft.projectionHash,
    ...(sourceUnits ? {sourceUnits: structuredClone(sourceUnits)} : {}),
    ...(privateSources.length || sourceUnits ? {privateCharacterSources: privateSources} : {}),
    ...(draft.playerCharacter ? {playerCharacterSource: {resourceKey: draft.playerCharacter.resourceKey, sourceHash: draft.playerCharacter.sourceHash}} : discoveries.size || privateSources.length || sourceUnits ? {playerCharacterSource: null} : {}),
    ...(draft.background?.length || draft.playerCharacter || discoveries.size || privateSources.length || sourceUnits ? {backgroundSources: (draft.background ?? []).filter(resource => resource.fragments.some(fragment => interpreted.has(fragment.fragmentKey) || visibleByFragment.has(fragment.fragmentKey) || discoveries.has(fragment.fragmentKey)))
      .map(({resourceKey, sourceHash, resourceKind, relatedResourceKeys}) => ({resourceKey, sourceHash, resourceKind,
        ...(relatedResourceKeys ? {relatedResourceKeys} : {})}))} : {}),
    worldReleaseHash: draft.worldReleaseHash, playerRole: input.brief.intent.playerRole,
    knowledge: [...fragments.flatMap((fragment, index) => {
      if (interpreted.has(fragment.fragmentKey)) return []
      const audienceKeys = visibleByFragment.get(fragment.fragmentKey) ?? [], discovery = discoveries.get(fragment.fragmentKey)
      if (!audienceKeys.length && !discovery) return []
      const source = chatProjectionResourcesV1(draft).find(c => c.resourceKey === fragment.resourceKey)!
      return [{key: `chat-source.${draft.projectionHash}.${index}`, content: fragment.valueJson, audienceKeys,
        ...(discovery ? {discovery: {actorKeys: discovery.actorKeys.map(key => participantKeys[keys.indexOf(key)]), condition: discovery.condition,
          prerequisiteKnowledgeKeys: discovery.prerequisiteFragmentKeys.map(key => sourceKeys.get(key)!)}} : {}),
        source: {resourceKey: source.resourceKey, sourceHash: source.sourceHash, pointer: fragment.pointer, purpose: purposes.get(fragment.fragmentKey)!,
          ...(fragment.textRange ? {textRange: {...fragment.textRange}} : {})}}]
    }), ...(sourceUnits ? compileChatSourceUnitKnowledgeV1(sourceUnits, draft, sourceKeys, keys, participantKeys) : [])],
  }
  return {content,
    roleProfiles: keys.map(key => {const profile = roleProfiles?.profiles.find(row => row.actorKey === key); return profile ? formatChatRoleProfileV1(profile) : ''}),
    names: keys.map((key, index) => {
      const name = views[0].find(fragment => fragment.resourceKey === key && fragment.pointer === '/name')
      const value: unknown = name ? JSON.parse(name.valueJson) : null
      return typeof value === 'string' && value.trim() ? value : `角色 ${index + 1}`
    }),
    voices: keys.map((key, index) => views[index + 1].filter(fragment => fragment.resourceKey === key && fragment.purpose === 'voice').map(fragment => fragment.valueJson).join('\n')),
  }
}

interface LocationIndexV1 {
  locationByNode: Map<string, string>
  sourceByNode: Map<string, number>
}

function locations(input: ProductModuleCompilerInputV1): LocationIndexV1 {
  return {
    locationByNode: new Map(input.narrative.nodes.map((node, index) => [node.key, `location.${pad(index)}`])),
    sourceByNode: new Map(sources(input).map((node, index) => [node.key, index])),
  }
}

export function compileAdventureModuleV1(input: ProductModuleCompilerInputV1): AdventureContentV1 {
  const index = locations(input)
  const interaction = compileInteractionModulesV1(input)
  const worldLocations = selectedLocations(input)
  const worldArtifacts = selectedArtifacts(input)
  const choiceBySource = choiceMap(input)
  const quests: AdventureContentV1['quests'] = sources(input).map((node, nodeIndex) => ({
    key: `quest.${pad(nodeIndex)}`, title: node.title,
    description: node.summary || `在 ${node.title} 做出会留下后果的选择。`,
    initialStatus: 'active', prerequisites: [], objectives: [{
      key: 'resolve', title: '决定本阶段的行动方向', optional: false,
      alternativeActionKeys: (choiceBySource.get(node.key) ?? []).map(choice => `action.choice.${choice.choiceKey}`),
    }], rewardEffects: [], completionNodeKey: null, failureNodeKey: null,
  }))
  const choiceActions: AdventureContentV1['actions'] = input.narrative.choices.map(choice => {
    const sourceIndex = index.sourceByNode.get(choice.sourceNodeKey)
    const sourceLocation = index.locationByNode.get(choice.sourceNodeKey)
    const targetLocation = index.locationByNode.get(choice.targetNodeKey)
    if (sourceIndex == null || !sourceLocation || !targetLocation) fail(`Choice 地点映射失败:${choice.choiceKey}`)
    return {
      key: `action.choice.${choice.choiceKey}`, kind: 'move', label: choice.text,
      description: choice.description || `执行叙事选择 ${choice.choiceKey}`,
      locationKey: sourceLocation, targetKey: targetLocation, requirements: [], rule: { kind: 'automatic' },
      successEffects: [
        { op: 'enter-location', locationKey: targetLocation },
        { op: 'complete-objective', questKey: `quest.${pad(sourceIndex)}`, objectiveKey: 'resolve' },
      ], costlySuccessEffects: [], failureEffects: [],
      successText: input.narrative.beats.filter(beat => beat.nodeKey === choice.targetNodeKey).map(beat => beat.text).join('\n') || `你选择了：${choice.text}`,
      costlySuccessText: `你付出代价后选择了：${choice.text}`, failureText: `当前无法完成：${choice.text}`,
      unavailableText: choice.unavailableReason || '当前条件不允许这个行动。',
      repeatable: false, narrativeChoiceKey: choice.choiceKey, interaction: null,
    }
  })
  const lookActions: AdventureContentV1['actions'] = input.narrative.nodes.map((node, nodeIndex) => ({
    key: `action.look.${pad(nodeIndex)}`, kind: 'look', label: `观察：${node.title}`,
    description: node.summary || '重新确认当前局面。', locationKey: index.locationByNode.get(node.key)!,
    targetKey: null, requirements: [], rule: { kind: 'automatic' }, successEffects: [],
    costlySuccessEffects: [], failureEffects: [],
    successText: input.narrative.beats.filter(beat => beat.nodeKey === node.key).map(beat => beat.text).join('\n') || node.summary,
    costlySuccessText: '你辨认出有限线索。', failureText: '当前信息仍不完整。',
    unavailableText: '当前无法观察。', repeatable: true, narrativeChoiceKey: null, interaction: null,
  }))
  const initialLocationKey = index.locationByNode.get(input.narrative.entryNodeKey)!
  const fieldNotesItemKey = 'item.field-notes'
  const fieldNotesObjectKey = 'object.field-notes'
  const sourceArtifactObjects: AdventureContentV1['objects'] = worldArtifacts.map((artifact, artifactIndex) => ({
    key: `object.source.${pad(artifactIndex)}`,
    locationKey: index.locationByNode.get(input.narrative.nodes[artifactIndex % input.narrative.nodes.length].key)!,
    title: artifact.name, description: artifact.description || `来自冻结世界的道具：${artifact.name}`,
    tags: ['world-artifact', `source:${artifact.resourceKey}`],
  }))
  const sourceArtifactItems: AdventureContentV1['items'] = worldArtifacts.map((artifact, artifactIndex) => ({
    key: `item.source.${pad(artifactIndex)}`, title: artifact.name,
    description: artifact.description || `来自冻结世界的道具：${artifact.name}`,
    tags: ['world-artifact', `source:${artifact.resourceKey}`], stackable: false, consumable: false,
  }))
  const sourceArtifactActions: AdventureContentV1['actions'] = worldArtifacts.map((artifact, artifactIndex) => ({
    key: `action.take.source.${pad(artifactIndex)}`, kind: 'take', label: `取得：${artifact.name}`,
    description: artifact.description || `把 ${artifact.name} 收入随身物品。`,
    locationKey: sourceArtifactObjects[artifactIndex].locationKey,
    targetKey: sourceArtifactObjects[artifactIndex].key, requirements: [], rule: { kind: 'automatic' },
    successEffects: [{
      op: 'gain-item', itemKey: sourceArtifactItems[artifactIndex].key,
      quantity: 1, claimKey: `claim.source.${pad(artifactIndex)}`,
    }],
    costlySuccessEffects: [], failureEffects: [], successText: `你取得了${artifact.name}。`,
    costlySuccessText: `你付出代价后取得了${artifact.name}。`, failureText: `${artifact.name}暂时无法取得。`,
    unavailableText: `${artifact.name}已经被取走。`, repeatable: false, narrativeChoiceKey: null, interaction: null,
  }))
  const interactionScene = interaction.sceneTemplates[0]
  const interactionRule = interactionScene?.relationshipRules[0]
  const talkAction: AdventureContentV1['actions'] = interactionScene && interactionRule ? [{
    key: 'action.talk.opening', kind: 'talk', label: `交谈：${interaction.profiles[0].name}`,
    description: '进入共享角色互动场景，关系变化由冻结规则显式结算。',
    locationKey: initialLocationKey,
    targetKey: interaction.profiles[0].characterKey.startsWith('character.')
      ? interaction.profiles[0].characterKey : null,
    requirements: [], rule: { kind: 'automatic' }, successEffects: [], costlySuccessEffects: [], failureEffects: [],
    successText: '对话留下了可回放的关系与知识证据。', costlySuccessText: '对话推进，但关系付出代价。',
    failureText: '对方暂时拒绝继续。', unavailableText: '当前无法开始这段对话。', repeatable: true,
    narrativeChoiceKey: null,
    interaction: {
      participantKey: interaction.profiles[0].participantKey,
      sceneKey: interactionScene.sceneKey,
      ruleKey: interactionRule.ruleKey,
    },
  }] : []
  const parsedAdventure = parseAdventureContent({
    version: 1, initialLocationKey, playerKey: 'player',
    playerIdentity: { name: input.brief.intent.playerRole, description: input.brief.intent.openingSituation },
    locations: input.narrative.nodes.map((node, nodeIndex) => {
      const worldLocation = worldLocations.length ? worldLocations[nodeIndex % worldLocations.length] : null
      return {
        key: index.locationByNode.get(node.key)!,
        title: worldLocation ? `${worldLocation.name} · ${node.title}` : node.title,
        description: [worldLocation?.description, node.summary
          || input.narrative.beats.filter(beat => beat.nodeKey === node.key).map(beat => beat.text).join('\n')]
          .filter(Boolean).join('\n'),
        tags: [node.kind, `narrative:${node.key}`, ...(worldLocation ? [`world-location:${worldLocation.resourceKey}`] : [])],
      }
    }),
    objects: [{
      key: fieldNotesObjectKey, locationKey: initialLocationKey, title: '现场记录夹',
      description: '保存已确认事实、未解问题和公开范围的便携记录夹。', tags: ['evidence', 'tool'],
    }, ...sourceArtifactObjects],
    items: [{
      key: fieldNotesItemKey, title: '现场记录', description: '可随身查阅的调查记录。',
      tags: ['evidence', 'tool'], stackable: false, consumable: false,
    }, ...sourceArtifactItems],
    abilities: [{ key: 'resolve', title: '决断', description: '识别局势并承担后果。', initial: 2, minimum: 0, maximum: 10 }],
    conditions: [], resources: [{ key: 'focus', title: '专注', initial: 5, minimum: 0, maximum: 5 }],
    quests,
    actions: [...choiceActions, ...lookActions, {
      key: 'action.take.field-notes', kind: 'take', label: '拿起现场记录',
      description: '把记录夹中的关键信息整理进随身物品。', locationKey: initialLocationKey,
      targetKey: fieldNotesObjectKey, requirements: [], rule: { kind: 'automatic' },
      successEffects: [{ op: 'gain-item', itemKey: fieldNotesItemKey, quantity: 1, claimKey: 'claim.field-notes' }],
      costlySuccessEffects: [], failureEffects: [], successText: '你取得了现场记录。',
      costlySuccessText: '你取得了部分记录。', failureText: '记录暂时无法取得。', unavailableText: '现场记录已经被取走。',
      repeatable: false, narrativeChoiceKey: null, interaction: null,
    }, ...sourceArtifactActions, ...talkAction],
    initialInventory: [],
  })
  if (parsedAdventure.version !== 1) throw new Error('[product-adapter] V1 compiler 产生了意外的 V2 冒险内容')
  return parsedAdventure
}
