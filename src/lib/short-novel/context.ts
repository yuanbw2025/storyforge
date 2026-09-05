import type { AssembleContextInput } from '../registry/types'
import { db } from '../db/schema'
import { htmlToPlainText } from '../utils/html'
import { buildShortNovelManuscriptSnapshotV1, ensureShortNovelProductionV1 } from './service'

async function isApplicableShortNovelScope(input: AssembleContextInput): Promise<boolean> {
  if (!input.scope) return false
  const work = await db.works.get(input.scope.workId)
  if (!work) return false
  if (work.projectId !== input.scope.projectId || work.worldId !== input.scope.worldId) {
    throw new Error('[short-novel-context] Work owner 与当前 scope 不一致')
  }
  return work.kind === 'novel' && work.novelProfile === 'short'
}

export async function readShortNovelProductionContextV1(input: AssembleContextInput): Promise<string> {
  if (!input.scope || !await isApplicableShortNovelScope(input)) return ''
  const production = await ensureShortNovelProductionV1(input.scope)
  return [
    '【短篇生产合同】',
    `阶段：${production.phase}；revision=${production.revision}`,
    production.brief ? `已确认 Brief：${JSON.stringify(production.brief)}` : '已确认 Brief：无',
    production.storyDesign ? `已确认故事设计：${JSON.stringify(production.storyDesign)}` : '已确认故事设计：无',
    production.latestReview ? `最近审校：${JSON.stringify(production.latestReview)}` : '最近审校：无',
  ].join('\n')
}

export async function readShortNovelManuscriptContextV1(input: AssembleContextInput): Promise<string> {
  if (!input.scope || !await isApplicableShortNovelScope(input)) return ''
  const snapshot = await buildShortNovelManuscriptSnapshotV1(input.scope)
  return [
    '【短篇当前结构与正文】',
    `作品：${snapshot.work.title}；目标 ${snapshot.work.targetWordCount} 字；manuscriptHash=${snapshot.manuscriptHash}`,
    ...snapshot.chapters.map(chapter => [
      `## ${chapter.stableKey}｜${chapter.title}｜${chapter.wordCount} 字`,
      `结构卡：${chapter.summary || '未填写'}`,
      `正文：\n${chapter.contentHtml ? htmlToPlainText(chapter.contentHtml) : '未写'}`,
    ].join('\n')),
  ].join('\n\n')
}
