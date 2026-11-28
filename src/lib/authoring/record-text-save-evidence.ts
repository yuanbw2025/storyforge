import type { Transaction } from 'dexie'
import { db } from '../db/schema'
import { FIELD_BY_TARGET } from '../registry/field-registry'
import { hashAdoptFieldValueV1 } from '../registry/adopt'
import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import { resolveHistoryWorkAuthorScopeV1 } from '../workspace/ownership'
import type { Project, Work, WorkspaceScope } from '../types'
import type { LocalSaveAckV1, LocalSaveIntentV1, LocalSaveRecordIdentityV1, LocalSaveWitnessV1 } from './local-save-evidence'
import { DETAILED_SCENE_TASK_FIELDS, normalizeDetailedScenes } from '../types/detailed-outline'
import { decodePowerStagesStrictV1 } from '../cultivation/power-authoring-contract'
import { parseAuthorStoryStagesV1 } from '../types/story-arc'

export type RecordTextTableV1 = LocalSaveRecordIdentityV1['table']
export interface RecordTextRowV1 {
  id?: number; projectId: number; worldId?: number; workId?: number; worldGroupId?: number | null
  ragDocumentId?: string; createdAt?: number; updatedAt: number
}
const prefix = { characters: 'character', characterRelations: 'character-relation', outlineNodes: 'outline-node', detailedOutlines: 'detailed-outline', storyArcs: 'story-arc', references: 'reference', foreshadows: 'foreshadow', powerSystems: 'power-system', cultivationSystems: 'cultivation-system', chapters: 'chapter', notes: null } as const
const sceneTexts = ['title', 'summary', 'location', 'conflict', 'notes', ...DETAILED_SCENE_TASK_FIELDS.map(({ key }) => key)]
const stageTexts = ['title', 'description', 'turningPoint']
const cultivationTexts = ['name', 'features', 'breakthrough', 'branchLabel']
export const recordTextWitnessKeyV1 = (field: string, entryId?: string) => entryId === undefined ? field : JSON.stringify([field, entryId])
function validAddress(identity: LocalSaveRecordIdentityV1) {
  if (identity.table === 'notes') return identity.field === 'content' && identity.entryId === undefined
    && Number.isSafeInteger(identity.recordCreatedAt) && identity.recordCreatedAt! > 0
  if (identity.entryId === undefined) return recordAuthorTextFieldsV1(identity.table).includes(identity.field)
  if (typeof identity.entryId !== 'string' || !identity.entryId.trim()) return false
  return identity.table === 'detailedOutlines' ? sceneTexts.some(field => identity.field === `scenes.${field}`)
    : identity.table === 'storyArcs' ? stageTexts.some(field => identity.field === `stages.${field}`)
      : identity.table === 'cultivationSystems' && cultivationTexts.some(field => identity.field === `stages.${field}`)
}
function addressedValue(row: RecordTextRowV1, identity: LocalSaveRecordIdentityV1): { value: unknown; present: boolean } {
  let target: object = row, field = identity.field
  if (identity.entryId !== undefined) {
    const entries = identity.table === 'detailedOutlines'
      ? normalizeDetailedScenes(Reflect.get(row, 'scenes')).map(scene => ({ id: scene.sceneId, item: scene }))
      : identity.table === 'storyArcs' ? parseAuthorStoryStagesV1(Reflect.get(row, 'stages')).map(stage => ({ id: stage.id, item: stage }))
        : decodePowerStagesStrictV1(Reflect.get(row, 'stages')).map(stage => ({ id: stage.id, item: stage }))
    const entry = entries.find(item => item.id === identity.entryId)
    if (!entry) throw new Error('原场景或阶段已删除，输入已保留。')
    target = entry.item; field = identity.field.slice(identity.field.indexOf('.') + 1)
  }
  return { value: Reflect.get(target, field), present: Object.prototype.hasOwnProperty.call(target, field) }
}
export function recordAuthorTextFieldsV1(table: RecordTextTableV1) {
  // Existing manual-only Work notes are not an additional AI writable field.
  if (table === 'notes') return ['content']
  return (FIELD_BY_TARGET.get(table) ?? []).filter(spec => !spec.adoptionPolicy && !spec.field.startsWith('statusProducer')
    && (table !== 'references' || spec.field === 'note')
    && (table !== 'chapters' || spec.field === 'notes')
    && (['string', 'longtext'].includes(spec.type) || (table === 'powerSystems' && spec.textReplacement?.codec === 'text-or-json'))).map(spec => spec.field)
}
export function recordTextSaveRequestV1(table: RecordTextTableV1, id: number, patch: Record<string, unknown>,
  scope: WorkspaceScope | undefined, intent: LocalSaveIntentV1) {
  const expected = intent?.expected, identity = expected?.identity as LocalSaveRecordIdentityV1 | undefined
  if (intent?.kind !== 'natural-field-local-save-v1' || !intent.session || !Number.isSafeInteger(intent.generation) || intent.generation < 0
    || !identity || identity.table !== table || identity.recordId !== id || expected.recordId !== id || expected.version !== 1
    || !['database-read', 'committed-write'].includes(expected.source) || !scope || identity.projectId !== scope.projectId
    || identity.worldId !== scope.worldId || identity.workId !== scope.workId || !validAddress(identity)
    || Object.keys(patch).length !== 1 || typeof patch[identity.entryId === undefined ? identity.field : identity.field.split('.')[1]] !== 'string') throw new Error('文字保存字段或记录凭据无效。')
  return { identity, raw: patch[identity.entryId === undefined ? identity.field : identity.field.split('.')[1]] as string }
}
async function buildWitness(row: RecordTextRowV1 | undefined, identity: LocalSaveRecordIdentityV1,
  source: LocalSaveWitnessV1['source'], selected?: object): Promise<LocalSaveWitnessV1> {
  if (!row || row.id !== identity.recordId || row.projectId !== identity.projectId
    || (['characters', 'characterRelations', 'powerSystems', 'cultivationSystems'].includes(identity.table) ? row.worldId !== identity.worldId : row.workId !== identity.workId)
    || (identity.table !== 'characters' && (row.worldGroupId ?? null) !== identity.worldGroupId)
    || !validAddress(identity) || (identity.table === 'notes' ? row.createdAt !== identity.recordCreatedAt
      : !isPortableResourceUidV1(row.ragDocumentId, prefix[identity.table]!)))
    throw new Error('文字记录已删除、归属或身份变化，不能确认本机保存。')
  const leaf = identity.field.slice(identity.field.indexOf('.') + 1)
  const { value, present } = selected ? { value: Reflect.get(selected, leaf), present: Object.prototype.hasOwnProperty.call(selected, leaf) } : addressedValue(row, identity)
  if (value !== undefined && typeof value !== 'string') throw new Error('文字字段格式异常，不能确认本机保存。')
  return { version: 1, source, identity: { ...identity }, recordId: row.id!, resourceUid: identity.table === 'notes' ? null : row.ragDocumentId!,
    value: value as string | undefined, present,
    valueHash: await hashAdoptFieldValueV1(value), confirmedAt: Date.now() }
}
export function recordTextWitnessV1(row: RecordTextRowV1 | undefined, identity: LocalSaveRecordIdentityV1,
  source: LocalSaveWitnessV1['source']): Promise<LocalSaveWitnessV1> {
  return buildWitness(row, identity, source)
}
export async function assertRecordTextSaveExpectedV1(row: RecordTextRowV1 | undefined, intent: LocalSaveIntentV1, transaction: Transaction) {
  const identity = intent.expected.identity as LocalSaveRecordIdentityV1
  await resolveHistoryWorkAuthorScopeV1({ projectId: identity.projectId, worldId: identity.worldId, workId: identity.workId }, transaction)
  const [project, work] = await Promise.all([transaction.table<Project, number>('projects').get(identity.projectId), transaction.table<Work, number>('works').get(identity.workId)])
  if (project?.workspacePurpose !== 'independent-work' || work?.kind !== 'novel' || work.novelProfile !== 'long') throw new Error('文字保存确认仅开放独立长篇。')
  const actual = await recordTextWitnessV1(row, identity, 'database-read'), expected = intent.expected
  if (actual.resourceUid !== expected.resourceUid || actual.present !== expected.present || actual.value !== expected.value
    || actual.valueHash !== expected.valueHash) throw new Error('文字字段已被修改，当前输入已保留，请核对后保存。')
}
export async function recordTextSaveAckV1(row: RecordTextRowV1 | undefined, intent: LocalSaveIntentV1, raw: string): Promise<LocalSaveAckV1> {
  const witness = await recordTextWitnessV1(row, intent.expected.identity as LocalSaveRecordIdentityV1, 'committed-write')
  if (witness.resourceUid !== intent.expected.resourceUid || witness.value !== raw || !witness.present)
    throw new Error('保存后未读到相同身份与原文，输入已保留。')
  return { kind: 'natural-field-local-save-ack-v1', session: intent.session, generation: intent.generation, witness }
}
export async function readRecordTextWitnessesV1(table: RecordTextTableV1, id: number, scope: WorkspaceScope) {
  await resolveHistoryWorkAuthorScopeV1(scope)
  const row = await db.table<RecordTextRowV1, number>(table).get(id)
  const witnesses: Record<string, LocalSaveWitnessV1> = {}
  const addresses: { field: string; entryId?: string; selected?: object }[] = recordAuthorTextFieldsV1(table).map(field => ({ field }))
  try {
    if (row && table === 'detailedOutlines') addresses.push(...normalizeDetailedScenes(Reflect.get(row, 'scenes')).flatMap(scene => sceneTexts.map(field => ({ field: `scenes.${field}`, entryId: scene.sceneId, selected: scene }))))
    if (row && table === 'cultivationSystems') addresses.push(...decodePowerStagesStrictV1(Reflect.get(row, 'stages')).flatMap(stage => cultivationTexts.map(field => ({ field: `stages.${field}`, entryId: stage.id, selected: stage }))))
    if (row && table === 'storyArcs') addresses.push(...parseAuthorStoryStagesV1(Reflect.get(row, 'stages')).flatMap(stage => stageTexts.map(field => ({ field: `stages.${field}`, entryId: stage.id, selected: stage }))))
  } catch { /* Damaged nested data stays unconfirmed, without hiding valid scalar fields. */ }
  for (const { selected, ...address } of addresses) {
    const identity: LocalSaveRecordIdentityV1 = { ...scope, table, ...address, recordId: id, worldGroupId: table !== 'characters' ? row?.worldGroupId ?? null : null,
      ...(table === 'notes' ? { recordCreatedAt: row?.createdAt } : {}) }
    try { witnesses[recordTextWitnessKeyV1(address.field, address.entryId)] = await buildWitness(row, identity, 'database-read', selected) }
    catch { /* A malformed field remains unknown; other fields retain their own evidence. */ }
  }
  return witnesses
}
