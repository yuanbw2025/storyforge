import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from '../product-production/hash'
import type { TextOpenWorldCommandEnvelopeV1, TextOpenWorldCommandEventPayloadV1 } from '../types'

type Row = Record<string, unknown>

const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const STABLE_KEY = /^[a-z][a-z0-9._:-]{0,199}$/
const SOURCES = ['system-action', 'fixed-choice', 'mapped-intent'] as const
const MAX_PAYLOAD_BYTES = 65_536

function fail(message: string): never { throw new Error(`[text-open-world-command] ${message}`) }
function row(value: unknown, label: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Row
}
function exact(value: Row, keys: readonly string[], label: string) {
  const expected = [...keys].sort()
  const actual = Object.keys(value).sort()
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) fail(`${label} 字段不符合合同:${actual.join(',')}`)
}
function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(`${label} 必须是${minimum}到${maximum}的整数`)
  return Number(value)
}
function token(value: unknown, label: string, pattern: RegExp): string {
  if (typeof value !== 'string') fail(`${label} 必须是字符串`)
  const parsed = value.trim()
  if (!pattern.test(parsed)) fail(`${label} 无效`)
  return parsed
}

export function parseTextOpenWorldCommandLookupKeyV1(value: unknown): { sessionId: number; commandId: string } {
  const parsed = row(value, 'commandLookup')
  exact(parsed, ['sessionId', 'commandId'], 'commandLookup')
  return {
    sessionId: integer(parsed.sessionId, 'commandLookup.sessionId', 1, Number.MAX_SAFE_INTEGER),
    commandId: token(parsed.commandId, 'commandLookup.commandId', COMMAND_ID),
  }
}

export function parseTextOpenWorldCommandEnvelopeV1(value: unknown): TextOpenWorldCommandEnvelopeV1 {
  const parsed = row(value, 'command')
  exact(parsed, ['schema', 'version', 'commandId', 'sessionId', 'actorKey', 'actionKey', 'payload', 'baseSequence', 'baseStateHash', 'source', 'requestedAt'], 'command')
  if (parsed.schema !== 'storyforge.text-open-world.command' || parsed.version !== 1) fail('command schema/version无效')
  const payload = row(parsed.payload, 'command.payload')
  const canonicalPayload = canonicalProductProductionJsonV2(payload)
  if (new TextEncoder().encode(canonicalPayload).byteLength > MAX_PAYLOAD_BYTES) fail(`command.payload不能超过${MAX_PAYLOAD_BYTES}字节`)
  if (!SOURCES.includes(parsed.source as typeof SOURCES[number])) fail('command.source无效')
  if (!isSha256Hash(parsed.baseStateHash)) fail('command.baseStateHash不是SHA-256')
  return {
    schema: 'storyforge.text-open-world.command',
    version: 1,
    commandId: token(parsed.commandId, 'command.commandId', COMMAND_ID),
    sessionId: integer(parsed.sessionId, 'command.sessionId', 1, Number.MAX_SAFE_INTEGER),
    actorKey: token(parsed.actorKey, 'command.actorKey', STABLE_KEY),
    actionKey: token(parsed.actionKey, 'command.actionKey', STABLE_KEY),
    payload: structuredClone(payload),
    baseSequence: integer(parsed.baseSequence, 'command.baseSequence', 0, Number.MAX_SAFE_INTEGER),
    baseStateHash: parsed.baseStateHash,
    source: parsed.source as TextOpenWorldCommandEnvelopeV1['source'],
    requestedAt: integer(parsed.requestedAt, 'command.requestedAt', 0, Number.MAX_SAFE_INTEGER),
  }
}

/** requestedAt is audit metadata, not gameplay identity, so a transport retry may refresh it. */
export async function fingerprintTextOpenWorldCommandV1(value: unknown): Promise<string> {
  const command = parseTextOpenWorldCommandEnvelopeV1(value)
  return hashProductProductionValueV2({
    schema: command.schema,
    version: command.version,
    commandId: command.commandId,
    sessionId: command.sessionId,
    actorKey: command.actorKey,
    actionKey: command.actionKey,
    payload: command.payload,
    baseSequence: command.baseSequence,
    baseStateHash: command.baseStateHash,
    source: command.source,
  })
}

export function parseTextOpenWorldCommandEventPayloadV1(value: unknown): TextOpenWorldCommandEventPayloadV1 {
  const parsed = row(value, 'commandEvent')
  exact(parsed, ['schema', 'version', 'envelope', 'requestFingerprint', 'resultingSequence', 'resultingStateHash'], 'commandEvent')
  if (parsed.schema !== 'storyforge.text-open-world.command-event' || parsed.version !== 1) fail('commandEvent schema/version无效')
  if (!isSha256Hash(parsed.requestFingerprint) || !isSha256Hash(parsed.resultingStateHash)) fail('commandEvent hash无效')
  return {
    schema: 'storyforge.text-open-world.command-event',
    version: 1,
    envelope: parseTextOpenWorldCommandEnvelopeV1(parsed.envelope),
    requestFingerprint: parsed.requestFingerprint,
    resultingSequence: integer(parsed.resultingSequence, 'commandEvent.resultingSequence', 1, Number.MAX_SAFE_INTEGER),
    resultingStateHash: parsed.resultingStateHash,
  }
}
