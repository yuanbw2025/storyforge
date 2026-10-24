import type {WorkspaceScope} from '../types'
import {isSha256Hash} from '../product-production/hash'
import {parseChatAuthoringSettings} from './authoring-contract'
import {loadChatSourceProjectionV1, readChatDraftV1} from './draft-service'
import {chatProjectionResourcesV1, readPreparedChatSourceProjectionViewV1, type ChatSourceClassificationV1, type ChatSourceFragmentV1} from './source-projection'

/** S2 author-only selection. It grants no participant knowledge or write permission. */
export interface ChatSourceReviewRequestV1 {
  draftRevision: number
  projectionHash: string
  fragmentKeys: string[]
  /** Optional actor-limited reading; absence preserves the historical author review. */
  actorKey?: string
}

export interface ChatSourceReviewContextV1 {
  schema: 'storyforge.chat-source-review-context'
  version: 1
  draftRevision: number
  projectionHash: string
  worldReferenceHash: string
  worldReleaseHash: string
  audience: 'author-only'
  perspective?: {actorKey: string}
  cast: Array<{resourceKey: string; authorLabel?: string; role: 'actor' | 'player'}>
  fragments: Array<ChatSourceFragmentV1 & {
    sourceHash: string
    resourceKind: string
    origin?: 'product-private'
    confirmedClassification: ChatSourceClassificationV1 | null
    /** Actor-limited reading excludes author permissions and discovery conditions. */
    knownPurpose?: ChatSourceClassificationV1['purpose']
  }>
}

function parseRequest(value: ChatSourceReviewRequestV1): ChatSourceReviewRequestV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== (Object.prototype.hasOwnProperty.call(value, 'actorKey') ? 'actorKey,draftRevision,fragmentKeys,projectionHash' : 'draftRevision,fragmentKeys,projectionHash')
    || Object.prototype.hasOwnProperty.call(value, 'actorKey') && (typeof value.actorKey !== 'string' || !value.actorKey.trim() || value.actorKey.length > 500)
    || !Number.isSafeInteger(value.draftRevision) || value.draftRevision < 0
    || !isSha256Hash(value.projectionHash)
    || !Array.isArray(value.fragmentKeys) || !value.fragmentKeys.length || value.fragmentKeys.length > 2000
    || value.fragmentKeys.some(key => typeof key !== 'string' || !key || key.length > 1000)
    || new Set(value.fragmentKeys).size !== value.fragmentKeys.length) {
    throw new Error('资料整理须指定有效的草稿版本、来源投影和不重复的原文片段')
  }
  return structuredClone(value)
}

/** Registry reader only: verified frozen sources, exact selection, no DB/model writes. */
export async function readChatSourceReviewContextV1(
  scopeInput: WorkspaceScope, requestInput: ChatSourceReviewRequestV1,
): Promise<ChatSourceReviewContextV1> {
  // Freeze before the first await: an author changing selection mid-read cannot
  // expand what this request is allowed to deliver to a future model call.
  const request = parseRequest(requestInput), scope = structuredClone(scopeInput)
  const draft = await readChatDraftV1(scope)
  if (draft.revision !== request.draftRevision) throw new Error('方案已变化，请重新选择需要整理的资料')
  const settings = parseChatAuthoringSettings(JSON.parse(draft.settingsJson))
  if (settings.version === 1) throw new Error('请先升级到带资料检查的角色聊天方案')
  const projection = await loadChatSourceProjectionV1(scope, request.draftRevision)
  if (projection.projectionHash !== request.projectionHash) throw new Error('来源投影已变化，请重新选择需要整理的资料')
  const selected = new Set(request.fragmentKeys)
  let known: Map<string, ChatSourceClassificationV1['purpose']> | undefined
  if (request.actorKey !== undefined) {
    if (!projection.characters.some(row => row.resourceKey === request.actorKey)) throw new Error('整理视角必须是当前参与演绎的 AI 角色')
    if (!settings.sourceReview) throw new Error('请先确认并保存资料知情范围，再按角色视角整理')
    known = new Map(readPreparedChatSourceProjectionViewV1({draft: projection, review: settings.sourceReview, viewerKey: request.actorKey})
      .map(fragment => [fragment.fragmentKey, fragment.purpose]))
    if (request.fragmentKeys.some(key => !known!.has(key))) throw new Error('所选资料包含该角色尚未获准知道的内容；请取消这些选择或由作者重新确认知情范围')
  }
  const confirmed = settings.sourceReview?.projectionHash === projection.projectionHash
    ? new Map(settings.sourceReview.classifications.map(row => [row.fragmentKey, row])) : new Map<string, ChatSourceClassificationV1>()
  const fragments: ChatSourceReviewContextV1['fragments'] = chatProjectionResourcesV1(projection).flatMap(resource =>
    resource.fragments.filter(fragment => selected.has(fragment.fragmentKey)).map(fragment => ({
      ...fragment, sourceHash: resource.sourceHash,
      ...(resource.origin ? {origin: resource.origin} : {}),
      resourceKind: projection.background?.find(row => row.resourceKey === resource.resourceKey)?.resourceKind ?? 'character',
      confirmedClassification: known ? null : confirmed.get(fragment.fragmentKey) ?? null,
      ...(known ? {knownPurpose: known.get(fragment.fragmentKey)!} : {}),
    })))
  if (fragments.length !== selected.size) throw new Error('选中的原文片段已缺失或不属于当前来源投影')
  const current = await readChatDraftV1(scope)
  if (current.revision !== request.draftRevision || current.worldReleaseId !== draft.worldReleaseId)
    throw new Error('读取期间方案已变化，请重新选择需要整理的资料')
  return structuredClone({
    schema: 'storyforge.chat-source-review-context', version: 1, audience: 'author-only',
    ...(request.actorKey ? {perspective: {actorKey: request.actorKey}} : {}),
    draftRevision: request.draftRevision, projectionHash: projection.projectionHash,
    worldReferenceHash: projection.worldReferenceHash, worldReleaseHash: projection.worldReleaseHash,
    cast: [
      ...projection.characters.map(row => ({resourceKey: row.resourceKey, ...(!known ? {authorLabel: row.label} : {}), role: 'actor' as const})),
      ...(projection.playerCharacter ? [{resourceKey: projection.playerCharacter.resourceKey, ...(!known ? {authorLabel: projection.playerCharacter.label} : {}), role: 'player' as const}] : []),
    ].filter(row => !known || row.resourceKey === request.actorKey || fragments.some(fragment => fragment.resourceKey === row.resourceKey)),
    fragments,
  })
}
