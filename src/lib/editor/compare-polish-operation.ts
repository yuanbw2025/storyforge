import type { HeldItemProjection } from '../consistency/held-items'
import { checkHeldItemAcquisition } from '../consistency/held-items'
import { countWords, htmlToPlainText } from '../utils/html'

export interface ComparePolishSaveArgs {
  projectId: number
  chapterId: number
  chapterTitle: string
  draftHtml: string
  createSnapshot: (projectId: number, label: string, type: 'auto' | 'manual') => Promise<number>
  updateChapter: (chapterId: number, patch: { content: string; wordCount: number }) => Promise<void>
}

export interface ComparePolishSaveResult {
  snapshotId: number
  html: string
  plainText: string
  wordCount: number
}

export function evaluateCompareDraftConsistency(
  draftHtml: string,
  heldItems: HeldItemProjection[],
) {
  return checkHeldItemAcquisition(htmlToPlainText(draftHtml), heldItems)
}

/** Snapshot creation must finish before the chapter manuscript is overwritten. */
export async function saveComparePolishDraft(
  args: ComparePolishSaveArgs,
): Promise<ComparePolishSaveResult> {
  const plainText = htmlToPlainText(args.draftHtml)
  const wordCount = countWords(plainText)
  const snapshotId = await args.createSnapshot(
    args.projectId,
    `对照润色前 · ${args.chapterTitle}`,
    'manual',
  )
  await args.updateChapter(args.chapterId, {
    content: args.draftHtml,
    wordCount,
  })
  return { snapshotId, html: args.draftHtml, plainText, wordCount }
}
