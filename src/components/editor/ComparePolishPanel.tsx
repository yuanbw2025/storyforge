import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, Save, X } from 'lucide-react'
import type { RichEditorHandle } from './RichEditor'
import RichEditor from './RichEditor'
import { useBackupStore } from '../../stores/backup'
import { useChapterStore } from '../../stores/chapter'
import { useBeforeUnload } from '../../hooks/useBeforeUnload'
import { useDialog } from '../shared/Dialog'
import { useToast } from '../shared/Toast'
import { readProjectHeldItems } from '../../lib/consistency/held-items'
import {
  evaluateCompareDraftConsistency,
  saveComparePolishDraft,
} from '../../lib/editor/compare-polish-operation'
import { countWords, htmlToPlainText } from '../../lib/utils/html'

interface Props {
  projectId: number
  chapterId: number
  chapterTitle: string
  worldGroupId?: number | null
  sourceHtml: string
  onSaved: (result: { html: string; plainText: string; wordCount: number }) => void
  onClose: () => void
}

export default function ComparePolishPanel({
  projectId,
  chapterId,
  chapterTitle,
  worldGroupId,
  sourceHtml,
  onSaved,
  onClose,
}: Props) {
  const [draftHtml, setDraftHtml] = useState(sourceHtml)
  const [saving, setSaving] = useState(false)
  const editorRef = useRef<RichEditorHandle>(null)
  const createSnapshot = useBackupStore(state => state.createSnapshot)
  const updateChapter = useChapterStore(state => state.updateChapter)
  const dialog = useDialog()
  const toast = useToast()
  const dirty = draftHtml !== sourceHtml
  const sourceWords = useMemo(() => countWords(htmlToPlainText(sourceHtml)), [sourceHtml])
  const draftWords = useMemo(() => countWords(htmlToPlainText(draftHtml)), [draftHtml])

  useBeforeUnload(dirty)

  const close = async () => {
    if (dirty) {
      const confirmed = await dialog.confirm({
        title: '放弃对照润色草稿？',
        message: '右侧尚未保存的改写会丢失，左侧原稿和当前章节正文不受影响。',
        confirmText: '放弃草稿',
        tone: 'danger',
      })
      if (!confirmed) return
    }
    onClose()
  }

  const save = async () => {
    if (!dirty || saving) return
    const html = editorRef.current?.getHTML() ?? draftHtml
    const plain = editorRef.current?.getPlainText() ?? htmlToPlainText(html)
    if (!plain.trim()) {
      await dialog.alert({ title: '无法保存空正文', message: '右侧改写稿为空，请先完成内容后再保存。' })
      return
    }

    setSaving(true)
    try {
      const heldItems = await readProjectHeldItems(projectId, chapterId, worldGroupId)
      const findings = evaluateCompareDraftConsistency(html, heldItems)
      if (findings.length > 0) {
        const examples = findings.slice(0, 3).map(item => `“${item.quote}”`).join('\n')
        const proceed = await dialog.confirm({
          title: `发现 ${findings.length} 处物品连续性风险`,
          message: `${examples}\n\n这些是确定性提示，不会自动改稿。仍要创建快照并保存当前改写吗？`,
          confirmText: '仍然保存',
        })
        if (!proceed) return
      }

      const result = await saveComparePolishDraft({
        projectId,
        chapterId,
        chapterTitle,
        draftHtml: html,
        createSnapshot,
        updateChapter,
      })
      setDraftHtml(result.html)
      onSaved(result)
      toast.success('对照润色稿已保存，并创建恢复快照')
      onClose()
    } catch (error) {
      toast.error(`保存失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-label="对照润色" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">对照润色 · {chapterTitle}</h3>
          <p className="mt-1 text-xs text-text-muted">左侧原稿固定不变，右侧改写仅在保存后覆盖本章正文。</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { void save() }}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? '保存中...' : '创建快照并保存'}
          </button>
          <button
            type="button"
            onClick={() => { void close() }}
            title="关闭对照润色"
            aria-label="关闭对照润色"
            className="rounded p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium text-text-secondary">原稿（只读）</span>
            <span className="text-text-muted">{sourceWords.toLocaleString()} 字</span>
          </div>
          <RichEditor
            value={sourceHtml}
            onChange={() => {}}
            disabled
            showToolbar={false}
            minHeight={560}
            className="sf-manuscript-editor bg-bg-surface"
          />
        </div>

        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium text-text-secondary">改写稿</span>
            <span className="text-text-muted">{draftWords.toLocaleString()} 字</span>
          </div>
          <RichEditor
            ref={editorRef}
            value={draftHtml}
            onChange={html => setDraftHtml(html)}
            placeholder="在这里对照原稿逐段改写..."
            minHeight={560}
            className="sf-manuscript-editor"
          />
        </div>
      </div>

      <p className="flex items-start gap-1.5 text-[11px] leading-5 text-text-muted">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
        保存前会检查已持有物品被重复写成首次获得的风险；提示只供判断，不会自动改写正文。
      </p>
    </section>
  )
}
