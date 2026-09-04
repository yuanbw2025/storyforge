import {
  applyNarrativeEffects,
  evaluateNarrativeCondition,
  parseNarrativeCondition,
  parseNarrativeEffects,
} from '../narrative/blueprint'
import type {
  FrozenProductNarrativeNode,
  FrozenNarrativeBeat,
  FrozenNarrativeChoice,
  NarrativeChoiceEvaluation,
  NarrativeContentGraphReport,
} from '../types'

function stronglyConnectedComponents(edges: ReadonlyMap<string, readonly string[]>): string[][] {
  let index = 0
  const indexes = new Map<string, number>()
  const lowLinks = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const components: string[][] = []

  const visit = (key: string): void => {
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

/** Pure validation for self-contained Build and ProductRelease narrative packages. */
export function validateNarrativeContentGraph(input: {
  entryNodeKey: string | null
  nodes: FrozenProductNarrativeNode[]
  beats: FrozenNarrativeBeat[]
  choices: FrozenNarrativeChoice[]
  knownSpeakerKeys?: ReadonlySet<string>
}): NarrativeContentGraphReport {
  const errors: string[] = []
  const nodeKeys = new Set(input.nodes.map(node => node.key))
  const beatKeys = new Set<string>()
  const choiceKeys = new Set<string>()
  if (nodeKeys.size !== input.nodes.length) errors.push('[narrative] 叙事节点 key 重复')
  const entryKey = input.entryNodeKey?.trim() || null
  if (!entryKey) errors.push('[narrative] 缺少入口节点')
  else if (!nodeKeys.has(entryKey)) errors.push('[narrative] 入口节点不存在')

  const danglingSuccessors: NarrativeContentGraphReport['danglingSuccessors'] = []
  const invalidChoiceTargets: NarrativeContentGraphReport['invalidChoiceTargets'] = []
  const orphanBeatKeys: string[] = []
  const orphanChoiceKeys: string[] = []
  const edges = new Map(input.nodes.map(node => [node.key, [] as string[]]))

  for (const node of input.nodes) {
    try {
      parseNarrativeCondition(node.conditionJson)
      parseNarrativeEffects(node.effectsJson)
    } catch (cause) {
      errors.push(cause instanceof Error ? cause.message : String(cause))
    }
    for (const target of node.successorKeys) {
      if (!nodeKeys.has(target)) danglingSuccessors.push({ nodeKey: node.key, successorKey: target })
    }
  }
  for (const beat of input.beats) {
    if (beatKeys.has(beat.beatKey)) errors.push(`[narrative] Beat key 重复:${beat.beatKey}`)
    beatKeys.add(beat.beatKey)
    if (!nodeKeys.has(beat.nodeKey)) orphanBeatKeys.push(beat.beatKey)
    if (beat.kind === 'dialogue' && !beat.speakerKey) errors.push(`[narrative] 对话 Beat 缺少 speaker:${beat.beatKey}`)
    if (beat.speakerKey && input.knownSpeakerKeys && !input.knownSpeakerKeys.has(beat.speakerKey)) {
      errors.push(`[narrative] Beat speaker 不在冻结产品包中:${beat.beatKey}`)
    }
    if (!beat.text.trim()) errors.push(`[narrative] Beat 文本为空:${beat.beatKey}`)
  }
  for (const choice of input.choices) {
    if (choiceKeys.has(choice.choiceKey)) errors.push(`[narrative] Choice key 重复:${choice.choiceKey}`)
    choiceKeys.add(choice.choiceKey)
    if (!nodeKeys.has(choice.sourceNodeKey)) orphanChoiceKeys.push(choice.choiceKey)
    if (!nodeKeys.has(choice.targetNodeKey)) {
      invalidChoiceTargets.push({ choiceKey: choice.choiceKey, targetNodeKey: choice.targetNodeKey })
    } else if (nodeKeys.has(choice.sourceNodeKey)) {
      edges.get(choice.sourceNodeKey)!.push(choice.targetNodeKey)
    }
    if (!choice.text.trim()) errors.push(`[narrative] Choice 文本为空:${choice.choiceKey}`)
    try {
      parseNarrativeCondition(choice.displayConditionJson)
      parseNarrativeCondition(choice.availableConditionJson)
      parseNarrativeEffects(choice.effectsJson)
    } catch (cause) {
      errors.push(cause instanceof Error ? cause.message : String(cause))
    }
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
  if (!endingNodeKeys.length) errors.push('[narrative] 缺少结局节点')
  else if (!reachableEndingKeys.length) errors.push('[narrative] 没有从入口可达的结局')

  const deadEndNodeKeys = input.nodes
    .filter(node => node.kind !== 'ending' && (edges.get(node.key)?.length ?? 0) === 0)
    .map(node => node.key)
    .sort()
  const cycleRisks = stronglyConnectedComponents(edges).filter(component => (
    component.length > 1 || (edges.get(component[0]) ?? []).includes(component[0])
  ))
  const endingSet = new Set(endingNodeKeys)
  const blockingCycleKeys = cycleRisks.filter(component => {
    const members = new Set(component)
    return !component.some(key => endingSet.has(key))
      && !component.some(key => (edges.get(key) ?? []).some(target => !members.has(target)))
  })
  if (deadEndNodeKeys.length) errors.push(`[narrative] 非结局死路:${deadEndNodeKeys.join(',')}`)
  if (blockingCycleKeys.length) errors.push(`[narrative] 无退出循环:${blockingCycleKeys.map(keys => keys.join('->')).join(';')}`)
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
