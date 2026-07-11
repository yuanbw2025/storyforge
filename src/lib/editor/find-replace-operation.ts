import type { Chapter } from '../types'
import {
  findChapterMatches,
  replaceChapterContent,
  type ChapterSearchTarget,
  type FindReplaceOptions,
} from './find-replace'

export type ReplaceMode = 'one' | 'chapter' | 'book'

export interface FindReplaceUndoPatch {
  label: string
  chapters: Array<{
    id: number
    content: string
    wordCount: number
  }>
}

interface ExecuteReplaceArgs {
  mode: ReplaceMode
  targets: ChapterSearchTarget[]
  chapters: Chapter[]
  options: FindReplaceOptions & { replacement: string }
  projectId: number
  selected?: { chapterId: number; occurrenceIndex: number } | null
  createSnapshot: (projectId: number, label: string, type: 'auto' | 'manual') => Promise<number>
  updateChapter: (id: number, patch: Partial<Chapter>) => Promise<void>
  label: string
}

export interface ExecuteReplaceResult {
  replaced: number
  affectedChapters: number
  snapshotId: number
  undoPatch: FindReplaceUndoPatch
}

export function countPlannedReplacements(
  targets: ChapterSearchTarget[],
  options: FindReplaceOptions,
  mode: ReplaceMode,
): { count: number; affectedChapters: number } {
  const previews = targets
    .map(target => findChapterMatches(target, options))
    .filter(preview => preview && preview.count > 0)

  if (mode === 'one') {
    return previews.length ? { count: 1, affectedChapters: 1 } : { count: 0, affectedChapters: 0 }
  }

  return {
    count: previews.reduce((sum, preview) => sum + (preview?.count ?? 0), 0),
    affectedChapters: previews.length,
  }
}

export async function executeFindReplace(args: ExecuteReplaceArgs): Promise<ExecuteReplaceResult> {
  const targetsWithMatches = args.targets
    .filter(target => (findChapterMatches(target, args.options)?.count ?? 0) > 0)
  if (!targetsWithMatches.length) {
    throw new Error('没有可替换的命中')
  }

  const snapshotId = await args.createSnapshot(args.projectId, args.label, 'manual')
  const undoPatch: FindReplaceUndoPatch = {
    label: `${args.label} · 快照 #${snapshotId}`,
    chapters: targetsWithMatches.map(target => {
      const chapter = args.chapters.find(item => item.id === target.id)
      if (!chapter) throw new Error(`章节不存在:${target.id}`)
      return {
        id: target.id,
        content: chapter.content || '',
        wordCount: chapter.wordCount || 0,
      }
    }),
  }

  let replaced = 0
  let affectedChapters = 0
  for (const target of targetsWithMatches) {
    const onlyOccurrenceIndex = args.mode === 'one' && args.selected?.chapterId === target.id
      ? args.selected.occurrenceIndex
      : args.mode === 'one'
        ? 0
        : undefined
    const result = replaceChapterContent(target.content, args.options, args.mode === 'one' ? { onlyOccurrenceIndex } : undefined)
    if (!result.count) continue
    replaced += result.count
    affectedChapters += 1
    await args.updateChapter(target.id, {
      content: result.html,
      wordCount: result.wordCount,
    })
    if (args.mode === 'one') break
  }

  return { replaced, affectedChapters, snapshotId, undoPatch }
}

export async function undoFindReplace(
  undoPatch: FindReplaceUndoPatch,
  updateChapter: (id: number, patch: Partial<Chapter>) => Promise<void>,
): Promise<number> {
  for (const chapter of undoPatch.chapters) {
    await updateChapter(chapter.id, {
      content: chapter.content,
      wordCount: chapter.wordCount,
    })
  }
  return undoPatch.chapters.length
}
