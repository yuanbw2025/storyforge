import type { WorkspaceScope } from '../types'

/** Initial verified consumers; retained for existing N5 callers and receipts. */
export const LOCAL_SAVE_NATURAL_FIELDS_V1 = [
  'worldStructure', 'worldDimensions', 'continentLayout', 'mountainsRivers', 'climateByRegion',
] as const
export type LocalSaveNaturalFieldV1 = typeof LOCAL_SAVE_NATURAL_FIELDS_V1[number]
/** Explicit scalar text whitelist for the same independent-longform writer.
 * Nested leaves are admitted separately below, never as an entire object. */
export const LOCAL_SAVE_WORLDVIEW_TEXT_FIELDS_V1 = [
  ...LOCAL_SAVE_NATURAL_FIELDS_V1, 'worldOrigin', 'powerHierarchy', 'races',
  'factionLayout', 'regionDimensions', 'politicsOverview', 'economyOverview',
  'cultureOverview', 'internalConflicts', 'itemDesign',
] as const
export type LocalSaveWorldviewTextFieldV1 = typeof LOCAL_SAVE_WORLDVIEW_TEXT_FIELDS_V1[number]
export const LOCAL_SAVE_WORLDVIEW_LEAF_FIELDS_V1 = [
  'divineDesign.divineRank', 'divineDesign.divineNames', 'divineDesign.divineRules',
  'naturalResources.rareCreatures', 'naturalResources.herbs', 'naturalResources.minerals', 'naturalResources.others',
] as const
export const LOCAL_SAVE_WORLDVIEW_FIELDS_V1 = [...LOCAL_SAVE_WORLDVIEW_TEXT_FIELDS_V1, ...LOCAL_SAVE_WORLDVIEW_LEAF_FIELDS_V1] as const
export type LocalSaveWorldviewFieldV1 = typeof LOCAL_SAVE_WORLDVIEW_FIELDS_V1[number]
export const LOCAL_SAVE_STORY_CORE_FIELDS_V1 = [
  'logline', 'concept', 'theme', 'centralConflict', 'plotPattern', 'mainPlot', 'subPlots',
] as const
export type LocalSaveStoryCoreFieldV1 = typeof LOCAL_SAVE_STORY_CORE_FIELDS_V1[number]
export const LOCAL_SAVE_CREATIVE_RULE_FIELDS_V1 = ['writingStyle', 'atmosphere', 'specialRequirements'] as const
export type LocalSaveCreativeRuleFieldV1 = typeof LOCAL_SAVE_CREATIVE_RULE_FIELDS_V1[number]
interface LocalSaveWorldviewIdentityV1 extends WorkspaceScope {
  table: 'worldviews'
  field: LocalSaveWorldviewFieldV1
  worldGroupId: number | null
}
interface LocalSaveStoryCoreIdentityV1 extends WorkspaceScope {
  table: 'storyCores'
  field: LocalSaveStoryCoreFieldV1
  worldGroupId: null
}
interface LocalSaveCreativeRuleIdentityV1 extends WorkspaceScope {
  table: 'creativeRules'
  field: LocalSaveCreativeRuleFieldV1
  worldGroupId: null
}
export type LocalSaveHistoryIdentityV1 = WorkspaceScope & { worldGroupId: number | null } & (
  | { table: 'histories'; field: 'overview' | 'eraSystem' }
  | { table: 'historicalTimelineEvents' | 'historicalKeywords'; field: 'description' | 'conceptNote'; recordId: number }
)
export interface LocalSaveRecordIdentityV1 extends WorkspaceScope {
  table: 'characters' | 'outlineNodes' | 'detailedOutlines' | 'storyArcs' | 'references' | 'foreshadows' | 'powerSystems' | 'cultivationSystems' | 'chapters'
  field: string
  recordId: number
  worldGroupId: number | null
  /** Stable scene/stage identity, never its mutable position in an array. */
  entryId?: string
}
export type LocalSaveIdentityV1 = LocalSaveWorldviewIdentityV1 | LocalSaveStoryCoreIdentityV1 | LocalSaveCreativeRuleIdentityV1 | LocalSaveHistoryIdentityV1 | LocalSaveRecordIdentityV1
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
    identity.worldGroupId, identity.table, identity.field,
    ...('recordId' in identity ? [identity.recordId] : []),
    ...('entryId' in identity ? [identity.entryId] : [])])
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
