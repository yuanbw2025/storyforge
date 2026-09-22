import type {
  TextOpenWorldCombatRuntimeStateV2,
  TextOpenWorldCombatStatModifierV2,
  TextOpenWorldProgressionModuleV2,
} from '../types'

export type TextOpenWorldCombatStatusApplyOutcomeV2 =
  | 'applied'
  | 'rejected'
  | 'refreshed'
  | 'stacked'
  | 'max-stacks'

export interface TextOpenWorldCombatModifierTotalsV2 {
  attack: number
  defense: number
  skillPower: number
  criticalChanceBasisPoints: number
}

const MODIFIER_STATS = ['attack', 'defense', 'skillPower', 'criticalChanceBasisPoints'] as const

function fail(message: string): never { throw new Error(`[text-open-world-combat-status] ${message}`) }

function safeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) fail(`${label}必须是安全整数`)
  return value
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  const a = [...left].sort()
  const b = [...right].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function definitionFor(progression: TextOpenWorldProgressionModuleV2, statusKey: string) {
  return progression.statuses.find(status => status.key === statusKey) ?? fail(`状态定义不存在:${statusKey}`)
}

function emptyTotals(): TextOpenWorldCombatModifierTotalsV2 {
  return { attack: 0, defense: 0, skillPower: 0, criticalChanceBasisPoints: 0 }
}

function addModifiers(
  totals: TextOpenWorldCombatModifierTotalsV2,
  modifiers: readonly TextOpenWorldCombatStatModifierV2[],
  multiplier: number,
) {
  for (const modifier of modifiers) {
    if (!MODIFIER_STATS.includes(modifier.stat)) fail(`修正属性无效:${String(modifier.stat)}`)
    if (modifier.operation !== 'add-flat') fail(`修正操作无效:${String(modifier.operation)}`)
    const amount = safeInteger(modifier.amount, `修正值${modifier.stat}`)
    const delta = safeInteger(amount * multiplier, `修正值${modifier.stat}`)
    totals[modifier.stat] = safeInteger(totals[modifier.stat] + delta, `累计修正值${modifier.stat}`)
  }
}

export function isTextOpenWorldCombatRuntimeStateV2(value: unknown): value is TextOpenWorldCombatRuntimeStateV2 {
  return Boolean(value && typeof value === 'object' && (value as { version?: unknown }).version === 2)
}

/** Validates only CombatRuntimeState v2 additions; the v1 state machine retains ownership of shared fields. */
export function validateTextOpenWorldCombatStatusStateV2(input: {
  combat: unknown
  progression: TextOpenWorldProgressionModuleV2
}): TextOpenWorldCombatRuntimeStateV2 {
  if (!isTextOpenWorldCombatRuntimeStateV2(input.combat)) fail('必须提供CombatRuntimeState v2')
  const combat = input.combat
  const combatantKeys = combat.turnOrder
  if (!Array.isArray(combatantKeys) || !combatantKeys.length
    || combatantKeys.some(combatantKey => typeof combatantKey !== 'string' || !combatantKey)
    || new Set(combatantKeys).size !== combatantKeys.length) {
    fail('turnOrder必须是非空且不重复的战斗员列表')
  }
  if (!combat.actorTurnOrdinalByCombatantKey || typeof combat.actorTurnOrdinalByCombatantKey !== 'object'
    || Array.isArray(combat.actorTurnOrdinalByCombatantKey)
    || !sameKeys(Object.keys(combat.actorTurnOrdinalByCombatantKey), combatantKeys)) {
    fail('actorTurnOrdinalByCombatantKey必须完整覆盖turnOrder')
  }
  if (!combat.statusInstancesByCombatantKey || typeof combat.statusInstancesByCombatantKey !== 'object'
    || Array.isArray(combat.statusInstancesByCombatantKey)
    || !sameKeys(Object.keys(combat.statusInstancesByCombatantKey), combatantKeys)) {
    fail('statusInstancesByCombatantKey必须完整覆盖turnOrder')
  }
  for (const combatantKey of combatantKeys) {
    const ordinal = safeInteger(combat.actorTurnOrdinalByCombatantKey[combatantKey], `${combatantKey}行动序号`)
    if (ordinal < 0) fail(`${combatantKey}行动序号不能为负数`)
    const instances = combat.statusInstancesByCombatantKey[combatantKey]
    if (!Array.isArray(instances)) fail(`${combatantKey}状态实例必须是数组`)
    if (instances.some(instance => !instance || typeof instance !== 'object' || Array.isArray(instance))) {
      fail(`${combatantKey}状态实例必须是对象`)
    }
    if (new Set(instances.map(instance => instance.statusKey)).size !== instances.length) {
      fail(`${combatantKey}同一状态只能有一个实例`)
    }
    for (const instance of instances) {
      if (typeof instance.statusKey !== 'string' || !instance.statusKey) fail(`${combatantKey}状态key无效`)
      const definition = definitionFor(input.progression, instance.statusKey)
      if (typeof instance.sourceCombatantKey !== 'string' || !combatantKeys.includes(instance.sourceCombatantKey)) {
        fail(`状态来源战斗员不存在:${String(instance.sourceCombatantKey)}`)
      }
      const sourceSkill = input.progression.skills.find(skill => skill.key === instance.sourceSkillKey)
      if (!sourceSkill || sourceSkill.mechanic.kind !== 'status' || sourceSkill.mechanic.statusKey !== instance.statusKey) {
        fail(`状态来源技能不匹配:${String(instance.sourceSkillKey)}:${instance.statusKey}`)
      }
      safeInteger(instance.stacks, `${instance.statusKey}.stacks`)
      if (instance.stacks < 1 || instance.stacks > definition.maxStacks) fail(`状态叠层越界:${instance.statusKey}`)
      safeInteger(instance.appliedAtActorTurnOrdinal, `${instance.statusKey}.appliedAtActorTurnOrdinal`)
      if (instance.appliedAtActorTurnOrdinal < 0 || instance.appliedAtActorTurnOrdinal > ordinal) {
        fail(`状态施加序号无效:${instance.statusKey}`)
      }
      if (definition.duration.clock === 'combat') {
        if (instance.expiresAfterTargetTurnOrdinal !== null) fail(`整场状态不能声明回合到期点:${instance.statusKey}`)
      } else {
        const expires = safeInteger(instance.expiresAfterTargetTurnOrdinal ?? Number.NaN, `${instance.statusKey}.expiresAfterTargetTurnOrdinal`)
        if (expires !== instance.appliedAtActorTurnOrdinal + definition.duration.turns) {
          fail(`状态到期点与定义不一致:${instance.statusKey}`)
        }
      }
    }
  }
  return combat
}

export function beginTextOpenWorldCombatantTurnV2(input: {
  combat: TextOpenWorldCombatRuntimeStateV2
  progression: TextOpenWorldProgressionModuleV2
  combatantKey: string
}): TextOpenWorldCombatRuntimeStateV2 {
  validateTextOpenWorldCombatStatusStateV2(input)
  if (!(input.combatantKey in input.combat.actorTurnOrdinalByCombatantKey)) fail(`战斗员不存在:${input.combatantKey}`)
  const combat = structuredClone(input.combat)
  combat.actorTurnOrdinalByCombatantKey[input.combatantKey] = safeInteger(
    combat.actorTurnOrdinalByCombatantKey[input.combatantKey] + 1,
    `${input.combatantKey}下一行动序号`,
  )
  return validateTextOpenWorldCombatStatusStateV2({ combat, progression: input.progression })
}

export function applyTextOpenWorldCombatStatusV2(input: {
  combat: TextOpenWorldCombatRuntimeStateV2
  progression: TextOpenWorldProgressionModuleV2
  targetCombatantKey: string
  sourceCombatantKey: string
  sourceSkillKey: string
}): { combat: TextOpenWorldCombatRuntimeStateV2; outcome: TextOpenWorldCombatStatusApplyOutcomeV2 } {
  validateTextOpenWorldCombatStatusStateV2(input)
  const sourceSkill = input.progression.skills.find(skill => skill.key === input.sourceSkillKey)
  if (!sourceSkill || sourceSkill.mechanic.kind !== 'status') fail(`技能不是状态技能:${input.sourceSkillKey}`)
  if (!(input.targetCombatantKey in input.combat.statusInstancesByCombatantKey)) fail(`目标战斗员不存在:${input.targetCombatantKey}`)
  if (!(input.sourceCombatantKey in input.combat.statusInstancesByCombatantKey)) fail(`来源战斗员不存在:${input.sourceCombatantKey}`)
  const definition = definitionFor(input.progression, sourceSkill.mechanic.statusKey)
  const combat = structuredClone(input.combat)
  const instances = combat.statusInstancesByCombatantKey[input.targetCombatantKey]
  const existing = instances.find(instance => instance.statusKey === definition.key)
  const ordinal = combat.actorTurnOrdinalByCombatantKey[input.targetCombatantKey]
  const expiresAfterTargetTurnOrdinal = definition.duration.clock === 'combat'
    ? null
    : safeInteger(ordinal + definition.duration.turns, `${definition.key}到期序号`)
  if (!existing) {
    instances.push({
      statusKey: definition.key,
      sourceCombatantKey: input.sourceCombatantKey,
      sourceSkillKey: input.sourceSkillKey,
      stacks: 1,
      appliedAtActorTurnOrdinal: ordinal,
      expiresAfterTargetTurnOrdinal,
    })
    return { combat: validateTextOpenWorldCombatStatusStateV2({ combat, progression: input.progression }), outcome: 'applied' }
  }
  if (definition.reapplyPolicy === 'reject') return { combat, outcome: 'rejected' }
  if (definition.reapplyPolicy === 'stack' && existing.stacks >= definition.maxStacks) return { combat, outcome: 'max-stacks' }
  existing.sourceCombatantKey = input.sourceCombatantKey
  existing.sourceSkillKey = input.sourceSkillKey
  existing.appliedAtActorTurnOrdinal = ordinal
  existing.expiresAfterTargetTurnOrdinal = expiresAfterTargetTurnOrdinal
  if (definition.reapplyPolicy === 'stack') existing.stacks += 1
  return {
    combat: validateTextOpenWorldCombatStatusStateV2({ combat, progression: input.progression }),
    outcome: definition.reapplyPolicy === 'stack' ? 'stacked' : 'refreshed',
  }
}

/** Call after the named combatant has completed the currently begun turn. */
export function settleTextOpenWorldCombatStatusesAfterTurnV2(input: {
  combat: TextOpenWorldCombatRuntimeStateV2
  progression: TextOpenWorldProgressionModuleV2
  combatantKey: string
}): { combat: TextOpenWorldCombatRuntimeStateV2; expiredStatusKeys: string[] } {
  validateTextOpenWorldCombatStatusStateV2(input)
  const completedOrdinal = input.combat.actorTurnOrdinalByCombatantKey[input.combatantKey]
  if (!Number.isSafeInteger(completedOrdinal) || completedOrdinal < 1) fail(`战斗员尚未开始行动:${input.combatantKey}`)
  const combat = structuredClone(input.combat)
  const instances = combat.statusInstancesByCombatantKey[input.combatantKey] ?? fail(`战斗员不存在:${input.combatantKey}`)
  const expiredStatusKeys = instances
    .filter(instance => instance.expiresAfterTargetTurnOrdinal != null
      && completedOrdinal >= instance.expiresAfterTargetTurnOrdinal)
    .map(instance => instance.statusKey)
  combat.statusInstancesByCombatantKey[input.combatantKey] = instances.filter(
    instance => !expiredStatusKeys.includes(instance.statusKey),
  )
  return {
    combat: validateTextOpenWorldCombatStatusStateV2({ combat, progression: input.progression }),
    expiredStatusKeys,
  }
}

export function clearTextOpenWorldCombatStatusesAtTerminalV2(input: {
  combat: TextOpenWorldCombatRuntimeStateV2
  progression: TextOpenWorldProgressionModuleV2
}): TextOpenWorldCombatRuntimeStateV2 {
  validateTextOpenWorldCombatStatusStateV2(input)
  if (input.combat.phase !== 'terminal' || input.combat.status === 'active') fail('只能在战斗终态清空状态')
  const combat = structuredClone(input.combat)
  for (const combatantKey of combat.turnOrder) combat.statusInstancesByCombatantKey[combatantKey] = []
  return validateTextOpenWorldCombatStatusStateV2({ combat, progression: input.progression })
}

export function deriveTextOpenWorldCombatStatusModifiersV2(input: {
  combat: TextOpenWorldCombatRuntimeStateV2
  progression: TextOpenWorldProgressionModuleV2
  combatantKey: string
}): TextOpenWorldCombatModifierTotalsV2 {
  validateTextOpenWorldCombatStatusStateV2(input)
  const totals = emptyTotals()
  const instances = input.combat.statusInstancesByCombatantKey[input.combatantKey] ?? fail(`战斗员不存在:${input.combatantKey}`)
  for (const instance of instances) {
    addModifiers(totals, definitionFor(input.progression, instance.statusKey).modifiers, instance.stacks)
  }
  return totals
}

export function deriveTextOpenWorldPassiveStaticModifiersV2(input: {
  progression: TextOpenWorldProgressionModuleV2
  learnedSkillKeys: readonly string[]
}): TextOpenWorldCombatModifierTotalsV2 {
  const totals = emptyTotals()
  for (const skillKey of input.learnedSkillKeys) {
    const skill = input.progression.skills.find(candidate => candidate.key === skillKey) ?? fail(`技能不存在:${skillKey}`)
    if (skill.mechanic.kind === 'passive-static') addModifiers(totals, skill.mechanic.modifiers, 1)
  }
  return totals
}
