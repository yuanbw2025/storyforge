import { db } from '../db/schema'
import { addNarrativeNode, createNarrativeModule } from '../narrative/blueprint'
import { transactionTablesForReferences } from '../registry/lifecycle'
import {
  addNarrativeBeat,
  addNarrativeChoice,
  createGameDefinition,
  deleteGameDefinitionRecordInTransaction,
  validateStoryGameContent,
} from '../text-game/content'
import { publishGameDefinition } from '../text-game/releases'
import type {
  GameDefinition,
  GameRelease,
  NarrativeContentGraphReport,
  NarrativeModule,
  NarrativeNode,
  NarrativeSimulationContentV1,
  NarrativeSimulationModule,
  NarrativeSimulationValidationReport,
  WorkspaceScope,
  WorldRelease,
  WorldRevision,
} from '../types'
import { createWorldRevision, listWorldRevisions, publishWorldRevision } from '../world-engine/releases'
import { assertRecordInScope, resolveScope, scopeTransactionTables, stampNewRecord } from '../world-engine/scope'
import { parseNarrativeSimulationContent, validateNarrativeSimulationContent } from './runtime'

export interface NarrativeSimulationAuthoringSnapshot {
  definitions: GameDefinition[]
  narrativeModules: NarrativeModule[]
  narrativeNodes: NarrativeNode[]
  simulationModules: NarrativeSimulationModule[]
  releases: GameRelease[]
}

export interface NarrativeSimulationDraftReport {
  valid: boolean
  simulation: NarrativeSimulationValidationReport
  narrative: NarrativeContentGraphReport
  errors: string[]
  warnings: string[]
}

export interface NarrativeSimulationPublication {
  report: NarrativeSimulationDraftReport
  revision: WorldRevision
  worldRelease: WorldRelease
  gameRelease: GameRelease
}

async function definitionInScope(scope: WorkspaceScope, id: number): Promise<GameDefinition> {
  const definition = await db.gameDefinitions.get(id)
  if (!definition || definition.productType !== 'narrative-simulation'
    || !await assertRecordInScope(scope, 'gameDefinitions', definition, { owner: 'work' })) {
    throw new Error('[textsim] 游戏定义不属于当前 Work')
  }
  return definition
}

export async function loadNarrativeSimulationAuthoringSnapshot(
  inputScope: WorkspaceScope,
): Promise<NarrativeSimulationAuthoringSnapshot> {
  const scope = await resolveScope({ scope: inputScope })
  const definitions = (await db.gameDefinitions.where('workId').equals(scope.workId).toArray())
    .filter(row => row.projectId === scope.projectId && row.worldId === scope.worldId
      && row.productType === 'narrative-simulation')
    .sort((left, right) => right.updatedAt - left.updatedAt)
  const definitionIds = definitions.flatMap(row => row.id == null ? [] : [row.id])
  const narrativeModuleIds = definitions.map(row => row.narrativeModuleId)
  const [narrativeModules, narrativeNodes, simulationModules, releases] = await Promise.all([
    Promise.all(narrativeModuleIds.map(id => db.narrativeModules.get(id)))
      .then(rows => rows.filter((row): row is NarrativeModule => !!row)),
    narrativeModuleIds.length ? db.narrativeNodes.where('moduleId').anyOf(narrativeModuleIds).sortBy('order') : [],
    definitionIds.length ? db.narrativeSimulationModules.where('gameDefinitionId').anyOf(definitionIds).toArray() : [],
    definitionIds.length ? db.gameReleases.where('workId').equals(scope.workId)
      .filter(row => definitionIds.includes(row.gameDefinitionId ?? -1)).toArray() : [],
  ])
  return {
    definitions,
    narrativeModules,
    narrativeNodes,
    simulationModules,
    releases: releases.sort((left, right) => right.version - left.version),
  }
}

async function addEndingChoice(input: {
  scope: WorkspaceScope
  moduleId: number
  endingKey: string
  title: string
  order: number
}) {
  const conditionJson = JSON.stringify({ path: 'simulation.endingKey', eq: input.endingKey })
  await addNarrativeChoice({
    scope: input.scope,
    moduleId: input.moduleId,
    sourceNodeKey: 'entry',
    choiceKey: `ending.${input.endingKey}`,
    text: `进入结局：${input.title}`,
    description: '由冻结模拟规则达成的结局。',
    unavailableReason: '尚未满足该结局条件。',
    targetNodeKey: `ending.${input.endingKey}`,
    displayConditionJson: conditionJson,
    availableConditionJson: conditionJson,
    tags: [`simulation-ending:${input.endingKey}`],
    order: input.order,
  })
}

export async function createNarrativeSimulationGame(input: {
  scope: WorkspaceScope
  title?: string
  gameKey?: string
  content?: NarrativeSimulationContentV1 | string
}): Promise<GameDefinition> {
  const title = input.title?.trim() || '未命名叙事模拟'
  const gameKey = input.gameKey?.trim() || `textsim-${Date.now().toString(36)}`
  const content = parseNarrativeSimulationContent(input.content ?? createNarrativeSimulationAcceptanceContent())
  return db.transaction('rw', scopeTransactionTables(
    db.narrativeModules,
    db.narrativeNodes,
    db.narrativeBeats,
    db.narrativeChoices,
    db.gameDefinitions,
    db.narrativeSimulationModules,
    db.characters,
    db.outlineNodes,
  ), async () => {
    const module = await createNarrativeModule({ scope: input.scope, owner: 'work', kind: 'main', title })
    const endingKeys = content.endings.map(ending => `ending.${ending.key}`)
    await addNarrativeNode({
      scope: input.scope,
      moduleId: module.id!,
      key: 'entry',
      kind: 'entry',
      title: '治理周期',
      summary: '在封闭系统内分配资源、处理问题并承担延迟后果。',
      successorKeys: endingKeys,
      order: 0,
    })
    await addNarrativeBeat({
      scope: input.scope,
      moduleId: module.id!,
      nodeKey: 'entry',
      beatKey: 'entry.briefing',
      kind: 'system',
      text: '每个回合选择有限行动；确定性规则先结算事实，再生成可见报告。',
      order: 0,
    })
    for (const [index, ending] of content.endings.entries()) {
      const nodeKey = `ending.${ending.key}`
      if (ending.narrativeNodeKey !== nodeKey) {
        throw new Error(`[textsim] 结局 ${ending.key} 必须绑定 Narrative 节点 ${nodeKey}`)
      }
      await addNarrativeNode({
        scope: input.scope,
        moduleId: module.id!,
        key: nodeKey,
        kind: 'ending',
        title: ending.title,
        summary: ending.description,
        order: index + 1,
      })
      await addNarrativeBeat({
        scope: input.scope,
        moduleId: module.id!,
        nodeKey,
        beatKey: `${nodeKey}.summary`,
        kind: 'narration',
        text: ending.description,
        order: 0,
      })
      await addEndingChoice({ scope: input.scope, moduleId: module.id!, endingKey: ending.key, title: ending.title, order: index })
    }
    const definition = await createGameDefinition({
      scope: input.scope,
      gameKey,
      title,
      description: '30 回合封闭系统叙事模拟；事实由确定性规则与事件流结算。',
      narrativeModuleId: module.id!,
      productType: 'narrative-simulation',
      initialVariables: {},
    })
    const scope = await resolveScope({ scope: input.scope })
    const now = Date.now()
    await db.narrativeSimulationModules.add(stampNewRecord(scope, 'narrativeSimulationModules', {
      projectId: scope.projectId,
      worldId: scope.worldId,
      workId: scope.workId,
      gameDefinitionId: definition.id!,
      contentJson: JSON.stringify(content),
      createdAt: now,
      updatedAt: now,
    } satisfies NarrativeSimulationModule, { owner: 'work' }))
    return definition
  })
}

export async function updateNarrativeSimulationDefinition(input: {
  scope: WorkspaceScope
  gameDefinitionId: number
  title: string
  description: string
}): Promise<GameDefinition> {
  const scope = await resolveScope({ scope: input.scope })
  const current = await definitionInScope(scope, input.gameDefinitionId)
  const title = input.title.trim()
  if (!title) throw new Error('[textsim] 标题不能为空')
  const updated = { ...current, title, description: input.description.trim(), updatedAt: Date.now() }
  await db.gameDefinitions.put(updated)
  return updated
}

export async function saveNarrativeSimulationContent(input: {
  scope: WorkspaceScope
  gameDefinitionId: number
  content: NarrativeSimulationContentV1 | string
}): Promise<NarrativeSimulationModule> {
  const scope = await resolveScope({ scope: input.scope })
  await definitionInScope(scope, input.gameDefinitionId)
  const content = parseNarrativeSimulationContent(input.content)
  const module = await db.narrativeSimulationModules.where('gameDefinitionId').equals(input.gameDefinitionId).first()
  if (!module || !await assertRecordInScope(scope, 'narrativeSimulationModules', module, { owner: 'work' })) {
    throw new Error('[textsim] 叙事模拟内容模块不存在')
  }
  const updatedAt = Date.now()
  const contentJson = JSON.stringify(content)
  await db.narrativeSimulationModules.update(module.id!, { contentJson, updatedAt })
  return { ...module, contentJson, updatedAt }
}

export async function validateNarrativeSimulationGame(
  inputScope: WorkspaceScope,
  gameDefinitionId: number,
): Promise<NarrativeSimulationDraftReport> {
  const scope = await resolveScope({ scope: inputScope })
  const definition = await definitionInScope(scope, gameDefinitionId)
  const [module, nodes, narrative] = await Promise.all([
    db.narrativeSimulationModules.where('gameDefinitionId').equals(definition.id!).first(),
    db.narrativeNodes.where('moduleId').equals(definition.narrativeModuleId).toArray(),
    validateStoryGameContent(scope, definition.narrativeModuleId),
  ])
  if (!module) throw new Error('[textsim] 叙事模拟内容模块不存在')
  const simulation = validateNarrativeSimulationContent({
    content: module.contentJson,
    narrativeNodeKeys: nodes.map(node => node.key),
  })
  const errors = [...narrative.errors, ...simulation.errors]
  return { valid: narrative.valid && simulation.valid, narrative, simulation, errors, warnings: simulation.warnings }
}

export async function publishNarrativeSimulationGame(input: {
  scope: WorkspaceScope
  gameDefinitionId: number
  label?: string
}): Promise<NarrativeSimulationPublication> {
  const scope = await resolveScope({ scope: input.scope })
  const definition = await definitionInScope(scope, input.gameDefinitionId)
  const report = await validateNarrativeSimulationGame(scope, definition.id!)
  if (!report.valid) throw new Error(`[textsim] 内容不可发布:${report.errors.join('；')}`)
  const latest = (await listWorldRevisions(scope))[0]
  const label = input.label?.trim() || `${definition.title} · 叙事模拟发布`
  const revision = await createWorldRevision({
    scope,
    label,
    parentRevisionId: latest?.id ?? null,
    selectedNarrativeModuleIds: [definition.narrativeModuleId],
  })
  const worldRelease = await publishWorldRevision(revision.id!, label)
  const gameRelease = await publishGameDefinition({
    scope,
    gameDefinitionId: definition.id!,
    worldReleaseId: worldRelease.id!,
    label,
  })
  return { report, revision, worldRelease, gameRelease }
}

export async function deleteNarrativeSimulationGameDraft(input: {
  scope: WorkspaceScope
  gameDefinitionId: number
}): Promise<void> {
  const scope = await resolveScope({ scope: input.scope })
  const definition = await definitionInScope(scope, input.gameDefinitionId)
  await db.transaction('rw', scopeTransactionTables(
    ...transactionTablesForReferences('gameDefinitions'),
    ...transactionTablesForReferences('narrativeModules'),
  ), async () => {
    const currentScope = await resolveScope({ scope })
    const current = await definitionInScope(currentScope, definition.id!)
    const consumers = await db.gameDefinitions.where('narrativeModuleId').equals(current.narrativeModuleId).toArray()
    await deleteGameDefinitionRecordInTransaction(currentScope, current.id!)
    if (consumers.length !== 1) return
    await db.narrativeNodes.where('moduleId').equals(current.narrativeModuleId).delete()
    await db.narrativeBeats.where('moduleId').equals(current.narrativeModuleId).delete()
    await db.narrativeChoices.where('moduleId').equals(current.narrativeModuleId).delete()
    await db.narrativeModules.delete(current.narrativeModuleId)
  })
}

const value = (key: string, title: string, initial: number, maximum: number, conserved = false) => ({
  key, title, description: `${title} 的可审计存量。`, initial, minimum: conserved ? initial : 0, maximum: conserved ? initial : maximum, conserved,
})

const metric = (key: string, title: string, initial: number) => ({
  ...value(key, title, initial, 500),
  levels: [
    { key: 'critical', label: '危急', minimum: 0 },
    { key: 'strained', label: '承压', minimum: 35 },
    { key: 'steady', label: '稳定', minimum: 65 },
  ],
})

export function createNarrativeSimulationAcceptanceContent(): NarrativeSimulationContentV1 {
  const report = (reportKey: string, observerKey: string, visibility: 'player' | 'actor' | 'debug', text: string) => ({
    op: 'create-report' as const, reportKey, observerKey, visibility, text, confidence: 0.9, expiresAfterTurns: null,
  })
  return {
    version: 1,
    turnLimit: 30,
    actionBudget: 2,
    resources: [
      value('funds', '公共资金', 120, 300),
      value('labor', '可用人力', 90, 220),
      value('districts', '辖区总量', 12, 12, true),
    ],
    metrics: [metric('stability', '秩序稳定', 55), metric('welfare', '民生福祉', 52), metric('legitimacy', '公共信任', 50)],
    actors: [
      { key: 'council', title: '议事会', description: '要求程序与授权。', kind: 'organization', stance: 15, capabilities: ['deliberate'], observationKeys: ['metric:legitimacy'], strategyActions: [{ key: 'review', title: '审议', requirements: [], effects: [{ op: 'change-value', target: 'metric', key: 'legitimacy', delta: 1 }], weight: 1 }] },
      { key: 'guild', title: '行会', description: '关注交易与供给。', kind: 'organization', stance: 5, capabilities: ['trade'], observationKeys: ['resource:funds', 'supply'], strategyActions: [{ key: 'trade', title: '组织交易', requirements: [], effects: [{ op: 'change-value', target: 'resource', key: 'funds', delta: 1 }], weight: 1 }] },
      { key: 'residents', title: '居民代表', description: '关注居住与公平。', kind: 'actor', stance: 10, capabilities: ['petition'], observationKeys: ['metric:welfare', 'housing'], strategyActions: [{ key: 'petition', title: '递交请愿', requirements: [], effects: [{ op: 'change-issue-pressure', issueKey: 'housing', delta: 1 }], weight: 1 }] },
      { key: 'watch', title: '巡守队', description: '关注安全与执行。', kind: 'organization', stance: 0, capabilities: ['patrol'], observationKeys: ['metric:stability', 'unrest'], strategyActions: [{ key: 'patrol', title: '例行巡查', requirements: [], effects: [{ op: 'change-value', target: 'metric', key: 'stability', delta: 1 }], weight: 1 }] },
      { key: 'auditors', title: '独立监察员', description: '核查资源来源。', kind: 'actor', stance: 20, capabilities: ['audit'], observationKeys: ['resource:funds'], strategyActions: [{ key: 'audit', title: '发布核查', requirements: [], effects: [report('audit-note', 'auditors', 'actor', '监察员记录了本回合的资金变化。')], weight: 1 }] },
    ],
    actions: [
      { key: 'repair-homes', title: '修缮住房', description: '直接缓解居住压力。', category: 'decision', requirements: [], costs: [{ op: 'change-value', target: 'resource', key: 'funds', delta: -8 }, { op: 'change-value', target: 'resource', key: 'labor', delta: -5 }], immediateEffects: [{ op: 'change-issue-pressure', issueKey: 'housing', delta: -9 }, { op: 'change-value', target: 'metric', key: 'welfare', delta: 4 }], delayedEffects: [], cooldownTurns: 1, conflictsWith: [], tags: ['housing'] },
      { key: 'ration-supplies', title: '临时配给', description: '短期缓解供给，随后积累不满。', category: 'decision', requirements: [], costs: [{ op: 'change-value', target: 'resource', key: 'funds', delta: -3 }], immediateEffects: [{ op: 'change-issue-pressure', issueKey: 'supply', delta: -8 }, { op: 'change-value', target: 'metric', key: 'stability', delta: 3 }], delayedEffects: [{ afterTurns: 3, effects: [{ op: 'change-issue-pressure', issueKey: 'unrest', delta: 7 }, { op: 'change-value', target: 'metric', key: 'welfare', delta: -4 }] }], cooldownTurns: 2, conflictsWith: ['open-market'], tags: ['short-term-benefit', 'traceable-side-effect'] },
      { key: 'negotiate-guild', title: '与行会谈判', description: '用程序换取供给合作。', category: 'decision', requirements: [], costs: [{ op: 'change-value', target: 'resource', key: 'funds', delta: -4 }], immediateEffects: [{ op: 'change-issue-pressure', issueKey: 'supply', delta: -5 }, { op: 'change-value', target: 'metric', key: 'legitimacy', delta: 3 }], delayedEffects: [], cooldownTurns: 1, conflictsWith: [], tags: ['negotiation'] },
      { key: 'public-hearing', title: '召开公开听证', description: '公开矛盾并恢复信任。', category: 'decision', requirements: [], costs: [{ op: 'change-value', target: 'resource', key: 'labor', delta: -3 }], immediateEffects: [{ op: 'change-issue-pressure', issueKey: 'unrest', delta: -4 }, { op: 'change-value', target: 'metric', key: 'legitimacy', delta: 4 }], delayedEffects: [], cooldownTurns: 1, conflictsWith: ['emergency-patrol'], tags: ['public'] },
      { key: 'emergency-patrol', title: '紧急巡守', description: '快速提升秩序但产生延迟信任代价。', category: 'decision', requirements: [], costs: [{ op: 'change-value', target: 'resource', key: 'funds', delta: -5 }, { op: 'change-value', target: 'resource', key: 'labor', delta: -4 }], immediateEffects: [{ op: 'change-value', target: 'metric', key: 'stability', delta: 6 }, { op: 'change-issue-pressure', issueKey: 'unrest', delta: -5 }], delayedEffects: [{ afterTurns: 2, effects: [{ op: 'change-value', target: 'metric', key: 'legitimacy', delta: -4 }] }], cooldownTurns: 1, conflictsWith: ['public-hearing'], tags: ['security'] },
      { key: 'train-teams', title: '训练协作队', description: '建立短期持续恢复能力。', category: 'decision', requirements: [], costs: [{ op: 'change-value', target: 'resource', key: 'funds', delta: -6 }], immediateEffects: [{ op: 'apply-modifier', modifierKey: 'trained-teams' }], delayedEffects: [], cooldownTurns: 3, conflictsWith: [], tags: ['capacity'] },
      { key: 'open-ledger', title: '公开账册政策', description: '持续提升公共信任。', category: 'policy', requirements: [], costs: [{ op: 'change-value', target: 'resource', key: 'labor', delta: -2 }], immediateEffects: [{ op: 'apply-modifier', modifierKey: 'open-ledger' }], delayedEffects: [], cooldownTurns: 4, conflictsWith: [], tags: ['policy'] },
      { key: 'fair-ration', title: '公平配给政策', description: '持续改善民生。', category: 'policy', requirements: [], costs: [{ op: 'change-value', target: 'resource', key: 'funds', delta: -7 }], immediateEffects: [{ op: 'apply-modifier', modifierKey: 'fair-ration' }], delayedEffects: [], cooldownTurns: 4, conflictsWith: ['open-market'], tags: ['policy'] },
      { key: 'night-shift', title: '夜班轮换政策', description: '持续补充秩序但消耗福祉。', category: 'policy', requirements: [], costs: [{ op: 'change-value', target: 'resource', key: 'funds', delta: -5 }], immediateEffects: [{ op: 'apply-modifier', modifierKey: 'night-shift' }], delayedEffects: [], cooldownTurns: 4, conflictsWith: [], tags: ['policy'] },
      { key: 'open-market', title: '开放市场政策', description: '增加资金并承受供给波动。', category: 'policy', requirements: [], costs: [{ op: 'change-value', target: 'resource', key: 'labor', delta: -2 }], immediateEffects: [{ op: 'apply-modifier', modifierKey: 'open-market' }], delayedEffects: [], cooldownTurns: 4, conflictsWith: ['ration-supplies', 'fair-ration'], tags: ['policy'] },
    ],
    modifiers: [
      { key: 'trained-teams', title: '受训协作队', description: '连续缓解住房压力。', durationTurns: 3, stackMode: 'refresh', recurringEffects: [{ op: 'change-issue-pressure', issueKey: 'housing', delta: -2 }] },
      { key: 'open-ledger', title: '账册公开', description: '公开记录持续积累信任。', durationTurns: 4, stackMode: 'refresh', recurringEffects: [{ op: 'change-value', target: 'metric', key: 'legitimacy', delta: 2 }] },
      { key: 'fair-ration', title: '公平配给', description: '持续改善民生并缓解供给。', durationTurns: 3, stackMode: 'refresh', recurringEffects: [{ op: 'change-value', target: 'metric', key: 'welfare', delta: 2 }, { op: 'change-issue-pressure', issueKey: 'supply', delta: -2 }] },
      { key: 'night-shift', title: '夜班轮换', description: '稳定秩序但降低福祉。', durationTurns: 3, stackMode: 'refresh', recurringEffects: [{ op: 'change-value', target: 'metric', key: 'stability', delta: 2 }, { op: 'change-value', target: 'metric', key: 'welfare', delta: -1 }] },
      { key: 'open-market', title: '开放市场', description: '持续增加资金并放大供给压力。', durationTurns: 3, stackMode: 'refresh', recurringEffects: [{ op: 'change-value', target: 'resource', key: 'funds', delta: 3 }, { op: 'change-issue-pressure', issueKey: 'supply', delta: 2 }] },
    ],
    issues: [
      { key: 'housing', title: '住房损耗', description: '维修积压形成的长期问题。', initialPressure: 30, minimumPressure: 0, maximumPressure: 100, driftPerTurn: 1, stages: [{ key: 'quiet', title: '可控', minimumPressure: 0, description: '仍可常规处理。' }, { key: 'strained', title: '承压', minimumPressure: 40, description: '居民开始受损。' }, { key: 'acute', title: '严重', minimumPressure: 70, description: '需要立即干预。' }], affectedActorKeys: ['residents', 'council'], crisis: false },
      { key: 'unrest', title: '公共动荡', description: '秩序与信任共同影响的危机。', initialPressure: 24, minimumPressure: 0, maximumPressure: 100, driftPerTurn: 2, stages: [{ key: 'quiet', title: '平静', minimumPressure: 0, description: '冲突尚未扩散。' }, { key: 'strained', title: '紧张', minimumPressure: 40, description: '公开冲突增加。' }, { key: 'severe', title: '失序', minimumPressure: 70, description: '系统接近崩溃。' }], affectedActorKeys: ['residents', 'watch'], crisis: true },
      { key: 'supply', title: '供给中断', description: '交易与储备失衡的危机。', initialPressure: 22, minimumPressure: 0, maximumPressure: 100, driftPerTurn: 2, stages: [{ key: 'quiet', title: '充足', minimumPressure: 0, description: '供给稳定。' }, { key: 'strained', title: '短缺', minimumPressure: 40, description: '价格与分配承压。' }, { key: 'severe', title: '断供', minimumPressure: 70, description: '基本运行受到威胁。' }], affectedActorKeys: ['guild', 'residents'], crisis: true },
    ],
    endings: [
      { key: 'shared-prosperity', title: '共同繁荣', description: '稳定、福祉和信任形成可持续平衡。', narrativeNodeKey: 'ending.shared-prosperity', priority: 400, conditions: [{ source: 'turn', operator: 'gte', value: 8 }, { source: 'metric', key: 'stability', operator: 'gte', value: 70 }, { source: 'metric', key: 'welfare', operator: 'gte', value: 65 }, { source: 'metric', key: 'legitimacy', operator: 'gte', value: 65 }] },
      { key: 'order-without-trust', title: '无信之治', description: '秩序得以维持，但公共授权已经耗尽。', narrativeNodeKey: 'ending.order-without-trust', priority: 300, conditions: [{ source: 'turn', operator: 'gte', value: 8 }, { source: 'metric', key: 'stability', operator: 'gte', value: 70 }, { source: 'metric', key: 'legitimacy', operator: 'lte', value: 35 }] },
      { key: 'system-collapse', title: '系统崩溃', description: '一场未解决危机越过承受边界。', narrativeNodeKey: 'ending.system-collapse', priority: 500, conditions: [{ source: 'issue-stage', key: 'unrest', operator: 'eq', value: 'severe' }] },
      { key: 'unfinished-mandate', title: '任期终局', description: '三十回合结束，系统带着未解矛盾进入下一任期。', narrativeNodeKey: 'ending.unfinished-mandate', priority: 100, conditions: [{ source: 'turn', operator: 'gte', value: 30 }] },
    ],
    themes: [
      { key: 'historic-town', title: '历史城镇', roleLabel: '执政官', resourceLabel: '府库', issueLabel: '城务' },
      { key: 'cultivation-sect', title: '玄幻宗门', roleLabel: '掌门', resourceLabel: '宗门资材', issueLabel: '宗门隐患' },
      { key: 'space-colony', title: '科幻殖民站', roleLabel: '站长', resourceLabel: '站点配额', issueLabel: '系统故障' },
      { key: 'modern-company', title: '现代公司', roleLabel: '负责人', resourceLabel: '经营资源', issueLabel: '组织风险' },
    ],
  }
}

export async function seedNarrativeSimulationAcceptanceGame(input: {
  scope: WorkspaceScope
}): Promise<GameDefinition> {
  const scope = await resolveScope({ scope: input.scope })
  const existing = await db.gameDefinitions.where('[workId+gameKey]').equals([scope.workId, 'closed-district-textsim']).first()
  if (existing) return existing
  return createNarrativeSimulationGame({
    scope,
    gameKey: 'closed-district-textsim',
    title: '十二街区治理录',
    content: createNarrativeSimulationAcceptanceContent(),
  })
}
