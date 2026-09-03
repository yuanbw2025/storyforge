import type {
  ProductWorldSourceBundleV1,
  RulePackV1,
  TtrpgCampaignContentV1,
  TtrpgCharacterTemplateV1,
} from '../types'
import { isSha256Hash } from '../product-production/hash'
import { evaluateRuleNumberExpressionV1, parseRulePackV1 } from './rule-pack'
import { parseTtrpgCharacterSheetV2 } from './character-sheet'
import { parseTtrpgMediaManifestV1, parseTtrpgVisualBibleV1 } from './media-contract'

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

function fail(message: string): never {
  throw new Error(`[ttrpg-campaign] ${message}`)
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || expected.some((key, index) => key !== actual[index])) {
    fail(`${label} 字段不精确:${actual.join(',')}`)
  }
}

function text(value: unknown, label: string, maximum = 20_000): string {
  if (typeof value !== 'string') fail(`${label} 必须是字符串`)
  const result = value.trim().normalize('NFC')
  if (!result || result.length > maximum) fail(`${label} 为空或过长`)
  return result
}

function stableKey(value: unknown, label: string): string {
  const result = text(value, label, 200)
  if (!KEY.test(result)) fail(`${label} 不是稳定 key`)
  return result
}

function finite(value: unknown, label: string, minimum = -1_000_000, maximum = 1_000_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail(`${label} 数值无效`)
  return value
}

function integer(value: unknown, label: string, minimum = 0, maximum = 1_000_000): number {
  const result = finite(value, label, minimum, maximum)
  if (!Number.isInteger(result)) fail(`${label} 必须是整数`)
  return result
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label} 必须是 boolean`)
  return value
}

function enumValue<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) fail(`${label} 枚举无效`)
  return value as T
}

function array(value: unknown, label: string, maximum = 1_000): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} 必须是有界数组`)
  return value
}

function keyArray(value: unknown, label: string, maximum = 1_000): string[] {
  const result = array(value, label, maximum).map((item, index) => stableKey(item, `${label}[${index}]`))
  if (new Set(result).size !== result.length) fail(`${label} 不允许重复`)
  return result
}

function textArray(value: unknown, label: string, maximum = 1_000): string[] {
  const result = array(value, label, maximum).map((item, index) => text(item, `${label}[${index}]`, 2_000))
  if (new Set(result).size !== result.length) fail(`${label} 不允许重复`)
  return result
}

function numericRecord(value: unknown, label: string): Record<string, number> {
  const row = object(value, label)
  if (Object.keys(row).length > 256) fail(`${label} 字段过多`)
  return Object.fromEntries(Object.entries(row).map(([field, number]) => [
    stableKey(field, `${label}.key`), finite(number, `${label}.${field}`),
  ]))
}

function nullableKey(value: unknown, label: string): string | null {
  return value == null ? null : stableKey(value, label)
}

function validateKnown(values: string[], known: Set<string>, label: string): void {
  const missing = values.filter(value => !known.has(value))
  if (missing.length) fail(`${label} 引用了未知 key:${missing.join(',')}`)
}

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) fail(`${label} key 重复`)
}

export interface TtrpgCampaignValidationReportV1 {
  valid: boolean
  errors: string[]
  warnings: string[]
  unconfirmedAttributeMappings: Array<{ characterKey: string; attributeKey: string }>
  structural: {
    reachableSceneKeys: string[]
    unreachableSceneKeys: string[]
    deadEndSceneKeys: string[]
    unreachableEndingKeys: string[]
    counterexamples: Array<{
      caseKey: 'direct' | 'failed-checks' | 'missed-first-path' | 'npc-unavailable' | 'split-party'
      passed: boolean
      evidence: string[]
    }>
  }
}

export function parseTtrpgCampaignContentV1(
  value: string | unknown,
  rulePackValue: RulePackV1 | unknown,
): TtrpgCampaignContentV1 {
  const rulePack = parseRulePackV1(rulePackValue)
  let raw: unknown = value
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { fail('不是合法 JSON') }
  }
  const root = object(raw, 'campaign')
  const rootFields = [
    'schema', 'version', 'campaignKey', 'title', 'pitch', 'playerCount', 'estimatedMinutes', 'tags',
    'difficulty', 'contentWarnings', 'sessionZero', 'openingSceneKey', 'characterTemplates', 'scenes',
    'clues', 'quests', 'endings', 'handouts', 'advancementMilestones', 'sourceWorld',
  ]
  if (Object.prototype.hasOwnProperty.call(root, 'gmMode')) rootFields.push('gmMode')
  if (Object.prototype.hasOwnProperty.call(root, 'informationPolicy')) rootFields.push('informationPolicy')
  if (Object.prototype.hasOwnProperty.call(root, 'bible')) rootFields.push('bible')
  if (Object.prototype.hasOwnProperty.call(root, 'clocks')) rootFields.push('clocks')
  if (Object.prototype.hasOwnProperty.call(root, 'fronts')) rootFields.push('fronts')
  if (Object.prototype.hasOwnProperty.call(root, 'secrets')) rootFields.push('secrets')
  if (Object.prototype.hasOwnProperty.call(root, 'designProvenance')) rootFields.push('designProvenance')
  if (Object.prototype.hasOwnProperty.call(root, 'tabletop')) rootFields.push('tabletop')
  if (Object.prototype.hasOwnProperty.call(root, 'visualBible')) rootFields.push('visualBible')
  if (Object.prototype.hasOwnProperty.call(root, 'mediaManifest')) rootFields.push('mediaManifest')
  exact(root, rootFields, 'campaign')
  if (root.schema !== 'storyforge.ttrpg-campaign' || root.version !== 1) fail('schema/version 无效')
  stableKey(root.campaignKey, 'campaignKey')
  if (root.gmMode != null) enumValue(root.gmMode, ['human', 'ai', 'hybrid'] as const, 'gmMode')
  text(root.title, 'title', 300)
  text(root.pitch, 'pitch', 10_000)
  const playerCount = object(root.playerCount, 'playerCount')
  exact(playerCount, ['minimum', 'maximum'], 'playerCount')
  const minimumPlayers = integer(playerCount.minimum, 'playerCount.minimum', 1, 20)
  const maximumPlayers = integer(playerCount.maximum, 'playerCount.maximum', 1, 20)
  if (minimumPlayers > maximumPlayers) fail('playerCount 范围无效')
  integer(root.estimatedMinutes, 'estimatedMinutes', 15, 100_000)
  textArray(root.tags, 'tags', 100)
  enumValue(root.difficulty, ['introductory', 'standard', 'challenging'] as const, 'difficulty')
  textArray(root.contentWarnings, 'contentWarnings', 100)

  const sessionZero = object(root.sessionZero, 'sessionZero')
  exact(sessionZero, ['premise', 'consentChecklist', 'lines', 'veils', 'pauseSignal', 'openDoor'], 'sessionZero')
  text(sessionZero.premise, 'sessionZero.premise')
  const consent = textArray(sessionZero.consentChecklist, 'sessionZero.consentChecklist', 100)
  if (!consent.length) fail('sessionZero.consentChecklist 不得为空')
  textArray(sessionZero.lines, 'sessionZero.lines', 100)
  textArray(sessionZero.veils, 'sessionZero.veils', 100)
  text(sessionZero.pauseSignal, 'sessionZero.pauseSignal', 200)
  bool(sessionZero.openDoor, 'sessionZero.openDoor')

  if (root.bible != null) {
    const bible = object(root.bible, 'bible')
    exact(bible, ['premise', 'background', 'coreConflict', 'themes', 'canonInvariants', 'sourceRefs'], 'bible')
    text(bible.premise, 'bible.premise')
    text(bible.background, 'bible.background')
    text(bible.coreConflict, 'bible.coreConflict')
    textArray(bible.themes, 'bible.themes', 100)
    const invariants = textArray(bible.canonInvariants, 'bible.canonInvariants', 200)
    if (!invariants.length) fail('bible.canonInvariants 不得为空')
    const sources = keyArray(bible.sourceRefs, 'bible.sourceRefs', 200)
    if (!sources.length) fail('bible.sourceRefs 不得为空')
  }
  if (root.designProvenance != null) {
    const provenance = object(root.designProvenance, 'designProvenance')
    exact(provenance, ['origin', 'proposalKeys', 'baseProposalKey', 'sectionSources', 'lockedSections', 'candidateHash'], 'designProvenance')
    enumValue(provenance.origin, ['author-guided', 'ai-candidate'] as const, 'designProvenance.origin')
    const proposalKeys = keyArray(provenance.proposalKeys, 'designProvenance.proposalKeys', 3)
    if (proposalKeys.length < 2 || proposalKeys.length > 3) fail('designProvenance 必须绑定 2～3 个提案')
    const baseProposalKey = stableKey(provenance.baseProposalKey, 'designProvenance.baseProposalKey')
    if (!proposalKeys.includes(baseProposalKey)) fail('designProvenance baseProposalKey 无效')
    const sections = ['background', 'coreConflict', 'opening', 'fronts', 'secrets', 'endings'] as const
    const sources = object(provenance.sectionSources, 'designProvenance.sectionSources')
    exact(sources, sections, 'designProvenance.sectionSources')
    for (const section of sections) {
      const proposalKey = stableKey(sources[section], `designProvenance.sectionSources.${section}`)
      if (!proposalKeys.includes(proposalKey)) fail(`designProvenance 分区来源无效:${section}`)
    }
    const locks = textArray(provenance.lockedSections, 'designProvenance.lockedSections', sections.length)
    if (locks.some(lock => !sections.includes(lock as typeof sections[number]))) fail('designProvenance 包含未知锁定分区')
    if (provenance.candidateHash != null && !isSha256Hash(provenance.candidateHash)) fail('designProvenance candidateHash 无效')
    if ((provenance.origin === 'ai-candidate') !== (provenance.candidateHash != null)) fail('designProvenance AI 来源与 candidateHash 不闭合')
  }

  if (root.informationPolicy != null) {
    const information = object(root.informationPolicy, 'informationPolicy')
    exact(information, [
      'characterPrivateChannels', 'gmSecrets', 'hiddenNpcState', 'hiddenDice',
      'interPlayerWhispers', 'revealAuditTrail',
    ], 'informationPolicy')
    bool(information.characterPrivateChannels, 'informationPolicy.characterPrivateChannels')
    bool(information.gmSecrets, 'informationPolicy.gmSecrets')
    bool(information.hiddenNpcState, 'informationPolicy.hiddenNpcState')
    enumValue(information.hiddenDice, ['never', 'gm-only', 'allowed'] as const, 'informationPolicy.hiddenDice')
    bool(information.interPlayerWhispers, 'informationPolicy.interPlayerWhispers')
    bool(information.revealAuditTrail, 'informationPolicy.revealAuditTrail')
  }

  const attributeKeys = new Set(rulePack.attributes.map(row => row.key))
  const resourceKeys = new Set(rulePack.resources.map(row => row.key))
  const itemKeys = new Set(rulePack.items.map(row => row.key))
  const actionKeys = new Set(rulePack.actions.map(row => row.key))
  const characterKeys: string[] = []
  const characters = array(root.characterTemplates, 'characterTemplates', 256).map((value, index) => {
    const row = object(value, `characterTemplates[${index}]`)
    const characterFields = [
      'characterKey', 'name', 'description', 'sourceRefs', 'role', 'attributes', 'attributeMappings',
      'skills', 'resources', 'itemKeys', 'actionKeys', 'portraitAssetKey',
    ]
    if (Object.prototype.hasOwnProperty.call(row, 'seatKey')) characterFields.push('seatKey')
    if (Object.prototype.hasOwnProperty.call(row, 'controller')) characterFields.push('controller')
    if (Object.prototype.hasOwnProperty.call(row, 'playerProfile')) characterFields.push('playerProfile')
    if (Object.prototype.hasOwnProperty.call(row, 'gmProfile')) characterFields.push('gmProfile')
    if (Object.prototype.hasOwnProperty.call(row, 'characterSheet')) characterFields.push('characterSheet')
    exact(row, characterFields, `characterTemplates[${index}]`)
    const characterKey = stableKey(row.characterKey, 'character.characterKey')
    if (row.seatKey != null) stableKey(row.seatKey, 'character.seatKey')
    characterKeys.push(characterKey)
    text(row.name, 'character.name', 300)
    text(row.description, 'character.description')
    keyArray(row.sourceRefs, 'character.sourceRefs', 100)
    const role = enumValue(row.role, ['player', 'npc'] as const, 'character.role')
    if (row.seatKey != null && role !== 'player') fail('只有玩家角色可以绑定 seatKey')
    if (row.controller != null) {
      const controller = enumValue(row.controller, ['human', 'ai', 'open', 'gm'] as const, 'character.controller')
      if ((role === 'npc') !== (controller === 'gm')) {
        fail('NPC 必须由 GM 控制；玩家角色不能使用 gm controller')
      }
    }
    const attributes = numericRecord(row.attributes, 'character.attributes')
    validateKnown(Object.keys(attributes), attributeKeys, 'character.attributes')
    if (Object.keys(attributes).length !== attributeKeys.size) fail('character.attributes 必须覆盖全部规则属性')
    const mappings = object(row.attributeMappings, 'character.attributeMappings')
    if (Object.keys(mappings).length !== attributeKeys.size) fail('character.attributeMappings 必须覆盖全部规则属性')
    for (const [attributeKey, mappingValue] of Object.entries(mappings)) {
      validateKnown([attributeKey], attributeKeys, 'character.attributeMappings')
      const mapping = object(mappingValue, `character.attributeMappings.${attributeKey}`)
      exact(mapping, ['value', 'derivationRule', 'sourceRefs', 'authorConfirmed'], `character.attributeMappings.${attributeKey}`)
      if (finite(mapping.value, 'mapping.value') !== attributes[attributeKey]) fail(`属性映射值与 attributes 不一致:${attributeKey}`)
      text(mapping.derivationRule, 'mapping.derivationRule', 2_000)
      keyArray(mapping.sourceRefs, 'mapping.sourceRefs', 100)
      bool(mapping.authorConfirmed, 'mapping.authorConfirmed')
    }
    numericRecord(row.skills, 'character.skills')
    const resources = numericRecord(row.resources, 'character.resources')
    validateKnown(Object.keys(resources), resourceKeys, 'character.resources')
    const characterItemKeys = keyArray(row.itemKeys, 'character.itemKeys', 100)
    const characterActionKeys = keyArray(row.actionKeys, 'character.actionKeys', 100)
    validateKnown(characterItemKeys, itemKeys, 'character.itemKeys')
    validateKnown(characterActionKeys, actionKeys, 'character.actionKeys')
    nullableKey(row.portraitAssetKey, 'character.portraitAssetKey')
    if (row.playerProfile != null) {
      if (role !== 'player') fail('只有玩家角色可以包含 playerProfile')
      const profile = object(row.playerProfile, 'character.playerProfile')
      exact(profile, ['privateGoal', 'secret', 'portrayal'], 'character.playerProfile')
      text(profile.privateGoal, 'character.playerProfile.privateGoal')
      text(profile.secret, 'character.playerProfile.secret')
      text(profile.portrayal, 'character.playerProfile.portrayal')
    }
    if (row.gmProfile != null) {
      if (role !== 'npc') fail('只有 NPC 可以包含 gmProfile')
      const profile = object(row.gmProfile, 'character.gmProfile')
      exact(profile, ['objective', 'leverage', 'secret', 'portrayal', 'escalation'], 'character.gmProfile')
      text(profile.objective, 'character.gmProfile.objective')
      text(profile.leverage, 'character.gmProfile.leverage')
      text(profile.secret, 'character.gmProfile.secret')
      text(profile.portrayal, 'character.gmProfile.portrayal')
      text(profile.escalation, 'character.gmProfile.escalation')
    }
    const parsed = structuredClone(row) as unknown as TtrpgCharacterTemplateV1
    if (row.characterSheet != null) {
      const { characterSheet: _ignored, ...templateWithoutSheet } = parsed
      parsed.characterSheet = parseTtrpgCharacterSheetV2(row.characterSheet, templateWithoutSheet, rulePack)
    }
    return parsed
  })
  unique(characterKeys, 'characterTemplates')
  unique(characters.flatMap(row => typeof row.seatKey === 'string' ? [row.seatKey] : []), 'characterTemplates.seatKey')
  if (!characters.some(row => row.role === 'player')) fail('至少需要一个玩家角色模板')
  const knownCharacters = new Set(characterKeys)

  const clueKeys: string[] = []
  const conclusions = new Set<string>()
  const clues = array(root.clues, 'clues', 1_000).map((value, index) => {
    const row = object(value, `clues[${index}]`)
    exact(row, ['clueKey', 'title', 'description', 'conclusionKey', 'required', 'discoveryPaths', 'visibility', 'sourceRefs'], `clues[${index}]`)
    clueKeys.push(stableKey(row.clueKey, 'clue.clueKey'))
    text(row.title, 'clue.title', 300)
    text(row.description, 'clue.description')
    conclusions.add(stableKey(row.conclusionKey, 'clue.conclusionKey'))
    bool(row.required, 'clue.required')
    const pathKeys = array(row.discoveryPaths, 'clue.discoveryPaths', 20).map((pathValue, pathIndex) => {
      const path = object(pathValue, `clue.discoveryPaths[${pathIndex}]`)
      exact(path, ['pathKey', 'sceneKey', 'actionKey', 'failForward'], `clue.discoveryPaths[${pathIndex}]`)
      stableKey(path.sceneKey, 'clue.path.sceneKey')
      const actionKey = stableKey(path.actionKey, 'clue.path.actionKey')
      validateKnown([actionKey], actionKeys, 'clue.path.actionKey')
      text(path.failForward, 'clue.path.failForward')
      return stableKey(path.pathKey, 'clue.path.pathKey')
    })
    unique(pathKeys, 'clue.discoveryPaths')
    if (row.required === true && pathKeys.length < 2) fail(`必需线索至少要有两条发现路径:${row.clueKey}`)
    enumValue(row.visibility, ['gm-only', 'discoverable', 'public'] as const, 'clue.visibility')
    keyArray(row.sourceRefs, 'clue.sourceRefs', 100)
    return structuredClone(row)
  })
  unique(clueKeys, 'clues')
  const knownClues = new Set(clueKeys)

  const sceneKeys: string[] = []
  const scenes = array(root.scenes, 'scenes', 1_000).map((value, index) => {
    const row = object(value, `scenes[${index}]`)
    const sceneFields = ['sceneKey', 'title', 'description', 'locationKey', 'participantKeys', 'clueKeys', 'actionKeys', 'nextSceneKeys', 'failureForward', 'gmSecret', 'sourceRefs']
    if (Object.prototype.hasOwnProperty.call(row, 'tabletopMapKey')) sceneFields.push('tabletopMapKey')
    exact(row, sceneFields, `scenes[${index}]`)
    const sceneKey = stableKey(row.sceneKey, 'scene.sceneKey')
    sceneKeys.push(sceneKey)
    text(row.title, 'scene.title', 300)
    text(row.description, 'scene.description')
    nullableKey(row.locationKey, 'scene.locationKey')
    const participants = keyArray(row.participantKeys, 'scene.participantKeys', 256)
    validateKnown(participants, knownCharacters, 'scene.participantKeys')
    const sceneClues = keyArray(row.clueKeys, 'scene.clueKeys', 256)
    validateKnown(sceneClues, knownClues, 'scene.clueKeys')
    const sceneActions = keyArray(row.actionKeys, 'scene.actionKeys', 256)
    validateKnown(sceneActions, actionKeys, 'scene.actionKeys')
    keyArray(row.nextSceneKeys, 'scene.nextSceneKeys', 256)
    text(row.failureForward, 'scene.failureForward')
    text(row.gmSecret, 'scene.gmSecret')
    keyArray(row.sourceRefs, 'scene.sourceRefs', 100)
    if (Object.prototype.hasOwnProperty.call(row, 'tabletopMapKey')) nullableKey(row.tabletopMapKey, 'scene.tabletopMapKey')
    return structuredClone(row)
  })
  unique(sceneKeys, 'scenes')
  const knownScenes = new Set(sceneKeys)
  const openingSceneKey = stableKey(root.openingSceneKey, 'openingSceneKey')
  validateKnown([openingSceneKey], knownScenes, 'openingSceneKey')
  for (const scene of scenes) validateKnown(scene.nextSceneKeys as string[], knownScenes, `scene ${scene.sceneKey}.nextSceneKeys`)
  for (const clue of clues) {
    for (const path of clue.discoveryPaths as Array<{ sceneKey: string }>) validateKnown([path.sceneKey], knownScenes, `clue ${clue.clueKey}.discoveryPaths`)
  }

  const clockKeys: string[] = []
  if (root.clocks != null) {
    array(root.clocks, 'clocks', 256).forEach((value, index) => {
      const row = object(value, `clocks[${index}]`)
      exact(row, ['clockKey', 'title', 'description', 'initialValue', 'maximum', 'advanceTriggers', 'onComplete', 'visibility', 'sourceRefs'], `clocks[${index}]`)
      const clockKey = stableKey(row.clockKey, 'clock.clockKey')
      clockKeys.push(clockKey)
      text(row.title, 'clock.title', 300)
      text(row.description, 'clock.description')
      const maximum = integer(row.maximum, 'clock.maximum', 2, 100)
      integer(row.initialValue, 'clock.initialValue', 0, maximum - 1)
      const triggerKeys = array(row.advanceTriggers, 'clock.advanceTriggers', 100).map((triggerValue, triggerIndex) => {
        const trigger = object(triggerValue, `clock.advanceTriggers[${triggerIndex}]`)
        exact(trigger, ['triggerKey', 'sceneKey', 'actionKey', 'amount', 'reason'], `clock.advanceTriggers[${triggerIndex}]`)
        const sceneKey = nullableKey(trigger.sceneKey, 'clock.trigger.sceneKey')
        const actionKey = nullableKey(trigger.actionKey, 'clock.trigger.actionKey')
        if (sceneKey) validateKnown([sceneKey], knownScenes, 'clock.trigger.sceneKey')
        if (actionKey) validateKnown([actionKey], actionKeys, 'clock.trigger.actionKey')
        if (!sceneKey && !actionKey) fail('clock trigger 至少绑定 sceneKey 或 actionKey')
        integer(trigger.amount, 'clock.trigger.amount', 1, maximum)
        text(trigger.reason, 'clock.trigger.reason')
        return stableKey(trigger.triggerKey, 'clock.trigger.triggerKey')
      })
      if (!triggerKeys.length) fail(`Clock 至少需要一个推进条件:${clockKey}`)
      unique(triggerKeys, `clock ${clockKey}.advanceTriggers`)
      text(row.onComplete, 'clock.onComplete')
      enumValue(row.visibility, ['gm-only', 'party', 'public'] as const, 'clock.visibility')
      const sources = keyArray(row.sourceRefs, 'clock.sourceRefs', 100)
      if (!sources.length) fail(`Clock 缺少来源:${clockKey}`)
    })
    unique(clockKeys, 'clocks')
  }
  const knownClocks = new Set(clockKeys)

  const frontKeys: string[] = []
  if (root.fronts != null) {
    array(root.fronts, 'fronts', 128).forEach((value, index) => {
      const row = object(value, `fronts[${index}]`)
      exact(row, ['frontKey', 'title', 'goal', 'participantKeys', 'clockKeys', 'escalation', 'defeatConditions', 'sourceRefs'], `fronts[${index}]`)
      const frontKey = stableKey(row.frontKey, 'front.frontKey')
      frontKeys.push(frontKey)
      text(row.title, 'front.title', 300)
      text(row.goal, 'front.goal')
      const participants = keyArray(row.participantKeys, 'front.participantKeys', 100)
      validateKnown(participants, knownCharacters, 'front.participantKeys')
      if (!participants.length) fail(`Front 缺少参与者:${frontKey}`)
      const clocks = keyArray(row.clockKeys, 'front.clockKeys', 100)
      validateKnown(clocks, knownClocks, 'front.clockKeys')
      if (!clocks.length) fail(`Front 缺少 Clock:${frontKey}`)
      if (!textArray(row.escalation, 'front.escalation', 100).length) fail(`Front 缺少升级阶梯:${frontKey}`)
      if (!textArray(row.defeatConditions, 'front.defeatConditions', 100).length) fail(`Front 缺少阻止条件:${frontKey}`)
      if (!keyArray(row.sourceRefs, 'front.sourceRefs', 100).length) fail(`Front 缺少来源:${frontKey}`)
    })
    unique(frontKeys, 'fronts')
  }

  const secretKeys: string[] = []
  if (root.secrets != null) {
    array(root.secrets, 'secrets', 512).forEach((value, index) => {
      const row = object(value, `secrets[${index}]`)
      exact(row, ['secretKey', 'title', 'truth', 'holderKeys', 'relatedClueKeys', 'revealRule', 'visibility', 'sourceRefs'], `secrets[${index}]`)
      const secretKey = stableKey(row.secretKey, 'secret.secretKey')
      secretKeys.push(secretKey)
      text(row.title, 'secret.title', 300)
      text(row.truth, 'secret.truth')
      const holders = keyArray(row.holderKeys, 'secret.holderKeys', 100)
      validateKnown(holders, knownCharacters, 'secret.holderKeys')
      const relatedClues = keyArray(row.relatedClueKeys, 'secret.relatedClueKeys', 100)
      validateKnown(relatedClues, knownClues, 'secret.relatedClueKeys')
      if (!relatedClues.length) fail(`Secret 缺少可审计揭示线索:${secretKey}`)
      text(row.revealRule, 'secret.revealRule')
      enumValue(row.visibility, ['gm-only', 'character-private'] as const, 'secret.visibility')
      if (!keyArray(row.sourceRefs, 'secret.sourceRefs', 100).length) fail(`Secret 缺少来源:${secretKey}`)
    })
    unique(secretKeys, 'secrets')
  }

  if (root.tabletop != null) {
    const tabletop = object(root.tabletop, 'tabletop')
    exact(tabletop, ['maps'], 'tabletop')
    const mapKeys: string[] = []
    const layerKeys: string[] = []
    const areaKeys: string[] = []
    const tokenKeys: string[] = []
    const fogKeys: string[] = []
    const maps = array(tabletop.maps, 'tabletop.maps', 256).map((value, mapIndex) => {
      const map = object(value, `tabletop.maps[${mapIndex}]`)
      exact(map, ['mapKey', 'title', 'width', 'height', 'backgroundAssetKey', 'fallbackDescription', 'grid', 'layers', 'areas', 'tokens', 'fog'], `tabletop.maps[${mapIndex}]`)
      const mapKey = stableKey(map.mapKey, 'tabletop.map.mapKey')
      mapKeys.push(mapKey)
      text(map.title, 'tabletop.map.title', 300)
      integer(map.width, 'tabletop.map.width', 4, 100)
      integer(map.height, 'tabletop.map.height', 4, 100)
      nullableKey(map.backgroundAssetKey, 'tabletop.map.backgroundAssetKey')
      text(map.fallbackDescription, 'tabletop.map.fallbackDescription')
      const grid = object(map.grid, 'tabletop.map.grid')
      exact(grid, ['kind', 'cellSize', 'distancePerCell', 'unit'], 'tabletop.map.grid')
      enumValue(grid.kind, ['square', 'zone'] as const, 'tabletop.map.grid.kind')
      integer(grid.cellSize, 'tabletop.map.grid.cellSize', 1, 20)
      const distancePerCell = finite(grid.distancePerCell, 'tabletop.map.grid.distancePerCell')
      if (distancePerCell <= 0 || distancePerCell > 10_000) fail('tabletop.map.grid.distancePerCell 超出范围')
      text(grid.unit, 'tabletop.map.grid.unit', 40)
      array(map.layers, 'tabletop.map.layers', 64).forEach((layerValue, layerIndex) => {
        const layer = object(layerValue, `tabletop.map.layers[${layerIndex}]`)
        exact(layer, ['layerKey', 'title', 'kind', 'zIndex', 'opacity', 'gmOnly'], `tabletop.map.layers[${layerIndex}]`)
        layerKeys.push(stableKey(layer.layerKey, 'tabletop.layer.layerKey'))
        text(layer.title, 'tabletop.layer.title', 300)
        enumValue(layer.kind, ['terrain', 'objects', 'annotation'] as const, 'tabletop.layer.kind')
        integer(layer.zIndex, 'tabletop.layer.zIndex', -100, 100)
        const opacity = finite(layer.opacity, 'tabletop.layer.opacity')
        if (opacity < 0 || opacity > 1) fail('tabletop.layer.opacity 必须在 0..1')
        bool(layer.gmOnly, 'tabletop.layer.gmOnly')
      })
      array(map.areas, 'tabletop.map.areas', 256).forEach((areaValue, areaIndex) => {
        const area = object(areaValue, `tabletop.map.areas[${areaIndex}]`)
        exact(area, ['areaKey', 'title', 'x', 'y', 'width', 'height', 'gmOnly'], `tabletop.map.areas[${areaIndex}]`)
        areaKeys.push(stableKey(area.areaKey, 'tabletop.area.areaKey'))
        text(area.title, 'tabletop.area.title', 300)
        integer(area.x, 'tabletop.area.x', 0, 99)
        integer(area.y, 'tabletop.area.y', 0, 99)
        const width = integer(area.width, 'tabletop.area.width', 1, 100)
        const height = integer(area.height, 'tabletop.area.height', 1, 100)
        if (Number(area.x) + width > 100 || Number(area.y) + height > 100) fail('tabletop.area 超出地图边界')
        bool(area.gmOnly, 'tabletop.area.gmOnly')
      })
      array(map.tokens, 'tabletop.map.tokens', 256).forEach((tokenValue, tokenIndex) => {
        const token = object(tokenValue, `tabletop.map.tokens[${tokenIndex}]`)
        exact(token, ['tokenKey', 'entityKey', 'x', 'y', 'size', 'controllerKey', 'hidden'], `tabletop.map.tokens[${tokenIndex}]`)
        tokenKeys.push(stableKey(token.tokenKey, 'tabletop.token.tokenKey'))
        const entityKey = stableKey(token.entityKey, 'tabletop.token.entityKey')
        validateKnown([entityKey], knownCharacters, 'tabletop.token.entityKey')
        integer(token.x, 'tabletop.token.x', 0, 100)
        integer(token.y, 'tabletop.token.y', 0, 100)
        integer(token.size, 'tabletop.token.size', 1, 20)
        const controllerKey = nullableKey(token.controllerKey, 'tabletop.token.controllerKey')
        if (controllerKey) validateKnown([controllerKey], knownCharacters, 'tabletop.token.controllerKey')
        bool(token.hidden, 'tabletop.token.hidden')
      })
      array(map.fog, 'tabletop.map.fog', 256).forEach((fogValue, fogIndex) => {
        const fog = object(fogValue, `tabletop.map.fog[${fogIndex}]`)
        exact(fog, ['fogKey', 'title', 'x', 'y', 'width', 'height'], `tabletop.map.fog[${fogIndex}]`)
        fogKeys.push(stableKey(fog.fogKey, 'tabletop.fog.fogKey'))
        text(fog.title, 'tabletop.fog.title', 300)
        integer(fog.x, 'tabletop.fog.x', 0, 99)
        integer(fog.y, 'tabletop.fog.y', 0, 99)
        const width = integer(fog.width, 'tabletop.fog.width', 1, 100)
        const height = integer(fog.height, 'tabletop.fog.height', 1, 100)
        if (Number(fog.x) + width > 100 || Number(fog.y) + height > 100) fail('tabletop.fog 超出地图边界')
      })
      return mapKey
    })
    if (!maps.length) fail('tabletop.maps 不得为空')
    unique(mapKeys, 'tabletop.maps')
    unique(layerKeys, 'tabletop.layers')
    unique(areaKeys, 'tabletop.areas')
    unique(tokenKeys, 'tabletop.tokens')
    unique(fogKeys, 'tabletop.fog')
    const knownMaps = new Set(mapKeys)
    for (const scene of scenes) {
      if (scene.tabletopMapKey != null) validateKnown([String(scene.tabletopMapKey)], knownMaps, `scene ${scene.sceneKey}.tabletopMapKey`)
    }
  } else if (scenes.some(scene => scene.tabletopMapKey != null)) {
    fail('scene.tabletopMapKey 存在时 campaign.tabletop 不得缺失')
  }

  const questKeys = array(root.quests, 'quests', 256).map((value, index) => {
    const row = object(value, `quests[${index}]`)
    exact(row, ['questKey', 'title', 'objective', 'requiredConclusionKeys', 'failureForward'], `quests[${index}]`)
    text(row.title, 'quest.title', 300)
    text(row.objective, 'quest.objective')
    const requiredConclusions = keyArray(row.requiredConclusionKeys, 'quest.requiredConclusionKeys', 100)
    validateKnown(requiredConclusions, conclusions, 'quest.requiredConclusionKeys')
    text(row.failureForward, 'quest.failureForward')
    return stableKey(row.questKey, 'quest.questKey')
  })
  if (!questKeys.length) fail('quests 不得为空')
  unique(questKeys, 'quests')

  const endingKeys = array(root.endings, 'endings', 100).map((value, index) => {
    const row = object(value, `endings[${index}]`)
    const fields = ['endingKey', 'title', 'requirements', 'epilogue']
    if (Object.prototype.hasOwnProperty.call(row, 'trigger')) fields.push('trigger')
    exact(row, fields, `endings[${index}]`)
    text(row.title, 'ending.title', 300)
    textArray(row.requirements, 'ending.requirements', 100)
    text(row.epilogue, 'ending.epilogue')
    if (row.trigger != null) {
      const trigger = object(row.trigger, 'ending.trigger')
      exact(trigger, ['sceneKey', 'requiredConclusionKeys', 'forbiddenConclusionKeys'], 'ending.trigger')
      const sceneKey = stableKey(trigger.sceneKey, 'ending.trigger.sceneKey')
      validateKnown([sceneKey], knownScenes, 'ending.trigger.sceneKey')
      const required = keyArray(trigger.requiredConclusionKeys, 'ending.trigger.requiredConclusionKeys', 100)
      const forbidden = keyArray(trigger.forbiddenConclusionKeys, 'ending.trigger.forbiddenConclusionKeys', 100)
      validateKnown(required, conclusions, 'ending.trigger.requiredConclusionKeys')
      validateKnown(forbidden, conclusions, 'ending.trigger.forbiddenConclusionKeys')
      if (required.some(key => forbidden.includes(key))) fail('ending.trigger 同一结论不能同时 required 和 forbidden')
    }
    return stableKey(row.endingKey, 'ending.endingKey')
  })
  if (endingKeys.length < 2) fail('至少需要两个结局')
  unique(endingKeys, 'endings')

  const handoutKeys = array(root.handouts, 'handouts', 512).map((value, index) => {
    const row = object(value, `handouts[${index}]`)
    exact(row, ['handoutKey', 'title', 'body', 'revealClueKey', 'assetKey', 'fallbackText'], `handouts[${index}]`)
    text(row.title, 'handout.title', 300)
    text(row.body, 'handout.body')
    const revealClueKey = nullableKey(row.revealClueKey, 'handout.revealClueKey')
    if (revealClueKey) validateKnown([revealClueKey], knownClues, 'handout.revealClueKey')
    nullableKey(row.assetKey, 'handout.assetKey')
    text(row.fallbackText, 'handout.fallbackText')
    return stableKey(row.handoutKey, 'handout.handoutKey')
  })
  unique(handoutKeys, 'handouts')

  const milestoneKeys = array(root.advancementMilestones, 'advancementMilestones', 256).map((value, index) => {
    const row = object(value, `advancementMilestones[${index}]`)
    exact(row, ['milestoneKey', 'title', 'award'], `advancementMilestones[${index}]`)
    text(row.title, 'milestone.title', 300)
    integer(row.award, 'milestone.award', 0, 1_000)
    return stableKey(row.milestoneKey, 'milestone.milestoneKey')
  })
  unique(milestoneKeys, 'advancementMilestones')

  const sourceWorld = object(root.sourceWorld, 'sourceWorld')
  exact(sourceWorld, ['contentHash', 'bundleHash'], 'sourceWorld')
  if (!isSha256Hash(sourceWorld.contentHash) || !isSha256Hash(sourceWorld.bundleHash)) fail('sourceWorld hash 无效')
  if ((root.visualBible == null) !== (root.mediaManifest == null)) {
    fail('visualBible 与 mediaManifest 必须同时存在或同时缺失')
  }
  if (root.visualBible != null && root.mediaManifest != null) {
    const locationKeys = new Set(scenes.flatMap(scene => scene.locationKey == null ? [] : [String(scene.locationKey)]))
    parseTtrpgVisualBibleV1(root.visualBible, { characterKeys: knownCharacters, locationKeys })
    parseTtrpgMediaManifestV1(root.mediaManifest, {
      targetRefs: new Set([
        ...characterKeys, ...sceneKeys, ...locationKeys, ...handoutKeys,
        ...rulePack.items.map(item => item.key),
        ...(root.tabletop == null ? [] : (root.tabletop as { maps: Array<{ mapKey: string }> }).maps.map(map => map.mapKey)),
      ]),
    })
  }
  return structuredClone(root) as unknown as TtrpgCampaignContentV1
}

export function validateTtrpgCampaignForPublicationV1(
  value: TtrpgCampaignContentV1 | unknown,
  rulePackValue: RulePackV1 | unknown,
): TtrpgCampaignValidationReportV1 {
  const emptyStructural: TtrpgCampaignValidationReportV1['structural'] = {
    reachableSceneKeys: [], unreachableSceneKeys: [], deadEndSceneKeys: [], unreachableEndingKeys: [], counterexamples: [],
  }
  let campaign: TtrpgCampaignContentV1
  try {
    campaign = parseTtrpgCampaignContentV1(value, rulePackValue)
  } catch (error) {
    return {
      valid: false, errors: [error instanceof Error ? error.message : String(error)], warnings: [],
      unconfirmedAttributeMappings: [], structural: emptyStructural,
    }
  }
  const unconfirmedAttributeMappings = campaign.characterTemplates.flatMap(character => (
    Object.entries(character.attributeMappings).flatMap(([attributeKey, mapping]) => (
      mapping.authorConfirmed ? [] : [{ characterKey: character.characterKey, attributeKey }]
    ))
  ))
  const warnings = campaign.handouts.filter(handout => !handout.assetKey).map(handout => (
    `讲义 ${handout.handoutKey} 使用文本 fallback`
  ))
  const sceneByKey = new Map(campaign.scenes.map(scene => [scene.sceneKey, scene]))
  const reachable = new Set<string>()
  const queue = [campaign.openingSceneKey]
  while (queue.length) {
    const sceneKey = queue.shift()!
    if (reachable.has(sceneKey)) continue
    reachable.add(sceneKey)
    for (const next of sceneByKey.get(sceneKey)?.nextSceneKeys ?? []) {
      if (!reachable.has(next)) queue.push(next)
    }
  }
  const reachableSceneKeys = [...reachable].sort()
  const unreachableSceneKeys = campaign.scenes.map(scene => scene.sceneKey).filter(key => !reachable.has(key)).sort()
  const hasMachineTriggers = campaign.endings.some(ending => ending.trigger != null)
  const terminalReachable = campaign.scenes.filter(scene => reachable.has(scene.sceneKey) && scene.nextSceneKeys.length === 0)
  const endingReachable = (ending: TtrpgCampaignContentV1['endings'][number]) => (
    ending.trigger ? reachable.has(ending.trigger.sceneKey) : terminalReachable.length > 0
  )
  const unreachableEndingKeys = campaign.endings.filter(ending => !endingReachable(ending)).map(ending => ending.endingKey).sort()
  const endingSceneKeys = new Set(campaign.endings.flatMap(ending => ending.trigger ? [ending.trigger.sceneKey] : []))
  const deadEndSceneKeys = hasMachineTriggers
    ? terminalReachable.filter(scene => !endingSceneKeys.has(scene.sceneKey)).map(scene => scene.sceneKey).sort()
    : []
  const requiredClues = campaign.clues.filter(clue => clue.required)
  const reachablePaths = (clue: TtrpgCampaignContentV1['clues'][number]) => (
    clue.discoveryPaths.filter(path => reachable.has(path.sceneKey))
  )
  const allScenesFailForward = campaign.scenes.every(scene => scene.failureForward.trim().length > 0)
  const directPassed = campaign.endings.some(endingReachable)
  const failedChecksPassed = allScenesFailForward && requiredClues.every(clue => reachablePaths(clue).length >= 1)
  const missedFirstPathPassed = requiredClues.every(clue => (
    reachablePaths(clue).length >= 2
  ))
  const npcUnavailablePassed = requiredClues.every(clue => {
    const paths = reachablePaths(clue)
    return paths.length >= 2 && (
      new Set(paths.map(path => path.sceneKey)).size >= 2
      || new Set(paths.map(path => path.actionKey)).size >= 2
    )
  })
  const playerCount = campaign.characterTemplates.filter(character => character.role === 'player').length
  const splitPartyPassed = playerCount < 2 || (
    requiredClues.every(clue => reachablePaths(clue).length >= 2)
    && campaign.scenes.filter(scene => reachable.has(scene.sceneKey)).every(scene => scene.participantKeys.length > 0)
  )
  const structural: TtrpgCampaignValidationReportV1['structural'] = {
    reachableSceneKeys, unreachableSceneKeys, deadEndSceneKeys, unreachableEndingKeys,
    counterexamples: [
      { caseKey: 'direct', passed: directPassed, evidence: [`reachableEndings=${campaign.endings.filter(endingReachable).length}`] },
      { caseKey: 'failed-checks', passed: failedChecksPassed, evidence: [`allScenesFailForward=${allScenesFailForward}`, `requiredClues=${requiredClues.length}`] },
      { caseKey: 'missed-first-path', passed: missedFirstPathPassed, evidence: requiredClues.map(clue => `${clue.clueKey}:paths=${reachablePaths(clue).length}`) },
      { caseKey: 'npc-unavailable', passed: npcUnavailablePassed, evidence: requiredClues.map(clue => `${clue.clueKey}:actions=${new Set(reachablePaths(clue).map(path => path.actionKey)).size}`) },
      { caseKey: 'split-party', passed: splitPartyPassed, evidence: [`reachableScenes=${reachable.size}`, `requiredClues=${requiredClues.length}`] },
    ],
  }
  const errors: string[] = []
  if (unconfirmedAttributeMappings.length) errors.push(`存在 ${unconfirmedAttributeMappings.length} 个尚未由作者确认的角色数值映射`)
  if (unreachableSceneKeys.length) errors.push(`存在入口不可达场景:${unreachableSceneKeys.join(',')}`)
  if (unreachableEndingKeys.length) errors.push(`存在入口不可达结局:${unreachableEndingKeys.join(',')}`)
  if (deadEndSceneKeys.length) errors.push(`存在未绑定结局的终止场景:${deadEndSceneKeys.join(',')}`)
  for (const counterexample of structural.counterexamples) {
    if (!counterexample.passed) errors.push(`战役反例未通过:${counterexample.caseKey}`)
  }
  const productionCampaign = campaign.tags.includes('production-campaign-v2')
  if (productionCampaign) {
    if (!campaign.bible) errors.push('生产战役缺少 Campaign Bible')
    if (!campaign.clocks?.length) errors.push('生产战役缺少 Clock')
    if (!campaign.fronts?.length) errors.push('生产战役缺少 Front')
    if (!campaign.secrets?.length) errors.push('生产战役缺少结构化 Secret')
    if (campaign.endings.some(ending => !ending.trigger)) errors.push('生产战役结局缺少 machine trigger')
  }
  return { valid: errors.length === 0, errors, warnings, unconfirmedAttributeMappings, structural }
}

function safeSlug(value: string): string {
  const result = value.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  return result.slice(0, 80) || 'world'
}

const PRETAG_FIXTURE_SCENE_KEYS = [
  'scene.opening', 'scene.crosscheck', 'scene.respite', 'scene.confrontation',
] as const

/** Detects both newly tagged fixtures and pre-tag fixed compiler output already stored in IndexedDB. */
export function isTtrpgFixtureCampaignV1(campaign: TtrpgCampaignContentV1): boolean {
  if (campaign.tags.includes('fixture-only')) return true
  const sceneKeys = campaign.scenes.map(scene => scene.sceneKey).sort()
  const fixtureSceneKeys = [...PRETAG_FIXTURE_SCENE_KEYS].sort()
  return campaign.campaignKey.endsWith('.lost-evidence')
    && sceneKeys.join(',') === fixtureSceneKeys.join(',')
    && campaign.clues.map(clue => clue.clueKey).sort().join(',') === 'clue.motive,clue.timeline'
}

function defaultCharacter(
  entity: ProductWorldSourceBundleV1['initialState']['entities'][string],
  rulePack: RulePackV1,
  authorConfirmed: boolean,
  role: TtrpgCharacterTemplateV1['role'],
): TtrpgCharacterTemplateV1 {
  const sourceRef = entity.entityKey
  const attributes = Object.fromEntries(rulePack.attributes.map(attribute => [attribute.key, attribute.defaultValue]))
  const attributeMappings = Object.fromEntries(rulePack.attributes.map(attribute => [attribute.key, {
    value: attribute.defaultValue,
    derivationRule: `使用 ${rulePack.ruleSystemId}@${rulePack.ruleSystemVersion} 的默认值；世界来源未声明可直接采用的游戏数值。`,
    sourceRefs: [sourceRef],
    authorConfirmed,
  }]))
  const resources = Object.fromEntries(rulePack.resources.map(resource => {
    const maximum = evaluateRuleNumberExpressionV1(resource.maximumFormula, attributes)
    return [resource.key, resource.initialMode === 'maximum' ? maximum : resource.minimum]
  }))
  const identity = typeof entity.attributes.identity === 'string' && entity.attributes.identity.trim()
    ? entity.attributes.identity.trim()
    : `${entity.name} 的可玩角色模板。`
  return {
    characterKey: sourceRef,
    name: entity.name,
    description: identity,
    sourceRefs: [sourceRef], role, attributes, attributeMappings,
    skills: {}, resources,
    itemKeys: rulePack.items.length ? [rulePack.items[0].key] : [],
    actionKeys: rulePack.actions.map(action => action.key),
    portraitAssetKey: null,
    ...(role === 'npc' ? { gmProfile: {
      objective: `维护与“${identity}”相关的核心利益，并对玩家的证据与承诺作出一致回应。`,
      leverage: entity.locationKey ? `熟悉 ${entity.locationKey} 及其人物关系。` : '掌握一条可用于交换的世界内信息。',
      secret: '对公开真相有所保留；只有玩家行动或已发现证据满足场景条件时才释放相关信息。',
      portrayal: `以${identity}的身份和立场回应，不替玩家作决定。`,
      escalation: '受到直接威胁时先提高代价或转移谈判条件，不凭空改写已提交事实。',
    } } : {}),
  }
}

/**
 * Deterministic fixture compiler retained for runtime and lifecycle tests.
 * Product code must use the reviewed CampaignPack production pipeline instead
 * of presenting this fixed investigation skeleton as authored content.
 */
export function compileTtrpgCampaignDraftV1(input: {
  worldSourceBundle: ProductWorldSourceBundleV1
  rulePack: RulePackV1
  fixtureOnly: true
  campaignKey?: string
  title?: string
  confirmDefaultMappings?: boolean
}): TtrpgCampaignContentV1 {
  if (import.meta.env.MODE !== 'test' || input.fixtureOnly !== true) {
    fail('固定战役编译器仅允许隔离测试 fixture')
  }
  const rulePack = parseRulePackV1(input.rulePack)
  if (input.worldSourceBundle.source.worldContentHash !== input.worldSourceBundle.canonSnapshot.snapshotHash
    && !isSha256Hash(input.worldSourceBundle.source.worldContentHash)) fail('ProductWorldSource 来源 hash 无效')
  if (!isSha256Hash(input.worldSourceBundle.bundleHash)) fail('ProductWorldSource bundleHash 无效')
  const entities = Object.values(input.worldSourceBundle.initialState.entities)
  const characters = entities.filter(entity => entity.kind === 'character' || entity.kind === 'npc' || entity.kind === 'player')
  if (!characters.length) fail('世界发布至少需要一个角色，才能编译正式 TTRPG 战役')
  const locations = entities.filter(entity => entity.kind === 'location')
  const looksLikeNpc = (entity: typeof characters[number]) => {
    const hint = [entity.attributes.role, entity.attributes.roleWeight, entity.attributes.identity]
      .filter((value): value is string => typeof value === 'string').join(' ').toLowerCase()
    return /(^|\W)(npc|supporting|secondary)(\W|$)|配角|路人|向导|守卫/.test(hint)
  }
  let playerCharacters = characters.filter(entity => !looksLikeNpc(entity)).slice(0, 4)
  if (!playerCharacters.length) playerCharacters = characters.slice(0, 1)
  let npcCharacters = characters.filter(entity => !playerCharacters.includes(entity)).slice(0, 4)
  if (!npcCharacters.length && playerCharacters.length > 1) {
    npcCharacters = [playerCharacters[playerCharacters.length - 1]]
    playerCharacters = playerCharacters.slice(0, -1)
  }
  const templates = [
    ...playerCharacters.map(entity => defaultCharacter(entity, rulePack, input.confirmDefaultMappings === true, 'player')),
    ...npcCharacters.map(entity => defaultCharacter(entity, rulePack, input.confirmDefaultMappings === true, 'npc')),
  ]
  const locationKey = locations[0]?.entityKey ?? null
  const participantKeys = templates.map(template => template.characterKey)
  const title = input.title?.trim() || `${input.worldSourceBundle.source.worldName}：失落的证据`
  const campaignKey = input.campaignKey?.trim() || `campaign.${safeSlug(input.worldSourceBundle.source.worldCode)}.lost-evidence`
  const sourceRefs = [input.worldSourceBundle.canonSnapshot.sources[0]?.sourceKey].filter((value): value is string => !!value)
  const sceneSpecs: TtrpgCampaignContentV1['scenes'] = [
    { sceneKey: 'scene.opening', title: '异常出现', description: '一个本应安全的地点留下互相矛盾的痕迹。', locationKey, participantKeys, clueKeys: ['clue.timeline', 'clue.motive'], actionKeys: ['investigate', 'influence', 'overcome', 'guard'], nextSceneKeys: ['scene.crosscheck'], failureForward: '即使检定失败，玩家仍得到模糊线索，但危险时钟推进。', gmSecret: '两条线索分别指向时间与动机，必须交叉验证。', sourceRefs, tabletopMapKey: 'map.scene.opening' },
    { sceneKey: 'scene.crosscheck', title: '交叉验证', description: '玩家可以核对记录、询问目击者或冒险重建现场。', locationKey, participantKeys, clueKeys: ['clue.timeline', 'clue.motive'], actionKeys: ['investigate', 'influence', 'assist', 'guard'], nextSceneKeys: ['scene.respite', 'scene.confrontation'], failureForward: '失败会使对手先一步准备，但不会删除已经发现的事实。', gmSecret: '只有把两个结论放在一起，才能安全进入最终对质。', sourceRefs, tabletopMapKey: 'map.scene.crosscheck' },
    { sceneKey: 'scene.respite', title: '幕间整备', description: '队伍在进入最终对质前整理证据、照顾伤势并确认各自的承诺。', locationKey, participantKeys, clueKeys: [], actionKeys: ['recover', 'assist'], nextSceneKeys: ['scene.confrontation'], failureForward: '即使资源没有完全恢复，队伍仍可带着代价进入终局。', gmSecret: '询问每名角色愿意为公开或保护真相承担什么代价。', sourceRefs, tabletopMapKey: 'map.scene.respite' },
    { sceneKey: 'scene.confrontation', title: '最终对质', description: '玩家带着证据面对利益冲突，选择公开、保护或交换。', locationKey, participantKeys, clueKeys: [], actionKeys: ['influence', 'overcome', 'strike', 'assist', 'guard'], nextSceneKeys: [], failureForward: '失败将改变代价和结局，而不是让战役停滞。', gmSecret: '优先让已公开的证据和玩家承诺决定结局。', sourceRefs, tabletopMapKey: 'map.scene.confrontation' },
  ]
  const tabletop: NonNullable<TtrpgCampaignContentV1['tabletop']> = {
    maps: sceneSpecs.map((scene, sceneIndex) => ({
      mapKey: scene.tabletopMapKey!, title: `${scene.title} · 区域图`, width: 20, height: 12,
      backgroundAssetKey: null, fallbackDescription: `${scene.description} 地图不可用时，以区域列表和距离文字继续主持。`,
      grid: { kind: 'square', cellSize: 1, distancePerCell: 2, unit: '米' },
      layers: [
        { layerKey: `layer.${scene.sceneKey}.terrain`, title: '地形', kind: 'terrain', zIndex: 0, opacity: 1, gmOnly: false },
        { layerKey: `layer.${scene.sceneKey}.clues`, title: 'GM 线索标记', kind: 'annotation', zIndex: 20, opacity: 0.9, gmOnly: true },
      ],
      areas: [
        { areaKey: `area.${scene.sceneKey}.entry`, title: '入口区', x: 4, y: 58, width: 28, height: 32, gmOnly: false },
        { areaKey: `area.${scene.sceneKey}.focus`, title: scene.clueKeys.length ? '调查焦点' : '冲突焦点', x: 38, y: 18, width: 38, height: 54, gmOnly: false },
        { areaKey: `area.${scene.sceneKey}.secret`, title: 'GM 隐藏区', x: 80, y: 8, width: 16, height: 34, gmOnly: true },
      ],
      tokens: scene.participantKeys.map((entityKey, tokenIndex) => ({
        tokenKey: `token.${scene.sceneKey}.${tokenIndex + 1}`,
        entityKey, x: 12 + tokenIndex * 10, y: 74, size: 7,
        controllerKey: templates.find(template => template.characterKey === entityKey)?.role === 'player' ? entityKey : null,
        hidden: templates.find(template => template.characterKey === entityKey)?.role === 'npc' && sceneIndex === 0,
      })),
      fog: [
        { fogKey: `fog.${scene.sceneKey}.focus`, title: '焦点区迷雾', x: 36, y: 15, width: 42, height: 60 },
        { fogKey: `fog.${scene.sceneKey}.secret`, title: '隐藏区迷雾', x: 78, y: 5, width: 20, height: 40 },
      ],
    })),
  }
  return parseTtrpgCampaignContentV1({
    schema: 'storyforge.ttrpg-campaign', version: 1, campaignKey, title,
    pitch: `一场发生在${input.worldSourceBundle.source.worldName}的调查冒险。玩家必须在局势失控前找出相互印证的证据，并决定公开真相还是保护相关人物。`,
    playerCount: { minimum: 1, maximum: Math.max(1, playerCharacters.length) },
    estimatedMinutes: 180, tags: ['fixture-only', 'investigation', 'adventure', 'fail-forward'], difficulty: 'introductory',
    contentWarnings: ['危险场景', '人物冲突'],
    sessionZero: {
      premise: '共同确认调查、冒险和人物冲突的可接受尺度；任何人都可随时暂停或淡出。',
      consentChecklist: ['确认内容警告', '选择角色', '确认公开与私密信息边界', '确认暂停信号'],
      lines: [], veils: ['过度血腥细节'], pauseSignal: '暂停', openDoor: true,
    },
    openingSceneKey: 'scene.opening', characterTemplates: templates, scenes: sceneSpecs,
    clues: [
      { clueKey: 'clue.timeline', title: '矛盾的时间线', description: '记录与现场痕迹证明关键事件发生得更早。', conclusionKey: 'conclusion.timeline', required: true, discoveryPaths: [
        { pathKey: 'path.timeline.records', sceneKey: 'scene.opening', actionKey: 'investigate', failForward: '得到残缺时间戳并推进危险。' },
        { pathKey: 'path.timeline.witness', sceneKey: 'scene.crosscheck', actionKey: 'influence', failForward: '目击者只透露间接线索，但指向同一结论。' },
      ], visibility: 'discoverable', sourceRefs },
      { clueKey: 'clue.motive', title: '被隐藏的动机', description: '受益关系揭示有人主动掩盖事实。', conclusionKey: 'conclusion.motive', required: true, discoveryPaths: [
        { pathKey: 'path.motive.scene', sceneKey: 'scene.opening', actionKey: 'investigate', failForward: '发现被移动的物品，无法确认操作者。' },
        { pathKey: 'path.motive.pressure', sceneKey: 'scene.crosscheck', actionKey: 'influence', failForward: '对方拒绝承认，却暴露了只有相关者才知道的信息。' },
      ], visibility: 'discoverable', sourceRefs },
    ],
    quests: [{ questKey: 'quest.truth', title: '拼合真相', objective: '取得相互独立的时间线和动机证据，并决定如何使用。', requiredConclusionKeys: ['conclusion.timeline', 'conclusion.motive'], failureForward: '线索不完整时仍进入对质，但对方拥有更大谈判优势。' }],
    endings: [
      { endingKey: 'ending.reveal', title: '公开真相', requirements: ['公开两个关键结论'], epilogue: '真相改变了局势，也让玩家承担公开它的代价。' },
      { endingKey: 'ending.protect', title: '有限保护', requirements: ['保留或交换至少一条关键证据'], epilogue: '眼前的人得到保护，但未公开的事实成为下一阶段的压力。' },
    ],
    handouts: [{ handoutKey: 'handout.case-notes', title: '调查记录', body: '按发现顺序记录线索、来源和公开范围。', revealClueKey: null, assetKey: null, fallbackText: '调查记录：时间线证据 / 动机证据 / 尚未公开的信息。' }],
    advancementMilestones: [{ milestoneKey: 'milestone.truth', title: '完成真相拼图', award: rulePack.advancement.awardPerMilestone }],
    tabletop,
    sourceWorld: { contentHash: input.worldSourceBundle.source.worldContentHash, bundleHash: input.worldSourceBundle.bundleHash },
  }, rulePack)
}
