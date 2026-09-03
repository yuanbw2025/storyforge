import type { RuleActionDefinitionV1, TtrpgRuntimeActionEconomyV2 } from '../types'

function fail(message: string): never {
  throw new Error(`[ttrpg-action-economy] ${message}`)
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(`${label} 无效`)
  return Number(value)
}

function actorKey(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(`${label} 必须是字符串`)
  const result = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(result)) fail(`${label} 无效`)
  return result
}

export function createDormantTtrpgActionEconomyV2(input: {
  actionsPerTurn: number
  reactionsPerRound: number
  freeActionsPerTurn?: number
}): TtrpgRuntimeActionEconomyV2 {
  return {
    schema: 'storyforge.ttrpg-action-economy', version: 2,
    actionsPerTurn: boundedInteger(input.actionsPerTurn, 'actionsPerTurn', 1, 20),
    reactionsPerRound: boundedInteger(input.reactionsPerRound, 'reactionsPerRound', 0, 20),
    freeActionsPerTurn: boundedInteger(input.freeActionsPerTurn ?? 1, 'freeActionsPerTurn', 0, 20),
    sceneKey: null, round: 0, activeActorKey: null, budgets: {},
  }
}

export function startTtrpgActionEconomySceneV2(input: {
  economy: TtrpgRuntimeActionEconomyV2
  sceneKey: string
  turnOrder: string[]
}): TtrpgRuntimeActionEconomyV2 {
  const parsed = parseTtrpgActionEconomyV2(input.economy)
  const sceneKey = actorKey(input.sceneKey, 'sceneKey')
  if (!Array.isArray(input.turnOrder) || !input.turnOrder.length || input.turnOrder.length > 100) fail('turnOrder 无效')
  const turnOrder = input.turnOrder.map((item, index) => actorKey(item, `turnOrder[${index}]`))
  if (new Set(turnOrder).size !== turnOrder.length) fail('turnOrder 不允许重复')
  return {
    ...parsed,
    sceneKey,
    round: 1,
    activeActorKey: turnOrder[0],
    budgets: Object.fromEntries(turnOrder.map(key => [key, {
      actionsRemaining: parsed.actionsPerTurn,
      reactionsRemaining: parsed.reactionsPerRound,
      freeActionsRemaining: parsed.freeActionsPerTurn,
    }])),
  }
}

export function parseTtrpgActionEconomyV2(value: unknown): TtrpgRuntimeActionEconomyV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('状态必须是对象')
  const row = value as Record<string, unknown>
  const expected = ['schema', 'version', 'actionsPerTurn', 'reactionsPerRound', 'freeActionsPerTurn', 'sceneKey', 'round', 'activeActorKey', 'budgets']
  if (Object.keys(row).sort().join(',') !== expected.sort().join(',')) fail('状态字段不精确')
  if (row.schema !== 'storyforge.ttrpg-action-economy' || row.version !== 2) fail('schema/version 无效')
  const actionsPerTurn = boundedInteger(row.actionsPerTurn, 'actionsPerTurn', 1, 20)
  const reactionsPerRound = boundedInteger(row.reactionsPerRound, 'reactionsPerRound', 0, 20)
  const freeActionsPerTurn = boundedInteger(row.freeActionsPerTurn, 'freeActionsPerTurn', 0, 20)
  const sceneKey = row.sceneKey == null ? null : actorKey(row.sceneKey, 'sceneKey')
  const activeActorKey = row.activeActorKey == null ? null : actorKey(row.activeActorKey, 'activeActorKey')
  const round = boundedInteger(row.round, 'round', 0, Number.MAX_SAFE_INTEGER)
  if (!row.budgets || typeof row.budgets !== 'object' || Array.isArray(row.budgets)) fail('budgets 无效')
  const budgets: TtrpgRuntimeActionEconomyV2['budgets'] = {}
  for (const [rawActorKey, rawBudget] of Object.entries(row.budgets as Record<string, unknown>)) {
    const key = actorKey(rawActorKey, 'budget.actorKey')
    if (!rawBudget || typeof rawBudget !== 'object' || Array.isArray(rawBudget)) fail(`budget ${key} 无效`)
    const budget = rawBudget as Record<string, unknown>
    if (Object.keys(budget).sort().join(',') !== 'actionsRemaining,freeActionsRemaining,reactionsRemaining') {
      fail(`budget ${key} 字段不精确`)
    }
    budgets[key] = {
      actionsRemaining: boundedInteger(budget.actionsRemaining, 'actionsRemaining', 0, actionsPerTurn),
      reactionsRemaining: boundedInteger(budget.reactionsRemaining, 'reactionsRemaining', 0, reactionsPerRound),
      freeActionsRemaining: boundedInteger(budget.freeActionsRemaining, 'freeActionsRemaining', 0, freeActionsPerTurn),
    }
  }
  if (sceneKey == null) {
    if (round !== 0 || activeActorKey != null || Object.keys(budgets).length) fail('休眠行动经济状态不一致')
  } else if (round < 1 || activeActorKey == null || !budgets[activeActorKey]) {
    fail('活动行动经济状态不一致')
  }
  return {
    schema: 'storyforge.ttrpg-action-economy', version: 2,
    actionsPerTurn, reactionsPerRound, freeActionsPerTurn,
    sceneKey, round, activeActorKey, budgets,
  }
}

export function spendTtrpgActionEconomyV2(input: {
  economy: TtrpgRuntimeActionEconomyV2
  turnOrder: string[]
  actorKey: string
  phase: RuleActionDefinitionV1['phase']
}): { economy: TtrpgRuntimeActionEconomyV2; nextActorKey: string | null; nextRound: number } {
  const economy = parseTtrpgActionEconomyV2(input.economy)
  const actor = actorKey(input.actorKey, 'actorKey')
  const budget = economy.budgets[actor]
  if (!economy.sceneKey || !budget || !input.turnOrder.includes(actor)) fail('行动者不在当前场景经济账本')
  const result = structuredClone(economy)
  const mutable = result.budgets[actor]
  if (input.phase === 'reaction') {
    if (mutable.reactionsRemaining < 1) fail('本轮反应次数已经耗尽')
    mutable.reactionsRemaining -= 1
    return { economy: result, nextActorKey: null, nextRound: result.round }
  }
  if (result.activeActorKey !== actor) fail('当前还没轮到该行动者')
  if (input.phase === 'free') {
    if (mutable.freeActionsRemaining < 1) fail('本回合自由行动次数已经耗尽')
    mutable.freeActionsRemaining -= 1
    return { economy: result, nextActorKey: null, nextRound: result.round }
  }
  if (input.phase !== 'action' && input.phase !== 'downtime') fail('行动阶段无效')
  if (mutable.actionsRemaining < 1) fail('本回合行动次数已经耗尽')
  mutable.actionsRemaining -= 1
  if (mutable.actionsRemaining > 0) return { economy: result, nextActorKey: null, nextRound: result.round }
  const currentIndex = input.turnOrder.indexOf(actor)
  const nextIndex = (currentIndex + 1) % input.turnOrder.length
  const nextActorKey = input.turnOrder[nextIndex]
  if (nextIndex === 0) {
    result.round += 1
    for (const item of Object.values(result.budgets)) item.reactionsRemaining = result.reactionsPerRound
  }
  result.activeActorKey = nextActorKey
  result.budgets[nextActorKey].actionsRemaining = result.actionsPerTurn
  result.budgets[nextActorKey].freeActionsRemaining = result.freeActionsPerTurn
  return { economy: result, nextActorKey, nextRound: result.round }
}
