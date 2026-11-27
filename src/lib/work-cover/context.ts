import { db } from '../db/schema'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import type { AssembleContextInput } from '../registry/types'
import { assertLongformCoverWorkV1, coverRecordInScopeV1 } from './drafts'
import { parseWorkCoverBriefV1 } from './contracts'

async function ownedDraft(input: AssembleContextInput) {
  const scope = await resolveScope(input)
  const work = await db.works.get(scope.workId)
  assertLongformCoverWorkV1(work, scope)
  const draft = input.workCoverDraftId == null ? undefined : await db.workCoverDrafts.get(input.workCoverDraftId)
  if (!draft || !coverRecordInScopeV1(scope, draft) || draft.workCode !== work.code || draft.revision !== input.workCoverDraftRevision
    || draft.expectedWorkUpdatedAt !== work.updatedAt) throw new Error('作品或封面提示词已变化，请重读后再生成。')
  const brief = parseWorkCoverBriefV1(draft.briefJson)
  if (await hashCanonicalValue(brief) !== draft.briefHash) throw new Error('封面提示词证据损坏。')
  return { scope, work, draft, brief }
}

export async function readWorkCoverMetadataV1(input: AssembleContextInput): Promise<string> {
  const { work } = await ownedDraft(input)
  // No readAgentWorkStatus: that reader also queries chapters and statistics.
  return canonicalStringify({ workCode: work.code, title: work.title, description: work.description, genres: work.genres, updatedAt: work.updatedAt })
}

export async function readWorkCoverBriefV1(input: AssembleContextInput): Promise<string> {
  const { draft, brief } = await ownedDraft(input)
  return canonicalStringify({ revision: draft.revision, briefHash: draft.briefHash, prompt: brief.prompt })
}

export async function readWorkCoverSelectedTextV1(input: AssembleContextInput): Promise<string> {
  const { scope, brief } = await ownedDraft(input)
  // Critically, absence does not even query the manuscript table.
  if (brief.selectedText === null) return ''
  const selected = brief.selectedText
  const chapter = await db.chapters.get(selected.chapterId)
  if (!chapter || !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) throw new Error('选用的正文不属于此作品。')
  const text = chapter.content.slice(selected.start, selected.end)
  if (selected.end > chapter.content.length || text.length > 8_000 || await sha256Text(text) !== selected.textHash) throw new Error('选用的正文片段已变化，请重新选择。')
  return canonicalStringify({ chapterId: selected.chapterId, start: selected.start, end: selected.end, textHash: selected.textHash, text })
}
