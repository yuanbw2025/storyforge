import type { Chapter, OutlineNode, WorkspaceScope } from '../types'
import { readOwnedRows, resolveScopeLike } from '../workspace/scope'
import { readLatestWholeChapterQualityReviewV1, runWholeChapterQualityReviewV1 } from '../agent/run/quality-review-durable'
import { createWholeChapterQualityCallV1, createQualityRevisionCallV1 } from '../prose/quality-transport'
import { runQualityRevisionV1, readLatestQualityRevisionV1, adoptQualityRevisionV1, rejectQualityRevisionV1 } from '../agent/run/quality-revision-durable'
import { htmlToPlainText } from '../utils/html'
import type { AuthoringInputEnvelope, AuthoringNodeInstance, AuthoringCandidateDomain } from './contracts'
import type { DomainExecutionInput, DomainExecutionResult } from './domain-execution'
import { readAuthoringCanonBinding } from './bindings'
import { describeResolvedAIRequestSettingsV1, resolveRequestConfig } from '../ai/client'
import { boundedQualityResolutionV1 } from '../prose/quality-request-budget'
import { hashCanonicalValue } from '../agent/run/hash'
import { freezeQualityRevisionPlanV1 } from '../prose/quality-revision'
import { verifyContextGatewayCandidateEvidenceV1 } from '../context-gateway/attempt-evidence'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'

export function qualityAuthoringModeV1(value: unknown): 'quality' | 'style' | 'readability' {
  if (value == null || value === 'quality' || value === '审校') return 'quality'
  if (value === 'style' || value === '表达与重复') return 'style'
  if (value === 'readability' || value === '追读力') return 'readability'
  throw new Error('评审侧重无效。')
}

export async function resolveQualityAuthoringChapterV1(input: { projectId: number; scope?: WorkspaceScope; worldGroupId: number | null; node: Pick<AuthoringNodeInstance, 'config'> }) {
  const scope = input.scope ?? await resolveScopeLike(input.projectId)
  const title = typeof input.node.config.chapterTitle === 'string' ? input.node.config.chapterTitle.trim() : ''
  if (!title) throw new Error('请指定全文评审的目标章节。')
  const [chapters, outlines] = await Promise.all([readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }), readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' })])
  const allowedOutlines = new Set(outlines.filter(row => (row.worldGroupId ?? null) === input.worldGroupId).map(row => row.id))
  const matches = chapters.filter(row => row.title === title && allowedOutlines.has(row.outlineNodeId))
  if (matches.length !== 1 || matches[0].id == null) throw new Error(`找不到唯一的目标章节《${title}》，未回退到其它章节。`)
  return { scope, chapter: matches[0] }
}

/** A visual adapter only: all model/context/evidence belongs to the shared service. */
export function qualityAuthoringRequestV1(node: AuthoringNodeInstance, inputs: AuthoringInputEnvelope[]) {
  const request = typeof node.config.request === 'string' ? node.config.request : ''
  const prompt = inputs.find(row => row.semantic === 'control.prompt')?.content.trim()
  return prompt ? `${request}\n\n【作者选择的提示词】\n${prompt}` : request
}

export function qualityAuthoringGenerationOverridesV1(node: AuthoringNodeInstance, inputs: AuthoringInputEnvelope[]) {
  const parameter = (semantic: string) => {
    const text = inputs.find(row => row.semantic === semantic)?.content.trim()
    return text == null || text === '' ? undefined : Number(text)
  }
  const values = { temperature: parameter('control.temperature') ?? (typeof node.config.temperature === 'number' ? node.config.temperature : undefined), maxTokens: parameter('control.max-tokens') ?? (typeof node.config.maxTokens === 'number' ? node.config.maxTokens : undefined) }
  if (Object.values(values).some(value => value != null && !Number.isFinite(value))) throw new Error('评审节点模型参数无效。')
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value != null)) as { temperature?: number; maxTokens?: number }
}

export async function executeQualityAuthoringNodeV1(input: DomainExecutionInput): Promise<DomainExecutionResult> {
  const { scope, chapter } = await resolveQualityAuthoringChapterV1(input)
  const mode = qualityAuthoringModeV1(input.node.config.mode)
  const prose = input.inputs.filter(row => row.semantic === 'chapter.prose')
  if (prose.some(row => row.state !== 'canon' || ![htmlToPlainText(chapter.content).trim(), chapter.content.trim()].some(text => text && row.content.includes(text)))) throw new Error('评审只读取当前已保存的本章正文；请先确认上游候选。')
  const cached = input.node.config.newReport === true ? null : await readLatestWholeChapterQualityReviewV1({ scope, chapterId: chapter.id!, mode })
  const generationOverrides = qualityAuthoringGenerationOverridesV1(input.node, input.inputs)
  const authorRequest = qualityAuthoringRequestV1(input.node, input.inputs)
  const categories = { quality: 'review.quality', style: 'review.anti-ai', readability: 'review.readability' } as const
  const settings = describeResolvedAIRequestSettingsV1(boundedQualityResolutionV1(resolveRequestConfig(input.aiConfig, { category: categories[mode], projectId: input.projectId, configOverrides: generationOverrides })), false, { responseFormat: 'json_object' })
  const identity = (value: typeof settings) => ({ provider: value.provider, model: value.model, parameters: value.parameters })
  const reusable = cached?.current && (cached.authorRequest ?? '') === authorRequest.trim() && await hashCanonicalValue(identity(cached.report.reviewer.settings)) === await hashCanonicalValue(identity(settings))
  const result = reusable ? cached : await runWholeChapterQualityReviewV1({ scope, chapterId: chapter.id!, outlineNodeId: chapter.outlineNodeId, worldGroupId: input.worldGroupId, mode, configOverride: input.aiConfig, generationOverrides, authorRequest, signal: input.signal, call: createWholeChapterQualityCallV1(input.projectId, mode, input.signal) })
  const binding = await readAuthoringCanonBinding({ ...input, scope })
  return { output: JSON.stringify(result.report), semantic: 'chapter.quality-review', domain: { kind: 'quality-review', chapterTitle: chapter.title, mode, reportHash: result.report.artifactHash }, sourceKeys: binding.sourceKeys, sourceHash: binding.sourceHash, sourceEvidence: binding }
}

export async function isQualityAuthoringReportCurrentV1(input: { projectId: number; worldGroupId: number | null; node: AuthoringNodeInstance; reportHash: string; mode: 'quality' | 'style' | 'readability' }) {
  const { scope, chapter } = await resolveQualityAuthoringChapterV1(input)
  const result = await readLatestWholeChapterQualityReviewV1({ scope, chapterId: chapter.id!, mode: input.mode })
  return result?.current === true && result.report.artifactHash === input.reportHash
}

export async function executeQualityRevisionAuthoringNodeV1(input: DomainExecutionInput): Promise<DomainExecutionResult> {
  const { scope, chapter } = await resolveQualityAuthoringChapterV1(input)
  const mode = qualityAuthoringModeV1(input.node.config.mode)
  const report = await readLatestWholeChapterQualityReviewV1({ scope, chapterId: chapter.id!, mode })
  if (!report?.current || input.node.config.reportHash !== report.report.artifactHash) throw new Error('阅读报告已变化，请重新选择本轮问题。')
  const upstream = input.inputs.filter(row => row.targetPortId === 'report')
  if (upstream.length !== 1 || upstream[0].semantic !== 'chapter.quality-review' || await hashCanonicalValue(JSON.parse(upstream[0].content)) !== await hashCanonicalValue(report.report)) throw new Error('上游报告与本章已验证报告不一致，未发起修订。')
  const issueIds = input.node.config.selectedIssueIds
  const paragraphs = input.node.config.additionalParagraphs ?? []
  if (!Array.isArray(issueIds) || issueIds.some(value => typeof value !== 'string') || !Array.isArray(paragraphs) || paragraphs.some(value => typeof value !== 'number')) throw new Error('请在节点设置里选择要处理的问题及允许范围。')
  const binding = await readAuthoringCanonBinding({ ...input, scope })
  const protectedQuotes = typeof input.node.config.protectedText === 'string' ? input.node.config.protectedText.split('\n').filter(line => line.trim()) : []
  const generationOverrides = qualityAuthoringGenerationOverridesV1(input.node, input.inputs)
  const authorRequest = qualityAuthoringRequestV1(input.node, input.inputs)
  const plan = await freezeQualityRevisionPlanV1({ scope, chapterId: chapter.id!, reportRunId: report.runId, report: report.report, reviewMessages: report.messages, reviewCurrent: true, originalText: htmlToPlainText(chapter.content), selectedIssueIds: issueIds, additionalParagraphs: paragraphs, protectedQuotes, previousCalls: 2, authorRequest })
  const saved = await readLatestQualityRevisionV1({ scope, chapterId: chapter.id! })
  let result = saved?.current && saved.state === 'awaiting_confirmation' && saved.candidate && saved.draft.plan.planHash === plan.planHash ? saved : null
  if (result?.candidate) {
    const evidence = await verifyContextGatewayCandidateEvidenceV1({ scope, runId: result.candidate.durable.runId, stepId: result.candidate.durable.stepId, attempt: result.candidate.durable.attempt, candidateHash: result.candidate.durable.candidateHash })
    const ref = evidence.manifest.artifacts.find(row => row.role === 'rendered-request')
    if (!ref) throw new Error('修订实际参数证据缺失，不能恢复。')
    const writer = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.projectId, artifactKind: 'rendered-request', contentHash: ref.contentHash })).settings
    const reader = result.candidate.qualityRevision!.recheck.review.reviewer.settings
    const identity = (value: { provider: string; model: string; parameters: unknown }) => ({ provider: value.provider, model: value.model, parameters: value.parameters })
    for (const [category, actual] of [['review.revise', writer], ['review.quality', reader]] as const) {
      const expected = describeResolvedAIRequestSettingsV1(boundedQualityResolutionV1(resolveRequestConfig(input.aiConfig, { category, projectId: input.projectId, configOverrides: generationOverrides })), false, { responseFormat: 'json_object' })
      if (await hashCanonicalValue(identity(expected)) !== await hashCanonicalValue(identity(actual))) throw new Error('已保存修订的模型参数与当前选择不同，请先处理原候选，再明确开启新一轮。')
    }
  }
  result ??= await runQualityRevisionV1({ scope, chapterId: chapter.id!, outlineNodeId: chapter.outlineNodeId, worldGroupId: input.worldGroupId, mode, reportRunId: report.runId, reportHash: report.report.artifactHash, selectedIssueIds: issueIds, additionalParagraphs: paragraphs, protectedQuotes, configOverride: input.aiConfig, generationOverrides, authorRequest, signal: input.signal, revise: createQualityRevisionCallV1(input.projectId, 'revision', input.signal), recheck: createQualityRevisionCallV1(input.projectId, 'recheck', input.signal) })
  if (!result.candidate) throw new Error('修订复核未完成，已收到预演只供查看。')
  return { output: result.candidate.outputText, semantic: 'chapter.prose', domain: { kind: 'quality-revision', chapterTitle: chapter.title, reportHash: report.report.artifactHash, candidateHash: result.candidate.durable.candidateHash }, sourceKeys: binding.sourceKeys, sourceHash: binding.sourceHash, sourceEvidence: binding }
}

export async function readQualityAuthoringRevisionV1(input: { projectId: number; worldGroupId: number | null; node: AuthoringNodeInstance; domain: Extract<AuthoringCandidateDomain, { kind: 'quality-revision' }> }) {
  if (input.node.config.chapterTitle !== input.domain.chapterTitle) throw new Error('修订目标已变化，不能处理旧节点候选。')
  const { scope, chapter } = await resolveQualityAuthoringChapterV1(input)
  const view = await readLatestQualityRevisionV1({ scope, chapterId: chapter.id! })
  if (!view?.candidate || view.candidate.durable.candidateHash !== input.domain.candidateHash || view.draft.plan.reportHash !== input.domain.reportHash) throw new Error('当前作品中找不到匹配的正式修订证据。')
  return { scope, chapter, view }
}

export async function adoptQualityAuthoringRevisionV1(input: { projectId: number; worldGroupId: number | null; node: AuthoringNodeInstance; domain: Extract<AuthoringCandidateDomain, { kind: 'quality-revision' }>; output: string }) {
  const { scope, chapter, view } = await readQualityAuthoringRevisionV1(input)
  if (input.output !== view.candidate!.outputText) throw new Error('范围修订输出只读，不能把未经复核的编辑作为原候选采纳。')
  if (view.state === 'completed' && chapter.content === view.draft.contentHtml) return { chapterId: chapter.id! }
  if (!view.current || view.state !== 'awaiting_confirmation') throw new Error('修订已过期或已处理，不能采纳。')
  await adoptQualityRevisionV1({ scope, candidate: view.candidate! })
  return { chapterId: chapter.id! }
}

export async function rejectQualityAuthoringRevisionV1(input: { projectId: number; worldGroupId: number | null; node: AuthoringNodeInstance; domain: Extract<AuthoringCandidateDomain, { kind: 'quality-revision' }> }) {
  const { scope, view } = await readQualityAuthoringRevisionV1(input)
  if (view.state === 'cancelled') return
  if (view.state !== 'awaiting_confirmation') throw new Error('该修订已处理，不能重复拒绝。')
  await rejectQualityRevisionV1({ scope, candidate: view.candidate! })
}
