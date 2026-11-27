import { createImportQuickHashV1 } from './chunker'

/** Local IO limits, independent of the model request budget. Never put the full
 * large file into a textarea or retain all decoded chunks. Offsets are UTF-16. */
export const IMPORT_TEXT_FILE_MAX_BYTES_V1 = 512 * 1024 * 1024
export const IMPORT_TEXT_PREVIEW_CHARS_V1 = 8192
const BLOCK_BYTES = 64 * 1024
export interface ImportBlobTextSourceV1 {
  readonly blob: Blob
  readonly totalChars: number
  readonly fileHash: string
  readonly preview: string
  readonly hasText: boolean
  read(startChar: number, endChar: number, signal?: AbortSignal): Promise<string>
}

function check(signal?: AbortSignal) { signal?.throwIfAborted() }

/** Move a byte cut before a potentially incomplete UTF-8 sequence. Invalid
 * bytes still go through the native decoder with its usual replacement rules. */
function utf8End(bytes: Uint8Array, target: number): number {
  for (let start = Math.max(0, target - 3); start < target; start++) {
    const lead = bytes[start]
    const size = lead >= 0xc2 && lead <= 0xdf ? 2 : lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xf0 && lead <= 0xf4 ? 4 : 1
    if (start + size <= target) continue
    let prefix = true
    for (let i = start + 1; i < target; i++) if ((bytes[i] & 0xc0) !== 0x80) prefix = false
    if (prefix) return start
  }
  return target
}

async function block(blob: Blob, byteOffset: number, blockBytes: number, signal?: AbortSignal) {
  check(signal)
  const bytes = new Uint8Array(await blob.slice(byteOffset, byteOffset + blockBytes + 3).arrayBuffer())
  check(signal)
  const target = Math.min(blockBytes, bytes.length)
  const end = byteOffset + target < blob.size ? utf8End(bytes, target) : target
  const text = new TextDecoder('utf-8', { ignoreBOM: byteOffset !== 0 }).decode(bytes.subarray(0, end))
  return { text, endByte: byteOffset + end }
}

/** Immutable Blob plus a sparse byte/character index. The index is ephemeral;
 * refresh rebuilds it from importFiles and validates the frozen session hashes. */
export async function openImportBlobTextSourceV1(blob: Blob, options: {
  signal?: AbortSignal
  onProgress?: (readBytes: number, totalBytes: number) => void
  /** Small blocks are useful for boundary regression fixtures. */
  blockBytes?: number
} = {}): Promise<ImportBlobTextSourceV1> {
  if (blob.size > IMPORT_TEXT_FILE_MAX_BYTES_V1) throw new Error('纯文本文件最大 512 MB；原文件未改动。')
  const blockBytes = options.blockBytes ?? BLOCK_BYTES
  if (!Number.isSafeInteger(blockBytes) || blockBytes < 8 || blockBytes > BLOCK_BYTES) throw new Error('无效的文件读取窗口。')
  const anchors: { byte: number; char: number }[] = []
  const hash = createImportQuickHashV1()
  let byte = 0, totalChars = 0, preview = '', hasText = false
  while (byte < blob.size) {
    anchors.push({ byte, char: totalChars })
    const part = await block(blob, byte, blockBytes, options.signal)
    hash.update(part.text)
    if (!hasText && /\S/u.test(part.text)) hasText = true
    if (preview.length < IMPORT_TEXT_PREVIEW_CHARS_V1) preview += part.text.slice(0, IMPORT_TEXT_PREVIEW_CHARS_V1 - preview.length)
    totalChars += part.text.length
    byte = part.endByte
    options.onProgress?.(byte, blob.size)
  }
  check(options.signal)
  return Object.freeze({ blob, totalChars, fileHash: hash.digest(), preview, hasText,
    async read(startChar: number, endChar: number, signal?: AbortSignal) {
      check(signal)
      if (!Number.isSafeInteger(startChar) || !Number.isSafeInteger(endChar) || startChar < 0 || endChar < startChar || endChar > totalChars)
        throw new Error('原文读取范围无效。')
      if (startChar === endChar) return ''
      let lo = 0, hi = anchors.length - 1
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (anchors[mid].char <= startChar) lo = mid
        else hi = mid - 1
      }
      let offset = anchors[lo].byte, char = anchors[lo].char, text = ''
      while (char < endChar) {
        const part = await block(blob, offset, blockBytes, signal)
        text += part.text.slice(Math.max(0, startChar - char), endChar - char)
        char += part.text.length
        offset = part.endByte
      }
      return text
    },
  })
}

export function isLargeImportTextFileV1(file: { name: string; size: number }) {
  return /\.(txt|md)$/i.test(file.name) && file.size > 1024 * 1024
}
