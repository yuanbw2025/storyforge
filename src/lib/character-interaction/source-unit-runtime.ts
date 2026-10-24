import {canonicalStringify} from '../agent/run/hash'
import type {FrozenChatSourceProjectionV1} from '../types/character-interaction'
import type {ChatSourceProjectionDraftV1} from './source-projection'
import {chatProjectionResourcesV1} from './source-projection'
import {parseChatSourceUnitSetV1, type ChatSourceUnitSetV1} from './source-unit-authorization'

export function compileChatSourceUnitKnowledgeV1(set: ChatSourceUnitSetV1, projection: ChatSourceProjectionDraftV1, sourceKeys: Map<string, string>, characterKeys: string[], participantKeys: string[]): FrozenChatSourceProjectionV1['knowledge'] {
  const fragments = chatProjectionResourcesV1(projection).flatMap(row => row.fragments)
  const actor = (key: string) => key === 'player' ? 'player' : participantKeys[characterKeys.indexOf(key)]
  return set.bundles.flatMap(bundle => bundle.candidate.fragments.flatMap(fragment => {
    const source = bundle.source.fragments.find(row => row.fragmentKey === fragment.fragmentKey)!
    return fragment.facts.map(fact => {
      const permission = bundle.permissions.find(row => row.fragmentKey === fragment.fragmentKey && row.unitKey === fact.key)!
      const discovery = permission.discovery
      return {key: `chat-unit.${projection.projectionHash}.${fragments.findIndex(row => row.fragmentKey === fragment.fragmentKey)}.${fact.key}`, content: JSON.stringify(fact.text), audienceKeys: permission.audienceKeys.map(actor),
        ...(discovery ? {discovery: {actorKeys: discovery.actorKeys.map(actor), condition: discovery.condition, prerequisiteKnowledgeKeys: discovery.prerequisiteFragmentKeys.map(key => sourceKeys.get(key)!)}} : {}),
        source: {resourceKey: source.resourceKey, sourceHash: source.sourceHash, pointer: source.pointer, purpose: 'knowledge' as const, unit: {fragmentKey: fragment.fragmentKey, unitKey: fact.key}}}
    })
  }))
}

/** V6 keeps full original evidence separately and proves every derived fact maps exactly once. */
export function validateFrozenChatSourceUnitsV1(source: FrozenChatSourceProjectionV1, participantKeys: readonly string[], characterKeys: readonly string[]) {
  const set = parseChatSourceUnitSetV1(source.sourceUnits)
  if (!set.bundles.length) throw new Error('新来源版本必须包含已确认事实整理')
  const actor = (key: string) => key === 'player' ? 'player' : participantKeys[characterKeys.indexOf(key)]
  const expected = new Set<FrozenChatSourceProjectionV1['knowledge'][number]>()
  const hashes = new Map<string, string>()
  const knownSources = [...(source.backgroundSources ?? []), ...(source.privateCharacterSources ?? []), ...(source.playerCharacterSource ? [source.playerCharacterSource] : []), ...source.knowledge.map(row => row.source)]
  for (const row of knownSources) {
    if (hashes.has(row.resourceKey) && hashes.get(row.resourceKey) !== row.sourceHash) throw new Error('冻结原文来源 hash 不一致')
    hashes.set(row.resourceKey, row.sourceHash)
  }
  for (const bundle of set.bundles) {
    if (bundle.source.projectionHash !== source.projectionHash || bundle.source.worldReleaseHash !== source.worldReleaseHash) throw new Error('事实原文证据与冻结投影不一致')
    const actors = bundle.source.cast.filter(row => row.role === 'actor').map(row => row.resourceKey)
    const players = bundle.source.cast.filter(row => row.role === 'player').map(row => row.resourceKey)
    if (canonicalStringify([...actors].sort()) !== canonicalStringify([...characterKeys].sort())
      || canonicalStringify(players) !== canonicalStringify(source.playerCharacterSource ? [source.playerCharacterSource.resourceKey] : [])) throw new Error('事实来源角色与冻结参与者不一致')
    for (const original of [...bundle.source.fragments, ...bundle.prerequisites]) {
      const background = source.backgroundSources?.find(row => row.resourceKey === original.resourceKey)
      const privateSource = source.privateCharacterSources?.find(row => row.resourceKey === original.resourceKey)
      if ((!characterKeys.includes(original.resourceKey) && !background && source.playerCharacterSource?.resourceKey !== original.resourceKey)
        || original.resourceKind !== (background?.resourceKind ?? 'character') || !!privateSource !== (original.origin === 'product-private')
        || hashes.has(original.resourceKey) && hashes.get(original.resourceKey) !== original.sourceHash) throw new Error('完整原文的来源身份或 hash 与冻结资源不一致')
      hashes.set(original.resourceKey, original.sourceHash)
    }
    for (const fragment of bundle.candidate.fragments) {
      const original = bundle.source.fragments.find(row => row.fragmentKey === fragment.fragmentKey)!
      // The compound original cannot coexist as actor knowledge beside its restricted units.
      if (source.knowledge.some(row => {
        if (row.source.unit || row.source.resourceKey !== original.resourceKey) return false
        if (row.source.pointer === original.pointer) return !row.source.textRange || !original.textRange || row.source.textRange.start < original.textRange.end && row.source.textRange.end > original.textRange.start
        return row.source.pointer.startsWith(`${original.pointer}/`) || original.pointer.startsWith(`${row.source.pointer}/`)
      })) throw new Error('完整复合原文不得绕过逐项知情授权')
      for (const fact of fragment.facts) {
        const permission = bundle.permissions.find(row => row.fragmentKey === fragment.fragmentKey && row.unitKey === fact.key)!
        const rows = source.knowledge.filter(row => row.source.unit?.fragmentKey === fragment.fragmentKey && row.source.unit.unitKey === fact.key)
        const row = rows[0]
        if (rows.length !== 1 || row.content !== JSON.stringify(fact.text) || row.source.resourceKey !== original.resourceKey || row.source.sourceHash !== original.sourceHash || row.source.pointer !== original.pointer || row.source.purpose !== 'knowledge' || row.source.textRange
          || canonicalStringify([...row.audienceKeys].sort()) !== canonicalStringify(permission.audienceKeys.map(actor).sort()) || !!row.discovery !== !!permission.discovery) throw new Error('冻结事实正文、来源或初知范围与作者确认不符')
        if (permission.discovery) {
          const rule = row.discovery!
          if (rule.condition !== permission.discovery.condition || canonicalStringify([...rule.actorKeys].sort()) !== canonicalStringify(permission.discovery.actorKeys.map(actor).sort())) throw new Error('冻结事实发现条件或角色与确认不符')
          const prerequisites = permission.discovery.prerequisiteFragmentKeys.map(key => {
            const original = bundle.prerequisites.find(row => row.fragmentKey === key)!
            const matches = source.knowledge.filter(item => !item.source.unit && item.source.resourceKey === original.resourceKey && item.source.sourceHash === original.sourceHash && item.source.pointer === original.pointer
              && item.content === original.valueJson && canonicalStringify(item.source.textRange ?? null) === canonicalStringify(original.textRange ?? null))
            if (matches.length !== 1) throw new Error('冻结发现前提缺少唯一原文证据')
            return matches[0].key
          })
          if (canonicalStringify(prerequisites.sort()) !== canonicalStringify([...rule.prerequisiteKnowledgeKeys].sort())) throw new Error('冻结发现前提与确认不符')
        }
        expected.add(row)
      }
    }
  }
  if (source.knowledge.some(row => row.source.unit && !expected.has(row))) throw new Error('冻结来源包含未确认的事实单位')
}

/** Only the coordinator may read these; actor formatting receives derived facts alone. */
export function chatSourceUnitConstraintsV1(set: ChatSourceUnitSetV1) {
  return set.bundles.map(bundle => ({sources: bundle.source.fragments.map(row => ({fragmentKey: row.fragmentKey, resourceKey: row.resourceKey, sourceHash: row.sourceHash, pointer: row.pointer, valueJson: row.valueJson, ...(row.textRange ? {textRange: row.textRange} : {})})),
    constraints: bundle.candidate.fragments.map(row => ({fragmentKey: row.fragmentKey, constraints: row.constraints})),
    instruction: '完整原文仅用于一致性约束，不授予任何角色知识；只可按已冻结的逐项事实和发现授权推进。引用和相邻事实不能扩大知情范围。'}))
}
