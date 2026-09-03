import type { Transaction } from 'dexie'
import type { Character, CharacterMoralAxis, CharacterRole, CharacterRoleWeight } from '../types'

export const CHARACTER_AXES_SNAPSHOT_KIND = 'character-axes-pre-v33'

interface LegacyCharacterRow {
  id?: number
  projectId: number
  role?: CharacterRole
  alignment?: 'good' | 'evil'
  [key: string]: unknown
}

export function axesFromCharacterRoleV32(
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

/** Import-boundary conversion for backups written before schema v33. */
export function upgradeImportedCharacterAxesV32(
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (['roleWeight', 'moralAxis', 'orderAxis'].every(key => typeof row[key] === 'string')) return row
  const role: CharacterRole =
    row.role === 'protagonist' || row.role === 'antagonist' || row.role === 'supporting'
    || row.role === 'minor' || row.role === 'npc' || row.role === 'extra'
      ? row.role
      : 'extra'
  return { ...row, ...axesFromCharacterRoleV32(role, row.alignment as 'good' | 'evil' | undefined) }
}

/** v32 → v33：先保存受影响的旧角色行，再只增量补三轴，不删除任何字段。 */
export async function migrateCharactersToAxes(tx: Transaction): Promise<void> {
  const characters = await tx.table('characters').toArray() as LegacyCharacterRow[]
  const byProject = new Map<number, LegacyCharacterRow[]>()
  for (const character of characters) {
    const rows = byProject.get(character.projectId) ?? []
    rows.push(character)
    byProject.set(character.projectId, rows)
  }

  const now = Date.now()
  for (const [projectId, rows] of byProject) {
    const marker = JSON.stringify({
      kind: CHARACTER_AXES_SNAPSHOT_KIND,
      schemaVersion: 32,
      characters: rows,
    })
    await tx.table('snapshots').add({
      projectId,
      label: 'R1 角色轴迁移前自动快照',
      type: 'auto',
      data: marker,
      size: marker.length,
      createdAt: now,
    })
  }

  await tx.table('characters').toCollection().modify((character: LegacyCharacterRow) => {
    const legacyRole: CharacterRole =
      character.role === 'protagonist'
      || character.role === 'antagonist'
      || character.role === 'supporting'
      || character.role === 'minor'
      || character.role === 'npc'
      || character.role === 'extra'
        ? character.role
        : 'extra'
    Object.assign(character, axesFromCharacterRoleV32(legacyRole, character.alignment))
  })
}
