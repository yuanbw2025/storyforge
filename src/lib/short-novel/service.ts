import { db } from '../db/schema'
import { hashCanonicalValue, canonicalStringify } from '../agent/run/hash'
import { walkOutlineChaptersInCanonicalOrder } from '../outline/canonical-outline-walk'
import { buildBestChapterByOutlineMap, chapterContentWordCount } from '../chapters/selectors'
import { countWords, htmlToPlainText, plainTextToHtml } from '../utils/html'
import { readOwnedRows, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { deriveShortNovelStructure, SHORT_NOVEL_MAX_WORDS, SHORT_NOVEL_MIN_WORDS } from '../workspace/work-kind'
import { parseAndVerifyCreationReleaseManifestV1 } from '../creation-release/contracts'
import type {
  Chapter,
  CreationReleaseV1,
  OutlineNode,
  ShortNovelBriefV1,
  ShortNovelChapterDraftV1,
  ShortNovelChapterPlanV1,
  ShortNovelFrozenChapterV1,
  ShortNovelProductionV1,
  ShortNovelReleaseManifestV1,
  ShortNovelReviewIssueV1,
  ShortNovelReviewV1,
  ShortNovelStoryDesignV1,
  Work,
  WorkspaceScope,
} from '../types'
import {
  parseShortNovelBriefV1,
  parseShortNovelChapterDraftV1,
  parseShortNovelChapterPlanV1,
  parseShortNovelReviewV1,
  parseShortNovelStoryDesignV1,
} from './contracts'

export interface ShortNovelManuscriptSnapshotV1 {
  work: Work & { id: number }
  outlineNodes: OutlineNode[]
  chapters: ShortNovelFrozenChapterV1[]
  manuscriptHash: string
  sourceJson: string
  anomalies: string[]
}

export interface ShortNovelCompletionReportV1 {
  ready: boolean
  wordCount: number
  blockers: string[]
  warnings: string[]
  manuscriptHash: string
}

async function readShortNovelSourceGuardV1(scope: WorkspaceScope): Promise<string> {
  const [work, outlines, chapters] = await Promise.all([
    db.works.get(scope.workId),
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
  ])
  assertShortWork(work, scope)
  return canonicalStringify({
    work: { id: work.id, title: work.title, description: work.description, genres: work.genres, targetWordCount: work.targetWordCount, updatedAt: work.updatedAt },
    outlines: outlines.map(row => ({ id: row.id, parentId: row.parentId, type: row.type, title: row.title, summary: row.summary, order: row.order, updatedAt: row.updatedAt })).sort((a, b) => (a.id ?? 0) - (b.id ?? 0)),
    chapters: chapters.map(row => ({ id: row.id, outlineNodeId: row.outlineNodeId, title: row.title, content: row.content, order: row.order, updatedAt: row.updatedAt })).sort((a, b) => (a.id ?? 0) - (b.id ?? 0)),
  })
}

function assertShortWork(work: Work | undefined, scope: WorkspaceScope): asserts work is Work & { id: number } {
  if (!work?.id || work.id !== scope.workId || work.projectId !== scope.projectId || work.worldId !== scope.worldId) throw new Error('[short-novel] 当前 Work 不存在或越界')
  if (work.kind !== 'novel' || work.novelProfile !== 'short') throw new Error('[short-novel] 当前 Work 不是短篇小说产品')
}

export function buildShortNovelProductionRecordV1(scope: WorkspaceScope, now = Date.now()): ShortNovelProductionV1 {
  return {
    projectId: scope.projectId,
    worldId: scope.worldId,
    workId: scope.workId,
    phase: 'intent',
    revision: 1,
    brief: null,
    briefConfirmedAt: null,
    storyDesign: null,
    designConfirmedAt: null,
    latestReview: null,
    reviewedManuscriptHash: null,
    currentReleaseId: null,
    createdAt: now,
    updatedAt: now,
  }
}

async function createSkeletonIfMissing(scope: WorkspaceScope, work: Work, now: number): Promise<void> {
  const existing = await readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' })
  if (existing.some(node => node.type === 'chapter')) return
  const structure = deriveShortNovelStructure(work.targetWordCount)
  const volume = stampNewRecord(scope, 'outlineNodes', {
    projectId: scope.projectId, parentId: null, type: 'volume' as const, title: '短篇正文', summary: '', order: 0, createdAt: now, updatedAt: now,
  }, { owner: 'work' })
  const volumeId = await db.outlineNodes.add(volume) as number
  for (let index = 0; index < structure.chapterCount; index += 1) {
    const title = `第${index + 1}章`
    const outline = stampNewRecord(scope, 'outlineNodes', {
      projectId: scope.projectId, parentId: volumeId, type: 'chapter' as const, title, summary: '', order: index, createdAt: now, updatedAt: now,
    }, { owner: 'work' })
    const outlineNodeId = await db.outlineNodes.add(outline) as number
    await db.chapters.add(stampNewRecord(scope, 'chapters', {
      projectId: scope.projectId, outlineNodeId, title, content: '', wordCount: 0, status: 'outline' as const, order: index, notes: '', createdAt: now, updatedAt: now,
    }, { owner: 'work' }))
  }
}

export async function ensureShortNovelProductionV1(scope: WorkspaceScope): Promise<ShortNovelProductionV1 & { id: number }> {
  const existing = await db.shortNovelProductions.where('workId').equals(scope.workId).first()
  if (existing?.id) {
    if (existing.projectId !== scope.projectId || existing.worldId !== scope.worldId) throw new Error('[short-novel] 生产根 owner 与当前 Work 不一致')
    return existing as ShortNovelProductionV1 & { id: number }
  }
  return db.transaction('rw', scopeTransactionTables(db.shortNovelProductions, db.outlineNodes, db.chapters), async () => {
    const work = await db.works.get(scope.workId)
    assertShortWork(work, scope)
    const concurrent = await db.shortNovelProductions.where('workId').equals(scope.workId).first()
    if (concurrent?.id) return concurrent as ShortNovelProductionV1 & { id: number }
    const now = Date.now()
    await createSkeletonIfMissing(scope, work, now)
    const row = buildShortNovelProductionRecordV1(scope, now)
    const id = await db.shortNovelProductions.add(row) as number
    return { ...row, id }
  })
}

export async function buildShortNovelManuscriptSnapshotV1(scope: WorkspaceScope): Promise<ShortNovelManuscriptSnapshotV1> {
  const [work, outlineNodes, chapterRows] = await Promise.all([
    db.works.get(scope.workId),
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
  ])
  assertShortWork(work, scope)
  const walk = walkOutlineChaptersInCanonicalOrder(outlineNodes)
  const chapterByOutline = buildBestChapterByOutlineMap(chapterRows)
  const chapters: ShortNovelFrozenChapterV1[] = []
  for (const item of walk.chapters) {
    const node = item.outlineNode
    const chapter = node.id == null ? undefined : chapterByOutline.get(node.id)
    const contentHtml = chapter?.content ?? ''
    chapters.push({
      stableKey: `chapter-${item.ordinal}`,
      order: item.ordinal - 1,
      title: node.title,
      summary: node.summary,
      contentHtml,
      wordCount: chapter ? chapterContentWordCount(chapter) : 0,
      contentHash: await hashCanonicalValue({ title: node.title, summary: node.summary, contentHtml }),
    })
  }
  const source = {
    work: { code: work.code, title: work.title, description: work.description, genres: work.genres, targetWordCount: work.targetWordCount },
    chapters,
  }
  const sourceJson = canonicalStringify(source)
  return {
    work,
    outlineNodes,
    chapters,
    manuscriptHash: await hashCanonicalValue(source),
    sourceJson,
    anomalies: walk.anomalies.map(item => item.detail),
  }
}

async function updateProductionV1(input: {
  scope: WorkspaceScope
  expectedRevision: number
  patch: Partial<ShortNovelProductionV1>
}): Promise<ShortNovelProductionV1 & { id: number }> {
  return db.transaction('rw', db.shortNovelProductions, db.works, db.worlds, async () => {
    const current = await db.shortNovelProductions.where('workId').equals(input.scope.workId).first()
    if (!current?.id || current.projectId !== input.scope.projectId || current.worldId !== input.scope.worldId) throw new Error('[short-novel] 生产根不存在或越界')
    if (current.revision !== input.expectedRevision) throw new Error('[short-novel] 生产状态已变化，请刷新后重试')
    const next = { ...input.patch, revision: current.revision + 1, updatedAt: Date.now() }
    await db.shortNovelProductions.update(current.id, next)
    return { ...current, ...next } as ShortNovelProductionV1 & { id: number }
  })
}

export async function confirmShortNovelBriefV1(input: { scope: WorkspaceScope; expectedRevision: number; brief: ShortNovelBriefV1 }): Promise<ShortNovelProductionV1 & { id: number }> {
  const brief = parseShortNovelBriefV1(input.brief)
  const work = await db.works.get(input.scope.workId); assertShortWork(work, input.scope)
  if (brief.targetWordCount !== work.targetWordCount) throw new Error('[short-novel] Brief 目标字数必须与当前 Work 一致')
  return updateProductionV1({ scope: input.scope, expectedRevision: input.expectedRevision, patch: { brief, briefConfirmedAt: Date.now(), storyDesign: null, designConfirmedAt: null, latestReview: null, reviewedManuscriptHash: null, phase: 'design' } })
}

export async function confirmShortNovelStoryDesignV1(input: { scope: WorkspaceScope; expectedRevision: number; storyDesign: ShortNovelStoryDesignV1 }): Promise<ShortNovelProductionV1 & { id: number }> {
  const production = await db.shortNovelProductions.where('workId').equals(input.scope.workId).first()
  if (!production?.briefConfirmedAt) throw new Error('[short-novel] 请先确认创作 Brief')
  return updateProductionV1({ scope: input.scope, expectedRevision: input.expectedRevision, patch: { storyDesign: parseShortNovelStoryDesignV1(input.storyDesign), designConfirmedAt: Date.now(), latestReview: null, reviewedManuscriptHash: null, phase: 'planning' } })
}

export async function adoptShortNovelChapterPlanV1(input: { scope: WorkspaceScope; expectedRevision: number; plan: ShortNovelChapterPlanV1[] }): Promise<ShortNovelProductionV1 & { id: number }> {
  const plan = parseShortNovelChapterPlanV1(input.plan)
  const before = await buildShortNovelManuscriptSnapshotV1(input.scope)
  const totalBudget = plan.reduce((sum, item) => sum + item.targetWordCount, 0)
  if (Math.abs(totalBudget - before.work.targetWordCount) > Math.max(500, before.work.targetWordCount * 0.1)) throw new Error('[short-novel] 章节预算总和必须接近作品目标字数')
  if (plan.length !== before.chapters.length) throw new Error('[short-novel] 章节计划数量必须与当前短篇骨架一致')
  return db.transaction('rw', scopeTransactionTables(db.shortNovelProductions, db.outlineNodes, db.chapters), async () => {
    const production = await db.shortNovelProductions.where('workId').equals(input.scope.workId).first()
    if (!production?.id || production.revision !== input.expectedRevision || !production.designConfirmedAt) throw new Error('[short-novel] 生产状态已变化或故事设计尚未确认')
    const nodes = await readOwnedRows<OutlineNode>(input.scope, 'outlineNodes', { owner: 'work' })
    const chapterRows = await readOwnedRows<Chapter>(input.scope, 'chapters', { owner: 'work' })
    const walk = walkOutlineChaptersInCanonicalOrder(nodes)
    if (walk.chapters.length !== plan.length || walk.anomalies.length) throw new Error('[short-novel] 当前大纲结构已变化或存在异常')
    const chapterByOutline = buildBestChapterByOutlineMap(chapterRows)
    const now = Date.now()
    for (let index = 0; index < plan.length; index += 1) {
      const item = plan[index]
      const outline = walk.chapters[index].outlineNode
      const summary = [`目标：${item.purpose}`, `开场压力：${item.openingPressure}`, `冲突：${item.conflict}`, `转折：${item.turn}`, `离场状态：${item.exitState}`, `视角：${item.viewpoint}`, `字数预算：${item.targetWordCount}`].join('\n')
      await db.outlineNodes.update(outline.id!, { title: item.title, summary, order: item.order, updatedAt: now })
      const chapter = chapterByOutline.get(outline.id!)
      if (chapter?.id) await db.chapters.update(chapter.id, { title: item.title, order: item.order, updatedAt: now })
    }
    const next = { phase: 'drafting' as const, latestReview: null, reviewedManuscriptHash: null, revision: production.revision + 1, updatedAt: now }
    await db.shortNovelProductions.update(production.id, next)
    return { ...production, ...next } as ShortNovelProductionV1 & { id: number }
  })
}

export async function adoptShortNovelChapterDraftV1(input: { scope: WorkspaceScope; expectedRevision: number; draft: ShortNovelChapterDraftV1; rewrite?: boolean }): Promise<ShortNovelProductionV1 & { id: number }> {
  const draft = parseShortNovelChapterDraftV1(input.draft)
  return db.transaction('rw', scopeTransactionTables(db.shortNovelProductions, db.outlineNodes, db.chapters), async () => {
    const production = await db.shortNovelProductions.where('workId').equals(input.scope.workId).first()
    if (!production?.id || production.revision !== input.expectedRevision || !production.designConfirmedAt) throw new Error('[short-novel] 生产状态已变化或故事设计尚未确认')
    const nodes = await readOwnedRows<OutlineNode>(input.scope, 'outlineNodes', { owner: 'work' })
    const chapters = await readOwnedRows<Chapter>(input.scope, 'chapters', { owner: 'work' })
    const walk = walkOutlineChaptersInCanonicalOrder(nodes)
    const ordinal = Number(draft.chapterKey.split('-')[1])
    const outline = walk.chapters[ordinal - 1]?.outlineNode
    const chapter = outline?.id == null ? undefined : buildBestChapterByOutlineMap(chapters).get(outline.id)
    if (!outline?.id || !chapter?.id) throw new Error('[short-novel] 目标章节不存在')
    const content = plainTextToHtml(draft.content)
    const now = Date.now()
    await db.outlineNodes.update(outline.id, { title: draft.title, updatedAt: now })
    await db.chapters.update(chapter.id, { title: draft.title, content, wordCount: countWords(draft.content), status: 'draft', updatedAt: now })
    const next = { phase: input.rewrite ? 'review' as const : 'drafting' as const, latestReview: null, reviewedManuscriptHash: null, revision: production.revision + 1, updatedAt: now }
    await db.shortNovelProductions.update(production.id, next)
    return { ...production, ...next } as ShortNovelProductionV1 & { id: number }
  })
}

export async function adoptShortNovelReviewV1(input: { scope: WorkspaceScope; expectedRevision: number; expectedManuscriptHash: string; review: ShortNovelReviewV1 }): Promise<ShortNovelProductionV1 & { id: number }> {
  const review = parseShortNovelReviewV1(input.review)
  const current = await buildShortNovelManuscriptSnapshotV1(input.scope)
  if (current.manuscriptHash !== input.expectedManuscriptHash) throw new Error('[short-novel] 手稿已变化，审校候选已 stale')
  assertShortNovelReviewEvidenceV1(review, current.chapters)
  const phase = review.issues.some(issue => issue.severity === 'critical' && issue.status === 'open') ? 'review' : 'release-ready'
  return updateProductionV1({ scope: input.scope, expectedRevision: input.expectedRevision, patch: { latestReview: review, reviewedManuscriptHash: current.manuscriptHash, phase } })
}

function quotedEvidenceSpansV1(evidence: string): string[] {
  const spans: string[] = []
  const pattern = /(?:“([^”\n]{4,120})”|「([^」\n]{4,120})」|『([^』\n]{4,120})』|"([^"\n]{4,120})")/g
  for (const match of evidence.matchAll(pattern)) {
    const span = match.slice(1).find(value => value != null)?.trim()
    if (span) spans.push(span)
  }
  return spans
}

/**
 * 审校问题不能只靠模型声称“见过”正文。每个问题都必须引用目标章节中
 * 实际存在的短文本；这样伪造时间线、人物或事件的 critic 候选会在采纳前失败。
 */
export function assertShortNovelReviewEvidenceV1(
  review: ShortNovelReviewV1,
  chapters: ShortNovelFrozenChapterV1[],
): void {
  const chapterByKey = new Map(chapters.map(chapter => [chapter.stableKey, chapter]))
  for (const issue of review.issues) {
    const targets = issue.chapterKeys.map(key => chapterByKey.get(key))
    if (targets.some(chapter => !chapter)) throw new Error(`[short-novel] 审校问题 ${issue.stableKey} 引用了不存在的章节`)
    const quotes = quotedEvidenceSpansV1(issue.evidence)
    if (!quotes.length) throw new Error(`[short-novel] 审校问题 ${issue.stableKey} 的 evidence 必须包含带引号的实际短引文`)
    const corpus = targets
      .map(chapter => `${chapter!.title}\n${chapter!.summary}\n${htmlToPlainText(chapter!.contentHtml)}`)
      .join('\n')
    const missing = quotes.find(quote => !corpus.includes(quote))
    if (missing) throw new Error(`[short-novel] 审校问题 ${issue.stableKey} 的证据引文不在目标章节：${missing}`)
  }
}

export async function resolveShortNovelReviewIssueV1(input: { scope: WorkspaceScope; expectedRevision: number; issueKey: string; decision: 'resolved' | 'dismissed' }): Promise<ShortNovelProductionV1 & { id: number }> {
  const production = await db.shortNovelProductions.where('workId').equals(input.scope.workId).first()
  if (!production?.latestReview) throw new Error('[short-novel] 当前没有已采纳审校结果')
  const exists = production.latestReview.issues.some(issue => issue.stableKey === input.issueKey)
  if (!exists) throw new Error('[short-novel] 审校问题不存在')
  const latestReview = { ...production.latestReview, issues: production.latestReview.issues.map(issue => issue.stableKey === input.issueKey ? { ...issue, status: input.decision } : issue) }
  const phase = latestReview.issues.some(issue => issue.severity === 'critical' && issue.status === 'open') ? 'review' : 'release-ready'
  return updateProductionV1({ scope: input.scope, expectedRevision: input.expectedRevision, patch: { latestReview, phase } })
}

export async function inspectShortNovelCompletionV1(scope: WorkspaceScope): Promise<ShortNovelCompletionReportV1> {
  const [production, snapshot, runs] = await Promise.all([
    ensureShortNovelProductionV1(scope),
    buildShortNovelManuscriptSnapshotV1(scope),
    readOwnedRows<any>(scope, 'agentRuns', { owner: 'work' }),
  ])
  const blockers: string[] = []
  const warnings: string[] = []
  const wordCount = snapshot.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0)
  if (!production.briefConfirmedAt || !production.brief) blockers.push('创作 Brief 尚未确认')
  if (!production.designConfirmedAt || !production.storyDesign) blockers.push('故事设计尚未确认')
  if (snapshot.anomalies.length) blockers.push(`大纲结构异常：${snapshot.anomalies.join('；')}`)
  if (snapshot.chapters.length < 3 || snapshot.chapters.length > 8) blockers.push('短篇必须包含 3～8 个章节')
  if (snapshot.chapters.some(chapter => !chapter.summary.trim())) blockers.push('仍有章节缺少结构卡')
  if (snapshot.chapters.some(chapter => chapter.wordCount === 0)) blockers.push('仍有章节缺少正文')
  if (wordCount < SHORT_NOVEL_MIN_WORDS || wordCount > SHORT_NOVEL_MAX_WORDS) blockers.push(`实际正文须为 ${SHORT_NOVEL_MIN_WORDS}～${SHORT_NOVEL_MAX_WORDS} 字；当前 ${wordCount} 字`)
  if (!production.latestReview || production.reviewedManuscriptHash !== snapshot.manuscriptHash) blockers.push('当前手稿尚未完成有效的全篇审校')
  const pendingCandidates = runs.filter(row => ['running', 'awaiting_confirmation'].includes(row.status) && row.contractJson?.includes('short:'))
  if (pendingCandidates.length) blockers.push(`仍有 ${pendingCandidates.length} 个短篇候选等待处理`)
  const openCritical = production.latestReview?.issues.filter(issue => issue.severity === 'critical' && issue.status === 'open') ?? []
  if (openCritical.length) blockers.push(`仍有 ${openCritical.length} 个 critical 问题未解决`)
  const openMajor = production.latestReview?.issues.filter(issue => issue.severity === 'major' && issue.status === 'open') ?? []
  if (openMajor.length) warnings.push(`仍有 ${openMajor.length} 个 major 问题未解决`)
  if (Math.abs(wordCount - snapshot.work.targetWordCount) > snapshot.work.targetWordCount * 0.2) warnings.push('实际字数与目标字数偏差超过 20%')
  return { ready: blockers.length === 0, wordCount, blockers, warnings, manuscriptHash: snapshot.manuscriptHash }
}

export async function publishShortNovelReleaseV1(input: { scope: WorkspaceScope; expectedRevision: number; label?: string }): Promise<CreationReleaseV1 & { id: number }> {
  const [production, snapshot, report, sourceGuard] = await Promise.all([
    ensureShortNovelProductionV1(input.scope),
    buildShortNovelManuscriptSnapshotV1(input.scope),
    inspectShortNovelCompletionV1(input.scope),
    readShortNovelSourceGuardV1(input.scope),
  ])
  if (production.revision !== input.expectedRevision) throw new Error('[short-novel] 生产状态已变化，请刷新后发布')
  if (!report.ready || !production.brief || !production.storyDesign || !production.latestReview || !production.reviewedManuscriptHash) throw new Error(`[short-novel] 尚未达到发布条件：${report.blockers.join('；')}`)
  const priorReleases = (await db.creationReleases.where('workId').equals(input.scope.workId).toArray())
    .filter(row => row.productKind === 'short-novel')
  const latest = priorReleases.sort((left, right) => right.version - left.version)[0]
  const version = (latest?.version ?? 0) + 1
  const now = Date.now()
  const manifest: ShortNovelReleaseManifestV1 = {
    schema: 'storyforge.short-novel-release', version: 1, productKind: 'short-novel',
    work: { code: snapshot.work.code, title: snapshot.work.title, description: snapshot.work.description, genres: [...snapshot.work.genres], targetWordCount: snapshot.work.targetWordCount },
    production: { revision: production.revision, brief: production.brief, storyDesign: production.storyDesign, review: production.latestReview, reviewedManuscriptHash: production.reviewedManuscriptHash },
    chapters: snapshot.chapters,
    manuscriptHash: snapshot.manuscriptHash,
    createdAt: now,
  }
  const manifestJson = canonicalStringify(manifest)
  const contentHash = await hashCanonicalValue(manifest)
  return db.transaction('rw', scopeTransactionTables(db.shortNovelProductions, db.creationReleases, db.chapters, db.outlineNodes), async () => {
    const current = await db.shortNovelProductions.where('workId').equals(input.scope.workId).first()
    if (!current?.id || current.revision !== input.expectedRevision) throw new Error('[short-novel] 发布期间生产状态发生变化')
    if (await readShortNovelSourceGuardV1(input.scope) !== sourceGuard) throw new Error('[short-novel] 发布期间手稿发生变化')
    const currentLatest = await db.creationReleases.where('[workId+productKind+version]').equals([input.scope.workId, 'short-novel', version]).first()
    if (currentLatest) throw new Error('[short-novel] 发布版本发生并发冲突')
    const row: CreationReleaseV1 = { projectId: input.scope.projectId, worldId: input.scope.worldId, workId: input.scope.workId, productKind: 'short-novel', version, label: input.label?.trim() || `${snapshot.work.title} v${version}`, parentReleaseId: latest?.id ?? null, sourceRevision: production.revision, manifestJson, contentHash, createdAt: now }
    const id = await db.creationReleases.add(row) as number
    await db.shortNovelProductions.update(current.id, { currentReleaseId: id, phase: 'complete', revision: current.revision + 1, updatedAt: now })
    await db.works.update(input.scope.workId, { status: 'completed', currentWordCount: report.wordCount, updatedAt: now })
    return { ...row, id }
  })
}

export async function reopenShortNovelProductionV1(input: { scope: WorkspaceScope; expectedRevision: number }): Promise<ShortNovelProductionV1 & { id: number }> {
  return updateProductionV1({ scope: input.scope, expectedRevision: input.expectedRevision, patch: { phase: 'review' } })
}

export async function listShortNovelReleasesV1(scope: WorkspaceScope): Promise<CreationReleaseV1[]> {
  return (await db.creationReleases.where('workId').equals(scope.workId).toArray())
    .filter(row => row.projectId === scope.projectId && row.worldId === scope.worldId && row.productKind === 'short-novel')
    .sort((left, right) => right.version - left.version)
}

export async function readShortNovelReleaseManifestV1(scope: WorkspaceScope, releaseId: number): Promise<ShortNovelReleaseManifestV1> {
  const release = await db.creationReleases.get(releaseId)
  if (!release || release.projectId !== scope.projectId || release.worldId !== scope.worldId || release.workId !== scope.workId || release.productKind !== 'short-novel') throw new Error('[short-novel] Release 不存在或越界')
  const work = await db.works.get(scope.workId)
  if (!work) throw new Error('[short-novel] Release 所属 Work 不存在')
  const manifest = await parseAndVerifyCreationReleaseManifestV1(release, work.code) as unknown as ShortNovelReleaseManifestV1
  if (manifest.production?.revision !== release.sourceRevision) throw new Error('[short-novel] Release 来源 revision 不一致')
  return manifest
}

function htmlToMarkdown(html: string): string {
  // 富文本正文把每个作者段落保存为独立块；无论原始模型使用单换行还是
  // 空行分段，Markdown 都必须恢复为空行分隔的可读段落。
  return htmlToPlainText(html).split(/\n+/).map(paragraph => paragraph.trim()).filter(Boolean).join('\n\n')
}

export function renderShortNovelReleaseMarkdownV1(manifest: ShortNovelReleaseManifestV1): string {
  return [`# ${manifest.work.title}`, '', ...manifest.chapters.flatMap(chapter => [`## ${chapter.title}`, '', htmlToMarkdown(chapter.contentHtml), ''])].join('\n').trim()
}

export function renderShortNovelReleaseTextV1(manifest: ShortNovelReleaseManifestV1): string {
  return [manifest.work.title, '', ...manifest.chapters.flatMap(chapter => [chapter.title, '', htmlToPlainText(chapter.contentHtml), ''])].join('\n').trim()
}

export function renderShortNovelReleaseJsonV1(manifest: ShortNovelReleaseManifestV1): string {
  return JSON.stringify(manifest, null, 2)
}

export function reviewIssueForChapter(review: ShortNovelReviewV1 | null, chapterKey: string): ShortNovelReviewIssueV1[] {
  return review?.issues.filter(issue => issue.chapterKeys.includes(chapterKey)) ?? []
}
