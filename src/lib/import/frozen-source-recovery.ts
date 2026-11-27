import { chunkDocument, quickHash, type ChunkPlan } from './chunker'
import type { ImportSession } from '../types/import-session'
import { hashImportChunkTextV1, ImportSessionAuthorityError } from '../../stores/import-session'

/** Recover original ranges only; model/settings changes never repartition a paid session. */
export async function recoverFrozenImportSourceV1(text: string, session: ImportSession): Promise<ChunkPlan[]> {
  if (text.length !== session.totalChars || quickHash(text) !== session.fileHash || session.chunks.length !== session.totalChunks)
    throw new ImportSessionAuthorityError('上传文件与原导入文件不同；请上传原文件或另开导入。')
  const matches = async (plans: ChunkPlan[]) => {
    if (plans.length !== session.totalChunks) return false
    for (const [index, plan] of plans.entries()) {
      const frozen = session.chunks[index]
      if (plan.index !== index || frozen.index !== index || plan.startChar !== frozen.startChar || plan.endChar !== frozen.endChar
        || plan.charCount !== frozen.charCount || !plan.text.length
        || await hashImportChunkTextV1(plan.text) !== frozen.sourceTextHash) return false
    }
    return true
  }
  const ranges: ChunkPlan[] = []
  for (const chunk of session.chunks) {
    if (!Number.isSafeInteger(chunk.startChar) || !Number.isSafeInteger(chunk.endChar)
      || chunk.startChar < 0 || chunk.endChar <= chunk.startChar || chunk.endChar > text.length) break
    ranges.push({ index: chunk.index, startChar: chunk.startChar, endChar: chunk.endChar,
      charCount: chunk.charCount, label: chunk.label, text: text.slice(chunk.startChar, chunk.endChar) })
  }
  if (await matches(ranges)) return ranges
  // Old sessions may include the legacy algorithm's trimmed paragraphs or
  // declared overlap. Preserve that exact algorithm, identity and hash.
  const legacy = chunkDocument(text, { targetChars: session.chunkSize })
  if (await matches(legacy)) return legacy.map((plan, index) => ({ ...plan, label: session.chunks[index].label }))
  throw new ImportSessionAuthorityError('原文件或已确认分块摘要不一致；未重排、重发或覆盖原任务。')
}
