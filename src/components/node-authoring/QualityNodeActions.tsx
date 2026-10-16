import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import ReviewPanel from '../editor/ReviewPanel'
import type { AuthoringInputEnvelope, AuthoringNodeInstance } from '../../lib/node-authoring/contracts'
import { resolveQualityAuthoringChapterV1, qualityAuthoringGenerationOverridesV1, qualityAuthoringRequestV1, qualityAuthoringModeV1 } from '../../lib/node-authoring/quality-execution'
import { requestedAIConfig } from '../../lib/node-authoring/executor'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import { useReviewResultStore } from '../../stores/review-result'
import { htmlToPlainText } from '../../lib/utils/html'

export default function QualityNodeActions({ projectId, worldGroupId, node, inputs = [], ready }: { projectId: number; worldGroupId: number | null; node: AuthoringNodeInstance; inputs?: AuthoringInputEnvelope[]; ready: boolean }) {
  const [target, setTarget] = useState<Awaited<ReturnType<typeof resolveQualityAuthoringChapterV1>> | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setTarget(null); setOpen(false); setError('')
    const subscription = liveQuery(() => resolveQualityAuthoringChapterV1({ projectId, worldGroupId, node })).subscribe({ next: value => { setTarget(value); setError('') }, error: cause => setError(cause instanceof Error ? cause.message : '章节读取失败。') })
    return () => subscription.unsubscribe()
  }, [projectId, worldGroupId, node])
  return <section className="mt-4 space-y-2 rounded border border-border p-3">
    <p className="text-xs text-text-muted">报告只读；按问题修订和采纳与分步骤模式共用。确认前保留原稿。</p>
    {error && <p role="alert" className="text-xs text-error">{error}</p>}
    {!ready && <p className="text-xs text-text-muted">先运行此节点，保存评审与参数；资料或连线变化后请重新运行。</p>}
    <button disabled={!target || !ready} className="rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-50" onClick={() => {
      if (!target?.chapter.id) return
      const mode = qualityAuthoringModeV1(node.config.mode)
      useReviewResultStore.getState().setActiveTab(target.chapter.id, mode === 'style' ? 'antiAI' : mode === 'readability' ? 'readability' : 'review')
      setOpen(true)
    }}>查看问题并修订本章</button>
    {open && target?.chapter.id && <div className="fixed inset-0 z-50 bg-black/20" data-testid="node-quality-panel"><ReviewPanel projectId={projectId} chapterId={target.chapter.id} outlineNodeId={target.chapter.outlineNodeId} worldGroupId={worldGroupId} chapterTitle={target.chapter.title} chapterContent={htmlToPlainText(target.chapter.content)} worldContext="" characterContext="" prevChapterSummary="" nextChapterSummary="" foreshadowContext="" stateContext="" onClose={() => setOpen(false)} onBeforeConsistencyRun={() => flushPendingEditsV1().then(() => undefined)} qualityConfigOverride={requestedAIConfig(node, inputs)} qualityGenerationOverrides={qualityAuthoringGenerationOverridesV1(node, inputs)} qualityAuthorRequest={qualityAuthoringRequestV1(node, inputs)} /></div>}
  </section>
}
