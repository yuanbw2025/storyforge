import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import type { AuthoringNodeInstance } from '../../lib/node-authoring/contracts'
import { resolveQualityAuthoringChapterV1, qualityAuthoringModeV1 } from '../../lib/node-authoring/quality-execution'
import { readLatestWholeChapterQualityReviewV1, type DurableQualityReviewV1 } from '../../lib/agent/run/quality-review-durable'
import { readLatestQualityRevisionV1, abandonQualityRevisionV1, type QualityRevisionViewV1 } from '../../lib/agent/run/quality-revision-durable'
import { WholeQualityReportView, QualityRevisionScopeControls, QualityRevisionComparisonView } from '../editor/QualityReviewViews'
import { htmlToPlainText } from '../../lib/utils/html'
import { db } from '../../lib/db/schema'

export default function RevisionNodeSelection({ projectId, worldGroupId, node, onConfigChange }: { projectId: number; worldGroupId: number | null; node: AuthoringNodeInstance; onConfigChange: (value: Record<string, unknown>) => void }) {
  const title = node.config.chapterTitle
  const mode = qualityAuthoringModeV1(node.config.mode)
  const [data, setData] = useState<{ report: DurableQualityReviewV1 | null; view: QualityRevisionViewV1 | null; text: string } | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    setData(null); setError('')
    let active = true, readVersion = 0
    let subscription: { unsubscribe: () => void } | null = null
    const resolveTarget = () => resolveQualityAuthoringChapterV1({ projectId, worldGroupId, node: { config: { chapterTitle: title } } })
    const showError = (cause: unknown) => {
      if (!active) return
      setData(null)
      setError(cause instanceof Error ? cause.message : '审修证据读取失败。')
    }
    const readVerified = () => {
      const version = ++readVersion
      // Cryptographic verification can leave Dexie's observation context.
      // Run it outside the indexed subscription, and reject late older reads.
      void (async () => {
        const { scope, chapter } = await resolveTarget()
        const [report, view] = await Promise.all([readLatestWholeChapterQualityReviewV1({ scope, chapterId: chapter.id!, mode }), readLatestQualityRevisionV1({ scope, chapterId: chapter.id! })])
        if (!active || version !== readVersion) return
        setData({ report, view, text: htmlToPlainText(chapter.content) }); setError('')
      })().catch(cause => { if (active && version === readVersion) showError(cause) })
    }
    void resolveTarget().then(({ chapter }) => {
      if (!active) return
      subscription = liveQuery(() => Promise.all([
        db.agentRuns.where('projectId').equals(projectId).toArray(),
        db.agentRunEvents.where('projectId').equals(projectId).count(),
        db.chapters.get(chapter.id!),
      ])).subscribe({ next: readVerified, error: cause => { readVersion += 1; showError(cause) } })
    }).catch(showError)
    return () => { active = false; readVersion += 1; subscription?.unsubscribe() }
  }, [projectId, worldGroupId, title, mode, refresh])
  const bound = Boolean(data?.report && node.config.reportHash === data.report.report.artifactHash)
  const selected = bound && Array.isArray(node.config.selectedIssueIds) ? node.config.selectedIssueIds.filter((value): value is string => typeof value === 'string') : []
  const extra = bound && Array.isArray(node.config.additionalParagraphs) ? node.config.additionalParagraphs.filter((value): value is number => typeof value === 'number') : []
  const protectedText = bound && typeof node.config.protectedText === 'string' ? node.config.protectedText : ''
  const update = (values: Record<string, unknown>) => onConfigChange({ ...node.config, ...(!bound ? { selectedIssueIds: [], additionalParagraphs: [], protectedText: '' } : {}), ...values, reportHash: data?.report?.report.artifactHash })
  return <section className="mt-4 space-y-3 rounded border border-border p-3" data-testid="node-revision-selection">
    <p className="text-xs text-text-muted">连接全文评审节点，再明确选择问题。修订与复核最多两次请求；生成后在运行结果中确认采纳。</p>
    {error && <p role="alert" className="text-xs text-error">{error}</p>}
    {!data?.report && <p className="text-xs text-text-muted">当前没有可用的本章报告，请先运行上游全文评审。</p>}
    {data?.report && <>
      <WholeQualityReportView result={data.report} selected={selected} disabled={!data.report.current} toggle={id => update({ selectedIssueIds: selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id] })} />
      {!bound && <p className="text-xs text-warning">请选择本轮问题；旧报告的选择不会自动用于新报告。</p>}
      <QualityRevisionScopeControls chapterText={data.text} extraParagraphs={extra} protectedText={protectedText} disabled={!data.report.current} setExtraParagraphs={value => update({ additionalParagraphs: value })} setProtectedText={value => update({ protectedText: value })} />
    </>}
    {data?.view && <QualityRevisionComparisonView view={data.view}>
      {['running', 'paused', 'recovery_required'].includes(data.view.state) && <button className="rounded border border-border p-2 text-xs" onClick={() => {
        void resolveQualityAuthoringChapterV1({ projectId, worldGroupId, node }).then(({ scope, chapter }) => abandonQualityRevisionV1({ scope, chapterId: chapter.id!, runId: data.view!.runId })).then(() => setRefresh(value => value + 1)).catch(cause => setError(cause instanceof Error ? cause.message : '未能结束运行。'))
      }}>结束未完成运行</button>}
    </QualityRevisionComparisonView>}
  </section>
}
