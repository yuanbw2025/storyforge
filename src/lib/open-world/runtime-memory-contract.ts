import type {
  ProductRuntimeEvent,
  TextOpenWorldMemoryCommittedEventPayloadV1,
  TextOpenWorldLongTermMemoryKindV1,
} from '../types'
import { hashProductProductionValueV2 } from '../product-production/hash'

const STABLE_KEY = /^[a-z][a-z0-9._:-]{0,199}$/
const HASH = /^[a-f0-9]{64}$/

function fail(message: string): never {
  throw new Error(`[text-open-world-runtime-memory-contract] ${message}`)
}

function row(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    fail(`${label}字段不在允许闭集:${actual.join(',')}`)
  }
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') fail(`${label}必须是字符串`)
  const normalized = value.normalize('NFC').trim()
  if (!normalized || normalized.length > maximum) fail(`${label}无效`)
  return normalized
}

function token(value: unknown, label: string): string {
  const normalized = text(value, label, 200)
  if (!STABLE_KEY.test(normalized)) fail(`${label}不是稳定键`)
  return normalized
}

function nullableToken(value: unknown, label: string): string | null {
  return value == null ? null : token(value, label)
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH.test(value)) fail(`${label}不是SHA-256`)
  return value
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) fail(`${label}无效`)
  return Number(value)
}

function uniqueTokens(value: unknown, label: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label}必须是最多${maximum}项数组`)
  const result = value.map((item, index) => token(item, `${label}[${index}]`))
  if (new Set(result).size !== result.length) fail(`${label}不能重复`)
  return result
}

function uniqueHashes(value: unknown, label: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label}必须是最多${maximum}项数组`)
  const result = value.map((item, index) => hash(item, `${label}[${index}]`))
  if (new Set(result).size !== result.length) fail(`${label}不能重复`)
  return result
}

function sequences(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.length > 128) fail(`${label}必须是最多128项数组`)
  const result = value.map((item, index) => integer(item, `${label}[${index}]`, 1))
  if (new Set(result).size !== result.length
    || result.some((sequence, index) => index > 0 && result[index - 1]! >= sequence)) {
    fail(`${label}必须严格递增且不能重复`)
  }
  return result
}

export function parseTextOpenWorldMemoryCommittedEventPayloadV1(
  value: unknown,
): TextOpenWorldMemoryCommittedEventPayloadV1 {
  const parsed = row(value, 'memoryEvent')
  exact(parsed, [
    'schema', 'version', 'memoryKey', 'kind', 'subjectKey', 'sceneKey', 'actorKey', 'summary',
    'coveredEventSequences', 'coveredEventHashes', 'playerKnowledgeKeys', 'actorKnowledgeKeys',
    'sourceDialogueKnowledgeKeys', 'openThreadKeys', 'sourceDialogueHash', 'candidateHash',
    'contextManifestHash', 'adoptionHash', 'worldMinute',
  ], 'memoryEvent')
  if (parsed.schema !== 'storyforge.text-open-world.memory-committed-event' || parsed.version !== 1) {
    fail('memoryEvent schema/version无效')
  }
  const kind = String(parsed.kind) as TextOpenWorldLongTermMemoryKindV1
  if (!['dialogue-window', 'player-memory', 'actor-memory'].includes(kind)) fail('kind无效')
  const subjectKey = token(parsed.subjectKey, 'subjectKey')
  const sceneKey = nullableToken(parsed.sceneKey, 'sceneKey')
  const actorKey = nullableToken(parsed.actorKey, 'actorKey')
  if (kind === 'dialogue-window' && (!actorKey || !sceneKey || subjectKey !== actorKey)) {
    fail('dialogue-window必须精确绑定场景和角色主体')
  }
  if (kind === 'actor-memory' && (!actorKey || subjectKey !== actorKey)) fail('actor-memory主体无效')
  if (kind === 'player-memory' && (actorKey != null || subjectKey !== 'player')) fail('player-memory主体无效')
  const coveredEventSequences = sequences(parsed.coveredEventSequences, 'coveredEventSequences')
  const coveredEventHashes = uniqueHashes(parsed.coveredEventHashes, 'coveredEventHashes', 128)
  if (coveredEventSequences.length !== coveredEventHashes.length) fail('事件序号与Hash数量不一致')
  return {
    schema: 'storyforge.text-open-world.memory-committed-event',
    version: 1,
    memoryKey: token(parsed.memoryKey, 'memoryKey'),
    kind,
    subjectKey,
    sceneKey,
    actorKey,
    summary: text(parsed.summary, 'summary', 4_000),
    coveredEventSequences,
    coveredEventHashes,
    playerKnowledgeKeys: uniqueTokens(parsed.playerKnowledgeKeys, 'playerKnowledgeKeys', 64),
    actorKnowledgeKeys: uniqueTokens(parsed.actorKnowledgeKeys, 'actorKnowledgeKeys', 64),
    sourceDialogueKnowledgeKeys: uniqueTokens(parsed.sourceDialogueKnowledgeKeys, 'sourceDialogueKnowledgeKeys', 64),
    openThreadKeys: uniqueTokens(parsed.openThreadKeys, 'openThreadKeys', 32),
    sourceDialogueHash: hash(parsed.sourceDialogueHash, 'sourceDialogueHash'),
    candidateHash: hash(parsed.candidateHash, 'candidateHash'),
    contextManifestHash: hash(parsed.contextManifestHash, 'contextManifestHash'),
    adoptionHash: hash(parsed.adoptionHash, 'adoptionHash'),
    worldMinute: integer(parsed.worldMinute, 'worldMinute'),
  }
}

/** Portable evidence fingerprint; excludes local database ids and wall time. */
export async function createTextOpenWorldMemoryEvidenceEventHashV1(
  event: ProductRuntimeEvent,
): Promise<string> {
  return hashProductProductionValueV2({
    schema: 'storyforge.text-open-world.memory-evidence-event',
    version: 1,
    sequence: event.sequence,
    type: event.type,
    actorKey: event.actorKey ?? null,
    targetKey: event.targetKey ?? null,
    commandId: event.commandId ?? null,
    baseSequence: event.baseSequence ?? null,
    baseStateHash: event.baseStateHash ?? null,
    payloadJson: event.payloadJson,
  })
}

export async function createTextOpenWorldMemoryAdoptionHashV1(
  payload: Omit<TextOpenWorldMemoryCommittedEventPayloadV1, 'adoptionHash'>,
): Promise<string> {
  return hashProductProductionValueV2({
    schema: 'storyforge.text-open-world.memory-adoption',
    version: 1,
    memory: payload,
  })
}
