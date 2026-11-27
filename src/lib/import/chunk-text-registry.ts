/**
 * 分块原文内存寄存器
 *
 * session 表只存 chunk 的元数据（不存原文，避免 IndexedDB 体积爆炸）。
 * 调用方在创建 / 续跑 session 前，把每块的原文 register 进来。
 * 页面刷新后内存丢失 → 续跑需要重新上传同一文件；
 * 同时面板还会尝试从 IndexedDB 里 saveBlob 存过的原始文件 Blob 恢复。
 *
 * 从 pipeline.ts 抽出，纯模块级状态，无其他依赖。
 */

interface ChunkTextRegistry {
  [sessionId: number]: Map<number, string>
}

const IN_MEM_CHUNK_TEXT: ChunkTextRegistry = {}
const READERS = new Map<number, { read: (index: number) => Promise<string | undefined>; current?: { index: number; text: string } }>()

export function registerChunkTexts(
  sessionId: number,
  chunks: Array<{ index: number; text: string }>,
): void {
  READERS.delete(sessionId)
  const m = new Map<number, string>()
  for (const c of chunks) m.set(c.index, c.text)
  IN_MEM_CHUNK_TEXT[sessionId] = m
}

export function hasChunkTexts(sessionId: number): boolean {
  const m = IN_MEM_CHUNK_TEXT[sessionId]
  return (!!m && m.size > 0) || READERS.has(sessionId)
}

export function clearChunkTexts(sessionId: number): void {
  delete IN_MEM_CHUNK_TEXT[sessionId]
  READERS.delete(sessionId)
}

export function getChunkText(sessionId: number, chunkIndex: number): string | undefined {
  const current = READERS.get(sessionId)?.current
  return current?.index === chunkIndex ? current.text : IN_MEM_CHUNK_TEXT[sessionId]?.get(chunkIndex)
}

/** Caller has checked frozen ranges/digests against the immutable original Blob.
 * Only the currently reviewed/dispatched chunk is cached for synchronous CAS guards. */
export function registerChunkTextReaderV1(sessionId: number, read: (index: number) => Promise<string | undefined>) {
  clearChunkTexts(sessionId)
  READERS.set(sessionId, { read })
}

export function captureChunkTextReaderV1(sessionId: number) {
  const reader = READERS.get(sessionId)
  if (!reader) {
    const strings = new Map(IN_MEM_CHUNK_TEXT[sessionId])
    return { lazy: false, read: async (index: number) => strings.get(index) }
  }
  return { lazy: true, async read(index: number) {
    if (READERS.get(sessionId) !== reader) throw new Error('原文件已经替换，请重新打开原导入。')
    const text = await reader.read(index)
    if (READERS.get(sessionId) !== reader) throw new Error('原文件已经替换，请重新打开原导入。')
    reader.current = text === undefined ? undefined : { index, text }
    return text
  } }
}

export async function readChunkTextV1(sessionId: number, index: number) {
  return captureChunkTextReaderV1(sessionId).read(index)
}
