import { db } from '../db/schema'
import { parseStages } from '../types/story-arc'
import type {
  NarrativeModule,
  NarrativeModuleKind,
  NarrativeCondition,
  NarrativeEffect,
  NarrativeExecutionStep,
  NarrativeNode,
  NarrativeNodeKind,
  NarrativeReachabilityReport,
  WorkspaceScope,
} from '../types'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveScope,
  scopeTransactionTables,
  stampNewRecord,
} from '../world-engine/scope'

function parseStringArray(value: string, label: string): string[] {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error(`[narrative] ${label} 不是合法 JSON`) }
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`[narrative] ${label} 必须是字符串数组`)
  }
  return parsed.map(item => item.trim())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseJson(value: string, label: string): unknown {
  try { return JSON.parse(value) } catch { throw new Error(`[narrative] ${label} 不是合法 JSON`) }
}

function assertPath(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`[narrative] ${label}.path 不能为空`)
  const parts = value.split('.')
  if (parts.some(part => !/^[a-zA-Z0-9_-]+$/.test(part) || ['__proto__', 'prototype', 'constructor'].includes(part))) {
    throw new Error(`[narrative] ${label}.path 无效`)
  }
  return value
}

function parseConditionValue(value: unknown, label: string): NarrativeCondition {
  if (!isRecord(value)) throw new Error(`[narrative] ${label} 必须是 JSON 对象`)
  const keys = Object.keys(value)
  if (keys.length === 0) return {}
  if ('all' in value) {
    if (keys.length !== 1 || !Array.isArray(value.all)) throw new Error(`[narrative] ${label}.all 必须是唯一的条件数组`)
    return { all: value.all.map((item, index) => parseConditionValue(item, `${label}.all[${index}]`)) }
  }
  if ('any' in value) {
    if (keys.length !== 1 || !Array.isArray(value.any)) throw new Error(`[narrative] ${label}.any 必须是唯一的条件数组`)
    return { any: value.any.map((item, index) => parseConditionValue(item, `${label}.any[${index}]`)) }
  }
  if ('not' in value) {
    if (keys.length !== 1) throw new Error(`[narrative] ${label}.not 必须是唯一条件`)
    return { not: parseConditionValue(value.not, `${label}.not`) }
  }
  const path = assertPath(value.path, label)
  const operators = ['exists', 'eq', 'in'].filter(key => key in value)
  if (operators.length !== 1 || keys.some(key => !['path', ...operators].includes(key))) {
    throw new Error(`[narrative] ${label} 必须且只能包含一个比较操作`)
  }
  if ('exists' in value) {
    if (typeof value.exists !== 'boolean') throw new Error(`[narrative] ${label}.exists 必须是布尔值`)
    return { path, exists: value.exists }
  }
  if ('in' in value) {
    if (!Array.isArray(value.in) || value.in.some(item => item !== null && !['string', 'number', 'boolean'].includes(typeof item))) {
      throw new Error(`[narrative] ${label}.in 必须是标量数组`)
    }
    return { path, in: value.in as Array<string | number | boolean | null> }
  }
  const eq = value.eq
  if (eq !== null && !['string', 'number', 'boolean'].includes(typeof eq)) throw new Error(`[narrative] ${label}.eq 必须是标量`)
  return { path, eq: eq as string | number | boolean | null }
}

function parseEffectsValue(value: unknown, label: string): NarrativeEffect[] {
  if (!Array.isArray(value)) throw new Error(`[narrative] ${label} 必须是 JSON 数组`)
  return value.map((item, index) => {
    const itemLabel = `${label}[${index}]`
    if (!isRecord(item)) throw new Error(`[narrative] ${itemLabel} 必须是对象`)
    const path = assertPath(item.path, itemLabel)
    if (item.op === 'set' && Object.keys(item).every(key => ['op', 'path', 'value'].includes(key)) && 'value' in item) {
      return { op: 'set', path, value: structuredClone(item.value) }
    }
    if (item.op === 'increment' && Object.keys(item).every(key => ['op', 'path', 'value'].includes(key)) && typeof item.value === 'number' && Number.isFinite(item.value)) {
      return { op: 'increment', path, value: item.value }
    }
    if (item.op === 'unset' && Object.keys(item).every(key => ['op', 'path'].includes(key))) return { op: 'unset', path }
    throw new Error(`[narrative] ${itemLabel} 不是受支持的确定性效果`)
  })
}

export function parseNarrativeCondition(value: string): NarrativeCondition {
  return parseConditionValue(parseJson(value, 'conditionJson'), 'conditionJson')
}

export function parseNarrativeEffects(value: string): NarrativeEffect[] {
  return parseEffectsValue(parseJson(value, 'effectsJson'), 'effectsJson')
}

function valueAtPath(state: Record<string, unknown>, path: string): { exists: boolean; value: unknown } {
  let cursor: unknown = state
  for (const part of path.split('.')) {
    if (!isRecord(cursor) || !(part in cursor)) return { exists: false, value: undefined }
    cursor = cursor[part]
  }
  return { exists: true, value: cursor }
}

export function evaluateNarrativeCondition(
  condition: NarrativeCondition,
  state: Record<string, unknown>,
): boolean {
  if ('all' in condition) return condition.all.every(child => evaluateNarrativeCondition(child, state))
  if ('any' in condition) return condition.any.some(child => evaluateNarrativeCondition(child, state))
  if ('not' in condition) return !evaluateNarrativeCondition(condition.not, state)
  if (!('path' in condition)) return true
  const current = valueAtPath(state, condition.path)
  if ('exists' in condition) return current.exists === condition.exists
  if ('in' in condition) return current.exists && condition.in.includes(current.value as never)
  return current.exists && current.value === condition.eq
}

function parentAtPath(state: Record<string, unknown>, path: string): { parent: Record<string, unknown>; key: string } {
  const parts = path.split('.')
  const key = parts.pop()!
  let parent = state
  for (const part of parts) {
    if (!isRecord(parent[part])) parent[part] = {}
    parent = parent[part] as Record<string, unknown>
  }
  return { parent, key }
}

export function applyNarrativeEffects(
  effects: NarrativeEffect[],
  currentState: Record<string, unknown>,
): Record<string, unknown> {
  const state = structuredClone(currentState)
  for (const effect of effects) {
    const { parent, key } = parentAtPath(state, effect.path)
    if (effect.op === 'set') parent[key] = structuredClone(effect.value)
    else if (effect.op === 'unset') delete parent[key]
    else {
      const current = parent[key] ?? 0
      if (typeof current !== 'number' || !Number.isFinite(current)) throw new Error(`[narrative] ${effect.path} 不是可递增数值`)
      parent[key] = current + effect.value
    }
  }
  return state
}

export async function executeNarrativeNode(input: {
  scope: WorkspaceScope
  moduleId: number
  nodeKey: string
  state: Record<string, unknown>
}): Promise<NarrativeExecutionStep> {
  const scope = await resolveScope({ scope: input.scope })
  const module = await db.narrativeModules.get(input.moduleId)
  if (!module || !await assertRecordInScope(scope, 'narrativeModules', module)) throw new Error('[narrative] 模块不属于当前 scope')
  const nodes = await db.narrativeNodes.where('moduleId').equals(input.moduleId).toArray()
  const node = nodes.find(item => item.key === input.nodeKey)
  if (!node) throw new Error(`[narrative] 节点不存在:${input.nodeKey}`)
  if (!evaluateNarrativeCondition(parseNarrativeCondition(node.conditionJson), input.state)) {
    throw new Error(`[narrative] 节点条件未满足:${input.nodeKey}`)
  }
  const state = applyNarrativeEffects(parseNarrativeEffects(node.effectsJson), input.state)
  const successorKeys = parseStringArray(node.successorKeysJson, `${node.key}.successorKeysJson`)
  const successorNodes = nodes.filter(candidate => successorKeys.includes(candidate.key)
    && evaluateNarrativeCondition(parseNarrativeCondition(candidate.conditionJson), state))
  return { node, state, successorNodes }
}

export async function createNarrativeModule(input: {
  scope: WorkspaceScope
  owner: 'world' | 'work'
  kind: NarrativeModuleKind
  title: string
  description?: string
  sourceProjection?: NarrativeModule['sourceProjection']
  sourceRefId?: number | null
}): Promise<NarrativeModule> {
  const title = input.title.trim()
  if (!title) throw new Error('[narrative] 模块名称不能为空')
  return db.transaction('rw', scopeTransactionTables(db.narrativeModules), async () => {
    const scope = await resolveScope({ scope: input.scope })
    const ts = Date.now()
    const row = stampNewRecord(scope, 'narrativeModules', {
      projectId: scope.projectId,
      kind: input.kind,
      title,
      description: input.description?.trim() ?? '',
      status: 'draft',
      sourceProjection: input.sourceProjection ?? 'custom',
      sourceRefId: input.sourceRefId ?? null,
      entryNodeKey: null,
      createdAt: ts,
      updatedAt: ts,
    } as NarrativeModule, { owner: input.owner }) as NarrativeModule
    const id = await db.narrativeModules.add(row) as number
    return { ...row, id }
  })
}

/** Create the smallest valid executable graph for a product-facing narrative entry. */
export async function createStarterNarrativeModule(input: {
  scope: WorkspaceScope
  owner: 'world' | 'work'
  kind: NarrativeModuleKind
  title: string
  description?: string
}): Promise<NarrativeModule> {
  return db.transaction('rw', scopeTransactionTables(
    db.narrativeModules,
    db.narrativeNodes,
    db.outlineNodes,
  ), async () => {
    const module = await createNarrativeModule({
      ...input,
      sourceProjection: 'custom',
    })
    await addNarrativeNode({
      scope: input.scope,
      moduleId: module.id!,
      key: 'entry',
      kind: 'entry',
      title: `${input.title.trim()} · 入口`,
      successorKeys: ['ending'],
      order: 0,
    })
    await addNarrativeNode({
      scope: input.scope,
      moduleId: module.id!,
      key: 'ending',
      kind: 'ending',
      title: input.kind === 'free' ? '结束本次探索' : `${input.title.trim()} · 结局`,
      order: 1,
    })
    const created = await db.narrativeModules.get(module.id!)
    if (!created) throw new Error('[narrative] 初始叙事创建失败')
    return created
  })
}

export async function addNarrativeNode(input: {
  scope: WorkspaceScope
  moduleId: number
  key: string
  kind: NarrativeNodeKind
  title: string
  summary?: string
  conditionJson?: string
  effectsJson?: string
  successorKeys?: string[]
  sourceOutlineNodeId?: number | null
  order?: number
}): Promise<NarrativeNode> {
  const key = input.key.trim()
  if (!key || !/^[a-zA-Z0-9._:-]+$/.test(key)) throw new Error('[narrative] 节点 key 无效')
  const conditionJson = input.conditionJson ?? '{}'
  const effectsJson = input.effectsJson ?? '[]'
  parseNarrativeCondition(conditionJson)
  parseNarrativeEffects(effectsJson)
  return db.transaction('rw', scopeTransactionTables(
    db.narrativeModules,
    db.narrativeNodes,
    db.outlineNodes,
  ), async () => {
    const scope = await resolveScope({ scope: input.scope })
    const module = await db.narrativeModules.get(input.moduleId)
    if (!module || !await assertRecordInScope(scope, 'narrativeModules', module)) {
      throw new Error('[narrative] 模块不属于当前 scope')
    }
    const duplicate = await db.narrativeNodes.where('moduleId').equals(input.moduleId).filter(node => node.key === key).first()
    if (duplicate) throw new Error(`[narrative] 节点 key 重复:${key}`)
    if (input.sourceOutlineNodeId != null) {
      const outline = await db.outlineNodes.get(input.sourceOutlineNodeId)
      if (!outline || !await assertRecordInScope(scope, 'outlineNodes', outline, { owner: 'work' })) {
        throw new Error('[narrative] 来源大纲不属于当前 Work')
      }
    }
    const ts = Date.now()
    const row: NarrativeNode = {
      projectId: scope.projectId,
      moduleId: input.moduleId,
      key,
      kind: input.kind,
      title: input.title.trim() || key,
      summary: input.summary?.trim() ?? '',
      conditionJson,
      effectsJson,
      successorKeysJson: JSON.stringify(input.successorKeys ?? []),
      sourceOutlineNodeId: input.sourceOutlineNodeId ?? null,
      order: input.order ?? 0,
      createdAt: ts,
      updatedAt: ts,
    }
    const id = await db.narrativeNodes.add(row) as number
    if (input.kind === 'entry' && !module.entryNodeKey) {
      await db.narrativeModules.update(module.id!, { entryNodeKey: key, updatedAt: ts })
    }
    return { ...row, id }
  })
}

export async function validateNarrativeModule(scope: WorkspaceScope, moduleId: number): Promise<NarrativeReachabilityReport> {
  scope = await resolveScope({ scope })
  const module = await db.narrativeModules.get(moduleId)
  if (!module || !await assertRecordInScope(scope, 'narrativeModules', module)) throw new Error('[narrative] 模块不属于当前 scope')
  const nodes = (await db.narrativeNodes.where('moduleId').equals(moduleId).toArray()).sort((a, b) => a.order - b.order)
  const errors: string[] = []
  const keys = new Set(nodes.map(node => node.key))
  if (keys.size !== nodes.length) errors.push('[narrative] 模块包含重复节点 key')
  if (nodes.some(node => node.projectId !== scope.projectId || node.moduleId !== moduleId)) {
    errors.push('[narrative] 模块包含身份错配节点')
  }
  const entryKey = module.entryNodeKey && keys.has(module.entryNodeKey)
    ? module.entryNodeKey
    : nodes.find(node => node.kind === 'entry')?.key ?? nodes[0]?.key ?? null
  if (!module.entryNodeKey) errors.push('[narrative] 模块未登记入口节点')
  else if (!keys.has(module.entryNodeKey)) errors.push('[narrative] 模块登记的入口节点不存在')
  const edges = new Map<string, string[]>()
  const danglingSuccessors: Array<{ nodeKey: string; successorKey: string }> = []
  for (const node of nodes) {
    try {
      const successors = parseStringArray(node.successorKeysJson, `${node.key}.successorKeysJson`)
      edges.set(node.key, successors)
      for (const successorKey of successors) if (!keys.has(successorKey)) danglingSuccessors.push({ nodeKey: node.key, successorKey })
      parseConditionValue(parseJson(node.conditionJson, `${node.key}.conditionJson`), `${node.key}.conditionJson`)
      parseEffectsValue(parseJson(node.effectsJson, `${node.key}.effectsJson`), `${node.key}.effectsJson`)
    } catch (cause) { errors.push(cause instanceof Error ? cause.message : String(cause)) }
  }
  const reachable = new Set<string>()
  const queue = entryKey ? [entryKey] : []
  while (queue.length) {
    const current = queue.shift()!
    if (reachable.has(current) || !keys.has(current)) continue
    reachable.add(current)
    queue.push(...(edges.get(current) ?? []))
  }
  if (!entryKey) errors.push('[narrative] 模块缺少入口节点')
  if (!nodes.some(node => node.kind === 'ending')) errors.push('[narrative] 模块缺少结局节点')
  const unreachableKeys = nodes.map(node => node.key).filter(key => !reachable.has(key))
  return {
    valid: errors.length === 0 && danglingSuccessors.length === 0 && unreachableKeys.length === 0,
    entryKey,
    reachableKeys: [...reachable],
    unreachableKeys,
    danglingSuccessors,
    errors,
  }
}

/** Materialize existing StoryArc stages as the first executable projection. */
export async function projectStoryArcsToNarrative(scope: WorkspaceScope): Promise<NarrativeModule[]> {
  return db.transaction('rw', scopeTransactionTables(
    db.storyArcs,
    db.narrativeModules,
    db.narrativeNodes,
    db.outlineNodes,
  ), async () => {
    const resolved = await resolveScope({ scope })
    const arcs = await readOwnedRows<any>(resolved, 'storyArcs')
    const existing = await readOwnedRows<NarrativeModule>(resolved, 'narrativeModules')
    const result: NarrativeModule[] = []
    for (const arc of arcs) {
      let module = existing.find(item => item.sourceProjection === 'story-arc' && item.sourceRefId === arc.id)
      const kind = arc.type === 'main' ? 'main' : 'side'
      if (!module) {
        module = await createNarrativeModule({
          scope: resolved,
          owner: arc.worldId != null ? 'world' : 'work',
          kind,
          title: arc.name,
          description: arc.description,
          sourceProjection: 'story-arc',
          sourceRefId: arc.id,
        })
        existing.push(module)
      } else {
        const updatedAt = Date.now()
        await db.narrativeModules.update(module.id!, {
          kind,
          title: arc.name,
          description: arc.description ?? '',
          entryNodeKey: null,
          updatedAt,
        })
        module = { ...module, kind, title: arc.name, description: arc.description ?? '', entryNodeKey: null, updatedAt }
        await db.narrativeNodes.where('moduleId').equals(module.id!).delete()
      }
      const stages = parseStages(arc.stages)
      const keys = stages.map((_: unknown, index: number) => `stage:${index + 1}`)
      for (let index = 0; index < stages.length; index++) {
        const stage = stages[index]
        await addNarrativeNode({
          scope: resolved,
          moduleId: module.id!,
          key: keys[index],
          kind: stages.length === 1 ? 'ending' : index === 0 ? 'entry' : index === stages.length - 1 ? 'ending' : 'scene',
          title: stage.title,
          summary: stage.description,
          successorKeys: keys[index + 1] ? [keys[index + 1]] : [],
          order: index,
        })
      }
      if (keys[0]) {
        await db.narrativeModules.update(module.id!, { entryNodeKey: keys[0], updatedAt: Date.now() })
        module = { ...module, entryNodeKey: keys[0] }
      }
      result.push(module)
    }
    return result
  })
}
