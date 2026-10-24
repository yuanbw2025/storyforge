import type {Character, FrozenChatSourceProjectionV1} from '../../src/lib/types'
import {chatProjectionResourcesV1, type ChatSourceProjectionDraftV1, type ChatSourceClassificationV1} from '../../src/lib/character-interaction/source-projection'

/** Evaluation author input, never an AI inference or a runtime repair. */
export interface M1RoleMaterialV1 {
  name: string
  goals: string[]
  privateFacts: string[]
  beliefs: string[]
  values: string[]
}

export function m1CharacterFieldsV1(role: M1RoleMaterialV1, publicFacts: readonly string[], identity: string): Pick<Character, 'name' | 'identity' | 'shortDescription' | 'background' | 'goals' | 'motivation' | 'personality'> {
  return {name: role.name, identity, shortDescription: publicFacts.join(''),
    background: role.privateFacts.join('；'), goals: role.goals.join('；'),
    motivation: role.beliefs.map(belief => `未经确认的角色猜测：${belief}`).join('；'),
    personality: role.values.join('；')}
}

/** Only the selected actor's declared fields are admitted. Other resources
 * remain author-only; a copied test-world resource cannot become public. */
export function m1ActorSourceClassificationsV1(projection: ChatSourceProjectionDraftV1, actorResourceKey: string): ChatSourceClassificationV1[] {
  return chatProjectionResourcesV1(projection).flatMap(resource => resource.fragments.map(fragment => {
    const pointer = fragment.pointer
    const purpose = ['/goals', '/motivation'].includes(pointer) ? 'motivation' : pointer === '/personality' ? 'voice' : ['/name', '/identity'].includes(pointer) ? 'identity' : 'knowledge'
    const selected = resource.resourceKey === actorResourceKey && fragment.valueJson !== '""'
    const isPublic = selected && ['/name', '/identity', '/shortDescription'].includes(pointer)
    const isPrivate = selected && ['/background', '/goals', '/motivation', '/personality'].includes(pointer)
    return {projectionHash: projection.projectionHash, fragmentKey: fragment.fragmentKey, purpose,
      visibility: isPublic ? 'public' : isPrivate ? 'participants' : 'author-only', audienceKeys: isPrivate ? [actorResourceKey] : []}
  }))
}

/** Pre-call admission for the registered material, after the real WorldRelease
 * and S2 compiler. Byte presence is insufficient: purpose and audience matter.
 * This does not judge generated openings or prove narrative quality. */
export function assertM1ActorSourceFidelityV1(input: {
  source: FrozenChatSourceProjectionV1
  actorResourceKey: string
  actorKey: string
  role: M1RoleMaterialV1
  publicFacts: readonly string[]
}): void {
  const {source, actorResourceKey, actorKey, role, publicFacts} = input
  const requireMaterial = (values: readonly string[], pointer: string, purpose: 'knowledge' | 'motivation', privateOnly: boolean) => {
    for (const value of values) {
      const matches = source.knowledge.filter(item => item.content.includes(value))
      if (matches.length !== 1 || matches[0].source.resourceKey !== actorResourceKey
        || matches[0].source.pointer !== pointer || matches[0].source.purpose !== purpose
        || !matches[0].audienceKeys.includes(actorKey)
        || (privateOnly ? matches[0].audienceKeys.some(key => key !== actorKey) : !matches[0].audienceKeys.includes('player'))) {
        throw new Error(`[m1-source-fidelity] ${pointer} 的原材料缺失、语义用途错误或知情范围不符；停止模型调用，不能用运行时补写修复来源`)
      }
    }
  }
  requireMaterial(role.privateFacts, '/background', 'knowledge', true)
  requireMaterial(role.goals, '/goals', 'motivation', true)
  requireMaterial(role.beliefs, '/motivation', 'motivation', true)
  requireMaterial(publicFacts, '/shortDescription', 'knowledge', false)
}

/** Explicit evaluation-author mapping, frozen before any model call. The whole
 * original truth remains unknown until its complete discovery condition holds. */
export interface M1DiscoverySourceV1 {
  resourceKey: string
  pointer: string
  text: string
  condition: string
}

export function m1ScenarioSourceClassificationsV1(projection: ChatSourceProjectionDraftV1, actorResourceKey: string,
  discoveries: readonly M1DiscoverySourceV1[]): ChatSourceClassificationV1[] {
  const backgroundFragments = new Set(projection.background?.flatMap(r => r.fragments.map(f => f.fragmentKey)))
  const rows = m1ActorSourceClassificationsV1(projection, actorResourceKey).map(row => backgroundFragments.has(row.fragmentKey)
    ? {...row, purpose: 'knowledge' as const} : row)
  const prerequisite = projection.characters.find(c => c.resourceKey === actorResourceKey)?.fragments.find(f => f.pointer === '/shortDescription' && f.valueJson !== '""')
  if (discoveries.length && !prerequisite) throw new Error('[m1-source-fidelity] 隐情缺少原公开背景依据')
  const seen = new Set<string>()
  for (const truth of discoveries) {
    const fragment = projection.background?.find(r => r.resourceKey === truth.resourceKey)?.fragments.find(f => f.pointer === truth.pointer)
    if (!fragment || fragment.valueJson !== JSON.stringify(truth.text) || !truth.text.trim() || !truth.condition.trim() || seen.has(fragment.fragmentKey)) {
      throw new Error('[m1-source-fidelity] 既定隐情的背景资源、完整原文、条件缺失或重复；停止模型调用')
    }
    seen.add(fragment.fragmentKey)
    const row = rows.find(r => r.fragmentKey === fragment.fragmentKey)!
    Object.assign(row, {purpose: 'knowledge', visibility: 'discoverable', audienceKeys: [],
      discovery: {actorKeys: [actorResourceKey], condition: truth.condition, prerequisiteFragmentKeys: [prerequisite!.fragmentKey]}})
  }
  return rows
}

/** Unlike actor-only admission, this also accounts for every authored hidden
 * truth. Omitting it, exposing it, or weakening its condition is not a valid run. */
export function assertM1ScenarioSourceFidelityV1(input: Parameters<typeof assertM1ActorSourceFidelityV1>[0] & {
  authorOnlyFacts: readonly string[]
  discoveries: readonly M1DiscoverySourceV1[]
}): void {
  assertM1ActorSourceFidelityV1(input)
  const fail = () => {throw new Error('[m1-source-fidelity] 既定隐情缺失、重复、初始泄露或发现授权与登记不符；停止模型调用')}
  const {source, authorOnlyFacts, discoveries, actorKey, actorResourceKey} = input
  for (const [pointer, value, purpose, audience] of [
    ['/name', input.role.name, 'identity', ['player', actorKey]],
    ['/personality', input.role.values.join('；'), 'voice', [actorKey]],
  ] as const) {
    if (!value) continue
    const matches = source.knowledge.filter(k => k.source.resourceKey === actorResourceKey && k.source.pointer === pointer)
    if (matches.length !== 1 || matches[0].content !== JSON.stringify(value) || matches[0].source.purpose !== purpose
      || JSON.stringify([...matches[0].audienceKeys].sort()) !== JSON.stringify([...audience].sort())) {
      throw new Error('[m1-source-fidelity] 角色名称或价值取向没有按原文、用途和听众保留；停止模型调用')
    }
  }
  if (new Set(authorOnlyFacts).size !== authorOnlyFacts.length || new Set(discoveries.map(t => t.text)).size !== discoveries.length
    || JSON.stringify([...authorOnlyFacts].sort()) !== JSON.stringify(discoveries.map(t => t.text).sort())
    || source.knowledge.filter(k => k.discovery).length !== discoveries.length) fail()
  const prerequisite = source.knowledge.find(k => k.source.resourceKey === actorResourceKey && k.source.pointer === '/shortDescription'
    && k.source.purpose === 'knowledge' && k.audienceKeys.includes(actorKey) && k.audienceKeys.includes('player'))
  for (const truth of discoveries) {
    const matches = source.knowledge.filter(k => {
      try {const value: unknown = JSON.parse(k.content); return typeof value === 'string' && value.includes(truth.text)} catch {return false}
    })
    const item = matches[0]
    if (!truth.text.trim() || !truth.condition.trim() || matches.length !== 1 || item.content !== JSON.stringify(truth.text)
      || item.source.resourceKey !== truth.resourceKey || item.source.pointer !== truth.pointer || item.source.purpose !== 'knowledge'
      || !source.backgroundSources?.some(s => s.resourceKey === truth.resourceKey && s.sourceHash === item.source.sourceHash)
      || item.audienceKeys.length || !item.discovery || !prerequisite
      || item.discovery.condition !== truth.condition || JSON.stringify(item.discovery.actorKeys) !== JSON.stringify([actorKey])
      || JSON.stringify(item.discovery.prerequisiteKnowledgeKeys) !== JSON.stringify([prerequisite.key])) fail()
  }
}
