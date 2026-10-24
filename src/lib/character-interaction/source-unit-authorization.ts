import {canonicalStringify} from '../agent/run/hash'
import {isSha256Hash} from '../product-production/hash'
import {parseChatSourceReviewV1, type ChatSourceProjectionDraftV1, type ChatSourceReviewV1, chatProjectionResourcesV1, readPreparedChatSourceProjectionViewV1} from './source-projection'
import type {ChatSourceReviewContextV1} from './source-review-context'
import {parseChatSourceUnitsReviewV1, chatSourceUnitsReviewPassedV1, validateChatSourceUnitsEvidenceV1,
  type ChatSourceUnitsCandidateV1, type ChatSourceUnitsReviewV1} from './source-units'

export interface ChatSourceUnitPermissionV1 {
  fragmentKey: string; unitKey: string; audienceKeys: string[]
  discovery?: {actorKeys: string[]; condition: string; prerequisiteFragmentKeys: string[]}
}
export interface ChatSourceUnitAuthorizationReviewV1 {
  interpretation: ChatSourceUnitsReviewV1
  permissions: Array<{fragmentKey: string; unitKey: string; initialKnowledgeFaithful: boolean; discoverySupported: boolean; reason: string}>
}
export interface ChatSourceUnitBundleV1 {
  source: ChatSourceReviewContextV1
  candidate: ChatSourceUnitsCandidateV1
  permissions: ChatSourceUnitPermissionV1[]
  prerequisites: ChatSourceReviewContextV1['fragments']
  review: ChatSourceUnitAuthorizationReviewV1
}
export interface ChatSourceUnitSetV1 {schema: 'storyforge.chat-source-units'; version: 1; bundles: ChatSourceUnitBundleV1[]}
const identity = (fragmentKey: string, unitKey: string) => canonicalStringify([fragmentKey, unitKey])
function fail(message: string): never {throw new Error(`事实确认无效：${message}`)}
function record(value: unknown, fields: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== fields.split(',').sort().join(',')) fail('字段无效')
}
function strings(value: unknown, max: number, size: number): asserts value is string[] {
  if (!Array.isArray(value) || value.length > max || value.some(x => typeof x !== 'string' || !x.trim() || x.length > size) || new Set(value).size !== value.length) fail('标识列表重复或无效')
}
export function parseChatSourceUnitPermissionsV1(value: unknown, candidate: ChatSourceUnitsCandidateV1): ChatSourceUnitPermissionV1[] {
  if (!Array.isArray(value) || value.length !== candidate.fragments.reduce((sum, row) => sum + row.facts.length, 0)) fail('每项事实须有且仅有一份知情授权')
  const seen = new Set<string>()
  for (const item of value) {
    record(item, 'fragmentKey,unitKey,audienceKeys' + (item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, 'discovery') ? ',discovery' : ''))
    if (typeof item.fragmentKey !== 'string' || typeof item.unitKey !== 'string' || !candidate.fragments.some(row => row.fragmentKey === item.fragmentKey && row.facts.some(fact => fact.key === item.unitKey))) fail('权限引用了候选外事实')
    const key = identity(item.fragmentKey, item.unitKey); if (seen.has(key)) fail('事实授权重复'); seen.add(key)
    strings(item.audienceKeys, 9, 500)
    if (item.discovery !== undefined) {
      record(item.discovery, 'actorKeys,condition,prerequisiteFragmentKeys')
      strings(item.discovery.actorKeys, 8, 500); strings(item.discovery.prerequisiteFragmentKeys, 200, 1000)
      if (!item.discovery.actorKeys.length || !item.discovery.prerequisiteFragmentKeys.length || item.discovery.actorKeys.some(actor => actor === 'player' || (item.audienceKeys as string[]).includes(actor))
        || typeof item.discovery.condition !== 'string' || !item.discovery.condition.trim() || item.discovery.condition.length > 2000) fail('发现条件、角色或前提无效')
    }
  }
  return structuredClone(value) as ChatSourceUnitPermissionV1[]
}
export function parseChatSourceUnitAuthorizationReviewV1(value: unknown, candidate: ChatSourceUnitsCandidateV1, permissions: ChatSourceUnitPermissionV1[]): ChatSourceUnitAuthorizationReviewV1 {
  record(value, 'interpretation,permissions')
  const interpretation = parseChatSourceUnitsReviewV1(value.interpretation, candidate)
  if (!Array.isArray(value.permissions) || value.permissions.length !== permissions.length) fail('独立复核须覆盖全部事实授权')
  const seen = new Set<string>()
  for (const row of value.permissions) {
    record(row, 'fragmentKey,unitKey,initialKnowledgeFaithful,discoverySupported,reason')
    if (typeof row.fragmentKey !== 'string' || typeof row.unitKey !== 'string' || !permissions.some(p => p.fragmentKey === row.fragmentKey && p.unitKey === row.unitKey)) fail('复核包含未知授权')
    const key = identity(row.fragmentKey, row.unitKey); if (seen.has(key)) fail('授权复核重复'); seen.add(key)
    if (typeof row.initialKnowledgeFaithful !== 'boolean' || typeof row.discoverySupported !== 'boolean' || typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 1200) fail('授权复核结论无效')
  }
  return {interpretation, permissions: structuredClone(value.permissions) as ChatSourceUnitAuthorizationReviewV1['permissions']}
}
export function chatSourceUnitAuthorizationPassedV1(review: ChatSourceUnitAuthorizationReviewV1) {
  return chatSourceUnitsReviewPassedV1(review.interpretation) && review.permissions.every(row => row.initialKnowledgeFaithful && row.discoverySupported)
}

/** Original passages remain author-only. Units, not the raw compound passage, grant knowledge. */
export function validateChatSourceUnitAuthorizationV1(candidateInput: unknown, permissionsInput: unknown, context: ChatSourceReviewContextV1) {
  const candidate = validateChatSourceUnitsEvidenceV1(candidateInput, context), permissions = parseChatSourceUnitPermissionsV1(permissionsInput, candidate)
  const actors = context.cast.filter(row => row.role === 'actor').map(row => row.resourceKey)
  if (context.fragments.some(row => row.confirmedClassification?.purpose !== 'knowledge' || row.confirmedClassification.visibility !== 'author-only')) fail('请先将所选原文保存为“事实与经历 / 仅作者掌握”；逐项知情范围在事实确认中单独设置')
  if (permissions.some(row => row.audienceKeys.some(key => key !== 'player' && !actors.includes(key)) || row.discovery?.actorKeys.some(key => !actors.includes(key)))) fail('知情或调查角色不属于当前作品')
  return {candidate, permissions}
}

/** Persisted interpretation is portable; no run, draft, world or other local numeric IDs. */
export function parseChatSourceUnitSetV1(value: unknown): ChatSourceUnitSetV1 {
  record(value, 'schema,version,bundles')
  if (value.schema !== 'storyforge.chat-source-units' || value.version !== 1 || !Array.isArray(value.bundles) || value.bundles.length > 128) fail('事实整理版本或数量无效')
  const seen = new Set<string>()
  for (const bundle of value.bundles) {
    record(bundle, 'source,candidate,permissions,prerequisites,review')
    record(bundle.source, 'schema,version,draftRevision,projectionHash,worldReferenceHash,worldReleaseHash,audience,cast,fragments')
    const source = bundle.source
    if (source.schema !== 'storyforge.chat-source-review-context' || source.version !== 1 || source.audience !== 'author-only' || !Number.isSafeInteger(source.draftRevision) || Number(source.draftRevision) < 0
      || !isSha256Hash(source.projectionHash) || !isSha256Hash(source.worldReferenceHash) || !isSha256Hash(source.worldReleaseHash) || !Array.isArray(source.cast) || source.cast.length > 9
      || !Array.isArray(source.fragments) || !source.fragments.length || source.fragments.length > 12) fail('原文证据缺失或版本无效')
    const cast = new Set<string>()
    for (const actor of source.cast) {
      record(actor, 'resourceKey,role' + (actor && typeof actor === 'object' && Object.prototype.hasOwnProperty.call(actor, 'authorLabel') ? ',authorLabel' : ''))
      if (typeof actor.resourceKey !== 'string' || !actor.resourceKey || actor.resourceKey.length > 500 || cast.has(actor.resourceKey) || !['actor', 'player'].includes(String(actor.role))
        || actor.authorLabel !== undefined && (typeof actor.authorLabel !== 'string' || actor.authorLabel.length > 500)) fail('来源角色身份无效')
      cast.add(actor.resourceKey)
    }
    if (!Array.isArray(bundle.prerequisites) || bundle.prerequisites.length > 2000) fail('前提证据无效')
    const localKeys = new Set<string>()
    for (const fragment of [...source.fragments, ...bundle.prerequisites]) {
      record(fragment, 'fragmentKey,resourceKey,pointer,valueJson,sourceHash,resourceKind,confirmedClassification'
        + (fragment && typeof fragment === 'object' && Object.prototype.hasOwnProperty.call(fragment, 'textRange') ? ',textRange' : '')
        + (fragment && typeof fragment === 'object' && Object.prototype.hasOwnProperty.call(fragment, 'origin') ? ',origin' : ''))
      if (typeof fragment.fragmentKey !== 'string' || localKeys.has(fragment.fragmentKey) || source.fragments.includes(fragment) && seen.has(fragment.fragmentKey) || typeof fragment.resourceKey !== 'string' || !fragment.resourceKey || fragment.resourceKey.length > 500
        || typeof fragment.pointer !== 'string' || !fragment.pointer.startsWith('/') || fragment.pointer.length > 1000 || !isSha256Hash(fragment.sourceHash)
        || typeof fragment.valueJson !== 'string' || !fragment.valueJson || fragment.valueJson.length > 7900 || typeof fragment.resourceKind !== 'string' || !/^[a-z][a-z-]{0,63}$/.test(fragment.resourceKind)
        || fragment.origin !== undefined && fragment.origin !== 'product-private') fail('原文证据重复、缺失或超出容量')
      localKeys.add(fragment.fragmentKey)
      if (source.fragments.includes(fragment)) seen.add(fragment.fragmentKey)
      const parsed: unknown = JSON.parse(fragment.valueJson)
      if (fragment.textRange !== undefined) {
        record(fragment.textRange, 'start,end')
        if (typeof parsed !== 'string' || !Number.isSafeInteger(fragment.textRange.start) || !Number.isSafeInteger(fragment.textRange.end)
          || Number(fragment.textRange.start) < 0 || Number(fragment.textRange.end) <= Number(fragment.textRange.start)
          || parsed.length !== Number(fragment.textRange.end) - Number(fragment.textRange.start)) fail('原文区间不一致')
      }
      const range = fragment.textRange as {start: number; end: number} | undefined
      if (fragment.fragmentKey !== `${fragment.resourceKey}#${fragment.pointer}${range ? `@${range.start}:${range.end}` : ''}`) fail('原文片段身份与来源区间不一致')
      const classification = parseChatSourceReviewV1({projectionHash: source.projectionHash, classifications: [fragment.confirmedClassification]}).classifications[0]
      if (classification.fragmentKey !== fragment.fragmentKey) fail('原文分类身份不一致')
    }
    const {candidate, permissions} = validateChatSourceUnitAuthorizationV1(bundle.candidate, bundle.permissions, source as unknown as ChatSourceReviewContextV1)
    const used = new Set<string>()
    for (const permission of permissions) for (const key of permission.discovery?.prerequisiteFragmentKeys ?? []) {
      const prerequisite = (bundle.prerequisites as ChatSourceReviewContextV1['fragments']).find(row => row.fragmentKey === key)?.confirmedClassification
      if (!prerequisite || prerequisite.purpose !== 'knowledge' || !(prerequisite.visibility === 'public' || prerequisite.visibility === 'participants' && permission.discovery!.actorKeys.every(actor => prerequisite.audienceKeys.includes(actor)))) fail('缺少调查角色已知的前提证据')
      used.add(key)
    }
    if (used.size !== bundle.prerequisites.length) fail('存在未声明读取的前提证据')
    if (!chatSourceUnitAuthorizationPassedV1(parseChatSourceUnitAuthorizationReviewV1(bundle.review, candidate, permissions))) fail('事实或权限独立复核尚未通过')
  }
  return structuredClone(value) as unknown as ChatSourceUnitSetV1
}

/** Compiler/store freshness gate rechecks every read passage and its exact classification. */
export function validateChatSourceUnitSetForProjectionV1(value: unknown, projection: ChatSourceProjectionDraftV1, review: ChatSourceReviewV1): ChatSourceUnitSetV1 {
  const set = parseChatSourceUnitSetV1(value)
  readPreparedChatSourceProjectionViewV1({draft: projection, review, viewerKey: 'player'})
  const resources = chatProjectionResourcesV1(projection)
  const classifications = new Map(review.classifications.map(row => [row.fragmentKey, row]))
  const keys = new Set(set.bundles.flatMap(row => row.candidate.fragments.map(fragment => fragment.fragmentKey)))
  for (const bundle of set.bundles) {
    if (bundle.source.projectionHash !== projection.projectionHash || bundle.source.worldReleaseHash !== projection.worldReleaseHash || bundle.source.worldReferenceHash !== projection.worldReferenceHash) fail('已确认事实的来源已变化，请重新整理')
    const cast = [...projection.characters.map(row => ({resourceKey: row.resourceKey, role: 'actor'})), ...(projection.playerCharacter ? [{resourceKey: projection.playerCharacter.resourceKey, role: 'player'}] : [])]
    if (canonicalStringify(bundle.source.cast.map(row => ({resourceKey: row.resourceKey, role: row.role}))) !== canonicalStringify(cast)) fail('已确认事实的角色范围已变化')
    for (const source of [...bundle.source.fragments, ...bundle.prerequisites]) {
      const resource = resources.find(row => row.resourceKey === source.resourceKey), current = resource?.fragments.find(row => row.fragmentKey === source.fragmentKey)
      if (!current || resource?.sourceHash !== source.sourceHash || source.origin !== resource.origin || source.resourceKind !== (projection.background?.find(row => row.resourceKey === source.resourceKey)?.resourceKind ?? 'character')
        || canonicalStringify(current) !== canonicalStringify({fragmentKey: source.fragmentKey, resourceKey: source.resourceKey, pointer: source.pointer, valueJson: source.valueJson, ...(source.textRange ? {textRange: source.textRange} : {})})
        || canonicalStringify(classifications.get(source.fragmentKey)) !== canonicalStringify(source.confirmedClassification)) fail('已确认事实的原文或分类已变化，请重新整理')
    }
    for (const permission of bundle.permissions) for (const key of permission.discovery?.prerequisiteFragmentKeys ?? []) {
      const known = classifications.get(key)
      if (keys.has(key) || !known || known.purpose !== 'knowledge' || !(known.visibility === 'public' || known.visibility === 'participants' && permission.discovery!.actorKeys.every(actor => known.audienceKeys.includes(actor)))) fail('发现前提必须是调查角色已知、未被事实整理替换的原文资料')
    }
  }
  return set
}

export function mergeChatSourceUnitBundleV1(previous: ChatSourceUnitSetV1 | undefined, bundle: ChatSourceUnitBundleV1): ChatSourceUnitSetV1 {
  const selected = new Set(bundle.candidate.fragments.map(row => row.fragmentKey))
  const retained = (previous?.bundles ?? []).filter(row => {
    if (!row.candidate.fragments.some(fragment => selected.has(fragment.fragmentKey))) return true
    if (row.candidate.fragments.some(fragment => !selected.has(fragment.fragmentKey))) fail('重新整理须包含该次确认的全部原文片段，避免静默移除同组事实')
    return false
  })
  return parseChatSourceUnitSetV1({schema: 'storyforge.chat-source-units', version: 1, bundles: [...retained, bundle]})
}
