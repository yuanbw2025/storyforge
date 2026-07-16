import { db } from '../db/schema'
import type { Chapter, OutlineNode, Project, WorldGroup } from '../types'
import type { PromptTemplate } from '../types/prompt'
import { adopt } from '../registry/adopt'
import type { AdoptInput } from '../registry/types'
import { useBackupStore } from '../../stores/backup'
import { countWords, htmlToPlainText, plainTextToHtml, toHtml } from '../utils/html'
import { propagateChapterEditStale } from '../consistency/impact-analysis'
import { rebuildChapterChunks, rebuildProjectNarrativeSummaries } from '../retrieval/retrieval'
import { resolvePromptLibraryScope } from '../ai/prompt-library-scope'

export interface PromptLibraryCompletedRun {
  assetId: string
  projectId: number
  chapterId: number | null
  outlineNodeId: number | null
  worldGroupId: number | null
  output: string
  completedAt: number
}

export interface PromptLibraryChapterAdoptionResult {
  chapterId: number
  snapshotId: number
  html: string
  wordCount: number
  demotedFacts: number
  warnings: string[]
}

export function canAdoptPromptLibraryRun(args: {
  run: PromptLibraryCompletedRun | null
  assetId: string
  isStreaming: boolean
  adopted: boolean
}): boolean {
  return Boolean(args.run && args.run.assetId === args.assetId && !args.isStreaming && !args.adopted)
}

export interface PromptLibraryChapterAdoptionDeps {
  loadScopeData: (projectId: number) => Promise<{
    chapters: Chapter[]
    nodes: OutlineNode[]
    groups: WorldGroup[]
  }>
  createSnapshot: (projectId: number, label: string, type: 'manual') => Promise<number>
  write: (input: AdoptInput) => ReturnType<typeof adopt>
  postProcess: (args: {
    projectId: number
    chapter: Chapter
    worldGroupId: number | null
  }) => Promise<{ demotedFacts: number; warnings: string[] }>
}

const defaultDeps: PromptLibraryChapterAdoptionDeps = {
  loadScopeData: async projectId => {
    const [chapters, nodes, groups] = await Promise.all([
      db.chapters.where('projectId').equals(projectId).toArray(),
      db.outlineNodes.where('projectId').equals(projectId).toArray(),
      db.worldGroups.where('projectId').equals(projectId).toArray(),
    ])
    return { chapters, nodes, groups }
  },
  createSnapshot: (projectId, label, type) => useBackupStore.getState().createSnapshot(projectId, label, type),
  write: adopt,
  postProcess: postProcessPromptLibraryChapterAdoption,
}

export async function adoptPromptLibraryChapterOutput(
  args: {
    project: Project
    template: PromptTemplate
    run: PromptLibraryCompletedRun
  },
  deps: PromptLibraryChapterAdoptionDeps = defaultDeps,
): Promise<PromptLibraryChapterAdoptionResult> {
  const projectId = args.project.id
  const contract = args.template.library?.output
  if (projectId == null || args.run.projectId !== projectId) throw new Error('生成结果不属于当前项目。')
  if (args.template.library?.assetId !== args.run.assetId) throw new Error('生成结果不属于当前 Prompt。')
  if (contract?.mode !== 'adopt' || contract.target !== 'chapters' || contract.field !== 'content') {
    throw new Error('当前 Prompt 没有章节正文采纳权限。')
  }
  const output = normalizeGeneratedProse(args.run.output)
  if (!output) throw new Error('生成结果为空，不能写入正文。')
  if (containsConflictReport(output)) throw new Error('结果是冲突报告，不是正文；请先解决冲突后重新生成。')

  const scopeData = await deps.loadScopeData(projectId)
  const scope = resolvePromptLibraryScope({
    template: args.template,
    project: args.project,
    ...scopeData,
    selection: args.run,
  })
  if (scope.errors.length) throw new Error(scope.errors.join(' '))
  if (scope.chapterId == null || scope.chapterId !== args.run.chapterId) {
    throw new Error('生成时绑定的章节已失效。')
  }
  const chapter = scopeData.chapters.find(item => item.id === scope.chapterId)
  if (!chapter) throw new Error('生成时绑定的章节已不存在。')

  const generatedHtml = plainTextToHtml(output)
  const existingHtml = toHtml(chapter.content || '')
  const html = contract.adoptMode === 'append' && existingHtml.trim()
    ? `${existingHtml}${generatedHtml}`
    : generatedHtml
  const wordCount = countWords(htmlToPlainText(html))

  const snapshotId = await deps.createSnapshot(
    projectId,
    `Prompt 采纳前 · ${chapter.title || `章节 #${chapter.id}`}`,
    'manual',
  )
  const writeResult = await deps.write({
    projectId,
    worldGroupId: scope.worldGroupId,
    target: 'chapters',
    recordId: scope.chapterId,
    mode: 'replace',
    data: { content: html, wordCount },
  })
  if (!writeResult.written.length) {
    throw new Error(writeResult.skipped[0]?.reason || '章节正文没有写入。')
  }

  const updatedChapter: Chapter = { ...chapter, content: html, wordCount, updatedAt: Date.now() }
  const post = await deps.postProcess({ projectId, chapter: updatedChapter, worldGroupId: scope.worldGroupId })
  return { chapterId: scope.chapterId, snapshotId, html, wordCount, ...post }
}

export function containsConflictReport(output: string): boolean {
  return /<\s*\/?\s*conflictreport\b/i.test(output)
}

export function normalizeGeneratedProse(output: string): string {
  return output
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0)
    .join('\n')
    .trim()
}

async function postProcessPromptLibraryChapterAdoption(args: {
  projectId: number
  chapter: Chapter
  worldGroupId: number | null
}): Promise<{ demotedFacts: number; warnings: string[] }> {
  const warnings: string[] = []
  let demotedFacts = 0
  try {
    demotedFacts = (await propagateChapterEditStale(args.projectId, args.chapter.id!)).demotedFacts
  } catch (error) {
    warnings.push(`事实状态刷新失败：${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    const [characters, codexEntries, locations] = await Promise.all([
      db.characters.where('projectId').equals(args.projectId).toArray(),
      db.codexEntries.where('projectId').equals(args.projectId).toArray(),
      db.importantLocations.where('projectId').equals(args.projectId).toArray(),
    ])
    await rebuildChapterChunks({
      projectId: args.projectId,
      chapter: args.chapter,
      worldGroupId: args.worldGroupId,
      knownEntities: [
        ...characters.map(item => item.name),
        ...codexEntries.map(item => item.name),
        ...locations.map(item => item.name),
      ].filter((name): name is string => Boolean(name)),
    })
    await rebuildProjectNarrativeSummaries({ projectId: args.projectId })
  } catch (error) {
    warnings.push(`检索索引刷新失败：${error instanceof Error ? error.message : String(error)}`)
  }
  return { demotedFacts, warnings }
}
