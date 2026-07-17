import { useEffect, useState } from 'react'
import { extractTextFromFile } from '../../../lib/doc-parser'
import { chunkDocument } from '../../../lib/import/chunker'
import type { ImportSession } from '../../../lib/types/import-session'
import { useImportSessionStore } from '../../../stores/import-session'
import { hasChunkTexts, registerChunkTexts } from '../../../lib/import/pipeline'

export default function useImportSessionRecovery(projectId: number) {
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
      useImportSessionStore.getState().findReusableCompleted(projectId).then(session => {
        if (!cancelled) setReusable(session)
      })
      const session = await useImportSessionStore.getState().findUnfinished(projectId)
      if (cancelled) return
      if (!session?.id) {
        setUnfinished(session || null)
        setBlobRestored(false)
        return
      }
      setUnfinished(session)
      if (hasChunkTexts(session.id)) {
        setBlobRestored(true)
        return
      }

      setRestoringBlob(true)
      try {
        const row = await useImportSessionStore.getState().loadBlob(session.id)
        if (cancelled) return
        if (!row?.blob) {
          setBlobRestored(false)
          return
        }
        const file = new File([row.blob], row.filename, { type: row.blob.type })
        const result = await extractTextFromFile(file)
        if (cancelled) return
        const plans = chunkDocument(result.text, { targetChars: session.chunkSize })
        if (plans.length === session.totalChunks) {
          registerChunkTexts(session.id, plans.map(plan => ({ index: plan.index, text: plan.text })))
          setBlobRestored(true)
        } else {
          console.warn(
            '[import] Blob 恢复后切块数对不上：',
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
  }, [projectId])

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
