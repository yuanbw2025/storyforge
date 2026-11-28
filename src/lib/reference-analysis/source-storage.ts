import Dexie from 'dexie'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import type { ChunkPlan } from '../import/chunker'
import type { ReferenceAnalysisSource } from '../types'

export type ReferenceSourceChunkPlanV1 = Omit<ChunkPlan, 'text'>
export interface ReferenceSourceReaderV1 {
  chunks: readonly ReferenceSourceChunkPlanV1[]
  read: (index: number) => Promise<string | undefined>
}

function metadata(chunk: ReferenceSourceChunkPlanV1): ReferenceSourceChunkPlanV1 {
  return { index: chunk.index, startChar: chunk.startChar, endChar: chunk.endChar,
    charCount: chunk.charCount, label: chunk.label }
}

function encodeText(text: string) {
  const buffer = new ArrayBuffer(text.length * 2), view = new DataView(buffer)
  for (let index = 0; index < text.length; index++) view.setUint16(index * 2, text.charCodeAt(index), true)
  return new Blob([buffer], { type: 'application/octet-stream' })
}

function decodeText(buffer: ArrayBuffer) {
  const view = new DataView(buffer), parts: string[] = []
  for (let start = 0; start < buffer.byteLength; start += 16384) {
    const codes: number[] = []
    for (let offset = start; offset < Math.min(start + 16384, buffer.byteLength); offset += 2) codes.push(view.getUint16(offset, true))
    parts.push(String.fromCharCode(...codes))
  }
  return parts.join('')
}

/** Build outside the native transaction. Retain Blob handles, never all decoded
 * strings. The original lifecycle writer still owns the atomic run/source claim. */
export async function encodeReferenceSourceReaderV1(reader: ReferenceSourceReaderV1, signal?: AbortSignal) {
  const plan = reader.chunks.map(metadata)
  const read = reader.read.bind(reader)
  const seen = new Set<number>()
  const chunks: ReferenceAnalysisSource['chunks'] = []
  for (const chunk of plan) {
    signal?.throwIfAborted()
    if (!Number.isSafeInteger(chunk.index) || chunk.index < 0 || seen.has(chunk.index)
      || !Number.isSafeInteger(chunk.startChar) || !Number.isSafeInteger(chunk.endChar)
      || chunk.startChar < 0 || chunk.endChar <= chunk.startChar
      || chunk.charCount !== chunk.endChar - chunk.startChar) throw new Error('参考原文分块计划异常，未创建分析版本。')
    const text = await read(chunk.index)
    signal?.throwIfAborted()
    if (typeof text !== 'string' || !text.length || text.length !== chunk.charCount)
      throw new Error('参考原文分块不完整，未创建分析版本。')
    // Existing ranges use UTF-16 offsets and can split a surrogate pair. A
    // UTF-8 Blob would replace those boundary code units and change the source.
    const textHashV1 = await sha256Text(JSON.stringify(text))
    const textBlobV1 = encodeText(text)
    chunks.push({ ...chunk, text: '', textBlobV1, textHashV1 })
    seen.add(chunk.index)
  }
  signal?.throwIfAborted()
  return { sourceStorageV1: 'utf16le-blob-chunks' as const, chunks }
}

/** Metadata never includes a decoded source string or a second Blob copy. */
export function referenceSourcePlanV1(source: ReferenceAnalysisSource): ReferenceSourceChunkPlanV1[] {
  return source.chunks.map(metadata)
}

export async function readReferenceSourceChunkV1(source: ReferenceAnalysisSource, index: number, bridgeTransaction = true): Promise<ChunkPlan | undefined> {
  const chunk = source.chunks.find(item => item.index === index)
  if (!chunk) return undefined
  if (source.sourceStorageV1 === undefined) {
    if (chunk.textBlobV1 !== undefined || chunk.textHashV1 !== undefined || typeof chunk.text !== 'string')
      throw new Error('参考原文存储格式异常，未使用不完整原文。')
    return { ...metadata(chunk), text: chunk.text }
  }
  if (source.sourceStorageV1 !== 'utf16le-blob-chunks' || chunk.text !== ''
    || !chunk.textBlobV1 || typeof chunk.textBlobV1.arrayBuffer !== 'function'
    || chunk.textBlobV1.size !== chunk.charCount * 2
    || typeof chunk.textHashV1 !== 'string' || !/^[a-f0-9]{64}$/.test(chunk.textHashV1))
    throw new Error('参考原文存储格式异常，未使用不完整原文。')
  // Authority may run within the original native transaction. Bridge each
  // selected Blob/hash read without opening a second transaction or writer.
  const reading = (async () => {
    const value = decodeText(await chunk.textBlobV1!.arrayBuffer())
    if (value.length !== chunk.charCount || await sha256Text(JSON.stringify(value)) !== chunk.textHashV1)
      throw new Error('参考原文分块摘要已变化，未发送模型请求。')
    return value
  })()
  const text = await (bridgeTransaction ? Dexie.waitFor(reading) : reading)
  return { ...metadata(chunk), text }
}
