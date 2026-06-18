import type { Transaction } from 'dexie'
import { axesFromLegacy } from '../character/character-axes'
import type { CharacterRole } from '../types'

export const CHARACTER_AXES_SNAPSHOT_KIND = 'character-axes-pre-v33'

interface LegacyCharacterRow {
  id?: number
  projectId: number
  role?: CharacterRole
  alignment?: 'good' | 'evil'
  [key: string]: unknown
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
    Object.assign(character, axesFromLegacy(legacyRole, character.alignment))
  })
}
