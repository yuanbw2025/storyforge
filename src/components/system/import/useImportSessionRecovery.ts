import { useEffect, useState } from 'react'
import { extractTextFromFile } from '../../../lib/doc-parser'
import { chunkDocument, quickHash } from '../../../lib/import/chunker'
import type { ImportSession } from '../../../lib/types/import-session'
import { hashImportChunkTextV1, hasFrozenImportIdentityV1, readImportSessionAuthorityV1, useImportSessionStore } from '../../../stores/import-session'
import { hasChunkTexts, registerChunkTexts } from '../../../lib/import/pipeline'

export default function useImportSessionRecovery(projectId: number, activeWorldId?: number | null, activeWorkId?: number | null) {
  const [unfinished, setUnfinished] = useState<ImportSession | null>(null)
  const [reusable, setReusable] = useState<ImportSession | null>(null)
  const [blobRestored, setBlobRestored] = useState(false)
  const [restoringBlob, setRestoringBlob] = useState(false)

  useEffect(() => {
    if (!navigator.storage?.persist) return
    navigator.storage.persisted().then(already => {
      if (!already) navigator.storage.persist().catch(() => {})
    }).catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    const scan = async () => {
      const store = useImportSessionStore.getState()
      const [reusable, unfinished] = await Promise.all([store.findReusableCompleted(projectId), store.findUnfinished(projectId)])
      if (cancelled) return
      setReusable(reusable)
      setUnfinished(unfinished)
      const session = unfinished ?? (reusable?.publishedReferenceId && reusable.analysisDepth === 'deep' ? reusable : null)
      if (!session?.id) {
        setBlobRestored(false)
        return
      }
      if (!hasFrozenImportIdentityV1(session)) {
        setBlobRestored(false)
        return
      }
      if (hasChunkTexts(session.id)) {
        setBlobRestored(true)
        return
      }

      setRestoringBlob(true)
      try {
        const frozen = await readImportSessionAuthorityV1(session.id, projectId, session)
        const row = await useImportSessionStore.getState().loadBlob(session.id)
        if (cancelled) return
        if (!row?.blob || row.fileHash !== frozen.fileHash) {
          setBlobRestored(false)
          return
        }
        const file = new File([row.blob], row.filename, { type: row.blob.type })
        const result = await extractTextFromFile(file)
        if (cancelled) return
        const plans = chunkDocument(result.text, { targetChars: frozen.chunkSize })
        let matches = quickHash(result.text) === frozen.fileHash && plans.length === frozen.totalChunks
        for (const plan of plans) {
          if (!matches) break
          const chunk = frozen.chunks[plan.index]
          matches = Boolean(chunk && chunk.index === plan.index && chunk.sourceTextHash === await hashImportChunkTextV1(plan.text))
        }
        if (cancelled) return
        if (matches) {
          await readImportSessionAuthorityV1(session.id, projectId, frozen)
          if (cancelled) return
          registerChunkTexts(session.id, plans.map(plan => ({ index: plan.index, text: plan.text })))
          setBlobRestored(true)
        } else {
          console.warn(
            '[import] Blob 恢复后原文件或切块摘要不一致：',
            `原 ${session.totalChunks} vs 新 ${plans.length}`,
          )
          setBlobRestored(false)
        }
      } catch (error) {
        console.error('[import] 从 Blob 恢复失败：', error)
        setBlobRestored(false)
      } finally {
        if (!cancelled) setRestoringBlob(false)
      }
    }
    scan()
    return () => { cancelled = true }
  }, [activeWorldId, activeWorkId, projectId])

  return {
    unfinished,
    reusable,
    blobRestored,
    restoringBlob,
    clearUnfinished: () => {
      setUnfinished(null)
      setBlobRestored(false)
    },
    clearReusable: () => setReusable(null),
    markBlobRestored: () => setBlobRestored(true),
  }
}
