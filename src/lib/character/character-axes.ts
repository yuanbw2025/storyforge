import type {
  Character,
  CharacterMoralAxis,
  CharacterOrderAxis,
  CharacterRole,
  CharacterRoleWeight,
} from '../types'

export const ROLE_WEIGHT_LABELS: Record<CharacterRoleWeight, string> = {
  main: '主要',
  secondary: '次要',
  npc: 'NPC',
  extra: '路人',
}

export const MORAL_AXIS_LABELS: Record<CharacterMoralAxis, string> = {
  good: '善良',
  neutral: '中立',
  evil: '邪恶',
}

export const ORDER_AXIS_LABELS: Record<CharacterOrderAxis, string> = {
  lawful: '守序',
  neutral: '中立',
  chaotic: '混乱',
}

export const ROLE_WEIGHTS = Object.keys(ROLE_WEIGHT_LABELS) as CharacterRoleWeight[]
export const MORAL_AXES = Object.keys(MORAL_AXIS_LABELS) as CharacterMoralAxis[]
export const ORDER_AXES = Object.keys(ORDER_AXIS_LABELS) as CharacterOrderAxis[]

const LEGACY_ROLES: CharacterRole[] = [
  'protagonist', 'antagonist', 'supporting', 'minor', 'npc', 'extra',
]

export function deriveCharacterRole(
  roleWeight: CharacterRoleWeight,
  moralAxis: CharacterMoralAxis,
): CharacterRole {
  if (roleWeight === 'secondary') return 'minor'
  if (roleWeight === 'npc') return 'npc'
  if (roleWeight === 'extra') return 'extra'
  if (moralAxis === 'good') return 'protagonist'
  if (moralAxis === 'evil') return 'antagonist'
  return 'supporting'
}

export function axesFromLegacy(
  role: CharacterRole,
  alignment?: 'good' | 'evil',
): Pick<Character, 'roleWeight' | 'moralAxis' | 'orderAxis' | 'role'> {
  const roleWeight: CharacterRoleWeight =
    role === 'protagonist' || role === 'antagonist' || role === 'supporting'
      ? 'main'
      : role === 'minor'
        ? 'secondary'
        : role
  const moralAxis: CharacterMoralAxis =
    role === 'protagonist'
      ? 'good'
      : role === 'antagonist'
        ? 'evil'
        : alignment === 'good' || alignment === 'evil'
          ? alignment
          : 'neutral'
  return { roleWeight, moralAxis, orderAxis: 'neutral', role }
}

export function isCompleteCharacterAxes(
  value: Record<string, unknown>,
): value is Record<string, unknown> & {
  roleWeight: CharacterRoleWeight
  moralAxis: CharacterMoralAxis
  orderAxis: CharacterOrderAxis
} {
  return ROLE_WEIGHTS.includes(value.roleWeight as CharacterRoleWeight)
    && MORAL_AXES.includes(value.moralAxis as CharacterMoralAxis)
    && ORDER_AXES.includes(value.orderAxis as CharacterOrderAxis)
}

/**
 * 补全角色双轴并刷新兼容 role。
 * - 完整新轴：以新轴为准派生 role。
 * - 纯旧 role：按 R1 迁移表转换。
 * - 定点更新：可传 fallback，用旧记录补齐未改动的轴。
 * - 半套新轴且无 fallback：原样返回，交给 AdoptionSchema 必填校验拒绝。
 */
export function normalizeCharacterAxes(
  value: Record<string, unknown>,
  fallback?: Record<string, unknown>,
): Record<string, unknown> {
  const combined = { ...(fallback ?? {}), ...value }
  if (isCompleteCharacterAxes(combined)) {
    return {
      ...value,
      roleWeight: combined.roleWeight,
      moralAxis: combined.moralAxis,
      orderAxis: combined.orderAxis,
      role: deriveCharacterRole(combined.roleWeight, combined.moralAxis),
    }
  }

  const hasAnyNewAxis = ['roleWeight', 'moralAxis', 'orderAxis']
    .some(field => Object.prototype.hasOwnProperty.call(value, field))
  const role = combined.role
  if (!hasAnyNewAxis && LEGACY_ROLES.includes(role as CharacterRole)) {
    return {
      ...value,
      ...axesFromLegacy(role as CharacterRole, combined.alignment as 'good' | 'evil' | undefined),
    }
  }
  return value
}

export function characterAxesLabel(
  character: Pick<Character, 'roleWeight' | 'moralAxis' | 'orderAxis'>,
): string {
  return `${ROLE_WEIGHT_LABELS[character.roleWeight]} · ${ORDER_AXIS_LABELS[character.orderAxis]}${MORAL_AXIS_LABELS[character.moralAxis]}`
}

export function moralAxisColor(moralAxis: CharacterMoralAxis): string {
  if (moralAxis === 'good') return '#22c55e'
  if (moralAxis === 'evil') return '#ef4444'
  return '#94a3b8'
}

export function filterCharactersByRoleWeight<T extends Pick<Character, 'roleWeight'>>(
  characters: T[],
  roleWeight: CharacterRoleWeight,
): T[] {
  return characters.filter(character => character.roleWeight === roleWeight)
}
