import type { ReactNode } from 'react'
import type { DurableQualityReviewV1 } from '../../lib/agent/run/quality-review-durable'
import type { QualityRevisionViewV1 } from '../../lib/agent/run/quality-revision-durable'
import { htmlToPlainText } from '../../lib/utils/html'

export function WholeQualityReportView({ result, selected, toggle, disabled }: { result: DurableQualityReviewV1; selected: string[]; toggle: (id: string) => void; disabled: boolean }) {
  const report = result.report
  return <div className="space-y-3" data-testid="whole-chapter-quality-report">
    <p className={result.current ? 'text-xs text-text-muted' : 'text-xs text-warning'}>{result.current ? '当前正文报告' : '正文或作品资料已变化，以下为历史报告。'} · 全文已送审 · 引文已校验</p>
    <p className="text-[11px] text-text-muted">{report.reviewer.provider} / {report.reviewer.model} · {report.coverage.paragraphs} 段 · {report.coverage.utf16Length} 字符 · {report.reviewer.correlatedJudge ? '与生成模型可能相关' : '使用不同的已记录模型'}。模型建议不代表文学达标或平台准入。</p>
    <p className="text-sm text-text-primary">{report.summary}</p>
    {result.authorRequest && <details className="text-xs"><summary className="cursor-pointer text-text-muted">这份报告使用的作者要求</summary><p className="mt-2 whitespace-pre-wrap">{result.authorRequest}</p></details>}
    {report.strengths.map((item, index) => <p key={index} className="text-xs text-success">保留：{item}</p>)}
    {report.issues.map(issue => <section key={issue.id} className="rounded border border-border bg-bg-base p-3">
      <label className="mb-2 flex items-center gap-2 text-xs"><input type="checkbox" aria-label={`处理第${issue.paragraph}段问题`} checked={selected.includes(issue.id)} disabled={disabled} onChange={() => toggle(issue.id)} />本轮处理这个问题</label>
      <p className="text-xs text-text-muted">第 {issue.paragraph} 段 · {issue.start}～{issue.end} · {issue.confidence === 'uncertain' ? '待作者判断' : '阅读建议'}</p>
      <blockquote className="my-2 border-l-2 border-accent pl-2 text-xs">{issue.quote}</blockquote>
      <p className="text-xs text-text-primary">{issue.reason}</p><p className="mt-1 text-xs text-text-secondary">{issue.suggestion}</p>
    </section>)}
    {!report.issues.length && <p className="text-xs text-text-muted">本次没有返回可定位的问题；这不等于整章无错。</p>}
  </div>
}

export function QualityRevisionScopeControls({ chapterText, extraParagraphs, protectedText, disabled, setExtraParagraphs, setProtectedText }: { chapterText: string; extraParagraphs: number[]; protectedText: string; disabled: boolean; setExtraParagraphs: (value: number[]) => void; setProtectedText: (value: string) => void }) {
  return <>
    <details><summary className="cursor-pointer text-xs">选择其它可改段落</summary><div className="mt-2 max-h-40 space-y-1 overflow-y-auto">{chapterText.split('\n').filter(line => line.trim()).map((line, index) => <label key={index} className="flex gap-2 text-xs"><input type="checkbox" disabled={disabled} checked={extraParagraphs.includes(index + 1)} onChange={() => setExtraParagraphs(extraParagraphs.includes(index + 1) ? extraParagraphs.filter(item => item !== index + 1) : [...extraParagraphs, index + 1])} />第 {index + 1} 段：{line}</label>)}</div></details>
    <label className="block text-xs">保护原句（可选，每行一句，须与正文完全相同）<textarea aria-label="保护原句" className="mt-1 w-full rounded border border-border bg-bg-base p-2" value={protectedText} disabled={disabled} onChange={event => setProtectedText(event.target.value)} /></label>
  </>
}

export function QualityRevisionComparisonView({ view, children }: { view: QualityRevisionViewV1; children?: ReactNode }) {
  return <div data-testid="quality-revision-preview" className="mt-4 space-y-3 rounded border border-border p-3">
    <p className="text-sm font-medium">修订前后对照</p>
    <p className="text-xs text-text-muted">{view.state === 'completed' ? '已采纳，记录只读。' : view.state === 'cancelled' ? '已放弃，原稿保留。' : !view.current ? '原稿、资料或证据已变化，修订不能采纳。' : !view.candidate || view.state !== 'awaiting_confirmation' ? '复核未完成，预演结果只供查看；刷新不会重发。' : '复核已返回，最终是否采用由你判断。'}</p>
    {view.draft.plan.authorRequest && <details className="text-xs"><summary className="cursor-pointer text-text-muted">这次修订使用的作者要求</summary><p className="mt-2 whitespace-pre-wrap">{view.draft.plan.authorRequest}</p></details>}
    <div className="grid gap-3 md:grid-cols-2"><div><p className="text-xs text-text-muted">原稿</p><p className="whitespace-pre-wrap text-sm">{htmlToPlainText(view.draft.sourceHtml)}</p></div><div><p className="text-xs text-text-muted">修订稿</p><p className="whitespace-pre-wrap text-sm">{view.draft.outputText}</p></div></div>
    {view.candidate?.qualityRevision?.recheck.outcomes.map(item => <p key={item.issueId} className="text-xs">{item.status === 'improved' ? '模型认为已有改善' : item.status === 'unchanged' ? '模型认为仍未解决' : '模型无法确定'}：{item.reason}<br />依据：“{item.quote}”</p>)}
    {view.candidate?.qualityRevision?.recheck.review.issues.map(item => <p key={item.id} className="text-xs text-warning">复核建议：{item.reason} · “{item.quote}”</p>)}
    {children}
  </div>
}
