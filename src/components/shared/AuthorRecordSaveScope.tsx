import { createContext, useContext, useEffect, useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import { readRecordTextWitnessesV1, recordTextWitnessKeyV1, type RecordTextTableV1 } from '../../lib/authoring/record-text-save-evidence'
import type { LocalSaveContractV1, LocalSaveWitnessV1 } from '../../lib/authoring/local-save-evidence'

export const AuthorRecordSaveScopeV1 = createContext<WorkspaceScope | null>(null)

/** One native row read per displayed record; drafts and writes stay in their original consumers. */
export function useAuthorRecordSavesV1(table: RecordTextTableV1, row?: { id?: number; projectId?: number; updatedAt?: number } | null) {
  const scope = useContext(AuthorRecordSaveScopeV1)
  const projectId = scope?.projectId, worldId = scope?.worldId, workId = scope?.workId
  const key = scope && row?.id != null && (row.projectId == null || row.projectId === scope.projectId)
    ? JSON.stringify([scope.projectId, scope.worldId, scope.workId, table, row.id]) : null
  const [state, setState] = useState<{ key: string; witnesses: Record<string, LocalSaveWitnessV1> } | null>(null)
  useEffect(() => {
    if (!key || projectId == null || worldId == null || workId == null || row?.id == null) return
    let active = true
    void readRecordTextWitnessesV1(table, row.id, { projectId, worldId, workId }).then(witnesses => {
      if (active) setState({ key, witnesses })
    }).catch(() => { if (active) setState({ key, witnesses: {} }) })
    return () => { active = false }
  }, [key, projectId, worldId, workId, table, row?.id, row?.updatedAt])
  return (field: string, entryId?: string): LocalSaveContractV1 | undefined => {
    const witness = state?.key === key ? state.witnesses[recordTextWitnessKeyV1(field, entryId)] : undefined
    return witness ? { identity: witness.identity, witness } : undefined
  }
}
