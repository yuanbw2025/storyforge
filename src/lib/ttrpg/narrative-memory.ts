import type { TtrpgOpenAudience } from './open-contract'
import * as p from './open-contract-parse'

export type TtrpgNarrativeMemoryReliabilityV1 = 'observed' | 'hearsay' | 'belief'
export type TtrpgNarrativeMemoryAudienceV1 = TtrpgOpenAudience

export interface TtrpgNarrativeMemoryV1 {
  id?: number
  projectId: number
  worldGroupId: number | null
  worldId: number
  workId: number
  sessionId: number
  revisionKey: string
  observerKey: string | null
  reliability: TtrpgNarrativeMemoryReliabilityV1
  audience: TtrpgNarrativeMemoryAudienceV1
  knownBy: string[]
  summary: string
  fromEventSequence: number
  toEventSequence: number
  sourceSessionId: number | null
  derivedFromHash: string
  stale: boolean
  updatedAt: number
}

export interface TtrpgNarrativeMemoryViewerV1 {
  audience?: TtrpgNarrativeMemoryAudienceV1
  actorKey?: string | null
  observerKey?: string | null
  sessionId?: number
  revisionKey?: string
  fromEventSequence?: number
  toEventSequence?: number
  eventSequence?: number
  currentEventSequence?: number
  throughSequence?: number
  derivedFromHash?: string
  sourceLineageHash?: string
}

export interface TtrpgNarrativeMemoryMarkStaleOptionsV1 {
  throughSequence?: number
  checkpointSequence?: number
  eventSequence?: number
  currentEventSequence?: number
  derivedFromHash?: string
  sourceLineageHash?: string
  updatedAt?: number
}

export interface TtrpgNarrativeMemoryBranchCloneInputV1 {
  memories: readonly unknown[]
  childSessionId: number
  throughSequence: number
}

const MEMORY_FIELDS = [
  'projectId',
  'worldGroupId',
  'worldId',
  'workId',
  'sessionId',
  'revisionKey',
  'observerKey',
  'reliability',
  'audience',
  'knownBy',
  'summary',
  'fromEventSequence',
  'toEventSequence',
  'sourceSessionId',
  'derivedFromHash',
  'stale',
  'updatedAt',
] as const

const MEMORY_FIELDS_WITH_ID = ['id', ...MEMORY_FIELDS] as const
const RELIABILITIES = ['observed', 'hearsay', 'belief'] as const
const AUDIENCES = ['gm-only', 'party', 'private', 'public'] as const
const AUDIENCE_RANK: Readonly<Record<TtrpgOpenAudience, number>> = {
  public: 0,
  party: 1,
  private: 2,
  'gm-only': 3,
}
const MAX_SAFE_SEQUENCE = Number.MAX_SAFE_INTEGER
const MAX_COLLECTION_SIZE = 10_000

function fail(message: string): never {
  return p.fail(`[ttrpg-narrative-memory] ${message}`)
}

function integer(value: unknown, label: string): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 0
    || value > MAX_SAFE_SEQUENCE
  ) {
    return fail(`${label}: 必须是非负安全整数`)
  }
  return value
}

function timestamp(value: unknown, label: string): number {
  return integer(value, label)
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function cloneMemory(memory: TtrpgNarrativeMemoryV1): TtrpgNarrativeMemoryV1 {
  const clone: TtrpgNarrativeMemoryV1 = {
    ...memory,
    knownBy: [...memory.knownBy],
  }
  return clone
}

function parseMemory(value: unknown, label: string): TtrpgNarrativeMemoryV1 {
  const row = p.object(p.json(value), label)
  const hasId = hasOwn(row, 'id')
  p.exact(row, hasId ? MEMORY_FIELDS_WITH_ID : MEMORY_FIELDS, label)

  const projectId = integer(row.projectId, `${label}.projectId`)
  const worldGroupId = p.nullable(row.worldGroupId, integer, `${label}.worldGroupId`)
  const worldId = integer(row.worldId, `${label}.worldId`)
  const workId = integer(row.workId, `${label}.workId`)
  const sessionId = integer(row.sessionId, `${label}.sessionId`)
  const revisionKey = p.key(row.revisionKey, `${label}.revisionKey`)
  const observerKey = p.nullable(row.observerKey, p.key, `${label}.observerKey`)
  const reliability = p.oneOf(row.reliability, RELIABILITIES, `${label}.reliability`)
  const audience = p.oneOf(row.audience, AUDIENCES, `${label}.audience`)
  const knownBy = p.keys(row.knownBy, `${label}.knownBy`, 256, 0)
  const summary = p.text(row.summary, `${label}.summary`, 20_000)
  const fromEventSequence = integer(row.fromEventSequence, `${label}.fromEventSequence`)
  const toEventSequence = integer(row.toEventSequence, `${label}.toEventSequence`)
  const sourceSessionId = p.nullable(
    row.sourceSessionId,
    (candidate, nestedLabel) => integer(candidate, nestedLabel),
    `${label}.sourceSessionId`,
  )
  const derivedFromHash = p.hash(row.derivedFromHash, `${label}.derivedFromHash`)
  const stale = p.bool(row.stale, `${label}.stale`)
  const updatedAt = timestamp(row.updatedAt, `${label}.updatedAt`)

  if (fromEventSequence > toEventSequence) {
    fail(`${label}.fromEventSequence 不得大于 toEventSequence`)
  }
  if ((reliability === 'hearsay' || reliability === 'belief') && observerKey === null) {
    fail(`${label}.${reliability} 必须有 observerKey`)
  }
  if (audience === 'private' && knownBy.length === 0) {
    fail(`${label}.private 必须有 knownBy`)
  }

  const memory: TtrpgNarrativeMemoryV1 = {
    projectId,
    worldGroupId,
    worldId,
    workId,
    sessionId,
    revisionKey,
    observerKey,
    reliability,
    audience,
    knownBy,
    summary,
    fromEventSequence,
    toEventSequence,
    sourceSessionId,
    derivedFromHash,
    stale,
    updatedAt,
  }
  if (hasId) memory.id = integer(row.id, `${label}.id`)
  return memory
}

export function parseTtrpgNarrativeMemoryV1(value: unknown): TtrpgNarrativeMemoryV1 {
  return parseMemory(value, 'narrativeMemory')
}

function assertNoDuplicateRevision(
  memories: readonly TtrpgNarrativeMemoryV1[],
  candidate: TtrpgNarrativeMemoryV1,
): void {
  if (memories.some(memory =>
    memory.sessionId === candidate.sessionId
    && memory.revisionKey === candidate.revisionKey,
  )) {
    fail(`session ${candidate.sessionId} 的 revisionKey 已存在:${candidate.revisionKey}`)
  }
}

function parseRecordEnvelope(value: unknown): {
  memory: TtrpgNarrativeMemoryV1
  existingMemories: TtrpgNarrativeMemoryV1[]
  currentEventSequence: number | null
  sourceLineageHash: string | null
} {
  const row = p.object(value, 'narrativeMemoryRecord')
  const allowed = ['memory', 'existingMemories', 'currentEventSequence', 'sourceLineageHash'] as const
  if (Object.keys(row).some(key => !allowed.includes(key as typeof allowed[number]))) {
    fail('narrativeMemoryRecord: 字段不精确')
  }
  if (!hasOwn(row, 'memory')) fail('narrativeMemoryRecord.memory 缺失')

  const existingMemories = hasOwn(row, 'existingMemories')
    ? p.list(row.existingMemories, 'narrativeMemoryRecord.existingMemories', (candidate, label) =>
      parseMemory(candidate, label), MAX_COLLECTION_SIZE, 0)
    : []
  const currentEventSequence = hasOwn(row, 'currentEventSequence')
    ? integer(row.currentEventSequence, 'narrativeMemoryRecord.currentEventSequence')
    : null
  const sourceLineageHash = hasOwn(row, 'sourceLineageHash')
    ? p.hash(row.sourceLineageHash, 'narrativeMemoryRecord.sourceLineageHash')
    : null
  return {
    memory: parseMemory(row.memory, 'narrativeMemoryRecord.memory'),
    existingMemories,
    currentEventSequence,
    sourceLineageHash,
  }
}

function recordMemory(
  value: unknown,
  existingMemories: readonly TtrpgNarrativeMemoryV1[] = [],
  currentEventSequence: number | null = null,
  sourceLineageHash: string | null = null,
): TtrpgNarrativeMemoryV1 {
  const memory = parseMemory(value, 'narrativeMemory')
  if (memory.stale) fail('新记录不得直接写入 stale 记忆')
  if (
    currentEventSequence !== null
    && memory.toEventSequence > currentEventSequence
  ) {
    fail('记忆区间超出当前 event sequence')
  }
  if (
    sourceLineageHash !== null
    && memory.derivedFromHash !== sourceLineageHash
  ) {
    fail('记忆 derivedFromHash 与当前血缘不匹配')
  }
  assertNoDuplicateRevision(existingMemories, memory)
  return cloneMemory(memory)
}

export function recordTtrpgNarrativeMemoryV1(input: unknown): TtrpgNarrativeMemoryV1
export function recordTtrpgNarrativeMemoryV1(
  memories: readonly unknown[],
  input: unknown,
): TtrpgNarrativeMemoryV1[]
export function recordTtrpgNarrativeMemoryV1(
  input: unknown,
  secondInput?: unknown,
): TtrpgNarrativeMemoryV1 | TtrpgNarrativeMemoryV1[] {
  if (Array.isArray(input)) {
    if (secondInput === undefined) fail('批量记录缺少 memory')
    const existingMemories = input.map((candidate, index) =>
      parseMemory(candidate, `narrativeMemories[${index}]`))
    const memory = recordMemory(secondInput, existingMemories)
    return [...existingMemories.map(cloneMemory), memory]
  }

  const candidate = p.object(input, 'narrativeMemoryRecordInput')
  if (hasOwn(candidate, 'memory')) {
    const envelope = parseRecordEnvelope(candidate)
    return recordMemory(
      envelope.memory,
      envelope.existingMemories,
      envelope.currentEventSequence,
      envelope.sourceLineageHash,
    )
  }
  return recordMemory(input)
}

function parseSequenceOption(
  row: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): number | null {
  const values = keys
    .filter(key => hasOwn(row, key))
    .map(key => integer(row[key], `${label}.${key}`))
  if (values.length === 0) return null
  if (values.some(value => value !== values[0])) {
    fail(`${label}: 等价 event sequence 参数不一致`)
  }
  return values[0]
}

function parseHashOption(
  row: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): string | null {
  const values = keys
    .filter(key => hasOwn(row, key))
    .map(key => p.hash(row[key], `${label}.${key}`))
  if (values.length === 0) return null
  if (values.some(value => value !== values[0])) {
    fail(`${label}: 等价 lineage hash 参数不一致`)
  }
  return values[0]
}

function parseViewer(value: unknown): TtrpgNarrativeMemoryViewerV1 | undefined {
  if (value == null) return undefined
  const row = p.object(value, 'narrativeMemoryViewer')
  const allowed = [
    'audience',
    'actorKey',
    'observerKey',
    'sessionId',
    'revisionKey',
    'fromEventSequence',
    'toEventSequence',
    'eventSequence',
    'currentEventSequence',
    'throughSequence',
    'derivedFromHash',
    'sourceLineageHash',
  ] as const
  if (Object.keys(row).some(key => !allowed.includes(key as typeof allowed[number]))) {
    fail('narrativeMemoryViewer: 字段不精确')
  }

  const audience = hasOwn(row, 'audience')
    ? p.oneOf(row.audience, AUDIENCES, 'narrativeMemoryViewer.audience')
    : undefined
  const actorKey = hasOwn(row, 'actorKey')
    ? p.nullable(row.actorKey, p.key, 'narrativeMemoryViewer.actorKey')
    : undefined
  const observerKey = hasOwn(row, 'observerKey')
    ? p.nullable(row.observerKey, p.key, 'narrativeMemoryViewer.observerKey')
    : undefined
  if (actorKey !== undefined && observerKey !== undefined && actorKey !== observerKey) {
    fail('narrativeMemoryViewer.actorKey 与 observerKey 不一致')
  }
  const eventSequence = parseSequenceOption(
    row,
    ['eventSequence', 'currentEventSequence', 'throughSequence'],
    'narrativeMemoryViewer',
  )
  const fromEventSequence = hasOwn(row, 'fromEventSequence')
    ? integer(row.fromEventSequence, 'narrativeMemoryViewer.fromEventSequence')
    : undefined
  const toEventSequence = hasOwn(row, 'toEventSequence')
    ? integer(row.toEventSequence, 'narrativeMemoryViewer.toEventSequence')
    : undefined
  const upperBound = toEventSequence ?? eventSequence
  if (fromEventSequence !== undefined && upperBound !== null && fromEventSequence > upperBound) {
    fail('narrativeMemoryViewer.fromEventSequence 不得大于上界')
  }
  const derivedFromHash = parseHashOption(
    row,
    ['derivedFromHash', 'sourceLineageHash'],
    'narrativeMemoryViewer',
  )
  return {
    audience,
    actorKey: actorKey ?? observerKey,
    sessionId: hasOwn(row, 'sessionId')
      ? integer(row.sessionId, 'narrativeMemoryViewer.sessionId')
      : undefined,
    revisionKey: hasOwn(row, 'revisionKey')
      ? p.key(row.revisionKey, 'narrativeMemoryViewer.revisionKey')
      : undefined,
    fromEventSequence,
    toEventSequence,
    eventSequence: eventSequence ?? undefined,
    derivedFromHash: derivedFromHash ?? undefined,
  }
}

function memoryVisibleToViewer(
  memory: TtrpgNarrativeMemoryV1,
  viewer: TtrpgNarrativeMemoryViewerV1 | undefined,
): boolean {
  if (viewer === undefined || viewer.audience === undefined) return true
  if (viewer.audience === 'gm-only') return true
  if (AUDIENCE_RANK[memory.audience] > AUDIENCE_RANK[viewer.audience]) return false
  if (memory.audience === 'private') {
    return viewer.actorKey !== undefined
      && viewer.actorKey !== null
      && memory.knownBy.includes(viewer.actorKey)
  }
  return true
}

function memoryInEventRange(
  memory: TtrpgNarrativeMemoryV1,
  viewer: TtrpgNarrativeMemoryViewerV1 | undefined,
): boolean {
  if (viewer === undefined) return true
  const lowerBound = viewer.fromEventSequence
  const upperBound = viewer.toEventSequence ?? viewer.eventSequence
  if (lowerBound !== undefined && memory.fromEventSequence < lowerBound) return false
  if (upperBound !== undefined && memory.toEventSequence > upperBound) return false
  return true
}

function compareMemories(
  left: TtrpgNarrativeMemoryV1,
  right: TtrpgNarrativeMemoryV1,
): number {
  return left.fromEventSequence - right.fromEventSequence
    || left.toEventSequence - right.toEventSequence
    || left.revisionKey.localeCompare(right.revisionKey)
    || left.sessionId - right.sessionId
    || (left.id ?? -1) - (right.id ?? -1)
}

function recallMemories(
  values: readonly unknown[],
  viewer: TtrpgNarrativeMemoryViewerV1 | undefined,
): TtrpgNarrativeMemoryV1[] {
  return values
    .map((value, index) => parseMemory(value, `narrativeMemories[${index}]`))
    .filter(memory => !memory.stale)
    .filter(memory => viewer?.sessionId === undefined || memory.sessionId === viewer.sessionId)
    .filter(memory => viewer?.revisionKey === undefined || memory.revisionKey === viewer.revisionKey)
    .filter(memory => viewer?.derivedFromHash === undefined
      || memory.derivedFromHash === viewer.derivedFromHash)
    .filter(memory => memoryVisibleToViewer(memory, viewer))
    .filter(memory => memoryInEventRange(memory, viewer))
    .sort(compareMemories)
    .map(cloneMemory)
}

export function recallTtrpgNarrativeMemoryV1(
  memories: readonly unknown[],
  viewer?: unknown,
): TtrpgNarrativeMemoryV1[]
export function recallTtrpgNarrativeMemoryV1(input: unknown): TtrpgNarrativeMemoryV1[]
export function recallTtrpgNarrativeMemoryV1(
  input: unknown,
  viewerInput?: unknown,
): TtrpgNarrativeMemoryV1[] {
  if (Array.isArray(input)) {
    return recallMemories(input, parseViewer(viewerInput))
  }

  const row = p.object(input, 'narrativeMemoryRecall')
  const allowed = ['memories', 'viewer'] as const
  if (Object.keys(row).some(key => !allowed.includes(key as typeof allowed[number]))) {
    fail('narrativeMemoryRecall: 字段不精确')
  }
  if (!hasOwn(row, 'memories')) fail('narrativeMemoryRecall.memories 缺失')
  const memories = p.list(row.memories, 'narrativeMemoryRecall.memories', (candidate, label) =>
    parseMemory(candidate, label), MAX_COLLECTION_SIZE, 0)
  return recallMemories(memories, parseViewer(row.viewer))
}

export function isTtrpgNarrativeMemoryRuleEligibleV1(value: unknown): boolean {
  parseMemory(value, 'narrativeMemory')
  // A human-confirmed synopsis is still prose. Rules/evidence use their own actual ledgers.
  return false
}

function parseMarkStaleOptions(value: unknown): {
  throughSequence: number | null
  derivedFromHash: string | null
  updatedAt: number | null
} {
  const row = p.object(value, 'narrativeMemoryStale')
  const allowed = [
    'throughSequence',
    'checkpointSequence',
    'eventSequence',
    'currentEventSequence',
    'derivedFromHash',
    'sourceLineageHash',
    'updatedAt',
  ] as const
  if (Object.keys(row).some(key => !allowed.includes(key as typeof allowed[number]))) {
    fail('narrativeMemoryStale: 字段不精确')
  }
  const throughSequence = parseSequenceOption(
    row,
    ['throughSequence', 'checkpointSequence', 'eventSequence', 'currentEventSequence'],
    'narrativeMemoryStale',
  )
  const derivedFromHash = parseHashOption(
    row,
    ['derivedFromHash', 'sourceLineageHash'],
    'narrativeMemoryStale',
  )
  if (throughSequence === null && derivedFromHash === null) {
    fail('narrativeMemoryStale 必须提供切点或 derivedFromHash')
  }
  return {
    throughSequence,
    derivedFromHash,
    updatedAt: hasOwn(row, 'updatedAt')
      ? timestamp(row.updatedAt, 'narrativeMemoryStale.updatedAt')
      : null,
  }
}

function markMemoryStale(
  value: unknown,
  options: {
    throughSequence: number | null
    derivedFromHash: string | null
    updatedAt: number | null
  },
): TtrpgNarrativeMemoryV1 {
  const memory = parseMemory(value, 'narrativeMemory')
  const outsideCutPoint = options.throughSequence !== null
    && (
      memory.fromEventSequence > options.throughSequence
      || memory.toEventSequence > options.throughSequence
    )
  const lineageChanged = options.derivedFromHash !== null
    && memory.derivedFromHash !== options.derivedFromHash
  if (!outsideCutPoint && !lineageChanged) return cloneMemory(memory)
  return {
    ...cloneMemory(memory),
    stale: true,
    updatedAt: options.updatedAt ?? memory.updatedAt,
  }
}

export function markTtrpgNarrativeMemoryStaleV1(
  memory: unknown,
  options: TtrpgNarrativeMemoryMarkStaleOptionsV1,
): TtrpgNarrativeMemoryV1
export function markTtrpgNarrativeMemoryStaleV1(
  memories: readonly unknown[],
  options: TtrpgNarrativeMemoryMarkStaleOptionsV1,
): TtrpgNarrativeMemoryV1[]
export function markTtrpgNarrativeMemoryStaleV1(input: unknown): TtrpgNarrativeMemoryV1 | TtrpgNarrativeMemoryV1[]
export function markTtrpgNarrativeMemoryStaleV1(
  input: unknown,
  optionsInput?: unknown,
): TtrpgNarrativeMemoryV1 | TtrpgNarrativeMemoryV1[] {
  if (Array.isArray(input)) {
    if (optionsInput === undefined) fail('批量标 stale 缺少边界')
    const options = parseMarkStaleOptions(optionsInput)
    return input.map(value => markMemoryStale(value, options))
  }

  if (optionsInput !== undefined) {
    return markMemoryStale(input, parseMarkStaleOptions(optionsInput))
  }

  const row = p.object(input, 'narrativeMemoryStaleInput')
  const allowed = ['memory', 'memories', ...[
    'throughSequence',
    'checkpointSequence',
    'eventSequence',
    'currentEventSequence',
    'derivedFromHash',
    'sourceLineageHash',
    'updatedAt',
  ]] as const
  if (Object.keys(row).some(key => !allowed.includes(key as typeof allowed[number]))) {
    fail('narrativeMemoryStaleInput: 字段不精确')
  }
  const hasMemory = hasOwn(row, 'memory')
  const hasMemories = hasOwn(row, 'memories')
  if (hasMemory === hasMemories) fail('必须且只能提供 memory 或 memories')
  const optionRow: Record<string, unknown> = {}
  for (const key of Object.keys(row)) {
    if (key !== 'memory' && key !== 'memories') optionRow[key] = row[key]
  }
  const options = parseMarkStaleOptions(optionRow)
  if (hasMemory) return markMemoryStale(row.memory, options)
  const memories = p.list(row.memories, 'narrativeMemoryStaleInput.memories', (value, label) =>
    parseMemory(value, label), MAX_COLLECTION_SIZE, 0)
  return memories.map(memory => markMemoryStale(memory, options))
}

export function cloneTtrpgNarrativeMemoriesForBranchV1(
  input: TtrpgNarrativeMemoryBranchCloneInputV1,
): TtrpgNarrativeMemoryV1[] {
  const throughSequence = integer(input.throughSequence, 'branchClone.throughSequence')
  const childSessionId = integer(input.childSessionId, 'branchClone.childSessionId')
  return input.memories
    .map((value, index) => parseMemory(value, `branchClone.memories[${index}]`))
    .filter(memory =>
      memory.fromEventSequence <= throughSequence
      && memory.toEventSequence <= throughSequence,
    )
    .map(memory => {
      const clone = cloneMemory(memory)
      delete clone.id
      clone.sessionId = childSessionId
      clone.sourceSessionId ??= memory.sessionId
      return clone
    })
}
