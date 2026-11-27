import { validateCultivationStages, type CultivationStage, type CultivationSystem } from '../types/cultivation'
import type { Worldview, PowerSystem } from '../types/worldview'
import type { WorkspaceScope } from '../types/world-ownership'

/** A1 pure preparation only. Does not perform CAS, adoption, reference checks or
 * writes. A future registered caller must re-read and validate inside its
 * adoption transaction; this result is neither authorization nor a receipt. */
export type PowerAuthoringScopeV1 = WorkspaceScope & { worldGroupId: number | null }
type DetailField = 'name' | 'description' | 'levels' | 'rules'
type PathField = 'name' | 'description'
export type PowerStageFieldV1 = 'name' | 'features' | 'breakthrough' | 'parentStageIds' | 'branchLabel' | 'tier'
export type PowerAuthoringTargetV1 =
  | { table: 'worldviews'; recordId: number; field: 'powerHierarchy' }
  | { table: 'powerSystems'; recordId: number; field: DetailField }
  | { table: 'cultivationSystems'; recordId: number; field: PathField }
  | { table: 'cultivationSystems'; recordId: number; field: 'stages'; stageId?: never; stageField?: never }
  | { table: 'cultivationSystems'; recordId: number; field: 'stages'; stageId: string; stageField: PowerStageFieldV1 }
export type PowerAuthoringSnapshotV1 =
  | { table: 'worldviews'; record: Worldview & { worldId: number } }
  | { table: 'powerSystems'; record: PowerSystem & { worldId: number } }
  | { table: 'cultivationSystems'; record: CultivationSystem & { worldId: number } }

/** Explicit operations, never a replacement array inferred from stage names. */
export interface PowerPathPlanV1 {
  version: 1
  updates: Array<{ id: string; patch: Partial<Pick<CultivationStage, PowerStageFieldV1>> }>
  additions: CultivationStage[]
  removals: string[]
}
export interface PreparedPowerAuthoringEditV1 {
  target: PowerAuthoringTargetV1
  patch: Record<string, string>
  /** A future adopter must check actual references and confirmed impact. */
  removedStageIds: string[]
}

const stageFields: readonly string[] = ['name', 'features', 'breakthrough', 'parentStageIds', 'branchLabel', 'tier']
const textFields = {
  worldviews: ['powerHierarchy'],
  powerSystems: ['name', 'description', 'levels', 'rules'],
  cultivationSystems: ['name', 'description'],
} as const
function own(value: object, field: PropertyKey): boolean { return Object.prototype.hasOwnProperty.call(value, field) }
function fail(message: string): never { throw new Error(`[PowerAuthoring] ${message}`) }
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be an object`)
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(`${label} contains an unknown field`)
}
function positiveId(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) fail(`${label} must be a positive ID`)
}
function stageId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) fail('stage ID must be a nonempty string')
}
function stageFieldValue(field: string, value: unknown): void {
  if (field === 'parentStageIds') {
    if (!Array.isArray(value)) fail('parentStageIds must be an ID array')
    value.forEach(stageId)
    if (new Set(value).size !== value.length) fail('duplicate parent stage ID')
  } else if (field === 'tier') {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('tier must be finite')
  } else if (typeof value !== 'string' || (field === 'name' && !value.trim())) {
    fail(`${field} must be ${field === 'name' ? 'nonempty ' : ''}text`)
  }
}
function assertStage(value: unknown, allowExistingExtraFields: boolean): asserts value is CultivationStage {
  const row = object(value, 'stage')
  if (!allowExistingExtraFields) keys(row, ['id', ...stageFields], 'new stage')
  stageId(row.id)
  stageFieldValue('name', row.name)
  stageFieldValue('parentStageIds', row.parentStageIds)
  for (const key of stageFields) {
    if (key !== 'name' && key !== 'parentStageIds' && own(row, key)) stageFieldValue(key, row[key])
  }
}

// Compare decimal values, allowing equivalent spellings such as 1.25e2/125.
// Do not compare through Number: that would hide rounding and underflow.
function decimalValue(token: string): string {
  const [mantissa, exponent = '0'] = token.toLowerCase().split('e')
  const fractionLength = mantissa.includes('.') ? mantissa.length - mantissa.indexOf('.') - 1 : 0
  const digits = mantissa.replace(/[-.]/g, '').replace(/^0+/, '')
  if (!digits) return '0'
  const coefficient = digits.replace(/0+$/, '')
  const power = BigInt(exponent) - BigInt(fractionLength) + BigInt(digits.length - coefficient.length)
  return `${mantissa.startsWith('-') ? '-' : ''}${coefficient}e${power}`
}

/** JSON.parse has already checked syntax. Inspect only unquoted numeric tokens
 * before any stringify can silently change unrelated author data. */
function assertNumericRoundTrip(raw: string): void {
  const numberToken = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
  let inString = false
  let escaped = false
  for (let index = 0; index < raw.length; index++) {
    const character = raw[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') { inString = true; continue }
    if (character !== '-' && !/\d/.test(character)) continue
    numberToken.lastIndex = index
    const token = numberToken.exec(raw)![0]
    const value = Number(token)
    if (!Number.isFinite(value) || Object.is(value, -0)
      || decimalValue(token) !== decimalValue(JSON.stringify(value))) {
      fail('stages contains a number that cannot round-trip without information loss; preserve raw JSON')
    }
    index += token.length - 1
  }
}

/** JSON errors and malformed rows fail closed, leaving the author's raw string
 * untouched. Existing unknown JSON properties survive exact field edits. */
export function decodePowerStagesStrictV1(raw: unknown): CultivationStage[] {
  if (typeof raw !== 'string') fail('stages must be saved JSON text')
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { fail('stages contains invalid JSON') }
  if (!Array.isArray(parsed)) fail('stages JSON must be an array')
  assertNumericRoundTrip(raw)
  parsed.forEach(stage => assertStage(stage, true))
  const validation = validateCultivationStages(parsed)
  if (!validation.valid) fail(validation.errors.join('; '))
  return parsed
}

function assertTarget(scope: PowerAuthoringScopeV1, target: PowerAuthoringTargetV1, snapshot: PowerAuthoringSnapshotV1): void {
  const scopeRow = object(scope, 'scope')
  keys(scopeRow, ['projectId', 'worldId', 'workId', 'worldGroupId'], 'scope')
  for (const field of ['projectId', 'worldId', 'workId']) positiveId(scopeRow[field], field)
  // undefined is an all-world read, never single-world write permission.
  if (scope.worldGroupId !== null) positiveId(scope.worldGroupId, 'worldGroupId')
  const targetRow = object(target, 'target')
  const isStage = own(targetRow, 'stageId') || own(targetRow, 'stageField')
  keys(targetRow, ['table', 'recordId', 'field', ...(isStage ? ['stageId', 'stageField'] : [])], 'target')
  positiveId(target.recordId, 'recordId')
  if (snapshot.table !== target.table || !own(textFields, target.table)) fail('snapshot table mismatch')
  const row = object(snapshot.record, 'record')
  positiveId(row.id, 'saved record ID')
  if (row.id !== target.recordId || row.projectId !== scope.projectId || row.worldId !== scope.worldId
    || (row.worldGroupId ?? null) !== scope.worldGroupId) fail('record scope or ID mismatch')
  if (target.table === 'cultivationSystems' && target.field === 'stages') {
    if (isStage) {
      stageId(targetRow.stageId)
      if (typeof targetRow.stageField !== 'string' || !stageFields.includes(targetRow.stageField)) fail('unknown stage field')
    }
  } else if (isStage || !(textFields[target.table] as readonly string[]).includes(target.field)) {
    fail('unknown target field')
  }
}

function applyPathPlan(stages: CultivationStage[], value: unknown, allocatedIds: readonly string[]): CultivationStage[] {
  const plan = object(value, 'path plan')
  keys(plan, ['version', 'updates', 'additions', 'removals'], 'path plan')
  if (plan.version !== 1 || !Array.isArray(plan.updates) || !Array.isArray(plan.additions) || !Array.isArray(plan.removals)) {
    fail('invalid path plan version or operations')
  }
  const existingIds = new Set(stages.map(stage => stage.id))
  allocatedIds.forEach(stageId)
  const allocated = new Set(allocatedIds)
  if (allocated.size !== allocatedIds.length || allocatedIds.some(id => existingIds.has(id))) fail('invalid allocated stage IDs')
  const touched = new Set<string>()
  const removed = new Set<string>()
  const patches = new Map<string, Record<string, unknown>>()
  const touchExisting = (id: unknown): string => {
    stageId(id)
    if (!existingIds.has(id)) fail('operation targets an unknown stage ID')
    if (touched.has(id)) fail('duplicate or conflicting stage operations')
    touched.add(id)
    return id
  }
  for (const update of plan.updates) {
    const row = object(update, 'stage update')
    keys(row, ['id', 'patch'], 'stage update')
    const id = touchExisting(row.id)
    const patch = object(row.patch, 'stage patch')
    keys(patch, stageFields, 'stage patch')
    if (!Object.keys(patch).length) fail('stage patch is empty')
    for (const [field, fieldValue] of Object.entries(patch)) stageFieldValue(field, fieldValue)
    patches.set(id, structuredClone(patch))
  }
  for (const id of plan.removals) removed.add(touchExisting(id))
  const additions: CultivationStage[] = []
  for (const stage of plan.additions) {
    assertStage(stage, false)
    if (!allocated.has(stage.id) || existingIds.has(stage.id) || touched.has(stage.id)) fail('new stage ID was not uniquely preallocated')
    touched.add(stage.id)
    additions.push(structuredClone(stage))
  }
  return [...stages.filter(stage => !removed.has(stage.id)).map(stage => ({ ...stage, ...patches.get(stage.id) })), ...additions]
}

export function preparePowerAuthoringEditV1(input: {
  scope: PowerAuthoringScopeV1
  target: PowerAuthoringTargetV1
  snapshot: PowerAuthoringSnapshotV1
  value: unknown
  /** Supplied by the deterministic caller, never accepted from a model plan. */
  allocatedStageIds?: readonly string[]
}): PreparedPowerAuthoringEditV1 {
  const { scope, target, snapshot, value } = input
  assertTarget(scope, target, snapshot)
  const record = snapshot.record as unknown as Record<string, unknown>
  const result = (patch: Record<string, string>, removedStageIds: string[] = []): PreparedPowerAuthoringEditV1 => ({
    target: structuredClone(target), patch, removedStageIds,
  })
  if (target.table !== 'cultivationSystems' || target.field !== 'stages') {
    if (record[target.field] !== undefined && typeof record[target.field] !== 'string') fail('saved field is not text; preserve it for repair')
    if (typeof value !== 'string') fail('field candidate must be text')
    return result({ [target.field]: value })
  }
  const before = decodePowerStagesStrictV1(record.stages)
  let next: CultivationStage[]
  if (target.stageId !== undefined) {
    const selected = before.find(stage => stage.id === target.stageId)
    if (!selected) fail('unknown target stage ID')
    stageFieldValue(target.stageField, value)
    next = before.map(stage => stage.id === selected.id ? { ...stage, [target.stageField]: structuredClone(value) } : stage)
  } else {
    next = applyPathPlan(before, value, input.allocatedStageIds ?? [])
  }
  // Validate the whole resulting graph; never detach dangling edges implicitly.
  const serialized = JSON.stringify(next)
  const validated = decodePowerStagesStrictV1(serialized)
  const nextIds = new Set(validated.map(stage => stage.id))
  return result({ stages: serialized }, before.filter(stage => !nextIds.has(stage.id)).map(stage => stage.id))
}
