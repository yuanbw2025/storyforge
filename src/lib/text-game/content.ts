import { db } from '../db/schema'
import {
  applyNarrativeEffects,
  evaluateNarrativeCondition,
  parseNarrativeCondition,
  parseNarrativeEffects,
  validateNarrativeModule,
} from '../narrative/blueprint'
import { transactionTablesForReferences } from '../registry/lifecycle'
import type {
  FrozenGameNarrativeNode,
  FrozenNarrativeBeat,
  FrozenNarrativeChoice,
  GameDefinition,
  NarrativeBeat,
  NarrativeBeatKind,
  NarrativeChoice,
  NarrativeChoiceEvaluation,
  NarrativeContentGraphReport,
  GameProductType,
  WorldGameSourceSelectionV1,
  WorkspaceScope,
} from '../types'
import { NARRATIVE_BEAT_KINDS } from '../types'
import {
  assertRecordInScope,
  resolveScope,
  scopeTransactionTables,
  stampNewRecord,
} from '../world-engine/scope'
import { cascadeRegisteredReferences } from '../world-engine/lifecycle'

const STABLE_KEY = /^[a-zA-Z0-9._:-]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const WORLD_GAME_SOURCE_ID_FIELDS = [
  'characterExportIds',
  'characterRelationExportIds',
  'importantLocationExportIds',
  'artifactExportIds',
  'codexEntryExportIds',
  'storyArcExportIds',
  'avgMediaAssetExportIds',
] as const satisfies ReadonlyArray<keyof WorldGameSourceSelectionV1>

function validateWorldGameSourceSelection(input: {
  value: unknown
  productType: GameProductType
  worldContentHash: string
  mappingVersion: number
}): asserts input is typeof input & { value: WorldGameSourceSelectionV1 } {
  if (!isRecord(input.value)
    || input.value.schema !== 'storyforge.world-game-source'
    || input.value.version !== 1
    || input.mappingVersion !== input.value.version
    || !['storygame', 'text-adventure', 'avg'].includes(input.productType)
    || input.value.productType !== input.productType
    || input.value.worldContentHash !== input.worldContentHash
    || !Number.isInteger(input.value.narrativeModuleExportId)
    || Number(input.value.narrativeModuleExportId) < 0) {
    throw new Error('[game-definition] 世界来源选择与游戏定义不一致')
  }
  for (const field of WORLD_GAME_SOURCE_ID_FIELDS) {
    const ids = input.value[field]
    if (!Array.isArray(ids) || ids.some(id => !Number.isInteger(id) || Number(id) < 0)
      || new Set(ids).size !== ids.length) {
      throw new Error(`[game-definition] 世界来源便携引用无效:${field}`)
    }
  }
}

export function parseGameDefinitionWorldSource(value: Pick<GameDefinition,
  'productType' | 'sourceWorldContentHash' | 'sourceSelectionJson' | 'sourceMappingVersion'
>): { worldContentHash: string; mappingVersion: number; selection: WorldGameSourceSelectionV1 } | null {
  const worldContentHash = value.sourceWorldContentHash?.trim() ?? ''
  const sourceSelectionJson = value.sourceSelectionJson ?? ''
  const mappingVersion = value.sourceMappingVersion ?? 0
  if (!worldContentHash && !sourceSelectionJson && !mappingVersion) return null
  if (!/^[a-f0-9]{64}$/.test(worldContentHash)) throw new Error('[game-definition] 世界来源 contentHash 无效')
  if (!Number.isInteger(mappingVersion) || mappingVersion < 1) throw new Error('[game-definition] 世界来源映射版本无效')
  let selection: unknown
  try { selection = JSON.parse(sourceSelectionJson) } catch { throw new Error('[game-definition] 世界来源选择不是合法 JSON') }
  const validated = { value: selection, productType: value.productType, worldContentHash, mappingVersion }
  validateWorldGameSourceSelection(validated)
  return { worldContentHash, mappingVersion, selection: validated.value }
}

function parseObjectJson(value: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error(`[storygame] ${label} 不是合法 JSON`) }
  if (!isRecord(parsed)) throw new Error(`[storygame] ${label} 必须是 JSON 对象`)
  return structuredClone(parsed)
}

function parseStringArray(value: string, label: string): string[] {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error(`[storygame] ${label} 不是合法 JSON`) }
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`[storygame] ${label} 必须是非空字符串数组`)
  }
  const normalized = parsed.map(item => item.trim())
  if (new Set(normalized).size !== normalized.length) throw new Error(`[storygame] ${label} 不能包含重复值`)
  return normalized
}

function normalizeStableKey(value: string, label: string): string {
  const key = value.trim()
  if (!key || key.length > 200 || !STABLE_KEY.test(key)) throw new Error(`[storygame] ${label} 无效`)
  return key
}

function parseSuccessors(value: string, nodeKey: string): string[] {
  return parseStringArray(value, `${nodeKey}.successorKeysJson`)
}

function nodeSnapshot(row: {
  key: string
  kind: FrozenGameNarrativeNode['kind']
  title: string
  summary: string
  conditionJson: string
  effectsJson: string
  successorKeysJson: string
}): FrozenGameNarrativeNode {
  parseNarrativeCondition(row.conditionJson)
  parseNarrativeEffects(row.effectsJson)
  return {
    key: row.key,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    conditionJson: row.conditionJson,
    effectsJson: row.effectsJson,
    successorKeys: parseSuccessors(row.successorKeysJson, row.key),
  }
}

function beatSnapshot(row: NarrativeBeat, speakerKey: string | null): FrozenNarrativeBeat {
  return {
    beatKey: row.beatKey,
    nodeKey: row.nodeKey,
    kind: row.kind,
    speakerKey,
    text: row.text,
    order: row.order,
  }
}

function choiceSnapshot(row: NarrativeChoice): FrozenNarrativeChoice {
  parseNarrativeCondition(row.displayConditionJson)
  parseNarrativeCondition(row.availableConditionJson)
  parseNarrativeEffects(row.effectsJson)
  return {
    choiceKey: row.choiceKey,
    sourceNodeKey: row.sourceNodeKey,
    text: row.text,
    description: row.description,
    unavailableReason: row.unavailableReason,
    targetNodeKey: row.targetNodeKey,
    displayConditionJson: row.displayConditionJson,
    availableConditionJson: row.availableConditionJson,
    effectsJson: row.effectsJson,
    tags: parseStringArray(row.tagsJson, `${row.choiceKey}.tagsJson`),
    order: row.order,
  }
}

function stronglyConnectedComponents(edges: ReadonlyMap<string, readonly string[]>): string[][] {
  let index = 0
  const indexes = new Map<string, number>()
  const lowLinks = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const components: string[][] = []

  const visit = (key: string) => {
    indexes.set(key, index)
    lowLinks.set(key, index)
    index += 1
    stack.push(key)
    onStack.add(key)
    for (const target of edges.get(key) ?? []) {
      if (!edges.has(target)) continue
      if (!indexes.has(target)) {
        visit(target)
        lowLinks.set(key, Math.min(lowLinks.get(key)!, lowLinks.get(target)!))
      } else if (onStack.has(target)) {
        lowLinks.set(key, Math.min(lowLinks.get(key)!, indexes.get(target)!))
      }
    }
    if (lowLinks.get(key) !== indexes.get(key)) return
    const component: string[] = []
    while (stack.length) {
      const member = stack.pop()!
      onStack.delete(member)
      component.push(member)
      if (member === key) break
    }
    components.push(component.sort())
  }

  for (const key of edges.keys()) if (!indexes.has(key)) visit(key)
  return components
}

export function validateNarrativeContentGraph(input: {
  entryNodeKey: string | null
  nodes: FrozenGameNarrativeNode[]
  beats: FrozenNarrativeBeat[]
  choices: FrozenNarrativeChoice[]
  knownSpeakerKeys?: ReadonlySet<string>
}): NarrativeContentGraphReport {
  const errors: string[] = []
  const nodeKeys = new Set(input.nodes.map(node => node.key))
  const beatKeys = new Set<string>()
  const choiceKeys = new Set<string>()
  if (nodeKeys.size !== input.nodes.length) errors.push('[storygame] 叙事节点 key 重复')
  const entryKey = input.entryNodeKey?.trim() || null
  if (!entryKey) errors.push('[storygame] 缺少入口节点')
  else if (!nodeKeys.has(entryKey)) errors.push('[storygame] 入口节点不存在')

  const danglingSuccessors: NarrativeContentGraphReport['danglingSuccessors'] = []
  const invalidChoiceTargets: NarrativeContentGraphReport['invalidChoiceTargets'] = []
  const orphanBeatKeys: string[] = []
  const orphanChoiceKeys: string[] = []
  // STORYGAME-1A 的新写入权威只有 NarrativeChoice。Node.successorKeys 仅做
  // legacy 断链诊断，绝不能在新 GameRelease 中悄悄变成另一套可执行边。
  const edges = new Map(input.nodes.map(node => [node.key, [] as string[]]))
  for (const node of input.nodes) {
    try {
      parseNarrativeCondition(node.conditionJson)
      parseNarrativeEffects(node.effectsJson)
    } catch (cause) { errors.push(cause instanceof Error ? cause.message : String(cause)) }
    for (const target of node.successorKeys) {
      if (!nodeKeys.has(target)) danglingSuccessors.push({ nodeKey: node.key, successorKey: target })
    }
  }
  for (const beat of input.beats) {
    if (beatKeys.has(beat.beatKey)) errors.push(`[storygame] Beat key 重复:${beat.beatKey}`)
    beatKeys.add(beat.beatKey)
    if (!nodeKeys.has(beat.nodeKey)) orphanBeatKeys.push(beat.beatKey)
    if (beat.kind === 'dialogue' && !beat.speakerKey) errors.push(`[storygame] 对话 Beat 缺少 speaker:${beat.beatKey}`)
    if (beat.speakerKey && input.knownSpeakerKeys && !input.knownSpeakerKeys.has(beat.speakerKey)) {
      errors.push(`[storygame] Beat speaker 不在冻结发布中:${beat.beatKey}`)
    }
    if (!beat.text.trim()) errors.push(`[storygame] Beat 文本为空:${beat.beatKey}`)
  }
  for (const choice of input.choices) {
    if (choiceKeys.has(choice.choiceKey)) errors.push(`[storygame] Choice key 重复:${choice.choiceKey}`)
    choiceKeys.add(choice.choiceKey)
    if (!nodeKeys.has(choice.sourceNodeKey)) orphanChoiceKeys.push(choice.choiceKey)
    if (!nodeKeys.has(choice.targetNodeKey)) {
      invalidChoiceTargets.push({ choiceKey: choice.choiceKey, targetNodeKey: choice.targetNodeKey })
    } else if (nodeKeys.has(choice.sourceNodeKey)) {
      edges.get(choice.sourceNodeKey)!.push(choice.targetNodeKey)
    }
    if (!choice.text.trim()) errors.push(`[storygame] Choice 文本为空:${choice.choiceKey}`)
    try {
      parseNarrativeCondition(choice.displayConditionJson)
      parseNarrativeCondition(choice.availableConditionJson)
      parseNarrativeEffects(choice.effectsJson)
    } catch (cause) { errors.push(cause instanceof Error ? cause.message : String(cause)) }
  }
  for (const [key, targets] of edges) edges.set(key, [...new Set(targets)])

  const reachable = new Set<string>()
  const queue = entryKey && nodeKeys.has(entryKey) ? [entryKey] : []
  while (queue.length) {
    const key = queue.shift()!
    if (reachable.has(key)) continue
    reachable.add(key)
    queue.push(...(edges.get(key) ?? []))
  }
  const endingNodeKeys = input.nodes.filter(node => node.kind === 'ending').map(node => node.key).sort()
  const reachableEndingKeys = endingNodeKeys.filter(key => reachable.has(key))
  if (!endingNodeKeys.length) errors.push('[storygame] 缺少结局节点')
  else if (!reachableEndingKeys.length) errors.push('[storygame] 没有从入口可达的结局')
  const deadEndNodeKeys = input.nodes
    .filter(node => node.kind !== 'ending' && (edges.get(node.key)?.length ?? 0) === 0)
    .map(node => node.key)
    .sort()

  const components = stronglyConnectedComponents(edges)
  const cycleRisks = components.filter(component => (
    component.length > 1 || (edges.get(component[0]) ?? []).includes(component[0])
  ))
  const endingSet = new Set(endingNodeKeys)
  const blockingCycleKeys = cycleRisks.filter(component => {
    const members = new Set(component)
    return !component.some(key => endingSet.has(key))
      && !component.some(key => (edges.get(key) ?? []).some(target => !members.has(target)))
  })
  if (deadEndNodeKeys.length) errors.push(`[storygame] 非结局死路:${deadEndNodeKeys.join(',')}`)
  if (blockingCycleKeys.length) errors.push(`[storygame] 无退出循环:${blockingCycleKeys.map(keys => keys.join('->')).join(';')}`)

  const unreachableNodeKeys = input.nodes.map(node => node.key).filter(key => !reachable.has(key)).sort()
  return {
    valid: errors.length === 0
      && danglingSuccessors.length === 0
      && invalidChoiceTargets.length === 0
      && orphanBeatKeys.length === 0
      && orphanChoiceKeys.length === 0
      && unreachableNodeKeys.length === 0,
    entryKey,
    reachableNodeKeys: [...reachable],
    unreachableNodeKeys,
    endingNodeKeys,
    reachableEndingKeys,
    deadEndNodeKeys,
    danglingSuccessors,
    invalidChoiceTargets,
    orphanBeatKeys: orphanBeatKeys.sort(),
    orphanChoiceKeys: orphanChoiceKeys.sort(),
    cycleRisks,
    blockingCycleKeys,
    errors,
  }
}

export async function validateStoryGameContent(
  scope: WorkspaceScope,
  moduleId: number,
): Promise<NarrativeContentGraphReport> {
  const resolved = await resolveScope({ scope })
  const module = await db.narrativeModules.get(moduleId)
  if (!module || !await assertRecordInScope(resolved, 'narrativeModules', module)) {
    throw new Error('[storygame] 叙事模块不属于当前 scope')
  }
  const legacy = await validateNarrativeModule(resolved, moduleId)
  const [nodes, beats, choices] = await Promise.all([
    db.narrativeNodes.where('moduleId').equals(moduleId).sortBy('order'),
    db.narrativeBeats.where('moduleId').equals(moduleId).sortBy('order'),
    db.narrativeChoices.where('moduleId').equals(moduleId).sortBy('order'),
  ])
  const speakerIds = [...new Set(beats.flatMap(beat => beat.speakerCharacterId == null ? [] : [beat.speakerCharacterId]))]
  const knownSpeakerKeys = new Set<string>()
  for (const speakerId of speakerIds) {
    const character = await db.characters.get(speakerId)
    if (character && await assertRecordInScope(resolved, 'characters', character, { owner: 'world' })) {
      knownSpeakerKeys.add(`character:${speakerId}`)
    }
  }
  const report = validateNarrativeContentGraph({
    entryNodeKey: legacy.entryKey,
    nodes: nodes.map(nodeSnapshot),
    beats: beats.map(beat => beatSnapshot(beat, beat.speakerCharacterId == null ? null : `character:${beat.speakerCharacterId}`)),
    choices: choices.map(choiceSnapshot),
    knownSpeakerKeys,
  })
  report.errors.unshift(...legacy.errors.filter(error => !report.errors.includes(error)))
  report.valid = report.errors.length === 0
    && report.danglingSuccessors.length === 0
    && report.invalidChoiceTargets.length === 0
    && report.orphanBeatKeys.length === 0
    && report.orphanChoiceKeys.length === 0
    && report.unreachableNodeKeys.length === 0
  return report
}

export async function createGameDefinition(input: {
  scope: WorkspaceScope
  gameKey: string
  title: string
  description?: string
  narrativeModuleId: number
  productType?: GameProductType
  enabledCapabilities?: string[]
  initialVariables?: Record<string, unknown>
  sourceWorldContentHash?: string
  sourceSelectionJson?: string
  sourceMappingVersion?: number
}): Promise<GameDefinition> {
  const gameKey = normalizeStableKey(input.gameKey, 'gameKey')
  const title = input.title.trim()
  if (!title || title.length > 300) throw new Error('[storygame] 游戏标题无效')
  const productType = input.productType ?? 'storygame'
  const requiredCapabilities: Partial<Record<GameProductType, string[]>> = {
    storygame: ['narrative'],
    'character-interaction': ['narrative', 'interaction'],
    'text-adventure': ['narrative', 'interaction', 'adventure'],
    avg: ['narrative', 'presentation'],
    'narrative-simulation': ['narrative', 'simulation'],
    'text-open-world': ['narrative', 'interaction', 'adventure', 'simulation', 'open-world'],
  }
  const required = requiredCapabilities[productType]
  if (!required) throw new Error(`[game-definition] 尚未实现产品类型:${productType}`)
  const enabledCapabilities = input.enabledCapabilities ?? required
  if (enabledCapabilities.join(',') !== required.join(',')) {
    throw new Error(`[game-definition] ${productType} 能力组合必须为 ${required.join(' + ')}`)
  }
  const initialVariables = structuredClone(input.initialVariables ?? {})
  if (!isRecord(initialVariables)) throw new Error('[storygame] 初始变量必须是对象')
  const sourceWorldContentHash = input.sourceWorldContentHash?.trim() ?? ''
  const sourceSelectionJson = input.sourceSelectionJson ?? ''
  const sourceMappingVersion = input.sourceMappingVersion ?? 0
  parseGameDefinitionWorldSource({
    productType,
    sourceWorldContentHash,
    sourceSelectionJson,
    sourceMappingVersion,
  })
  return db.transaction('rw', scopeTransactionTables(db.gameDefinitions, db.narrativeModules), async () => {
    const scope = await resolveScope({ scope: input.scope })
    const module = await db.narrativeModules.get(input.narrativeModuleId)
    if (!module || !await assertRecordInScope(scope, 'narrativeModules', module)) {
      throw new Error('[storygame] 叙事模块不属于当前 scope')
    }
    if (await db.gameDefinitions.where('[workId+gameKey]').equals([scope.workId, gameKey]).first()) {
      throw new Error(`[storygame] gameKey 重复:${gameKey}`)
    }
    const now = Date.now()
    const row = stampNewRecord(scope, 'gameDefinitions', {
      projectId: scope.projectId,
      worldId: scope.worldId,
      workId: scope.workId,
      gameKey,
      productType,
      title,
      description: input.description?.trim() ?? '',
      status: 'draft',
      narrativeModuleId: input.narrativeModuleId,
      enabledCapabilitiesJson: JSON.stringify(enabledCapabilities),
      initialVariablesJson: JSON.stringify(initialVariables),
      rulesetVersion: 1,
      sourceWorldContentHash,
      sourceSelectionJson,
      sourceMappingVersion,
      createdAt: now,
      updatedAt: now,
    } satisfies GameDefinition, { owner: 'work' })
    const id = await db.gameDefinitions.add(row) as number
    return { ...row, id }
  })
}

export async function addNarrativeBeat(input: {
  scope: WorkspaceScope
  moduleId: number
  nodeKey: string
  beatKey: string
  kind: NarrativeBeatKind
  speakerCharacterId?: number | null
  text: string
  order?: number
}): Promise<NarrativeBeat> {
  const beatKey = normalizeStableKey(input.beatKey, 'beatKey')
  const nodeKey = normalizeStableKey(input.nodeKey, 'nodeKey')
  const text = input.text.trim()
  if (!NARRATIVE_BEAT_KINDS.includes(input.kind)) throw new Error('[storygame] Beat 类型无效')
  if (!text || text.length > 40_000) throw new Error('[storygame] Beat 文本无效')
  if (input.kind === 'dialogue' && input.speakerCharacterId == null) throw new Error('[storygame] 对话 Beat 必须指定 speaker')
  if (input.kind !== 'dialogue' && input.speakerCharacterId != null) throw new Error('[storygame] 只有对话 Beat 可以指定 speaker')
  return db.transaction('rw', scopeTransactionTables(
    db.narrativeModules, db.narrativeNodes, db.narrativeBeats, db.characters,
  ), async () => {
    const scope = await resolveScope({ scope: input.scope })
    const module = await db.narrativeModules.get(input.moduleId)
    if (!module || !await assertRecordInScope(scope, 'narrativeModules', module)) throw new Error('[storygame] 模块不属于当前 scope')
    if (!await db.narrativeNodes.where('moduleId').equals(input.moduleId).filter(node => node.key === nodeKey).first()) {
      throw new Error(`[storygame] Beat 节点不存在:${nodeKey}`)
    }
    if (input.speakerCharacterId != null) {
      const character = await db.characters.get(input.speakerCharacterId)
      if (!character || !await assertRecordInScope(scope, 'characters', character, { owner: 'world' })) {
        throw new Error('[storygame] Beat speaker 不属于当前 World')
      }
    }
    const now = Date.now()
    const row: NarrativeBeat = {
      projectId: scope.projectId,
      moduleId: input.moduleId,
      nodeKey,
      beatKey,
      kind: input.kind,
      speakerCharacterId: input.speakerCharacterId ?? null,
      text,
      order: input.order ?? 0,
      createdAt: now,
      updatedAt: now,
    }
    const id = await db.narrativeBeats.add(row) as number
    return { ...row, id }
  })
}

export async function addNarrativeChoice(input: {
  scope: WorkspaceScope
  moduleId: number
  sourceNodeKey: string
  choiceKey: string
  text: string
  description?: string
  unavailableReason?: string
  targetNodeKey: string
  displayConditionJson?: string
  availableConditionJson?: string
  effectsJson?: string
  tags?: string[]
  order?: number
}): Promise<NarrativeChoice> {
  const choiceKey = normalizeStableKey(input.choiceKey, 'choiceKey')
  const sourceNodeKey = normalizeStableKey(input.sourceNodeKey, 'sourceNodeKey')
  const targetNodeKey = normalizeStableKey(input.targetNodeKey, 'targetNodeKey')
  const text = input.text.trim()
  if (!text || text.length > 4_000) throw new Error('[storygame] Choice 文本无效')
  const displayConditionJson = input.displayConditionJson ?? '{}'
  const availableConditionJson = input.availableConditionJson ?? '{}'
  const effectsJson = input.effectsJson ?? '[]'
  parseNarrativeCondition(displayConditionJson)
  parseNarrativeCondition(availableConditionJson)
  parseNarrativeEffects(effectsJson)
  const tags = [...new Set((input.tags ?? []).map(tag => tag.trim()).filter(Boolean))]
  if (tags.some(tag => tag.length > 100)) throw new Error('[storygame] Choice 标签过长')
  return db.transaction('rw', scopeTransactionTables(
    db.narrativeModules, db.narrativeNodes, db.narrativeChoices,
  ), async () => {
    const scope = await resolveScope({ scope: input.scope })
    const module = await db.narrativeModules.get(input.moduleId)
    if (!module || !await assertRecordInScope(scope, 'narrativeModules', module)) throw new Error('[storygame] 模块不属于当前 scope')
    const nodes = await db.narrativeNodes.where('moduleId').equals(input.moduleId).toArray()
    if (!nodes.some(node => node.key === sourceNodeKey)) throw new Error(`[storygame] Choice 来源节点不存在:${sourceNodeKey}`)
    if (!nodes.some(node => node.key === targetNodeKey)) throw new Error(`[storygame] Choice 目标节点不存在:${targetNodeKey}`)
    const now = Date.now()
    const row: NarrativeChoice = {
      projectId: scope.projectId,
      moduleId: input.moduleId,
      sourceNodeKey,
      choiceKey,
      text,
      description: input.description?.trim() ?? '',
      unavailableReason: input.unavailableReason?.trim() ?? '',
      targetNodeKey,
      displayConditionJson,
      availableConditionJson,
      effectsJson,
      tagsJson: JSON.stringify(tags),
      order: input.order ?? 0,
      createdAt: now,
      updatedAt: now,
    }
    const id = await db.narrativeChoices.add(row) as number
    return { ...row, id }
  })
}

export function evaluateNarrativeChoices(
  state: Record<string, unknown>,
  currentNodeKey: string,
  choices: readonly FrozenNarrativeChoice[],
): NarrativeChoiceEvaluation[] {
  const predicateState = {
    ...state,
    __visitedNodeKeys: Array.isArray(state.__visitedNodeKeys) ? state.__visitedNodeKeys : [],
    __selectedChoiceKeys: Array.isArray(state.__selectedChoiceKeys) ? state.__selectedChoiceKeys : [],
  }
  return choices
    .filter(choice => choice.sourceNodeKey === currentNodeKey)
    .sort((left, right) => left.order - right.order || left.choiceKey.localeCompare(right.choiceKey))
    .map(choice => {
      const visible = evaluateNarrativeCondition(parseNarrativeCondition(choice.displayConditionJson), predicateState)
      const available = visible
        && evaluateNarrativeCondition(parseNarrativeCondition(choice.availableConditionJson), predicateState)
      return {
        choiceKey: choice.choiceKey,
        visible,
        available,
        unavailableReason: visible && !available ? choice.unavailableReason : '',
        targetNodeKey: choice.targetNodeKey,
      }
    })
}

export function applyNarrativeChoiceEffects(
  choice: FrozenNarrativeChoice,
  variables: Record<string, unknown>,
): Record<string, unknown> {
  return applyNarrativeEffects(parseNarrativeEffects(choice.effectsJson), variables)
}

export function parseGameInitialVariables(definition: GameDefinition): Record<string, unknown> {
  return parseObjectJson(definition.initialVariablesJson, 'initialVariablesJson')
}

export function parseGameCapabilities(definition: GameDefinition): string[] {
  return parseStringArray(definition.enabledCapabilitiesJson, 'enabledCapabilitiesJson')
}

export async function deleteGameDefinition(input: {
  scope: WorkspaceScope
  gameDefinitionId: number
}): Promise<void> {
  const scope = await resolveScope({ scope: input.scope })
  const definition = await db.gameDefinitions.get(input.gameDefinitionId)
  if (!definition || !await assertRecordInScope(scope, 'gameDefinitions', definition, { owner: 'work' })) {
    throw new Error('[storygame] 游戏定义不属于当前 Work')
  }
  await db.transaction('rw', scopeTransactionTables(
    ...transactionTablesForReferences('gameDefinitions'),
  ), async () => {
    const currentScope = await resolveScope({ scope })
    const current = await db.gameDefinitions.get(input.gameDefinitionId)
    if (!current || !await assertRecordInScope(currentScope, 'gameDefinitions', current, { owner: 'work' })) {
      throw new Error('[storygame] 游戏定义在删除过程中发生变化')
    }
    await deleteGameDefinitionRecordInTransaction(currentScope, input.gameDefinitionId)
  })
}

/** @internal Shared transaction body for product-specific draft deletion. */
export async function deleteGameDefinitionRecordInTransaction(
  scope: WorkspaceScope,
  gameDefinitionId: number,
): Promise<GameDefinition> {
  const current = await db.gameDefinitions.get(gameDefinitionId)
  if (!current || !await assertRecordInScope(scope, 'gameDefinitions', current, { owner: 'work' })) {
    throw new Error('[storygame] 游戏定义在删除过程中发生变化')
  }
  // All product-specific children are governed by PROJECT_TABLES. Keeping the
  // deletion body registry-derived prevents every new product table from
  // becoming another hand-written lifecycle branch.
  await cascadeRegisteredReferences('gameDefinitions', gameDefinitionId)
  await db.gameDefinitions.delete(gameDefinitionId)
  return current
}
