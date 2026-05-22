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

export function registerChunkTexts(
  sessionId: number,
  chunks: Array<{ index: number; text: string }>,
): void {
  const m = new Map<number, string>()
  for (const c of chunks) m.set(c.index, c.text)
  IN_MEM_CHUNK_TEXT[sessionId] = m
}

export function hasChunkTexts(sessionId: number): boolean {
  const m = IN_MEM_CHUNK_TEXT[sessionId]
  return !!m && m.size > 0
}

export function clearChunkTexts(sessionId: number): void {
  delete IN_MEM_CHUNK_TEXT[sessionId]
}

export function getChunkText(sessionId: number, chunkIndex: number): string | undefined {
  return IN_MEM_CHUNK_TEXT[sessionId]?.get(chunkIndex)
}
