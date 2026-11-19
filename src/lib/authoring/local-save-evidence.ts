import type { WorkspaceScope } from '../types'

/** Deliberately limited to the independently owned long novel's Natural fields. */
export const LOCAL_SAVE_NATURAL_FIELDS_V1 = [
  'worldStructure', 'worldDimensions', 'continentLayout', 'mountainsRivers', 'climateByRegion',
] as const
export type LocalSaveNaturalFieldV1 = typeof LOCAL_SAVE_NATURAL_FIELDS_V1[number]
export interface LocalSaveIdentityV1 extends WorkspaceScope {
  table: 'worldviews'
  field: LocalSaveNaturalFieldV1
  worldGroupId: number | null
}
export interface LocalSaveWitnessV1 {
  version: 1
  source: 'database-read' | 'committed-write'
  identity: LocalSaveIdentityV1
  recordId: number | null
  resourceUid: string | null
  present: boolean
  value: string | undefined
  valueHash: string
  confirmedAt: number
}
export interface LocalSaveIntentV1 {
  kind: 'natural-field-local-save-v1'
  expected: LocalSaveWitnessV1
  session: string
  generation: number
}
export interface LocalSaveAckV1 {
  kind: 'natural-field-local-save-ack-v1'
  session: string
  generation: number
  witness: LocalSaveWitnessV1
}
export interface LocalSaveContractV1 {
  identity: LocalSaveIdentityV1
  witness: LocalSaveWitnessV1 | null
}
export function localSaveIdentityKeyV1(identity: LocalSaveIdentityV1): string {
  return JSON.stringify([identity.projectId, identity.worldId, identity.workId,
    identity.worldGroupId, identity.table, identity.field])
}
export function matchingLocalSaveAckV1(ack: unknown, intent: LocalSaveIntentV1, raw: string): ack is LocalSaveAckV1 {
  const value = ack as LocalSaveAckV1 | undefined
  return value?.kind === 'natural-field-local-save-ack-v1' && value.session === intent.session
    && value.generation === intent.generation && value.witness?.source === 'committed-write'
    && value.witness.version === 1 && value.witness.recordId != null && value.witness.resourceUid != null
    && value.witness.present && value.witness.value === raw && typeof value.witness.valueHash === 'string'
    && value.witness.valueHash.length > 0
    && localSaveIdentityKeyV1(value.witness.identity) === localSaveIdentityKeyV1(intent.expected.identity)
    && (intent.expected.recordId == null || (value.witness.recordId === intent.expected.recordId
      && value.witness.resourceUid === intent.expected.resourceUid))
}
