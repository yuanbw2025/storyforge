import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import ReviewPanel from '../../src/components/editor/ReviewPanel'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from './current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { runWholeChapterQualityReviewV1 } from '../../src/lib/agent/run/quality-review-durable'
import { runQualityRevisionV1 } from '../../src/lib/agent/run/quality-revision-durable'
import { normalizeRichEditorHTMLV1 } from '../../src/lib/editor/rich-editor-schema'

let root: Root, host: HTMLDivElement
let targets: Array<{ projectId: number; chapterId: number; outlineNodeId: number; content: string }>
let before: string
async function stored() { return JSON.stringify({ chapters: await db.chapters.toArray(), runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray() }) }
export async function prepare() {
  const f = await seedCurrentWorkspace('审稿目标隔离', { genres: ['realism'] })
  useAIConfigStore.setState({ config: { ...useAIConfigStore.getState().config, provider: 'ollama', baseUrl: 'https://review-owner.invalid/v1', model: 'isolated-review', maxTokens: 4000, contextWindow: 128000 } })
  targets = []
  for (const [i, content] of [normalizeRichEditorHTMLV1('<p><strong>余额三点，金额一百二十。</strong></p><p>陈禾签下名字，正文到此结束。</p>'), '<p>另一章的合成原稿。</p>'].entries()) {
    const base = { projectId: f.scope.projectId, createdAt: Date.now(), updatedAt: Date.now() }
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(f.scope, 'outlineNodes', { ...base, parentId: null, type: 'chapter', title: `隔离章${i + 1}`, summary: '金额一百二十，余额三点，签字处停笔', order: i }, { owner: 'work' })) as number
    const chapterId = await db.chapters.add(stampNewRecord(f.scope, 'chapters', { ...base, outlineNodeId, title: `隔离章${i + 1}`, content, wordCount: 31, status: 'draft', order: i, notes: '' }, { owner: 'work' })) as number
    targets.push({ projectId: f.scope.projectId, outlineNodeId, chapterId, content })
  }
  const a = targets[0]
  const report = await runWholeChapterQualityReviewV1({ scope: f.scope, ...a, worldGroupId: null, mode: 'quality', call: async (_m, _c, result) => {
    result.completion = 'complete'; result.finishReason = 'stop'
    return JSON.stringify({ summary: '停笔处有任务说明', strengths: ['金额和余额明确'], issues: [{ dimension: 'voice', confidence: 'suggestion', anchorId: 'p2', reason: '任务语言进入正文', suggestion: '移除任务说明，保留签字动作' }] })
  } })
  await runQualityRevisionV1({ scope: f.scope, ...a, worldGroupId: null, mode: 'quality', reportRunId: report.runId, reportHash: report.report.artifactHash, selectedIssueIds: [report.report.issues[0].id],
    revise: async (_m, _c, result) => { result.completion = 'complete'; result.finishReason = 'stop'; return JSON.stringify({ edits: [{ spanId: 'p2.1', replacement: '陈禾签下名字。' }] }) },
    recheck: async (_m, _c, result) => { result.completion = 'complete'; result.finishReason = 'stop'; return JSON.stringify({ review: { summary: '任务说明已移除，仍需作者判断', strengths: ['保留签字'], issues: [] }, outcomes: [{ issueId: report.report.issues[0].id, status: 'improved', anchorId: 'p2', reason: '签字事件保留且没有任务说明' }] }) },
  })
  before = await stored()
  host = document.createElement('div'); host.dataset.testid = 'review-owner-fixture'; document.body.append(host); root = createRoot(host)
  return switchTo(0)
}
export function switchTo(index: number) {
  const t = targets[index]
  flushSync(() => root.render(createElement(ReviewPanel, { ...t, chapterContent: t.content, chapterTitle: '隔离章节', worldContext: '', characterContext: '', prevChapterSummary: '', nextChapterSummary: '', foreshadowContext: '', stateContext: '', onClose: () => undefined })))
  return { text: host.textContent, hasCandidate: Boolean(host.querySelector('[data-testid="quality-revision-preview"]')), buttons: [...host.querySelectorAll('button')].map(x => x.textContent) }
}
export async function unchanged() { return before === await stored() }
