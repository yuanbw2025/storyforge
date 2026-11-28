import { useEffect, useState } from 'react'
import { extractTextFromFile, textLayerReportLineV1 } from '../../../lib/doc-parser'
import type { CsvGridV1 } from '../../../lib/import/csv-grid'
import type { DocxStructureV1 } from '../../../lib/import/docx-structure'
import { publishTextLayerNoticeV1, publishCsvGridViewV1 } from './ImportDocOverview'
import { recoverFrozenImportSourceV1, registerBlobImportSourceV1, verifyBlobImportSourceV1 } from '../../../lib/import/frozen-source-recovery'
import type { ImportSession } from '../../../lib/types/import-session'
import { hasFrozenImportIdentityV1, readImportSessionAuthorityV1, useImportSessionStore } from '../../../stores/import-session'
import { hasChunkTexts, registerChunkTexts } from '../../../lib/import/pipeline'

import { isLargeImportTextFileV1, openImportBlobTextSourceV1 } from '../../../lib/import/blob-text-source'

export default function useImportSessionRecovery(projectId: number, activeWorldId?: number | null, activeWorkId?: number | null) {
  const [unfinished, setUnfinished] = useState<ImportSession | null>(null)
  const [reusable, setReusable] = useState<ImportSession | null>(null)
  const [blobRestored, setBlobRestored] = useState(false)
  const [restoringBlob, setRestoringBlob] = useState(false)
  /** 032-L1-a：恢复出的原件没有可复制文本时，保留会话但不继续解析。 */
  const [textLayerBlocked, setTextLayerBlocked] = useState<string | null>(null)
  /** 032-L1-c：仅 csv blob 恢复成功时出现的只读侧车快照，不进 AI/adopt/persistence。 */
  const [csvGrid, setCsvGrid] = useState<CsvGridV1 | null>(null)
  const scopeKey = `${projectId}:${activeWorldId}:${activeWorkId}`
  const [docxPreview, setDocxPreview] = useState<{ key: string; value: DocxStructureV1 | null } | null>(null)

  useEffect(() => {
    if (!navigator.storage?.persist) return
    navigator.storage.persisted().then(already => {
      if (!already) navigator.storage.persist().catch(() => {})
    }).catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    setDocxPreview(null)
    const controller = new AbortController()
    const scan = async () => {
      const store = useImportSessionStore.getState()
      const [reusable, unfinished] = await Promise.all([store.findReusableCompleted(projectId), store.findUnfinished(projectId)])
      if (cancelled) return
      setReusable(reusable)
      setUnfinished(unfinished)
      const session = unfinished ?? (reusable?.publishedReferenceId && reusable.analysisDepth === 'deep' ? reusable : null)
      if (!session?.id) {
        publishTextLayerNoticeV1(null)
        setBlobRestored(false)
        return
      }
      if (!hasFrozenImportIdentityV1(session)) {
        publishTextLayerNoticeV1(null)
        setBlobRestored(false)
        return
      }
      if (hasChunkTexts(session.id)) {
        publishTextLayerNoticeV1(null)
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
        if (isLargeImportTextFileV1(file)) {
          const source = await openImportBlobTextSourceV1(file, { signal: controller.signal })
          await verifyBlobImportSourceV1(source, frozen, controller.signal)
          await readImportSessionAuthorityV1(session.id, projectId, frozen)
          if (cancelled) return
          registerBlobImportSourceV1(session.id, source, frozen.chunks)
          setTextLayerBlocked(null); publishTextLayerNoticeV1(null)
          setCsvGrid(null); publishCsvGridViewV1(null)
          setBlobRestored(true)
          return
        }
        const result = await extractTextFromFile(file, { signal: controller.signal, includeDocxStructure: true })
        if (cancelled) return
        if (result.status === 'empty') {
          // 不切块、不登记块文本、不产生候选：扫描件恢复只能停在原件。
          const notice = textLayerReportLineV1({ filename: row.filename, sizeBytes: row.blob.size, pageCount: result.pageCount, status: result.status })
          setTextLayerBlocked(notice)
          publishTextLayerNoticeV1(notice)
          setCsvGrid(null)
          publishCsvGridViewV1(null)
          setBlobRestored(false)
          return
        }
        setTextLayerBlocked(null)
        publishTextLayerNoticeV1(null)
        // 032-L1-c：仅 csv 且非 empty 时记录只读侧车；不改变 registerChunkTexts 输入（仍是 plainText）。
        setCsvGrid(result.csvGrid ?? null)
        publishCsvGridViewV1(result.csvGrid ?? null)
        const plans = await recoverFrozenImportSourceV1(result.text, frozen)
        if (cancelled) return
        await readImportSessionAuthorityV1(session.id, projectId, frozen)
        if (cancelled) return
        registerChunkTexts(session.id, plans.map(plan => ({ index: plan.index, text: plan.text })))
        setDocxPreview({ key: scopeKey, value: result.docxStructure ?? null })
        setBlobRestored(true)
      } catch (error) {
        console.error('[import] 从 Blob 恢复失败：', error)
        setBlobRestored(false)
      } finally {
        if (!cancelled) setRestoringBlob(false)
      }
    }
    scan()
    return () => { cancelled = true; controller.abort() }
  }, [activeWorldId, activeWorkId, projectId, scopeKey])

  return {
    unfinished,
    reusable,
    blobRestored,
    restoringBlob,
    textLayerBlocked,
    csvGrid,
    docxStructure: docxPreview?.key === scopeKey ? docxPreview.value : null,
    clearUnfinished: () => {
      setUnfinished(null)
      setBlobRestored(false)
      setTextLayerBlocked(null)
      publishTextLayerNoticeV1(null)
      setCsvGrid(null)
      setDocxPreview(null)
      publishCsvGridViewV1(null)
    },
    clearReusable: () => setReusable(null),
    markBlobRestored: () => setBlobRestored(true),
  }
}
