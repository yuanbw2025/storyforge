import { useAIConfigStore } from '../../stores/ai-config'
import { buildChapterContentPrompt, buildContinuePrompt } from '../ai/adapters/chapter-adapter'
import { chat, resolveRequestConfig, type ChatResult } from '../ai/client'
import { buildBestChapterByOutlineMap } from '../chapters/selectors'
import { db } from '../db/schema'
import type {
  GenerationGateIssue,
  GenerationNode,
  PreparedGenerationNode,
} from '../generation/generation-node'
import { prepareGenerationNode } from '../generation/generation-node'
import { walkOutlineChaptersInCanonicalOrder } from '../outline/canonical-outline-walk'
import { adopt } from '../registry/adopt'
import { rebuildChapterChunks } from '../retrieval/retrieval'
import {
  prepareProseGatewayAssemblyV1,
  type ProseGatewayAssemblyV1,
} from '../prose/gateway-context'
import {
  contextGatewayInputStateSourceKeysV1,
  projectContextGatewayInputStateV1,
} from './context-gateway-input'
import type { AIConfig, Chapter, ChatMessage, OutlineNode, Project, WorkspaceScope } from '../types'
import { countWords, htmlToPlainText, plainTextToHtml } from '../utils/html'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveScope,
  scopeTransactionTables,
} from '../workspace/scope'
import {
  attachAgentContextInputStateV1,
  evidenceFromContextResult,
  type AgentContextEvidence,
  type AgentContextProfile,
} from './context-policy'
import type { AgentContextCompressionRuntimeV1 } from './context-compression'
import {
  buildChapterInformationBoundaryV1,
  buildInformationBoundaryInstructionV1,
  validateProseInformationBoundaryV1,
  type InformationBoundaryManifestV1,
} from './information-boundary'
import {
  getDefaultAgentSkillV1,
  buildAgentSkillInputGuidanceV1,
  resolveAgentSkillV1,
  resolveAgentSkillContextSourceKeysV1,
  type AgentSkillExecutionModeV1,
  type AgentSkillId,
} from './skill-registry'
import {
  buildNarrativeBriefV1,
  formatNarrativeBriefForPromptV1,
  type NarrativeBriefV1,
} from './narrative-brief'
import {
  createCreativeIssueV1,
  runCreativeExecutionV1,
  type CreativeExecutionResultV1,
  type CreativeParseOutcomeV1,
  type CreativeRawModelResultV1,
} from './creative-execution'
import {
  parseCreativeArtifactV1,
  type CreativeAssumptionV1,
  type CreativeArtifactIssueV1,
  type CreativeArtifactV1,
  type CreativeQualityModeV1,
} from './creative-reliability'
import type { AgentTeamBudgetTracker } from './team-budget'

export const PROSE_COPILOT_SOURCE_KEYS = resolveAgentSkillContextSourceKeysV1(
  getDefaultAgentSkillV1('prose'),
  { includeOptional: true },
)

export type ProseCopilotOperation = 'generate' | 'continue'

export interface ProseCopilotSnapshot {
  outlineNodeId: number
  outlineUpdatedAt: number
  chapterId: number | null
  chapterUpdatedAt: number | null
  chapterContentHash: string
  chapterHadContent: boolean
  chapterOrder: number
  /** 叙事视角角色；缺省表示本轮不注入任何角色认知投影。 */
  perspectiveCharacterId?: number | null
  /** H9：生成时的信息边界；旧候选缺省时按兼容路径重建。 */
  informationBoundaryHash?: string
  /** 视角来自章节字段时，章节视角变化必须使候选过期；主 Agent 显式视角不绑定该字段。 */
  perspectiveFromChapter?: boolean
}

export interface ProseCopilotInput {
  project: Project
  scope: WorkspaceScope
  worldGroupId: number | null
  authorRequest: string
  supplementalContext: string
  inputGuidance: string
  operation: ProseCopilotOperation
  outlineNode: OutlineNode
  chapter: Chapter | null
  snapshot: ProseCopilotSnapshot
  assembled: ProseGatewayAssemblyV1
  narrativeBrief: NarrativeBriefV1
  previousTail: string
  config: AIConfig
  /** 显式叙事视角。不得让模型从正文或角色列表自行猜测。 */
  perspectiveCharacterId?: number | null
  perspectiveFromChapter?: boolean
  informationBoundary: InformationBoundaryManifestV1
  parameterValues?: Record<string, unknown>
  generationOverrides?: { temperature?: number; maxTokens?: number }
  routingCategory?: string
  signal?: AbortSignal
}

export interface PreparedProseCopilot {
  node: GenerationNode<ProseCopilotInput, string, { chapterId: number }>
  prepared: PreparedGenerationNode
  contextSources: string[]
  snapshot: ProseCopilotSnapshot
  operation: ProseCopilotOperation
  outlineNodeId: number
  label: string
  contextEvidence: AgentContextEvidence
  perspectiveCharacterId?: number | null
  informationBoundary: InformationBoundaryManifestV1
  contextGatewayExecution: ProseGatewayAssemblyV1['contextGatewayExecution']
  input: ProseCopilotInput
  modelIdentity: { provider: string; model: string }
  runRaw: (messages: ChatMessage[]) => Promise<CreativeRawModelResultV1>
}

interface ProseCopilotDependencies {
  runAI?: (messages: ReturnType<typeof buildProseMessages>) => Promise<string>
  readCurrent?: () => Promise<ProseCopilotSnapshot>
  save?: (draft: string) => Promise<{ chapterId: number }>
}

const MIN_PROSE_CHARS = 80
const MAX_PROSE_CHARS = 200_000

export class ProseCopilotStaleError extends Error {
  constructor() {
    super('目标章节或正文已在候选生成后发生变化。为保护作者手稿，请重新生成候选。')
    this.name = 'ProseCopilotStaleError'
  }
}

function fingerprintContent(value: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ (code + index), 0x85ebca6b)
  }
  return `${value.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`
}

export function parseProseCandidateDraft(draft: string): string {
  const value = draft.replace(/^```(?:markdown|text)?\s*/i, '').replace(/\s*```$/, '').trim()
  if (value.length < MIN_PROSE_CHARS) throw new Error(`正文候选至少需要 ${MIN_PROSE_CHARS} 个字符。`)
  if (value.length > MAX_PROSE_CHARS) throw new Error(`正文候选不能超过 ${MAX_PROSE_CHARS} 个字符。`)
  return value
}

function chineseOrdinal(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value)
  const digits: Record<string, number> = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9,
  }
  if (value === '十') return 10
  if (value.includes('十')) {
    const [left, right] = value.split('十')
    return (left ? digits[left] : 1) * 10 + (right ? digits[right] : 0)
  }
  return digits[value] ?? null
}

function operationFor(
  request: string,
  executionMode: AgentSkillExecutionModeV1 = 'auto',
): ProseCopilotOperation {
  if (executionMode === 'generate' || executionMode === 'continue') return executionMode
  return /续写|接着写|继续写|承接.{0,6}正文/.test(request) ? 'continue' : 'generate'
}

function scopedOutlineChapters(
  nodes: OutlineNode[],
  worldGroupId: number | null,
): ReturnType<typeof walkOutlineChaptersInCanonicalOrder>['chapters'] {
  return walkOutlineChaptersInCanonicalOrder(nodes).chapters
    .filter(item => (item.worldGroupId ?? null) === worldGroupId)
}

function selectTarget(
  request: string,
  nodes: OutlineNode[],
  chapters: Chapter[],
  worldGroupId: number | null,
  operation: ProseCopilotOperation,
): { outline: OutlineNode; chapter: Chapter | null; ordinal: number } {
  const candidates = scopedOutlineChapters(nodes, worldGroupId)
  if (!candidates.length) throw new Error('当前世界还没有章纲，请先生成章节大纲。')
  const chaptersByOutline = buildBestChapterByOutlineMap(chapters)
  const named = candidates.find(item => (
    item.outlineNode.title.trim() && request.includes(item.outlineNode.title.trim())
  ))
  const ordinalMatch = request.match(/第\s*([零〇一二两三四五六七八九十\d]+)\s*章/)
  const requestedOrdinal = ordinalMatch ? chineseOrdinal(ordinalMatch[1]) : null
  const numbered = requestedOrdinal == null
    ? undefined
    : candidates.find(item => item.ordinal === requestedOrdinal)
  const automatic = operation === 'continue'
    ? [...candidates].reverse().find(item => {
        const chapter = chaptersByOutline.get(item.outlineNode.id!)
        return Boolean(htmlToPlainText(chapter?.content ?? '').trim())
      })
    : candidates.find(item => {
        const chapter = chaptersByOutline.get(item.outlineNode.id!)
        return !htmlToPlainText(chapter?.content ?? '').trim()
      })
  const selected = named ?? numbered ?? automatic
  if (!selected?.outlineNode.id) {
    throw new Error(operation === 'continue'
      ? '没有可续写的已写章节，请明确章节或先生成正文。'
      : '没有可安全生成的空白章节；已有正文不会被默认覆盖。')
  }
  const chapter = chaptersByOutline.get(selected.outlineNode.id) ?? null
  const hasContent = Boolean(htmlToPlainText(chapter?.content ?? '').trim())
  if (operation === 'generate' && hasContent) {
    throw new Error(`《${selected.outlineNode.title}》已有正文；请明确使用“续写”，本阶段不覆盖已有手稿。`)
  }
  if (operation === 'continue' && !hasContent) {
    throw new Error(`《${selected.outlineNode.title}》尚无正文，请先生成正文。`)
  }
  return { outline: selected.outlineNode, chapter, ordinal: selected.ordinal }
}

async function snapshotOf(
  outline: OutlineNode,
  chapter: Chapter | null,
  order: number,
  perspectiveCharacterId?: number | null,
  informationBoundaryHash?: string,
  perspectiveFromChapter?: boolean,
): Promise<ProseCopilotSnapshot> {
  return {
    outlineNodeId: outline.id!,
    outlineUpdatedAt: outline.updatedAt,
    chapterId: chapter?.id ?? null,
    chapterUpdatedAt: chapter?.updatedAt ?? null,
    chapterContentHash: fingerprintContent(chapter?.content ?? ''),
    chapterHadContent: Boolean(htmlToPlainText(chapter?.content ?? '').trim()),
    chapterOrder: chapter?.order ?? Math.max(0, order - 1),
    perspectiveCharacterId,
    informationBoundaryHash,
    perspectiveFromChapter,
  }
}

async function readSnapshot(
  scope: WorkspaceScope,
  base: ProseCopilotSnapshot,
  worldGroupId: number | null,
  knownInformationBoundaryHash?: string,
): Promise<ProseCopilotSnapshot> {
  const outline = await db.outlineNodes.get(base.outlineNodeId)
  if (!outline || !await assertRecordInScope(scope, 'outlineNodes', outline, { owner: 'work' })) {
    throw new ProseCopilotStaleError()
  }
  const chapter = base.chapterId == null ? null : await db.chapters.get(base.chapterId)
  if (chapter && !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) {
    throw new ProseCopilotStaleError()
  }
  if (chapter && chapter.outlineNodeId !== base.outlineNodeId) throw new ProseCopilotStaleError()
  if (
    base.perspectiveFromChapter
    && (chapter?.perspectiveCharacterId ?? null) !== (base.perspectiveCharacterId ?? null)
  ) throw new ProseCopilotStaleError()
  if (base.chapterId == null) {
    const created = (await readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }))
      .find(row => row.outlineNodeId === base.outlineNodeId)
    if (created) throw new ProseCopilotStaleError()
  }
  const informationBoundaryHash = knownInformationBoundaryHash ?? (
    await buildChapterInformationBoundaryV1({
      scope,
      chapterId: chapter?.id ?? null,
      outlineNodeId: outline.id!,
      worldGroupId,
      perspectiveCharacterId: base.perspectiveCharacterId ?? null,
    })
  ).manifestHash
  return snapshotOf(
    outline,
    chapter ?? null,
    base.chapterOrder + 1,
    base.perspectiveCharacterId,
    informationBoundaryHash,
    base.perspectiveFromChapter,
  )
}

function sameSnapshot(left: ProseCopilotSnapshot, right: ProseCopilotSnapshot): boolean {
  return left.outlineNodeId === right.outlineNodeId
    && left.outlineUpdatedAt === right.outlineUpdatedAt
    && left.chapterId === right.chapterId
    && left.chapterUpdatedAt === right.chapterUpdatedAt
    && left.chapterContentHash === right.chapterContentHash
    && left.chapterHadContent === right.chapterHadContent
    && left.perspectiveCharacterId === right.perspectiveCharacterId
    && (left.informationBoundaryHash == null
      || left.informationBoundaryHash === right.informationBoundaryHash)
}

function candidateIssues(
  output: string,
  informationBoundary: InformationBoundaryManifestV1,
): GenerationGateIssue[] {
  const issues = validateProseInformationBoundaryV1(output, informationBoundary)
  try {
    parseProseCandidateDraft(output)
    return issues
  } catch (error) {
    return [...issues, {
      code: 'prose-invalid',
      message: error instanceof Error ? error.message : '正文候选无效。',
    }]
  }
}

function buildProseMessages(input: ProseCopilotInput) {
  const perspectiveBoundary = buildInformationBoundaryInstructionV1(input.informationBoundary)
  const charactersIndex = input.assembled.included.indexOf('characters')
  const characters = charactersIndex >= 0
    ? input.assembled.segments[charactersIndex]?.content ?? ''
    : ''
  const world = input.assembled.segments
    .filter((_, index) => index !== charactersIndex)
    .map(segment => segment.content)
    .filter(Boolean)
    .join('\n\n')
  const supplemental = input.supplementalContext.trim()
    ? `\n\n【本轮上游候选（尚未采纳，不属于 Canon）】\n${input.supplementalContext.trim()}`
    : ''
  const targetWordCount = Number(input.parameterValues?.wordCount)
  const wordCountHint = Number.isFinite(targetWordCount) && targetWordCount > 0
    ? `\n\n【节点字数目标】正文候选尽量接近 ${Math.floor(targetWordCount)} 字。`
    : ''
  const hint = [
    input.inputGuidance,
    input.authorRequest + wordCountHint + supplemental,
    formatNarrativeBriefForPromptV1(input.narrativeBrief),
  ].join('\n\n')
  if (input.operation === 'continue') {
    const context = characters ? `${world}\n\n${characters}` : world
    return buildContinuePrompt(
      htmlToPlainText(input.chapter?.content ?? ''),
      input.outlineNode.summary,
      perspectiveBoundary + '\n' + context,
      hint,
    )
  }
  const worldRulesIndex = input.assembled.included.indexOf('worldRules')
  return buildChapterContentPrompt(
    input.outlineNode.title,
    input.outlineNode.summary,
    world,
    characters,
    input.previousTail,
    worldRulesIndex >= 0 ? input.assembled.segments[worldRulesIndex]?.content ?? '' : '',
    perspectiveBoundary + '\n' + hint,
  )
}

async function adoptCandidate(input: {
  projectId: number
  worldGroupId: number | null
  operation: ProseCopilotOperation
  outline: OutlineNode
  snapshot: ProseCopilotSnapshot
  draft: string
  scope?: WorkspaceScope
}): Promise<{ chapterId: number }> {
  const candidate = parseProseCandidateDraft(input.draft)
  const workspaceScope = await resolveScope({ projectId: input.projectId, scope: input.scope })
  const informationBoundary = await buildChapterInformationBoundaryV1({
    scope: workspaceScope,
    chapterId: input.snapshot.chapterId,
    outlineNodeId: input.outline.id!,
    worldGroupId: input.worldGroupId,
    perspectiveCharacterId: input.snapshot.perspectiveCharacterId ?? null,
  })
  if (
    input.snapshot.informationBoundaryHash != null
    && informationBoundary.manifestHash !== input.snapshot.informationBoundaryHash
  ) throw new ProseCopilotStaleError()
  const boundaryIssues = validateProseInformationBoundaryV1(candidate, informationBoundary)
  if (boundaryIssues.length) throw new Error(boundaryIssues.map(issue => issue.message).join('；'))
  const chapterId = await db.transaction(
    'rw',
    scopeTransactionTables(
      db.chapters,
      db.outlineNodes,
      db.retrievalChunks,
      db.narrativeSummaryNodes,
    ),
    async () => {
      const current = await readSnapshot(
        workspaceScope,
        input.snapshot,
        input.worldGroupId,
        informationBoundary.manifestHash,
      )
      if (!sameSnapshot(current, input.snapshot)) throw new ProseCopilotStaleError()
      const chapter = current.chapterId == null ? null : await db.chapters.get(current.chapterId)
      const candidateHtml = plainTextToHtml(candidate)
      const content = input.operation === 'continue'
        ? `${chapter?.content ?? ''}${candidateHtml}`
        : candidateHtml
      const data = {
        outlineNodeId: input.outline.id!,
        title: input.outline.title,
        content,
        wordCount: countWords(htmlToPlainText(content)),
        status: 'draft' as const,
        order: current.chapterOrder,
        notes: chapter?.notes ?? '',
      }
      const result = chapter?.id == null
          ? await adopt({
            projectId: input.projectId,
            scope: workspaceScope,
            worldGroupId: input.worldGroupId,
            target: 'chapters',
            mode: 'add',
            data,
          })
        : await adopt({
            projectId: input.projectId,
            scope: workspaceScope,
            worldGroupId: input.worldGroupId,
            target: 'chapters',
            recordId: chapter.id,
            mode: 'replace',
            data: {
              content: data.content,
              wordCount: data.wordCount,
              status: data.status,
            },
          })
      const writtenId = result.written[0]?.id
      if (writtenId == null || result.skipped.length || result.typeErrors.length || result.fkErrors.length) {
        throw new Error('正文候选没有完整写入，事务已回滚。')
      }
      const oldChunkIds = await db.retrievalChunks.where('sourceChapterId').equals(writtenId).primaryKeys()
      if (oldChunkIds.length) await db.retrievalChunks.bulkDelete(oldChunkIds as number[])
      const summaries = await readOwnedRows<any>(workspaceScope, 'narrativeSummaryNodes', { owner: 'work' })
      for (const summary of summaries) {
        if (summary.id != null && (
          summary.level === 'book'
          || summary.level === 'volume'
          || summary.sourceChapterId === writtenId
        )) {
          await db.narrativeSummaryNodes.update(summary.id, { status: 'stale', updatedAt: Date.now() })
        }
      }
      return writtenId
    },
  )
  const [chapter, characters] = await Promise.all([
    db.chapters.get(chapterId),
    readOwnedRows<any>(workspaceScope, 'characters', { owner: 'world' }),
  ])
  if (chapter) {
    await rebuildChapterChunks({
      projectId: input.projectId,
      chapter,
      worldGroupId: input.worldGroupId,
      knownEntities: characters.map(character => character.name),
    })
  }
  return { chapterId }
}

export async function adoptRestoredProseCandidate(input: {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  operation: ProseCopilotOperation
  outlineNodeId: number
  snapshot: ProseCopilotSnapshot
  draft: string
}): Promise<{ chapterId: number }> {
  const scope = await resolveScope({ projectId: input.projectId, scope: input.scope })
  const outline = await db.outlineNodes.get(input.outlineNodeId)
  if (!await assertRecordInScope(scope, 'outlineNodes', outline, { owner: 'work' })) {
    throw new ProseCopilotStaleError()
  }
  return adoptCandidate({ ...input, outline: outline!, scope })
}

export async function prepareProseCopilot(input: {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  authorRequest: string
  skillId?: AgentSkillId
  supplementalContext?: string
  routingCategory?: string
  contextProfile?: AgentContextProfile
  parameterValues?: Record<string, unknown>
  /** 节点级 AI preset 的解析结果；未提供时沿用全局路由配置。 */
  configOverride?: AIConfig
  /** 明确的叙事视角角色；未传时正文主路径不注入全体角色认知。 */
  perspectiveCharacterId?: number | null
  generationOverrides?: { temperature?: number; maxTokens?: number }
  contextCompressionRuntime?: AgentContextCompressionRuntimeV1
  inheritedAssumptions?: readonly CreativeAssumptionV1[]
  signal?: AbortSignal
}, dependencies: ProseCopilotDependencies = {}): Promise<PreparedProseCopilot> {
  const project = await db.projects.get(input.projectId)
  if (!project) throw new Error('项目不存在。')
  if (project.enableMultiWorld && input.worldGroupId == null) {
    throw new Error('多世界项目必须先选择一个世界，才能生成正文。')
  }
  const worldGroupId = project.enableMultiWorld ? input.worldGroupId : null
  const request = input.authorRequest.trim()
  if (request.length < 2 || request.length > 2000) throw new Error('正文要求长度必须在 2–2000 字符之间。')
  if (/重写|改写|覆盖|替换.{0,6}正文/.test(request)) {
    throw new Error('主 Agent 正文领域当前不覆盖已有手稿；请使用正文编辑器的对照改写能力。')
  }
  const skill = resolveAgentSkillV1('prose', input.skillId)
  const scope = await resolveScope({ projectId: input.projectId, scope: input.scope })
  const [nodes, chapters] = await Promise.all([
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
  ])
  const operation = operationFor(request, skill.executionMode)
  const target = selectTarget(request, nodes, chapters, worldGroupId, operation)
  const perspectiveCharacterId = input.perspectiveCharacterId === undefined
    ? target.chapter?.perspectiveCharacterId ?? null
    : input.perspectiveCharacterId
  const perspectiveFromChapter = input.perspectiveCharacterId === undefined
  const defaultCategory = operation === 'continue' ? 'chapter.continue' : 'chapter.content'
  const routingCategory = input.routingCategory ?? defaultCategory
  const config = input.configOverride ?? resolveRequestConfig(
    useAIConfigStore.getState().config,
    { category: routingCategory },
  ).config
  const contextProfile = input.contextProfile ?? 'full'
  if (perspectiveCharacterId != null) {
    const character = await db.characters.get(perspectiveCharacterId)
    const visible = character
      && await assertRecordInScope(scope, 'characters', character, { owner: 'world' })
      && (Boolean(character.isCrossWorld) || (character.homeWorldGroupId ?? null) === worldGroupId)
    if (!visible) throw new Error('正文叙事视角角色不存在或不属于当前世界。')
  }
  const informationBoundary = await buildChapterInformationBoundaryV1({
    scope,
    chapterId: target.chapter?.id ?? null,
    outlineNodeId: target.outline.id!,
    worldGroupId,
    perspectiveCharacterId,
  })
  const snapshot = await snapshotOf(
    target.outline,
    target.chapter,
    target.ordinal,
    perspectiveCharacterId,
    informationBoundary.manifestHash,
    perspectiveFromChapter,
  )
  const assembled = await prepareProseGatewayAssemblyV1({
    projectId: input.projectId,
    scope,
    worldGroupId,
    operation,
    outlineNodeId: target.outline.id!,
    chapterId: target.chapter?.id ?? null,
    authorRequest: request,
    perspectiveCharacterId,
    config,
    contextProfile,
    allowOutlineOnlyAgentDraft: true,
    signal: input.signal,
  })
  const current = await readSnapshot(scope, snapshot, worldGroupId)
  if (!sameSnapshot(current, snapshot)) throw new ProseCopilotStaleError()
  const inputState = projectContextGatewayInputStateV1(
    skill,
    assembled.contextGatewayExecution,
    assembled,
  )
  const contextEvidence = attachAgentContextInputStateV1(
    evidenceFromContextResult(contextProfile, assembled),
    inputState,
  )
  contextEvidence.inputStateSourceKeys = contextGatewayInputStateSourceKeysV1(
    skill,
    assembled.contextGatewayExecution,
  )
  const inputGuidance = buildAgentSkillInputGuidanceV1(skill, inputState)
  const narrativeBrief = buildNarrativeBriefV1({
    authorRequest: request,
    assembled,
    inheritedAssumptions: input.inheritedAssumptions,
  })
  const nodeInput: ProseCopilotInput = {
    project,
    scope,
    worldGroupId,
    authorRequest: request,
    supplementalContext: input.supplementalContext ?? '',
    inputGuidance,
    operation,
    outlineNode: target.outline,
    chapter: target.chapter,
    snapshot,
    assembled,
    narrativeBrief,
    previousTail: '',
    config,
    parameterValues: input.parameterValues,
    perspectiveCharacterId,
    perspectiveFromChapter,
    informationBoundary,
    generationOverrides: input.generationOverrides,
    routingCategory,
    signal: input.signal,
  }
  const runRaw = async (messages: ChatMessage[]): Promise<CreativeRawModelResultV1> => {
    const startedAt = Date.now()
    const result: ChatResult = {}
    const output = dependencies.runAI
      ? await dependencies.runAI(messages)
      : await chat(messages, config, {
          category: routingCategory,
          projectId: input.projectId,
          configOverrides: {
            maxTokens: input.generationOverrides?.maxTokens ?? 16_000,
            ...(input.generationOverrides?.temperature != null
              ? { temperature: input.generationOverrides.temperature }
              : {}),
          },
          contextOverflowPolicy: 'reject',
        }, input.signal, result)
    return {
      output,
      ...(result.usage ? { usage: result.usage } : {}),
      durationMs: Math.max(0, Date.now() - startedAt),
    }
  }
  const node = createProseCopilotNode(nodeInput, {
    ...dependencies,
    runAI: async messages => (await runRaw(messages)).output,
  })
  return {
    node,
    prepared: prepareGenerationNode(node, nodeInput),
    contextSources: assembled.included,
    snapshot,
    operation,
    outlineNodeId: target.outline.id!,
    contextEvidence,
    perspectiveCharacterId,
    informationBoundary,
    contextGatewayExecution: assembled.contextGatewayExecution,
    input: nodeInput,
    modelIdentity: { provider: config.provider, model: config.model },
    runRaw,
    label: operation === 'continue'
      ? `续写《${target.outline.title}》`
      : `《${target.outline.title}》正文`,
  }
}

const PROSE_MOTION_SIGNAL = /决定|选择|拒绝|答应|追|逃|进入|离开|推开|抓住|放下|寻找|阻止|发现|失去|得到|改变|打断|转身|冲向|退后|开口|回答/

function parseProseCreativeOutcomeV1(
  raw: string,
  prepared: PreparedProseCopilot,
): CreativeParseOutcomeV1<string> {
  if (raw.length > MAX_PROSE_CHARS) {
    const issue = createCreativeIssueV1({
      code: 'prose-response-too-large',
      path: '$',
      message: `正文响应超过 ${MAX_PROSE_CHARS} 字符，不能安全持久化。`,
      disposition: 'blocking',
      action: 'replan',
    })
    return {
      status: 'blocked',
      output: raw.slice(0, MAX_PROSE_CHARS),
      editableText: raw.slice(0, MAX_PROSE_CHARS),
      validFragments: [],
      rejectedFragments: [{
        version: 1,
        id: 'prose-response',
        path: '$',
        text: raw.slice(0, 40_000),
        status: 'rejected',
        issueCodes: [issue.code],
      }],
      issues: [issue],
      assumptions: prepared.input.narrativeBrief.assumptions,
    }
  }
  try {
    const output = parseProseCandidateDraft(raw)
    const gateIssues = candidateIssues(output, prepared.informationBoundary)
    const issues = gateIssues.map(item => createCreativeIssueV1({
      code: item.code,
      path: '$',
      message: item.message,
      disposition: 'blocking',
      action: 'repair-once',
    }))
    if (!PROSE_MOTION_SIGNAL.test(output)) {
      issues.push(createCreativeIssueV1({
        code: 'prose-narrative-motion-weak',
        path: '$',
        message: '没有识别到明确的行动、选择或状态变化信号；正文仍可用，但建议作者检查是否真正推进了故事。',
        severity: 'warning',
        disposition: 'advisory',
        action: 'none',
        deterministic: false,
      }))
    }
    const hasBlocking = issues.some(issue => issue.disposition === 'blocking')
    return {
      status: hasBlocking ? 'blocked' : issues.length ? 'usable-with-warnings' : 'ready',
      output,
      editableText: output,
      validFragments: [{
        version: 1,
        id: 'prose:body',
        path: '$',
        text: output.slice(0, 40_000),
        status: 'valid',
        issueCodes: [],
      }],
      rejectedFragments: [],
      issues,
      assumptions: prepared.input.narrativeBrief.assumptions,
    }
  } catch (error) {
    const issue = createCreativeIssueV1({
      code: 'prose-response-invalid',
      path: '$',
      message: error instanceof Error ? error.message : '正文响应无效。',
    })
    return {
      status: 'manual-repair',
      output: raw.trim(),
      editableText: raw.trim(),
      validFragments: [],
      rejectedFragments: [{
        version: 1,
        id: 'prose-response',
        path: '$',
        text: raw.slice(0, 40_000),
        status: 'rejected',
        issueCodes: [issue.code],
      }],
      issues: [issue],
      assumptions: prepared.input.narrativeBrief.assumptions,
    }
  }
}

function buildProseRepairMessagesV1(
  raw: string,
  issues: readonly CreativeArtifactIssueV1[],
): ChatMessage[] {
  return [{
    role: 'system',
    content: [
      '你是正文局部问题修复器，只修列出的确定性问题。',
      '保留原文中所有未被点名的情节、段落顺序、人物行为、语气和事实，不整体重写。',
      '不得引入新人物、新设定、新因果或提前泄露角色未知信息。',
      '返回修复后的完整正文，不要解释，不要 Markdown 围栏。',
    ].join('\n'),
  }, {
    role: 'user',
    content: [
      '【只允许修复的问题】',
      JSON.stringify(issues.map(issue => ({ code: issue.code, path: issue.path }))),
      '【上一次原始正文】',
      raw,
    ].join('\n'),
  }]
}

export async function runProseCreativeReliabilityV1(input: {
  prepared: PreparedProseCopilot
  budget: AgentTeamBudgetTracker
  qualityMode: CreativeQualityModeV1
  validate?: (output: string) => Promise<GenerationGateIssue[]> | GenerationGateIssue[]
}): Promise<CreativeExecutionResultV1<string>> {
  return runCreativeExecutionV1({
    initialMessages: input.prepared.prepared.messages,
    runRaw: input.prepared.runRaw,
    parse: raw => parseProseCreativeOutcomeV1(raw, input.prepared),
    buildRepairMessages: buildProseRepairMessagesV1,
    validate: input.validate,
    budget: input.budget,
    callLabel: '正文领域 Agent',
    maxOutputTokens: input.prepared.input.generationOverrides?.maxTokens ?? 16_000,
    qualityMode: input.qualityMode,
    modelIdentity: input.prepared.modelIdentity,
    canonEvidenceRefs: input.prepared.contextEvidence.sourceEvidence
      ?.filter(item => item.status === 'included' && item.sourceHash)
      .map(item => `${item.key}:${item.sourceHash}`),
  })
}

export function revalidateProseCreativeDraftV1(input: {
  draft: string
  informationBoundary: InformationBoundaryManifestV1
  previousArtifact: CreativeArtifactV1
}): CreativeArtifactV1 {
  let status: CreativeArtifactV1['status'] = 'ready'
  let validFragments: CreativeArtifactV1['validFragments'] = []
  let rejectedFragments: CreativeArtifactV1['rejectedFragments'] = []
  let issues: CreativeArtifactV1['issues'] = []
  try {
    const output = parseProseCandidateDraft(input.draft)
    const gateIssues = candidateIssues(output, input.informationBoundary)
    issues = gateIssues.map(item => createCreativeIssueV1({
      code: item.code,
      path: '$',
      message: item.message,
      disposition: 'blocking',
      action: 'edit',
    }))
    if (!PROSE_MOTION_SIGNAL.test(output)) {
      issues.push(createCreativeIssueV1({
        code: 'prose-narrative-motion-weak',
        path: '$',
        message: '没有识别到明确的行动、选择或状态变化信号；正文仍可用，但建议作者检查是否真正推进了故事。',
        severity: 'warning',
        disposition: 'advisory',
        action: 'none',
        deterministic: false,
      }))
    }
    status = issues.some(issue => issue.disposition === 'blocking')
      ? 'blocked'
      : issues.length
        ? 'usable-with-warnings'
        : 'ready'
    validFragments = [{
      version: 1,
      id: 'prose:body',
      path: '$',
      text: output.slice(0, 40_000),
      status: 'valid',
      issueCodes: [],
    }]
  } catch (error) {
    status = 'manual-repair'
    issues = [createCreativeIssueV1({
      code: 'prose-author-draft-invalid',
      path: '$',
      message: error instanceof Error ? error.message : '作者修订的正文无效。',
      action: 'edit',
    })]
    rejectedFragments = [{
      version: 1,
      id: 'prose-author-draft',
      path: '$',
      text: input.draft.slice(0, 40_000),
      status: 'rejected',
      issueCodes: issues.map(issue => issue.code),
    }]
  }
  return parseCreativeArtifactV1({
    ...input.previousArtifact,
    status,
    editableText: input.draft.slice(0, MAX_PROSE_CHARS),
    validFragments,
    rejectedFragments,
    issues,
  })
}

export function createProseCopilotNode(
  input: ProseCopilotInput,
  dependencies: ProseCopilotDependencies = {},
): PreparedProseCopilot['node'] {
  const readCurrent = dependencies.readCurrent
    ?? (() => readSnapshot(input.scope, input.snapshot, input.worldGroupId))
  const save = dependencies.save ?? (draft => adoptCandidate({
    projectId: input.project.id!,
    worldGroupId: input.worldGroupId,
    operation: input.operation,
    outline: input.outlineNode,
    snapshot: input.snapshot,
    draft,
    scope: input.scope,
  }))
  const runAI = dependencies.runAI ?? (messages => chat(messages, input.config, {
    category: input.routingCategory ?? (input.operation === 'continue' ? 'chapter.continue' : 'chapter.content'),
    projectId: input.project.id!,
    configOverrides: {
      maxTokens: input.generationOverrides?.maxTokens ?? 16_000,
      ...(input.generationOverrides?.temperature != null
        ? { temperature: input.generationOverrides.temperature }
        : {}),
    },
    contextOverflowPolicy: 'reject',
  }, input.signal))
  return {
    id: `agent.chat-copilot.prose:${input.project.id}:${input.outlineNode.id}:${input.operation}:${input.snapshot.chapterUpdatedAt ?? 'new'}`,
    kind: input.operation === 'continue' ? 'chapter.continue' : 'chapter.content',
    editableInput: true,
    assembleInput: buildProseMessages,
    run: async messages => parseProseCandidateDraft(await runAI(messages)),
    gate: output => {
      const issues = candidateIssues(output, input.informationBoundary)
      return { status: issues.length ? 'blocked' : 'pass', issues }
    },
    adopt: async output => {
      const current = await readCurrent()
      if (!sameSnapshot(current, input.snapshot)) throw new ProseCopilotStaleError()
      return save(parseProseCandidateDraft(output))
    },
  }
}
