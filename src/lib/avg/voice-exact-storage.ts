import { canonicalStringify } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { assertExactRunArtifactBodySafeV1 } from '../memory/evidence-policy'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { avgEnum, avgHash, avgProtocolBody, avgRecord, avgText } from './protocol-validation'

export type AvgVoiceStoredKindV1 = 'assembly-voice' | 'raw-voice'
export interface AvgVoiceExactStorageV1 {
  schema: 'storyforge.avg.exact-voice-storage'
  version: 1
  kind: AvgVoiceStoredKindV1
  encoding: 'ascii-json-v1'
  payloadJson: string
  contentHash: string
}

// Even a worst-case escape-heavy string stays below the existing 2,000,000
// character Artifact envelope after the outer JSON quotes it again.
export const AVG_VOICE_EXACT_STORAGE_LIMIT_V1 = 750_000

export function stringifyAvgExactJsonV1(value: unknown): string {
  // Reuse strict finite/plain-object/sparse/cycle/key checks only. Discard its
  // NFC-normalized output: voice input must keep the original characters.
  canonicalProductProductionJsonV2(value)
  assertExactRunArtifactBodySafeV1({ artifactKind: 'source-snapshot', body: value })
  return canonicalStringify(value).replace(/[\u007f-\uffff]/g, character =>
    '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'))
}

function assertKind(value: unknown, kind: AvgVoiceStoredKindV1) {
  if (!['assembly-voice', 'raw-voice'].includes(kind) || !value || typeof value !== 'object' || Array.isArray(value)
    || (value as Record<string, unknown>).schema !== `storyforge.avg.${kind}`
    || (value as Record<string, unknown>).version !== 1) throw new Error('[avg-voice] 精确存储只接受当前登记的配音包络')
}

/** Portable data only, no local IDs/credentials or write authority. An ASCII
 * JSON string and its exact hash survive the existing canonical V2 Brief,
 * command, producer candidate and Artifact serializers without changing them.
 * It is the single stored voice value, not a second editable copy.
 */
export async function encodeAvgVoiceExactStorageV1(kind: AvgVoiceStoredKindV1, value: unknown): Promise<AvgVoiceExactStorageV1> {
  assertKind(value, kind)
  const payloadJson = stringifyAvgExactJsonV1(value)
  if (payloadJson.length > AVG_VOICE_EXACT_STORAGE_LIMIT_V1) throw new Error('[avg-voice] 完整配音合同超过精确存储上限；请明确拆批，不能截断保存')
  return { schema: 'storyforge.avg.exact-voice-storage', version: 1, kind,
    encoding: 'ascii-json-v1', payloadJson, contentHash: await sha256Text(payloadJson) }
}

/** Structural read only; async hash verification below is mandatory before
 * authorization, execution or adoption. Never reconstruct identity from NFC.
 */
export function parseAvgVoiceExactStorageV1(value: unknown, kind: AvgVoiceStoredKindV1) {
  const row = avgRecord(avgProtocolBody(value), ['schema', 'version', 'kind', 'encoding', 'payloadJson', 'contentHash'], 'exact voice storage')
  if (row.schema !== 'storyforge.avg.exact-voice-storage' || row.version !== 1 || row.kind !== kind) throw new Error('[avg-voice] 配音精确存储版本或用途无效')
  const packet: AvgVoiceExactStorageV1 = { schema: row.schema, version: 1, kind,
    encoding: avgEnum(row.encoding, ['ascii-json-v1'], 'voice storage encoding'),
    payloadJson: avgText(row.payloadJson, 'voice storage payload', AVG_VOICE_EXACT_STORAGE_LIMIT_V1),
    contentHash: avgHash(row.contentHash, 'voice storage hash') }
  if (/[^\u0020-\u007e]/.test(packet.payloadJson)) throw new Error('[avg-voice] 配音存储须为保留原字符的 ASCII JSON')
  let payload: unknown
  try { payload = JSON.parse(packet.payloadJson) } catch { throw new Error('[avg-voice] 配音精确存储不是合法 JSON') }
  assertKind(payload, kind)
  if (stringifyAvgExactJsonV1(payload) !== packet.payloadJson) throw new Error('[avg-voice] 配音精确存储不是准确的确定性序列化')
  return { packet, payload }
}

export async function decodeAvgVoiceExactStorageV1(value: unknown, kind: AvgVoiceStoredKindV1) {
  const parsed = parseAvgVoiceExactStorageV1(value, kind)
  if (await sha256Text(parsed.packet.payloadJson) !== parsed.packet.contentHash) throw new Error('[avg-voice] 配音精确存储 hash 不一致')
  return parsed
}
