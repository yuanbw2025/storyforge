import type { Transaction } from 'dexie'
import { db } from '../db/schema'
import { remapNarrativeDomainReferencesV1 } from '../narrative-domain/lifecycle'
import {
  cultivationLifecycleTableV1,
  detachCultivationProgressSystems,
  refreshCultivationProgressStageSources,
  verifyCultivationReferencePatchV1,
} from './progress-lifecycle'

/** 必须在 transactionTablesForReferences('cultivationSystems') 的 rw 事务中调用。 */
export async function clearCultivationSystemReferences(
  projectId: number,
  systemIds: ReadonlySet<number>,
): Promise<void> {
  if (systemIds.size === 0) return
  for (const id of systemIds) await remapNarrativeDomainReferencesV1({ table: 'cultivationSystems', fromId: id })
  const [characters, entries, facts] = await Promise.all([
    db.characters.where('projectId').equals(projectId).toArray(),
    db.codexEntries.where('projectId').equals(projectId).toArray(),
    db.temporalFacts.where('projectId').equals(projectId).toArray(),
  ])
  for (const character of characters) {
    if (character.id != null && character.cultivationSystemId != null
      && systemIds.has(character.cultivationSystemId)) {
      await db.characters.update(character.id, {
        cultivationSystemId: null,
        cultivationStageId: null,
        updatedAt: Date.now(),
      })
    }
  }
  for (const entry of entries) {
    if (entry.id != null && entry.cultivationSystemId != null
      && systemIds.has(entry.cultivationSystemId)) {
      await db.codexEntries.update(entry.id, {
        cultivationSystemId: null,
        cultivationStageId: null,
        updatedAt: Date.now(),
      })
    }
  }
  for (const fact of facts) {
    if (fact.id != null && fact.sourceCultivationSystemId != null
      && systemIds.has(fact.sourceCultivationSystemId)) {
      await db.temporalFacts.update(fact.id, {
        sourceCultivationSystemId: null,
        status: fact.status === 'rejected' || fact.status === 'superseded'
          ? fact.status
          : 'source-missing',
        updatedAt: Date.now(),
      })
    }
  }
  await detachCultivationProgressSystems(projectId, systemIds)
}

/** 阶段从图谱删除时，只清该阶段引用，保留仍有效的体系关联。 */
export async function clearRemovedCultivationStageReferences(
  projectId: number,
  systemId: number,
  removedStageIds: ReadonlySet<string>,
  transaction?: Transaction,
): Promise<void> {
  if (removedStageIds.size === 0) return
  const characterTable = cultivationLifecycleTableV1(db.characters, transaction), entryTable = cultivationLifecycleTableV1(db.codexEntries, transaction)
  const updateCharacter = db.characters.update.bind(characterTable), updateEntry = db.codexEntries.update.bind(entryTable)
  const [characters, entries] = await Promise.all([
    characterTable.where('projectId').equals(projectId).toArray(),
    entryTable.where('projectId').equals(projectId).toArray(),
  ])
  for (const character of characters) {
    if (character.id != null && character.cultivationSystemId === systemId
      && character.cultivationStageId && removedStageIds.has(character.cultivationStageId)) {
      const patch = { cultivationStageId: null, updatedAt: Date.now() }
      await verifyCultivationReferencePatchV1(characterTable, character, patch, await updateCharacter(character.id, patch))
    }
  }
  for (const entry of entries) {
    if (entry.id != null && entry.cultivationSystemId === systemId
      && entry.cultivationStageId && removedStageIds.has(entry.cultivationStageId)) {
      const patch = { cultivationStageId: null, updatedAt: Date.now() }
      await verifyCultivationReferencePatchV1(entryTable, entry, patch, await updateEntry(entry.id, patch))
    }
  }
}

export { refreshCultivationProgressStageSources }
