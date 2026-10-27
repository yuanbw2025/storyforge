import { db } from '../db/schema'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { TTRPG_OPEN_GUIDANCE_SOURCE_KEYS_V1 as TTRPG_OPEN_GUIDANCE_SOURCES_V1 } from './open-model-purpose-contract'
/** Authored context and retained prose, filtered by the real consumer BEFORE metadata is exposed. */
import type { FrozenResourceScopeV1, ContextResourceDescriptorV1 } from '../registry/types'
import { resolveScope } from '../workspace/scope'
import { assertInstanceBinding } from '../product/runtime-instances'
import { verifyProductRuntimeSessionSourceV1 } from '../product-production/preview-source'
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { isTtrpgRuntimeContentV2 } from './content-version'
import { loadTtrpgOpenPlayerContextV1 } from './open-player-context'
import { loadTtrpgOpenKpContextV1 } from './open-kp-context'
import { loadTtrpgOpenGmOracleContextV1 } from './open-gm-oracle-context'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { estimateTokens } from '../ai/context-budget'
import { createTtrpgOpenRuntimeResourceProviderV1, type TtrpgOpenResourceRowV1 } from './open-runtime-resource-provider'
import type { TtrpgOpenContextConsumerV1 } from './open-context-policy'
import { TtrpgOpenReadConflictV1 } from './open-read-conflict'
import { isTtrpgOpenOracleRuntimeGuidanceVisibleV1 } from './open-oracle-runtime-delivery'

export { TTRPG_OPEN_GUIDANCE_SOURCE_KEYS_V1 as TTRPG_OPEN_GUIDANCE_SOURCES_V1 } from './open-model-purpose-contract'
export function createTtrpgOpenGuidanceProviderV1(consumer: TtrpgOpenContextConsumerV1) {
  const sourceKey = TTRPG_OPEN_GUIDANCE_SOURCES_V1[consumer]
  return createTtrpgOpenRuntimeResourceProviderV1({ sourceKey, providerVersion: 'ttrpg-open-guidance-provider-v1', normalizationVersion: 'ttrpg-open-guidance-json-v1', kinds: ['fact', 'reference'], catalog: scope => catalog(scope, consumer) })
}
async function catalog(scope: FrozenResourceScopeV1, consumer: TtrpgOpenContextConsumerV1) {
  if (!scope.productRuntimeSessionId || !scope.worldId || !scope.workId || !scope.runtimeActorKey
    || consumer === 'actor' && scope.runtimeActorKey === 'gm' || consumer !== 'actor' && scope.runtimeActorKey !== 'gm') throw new Error('[ttrpg-open-context] 情境来源需要准确的角色与接收场景')
  const workspace = await resolveScope({ scope: { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId } })
  const input = { scope: workspace, sessionId: scope.productRuntimeSessionId, actorKey: scope.runtimeActorKey }
  const session = await assertInstanceBinding(input.sessionId, workspace), source = await verifyProductRuntimeSessionSourceV1({ scope: workspace, session, ttrpgProtocol: 2 })
  const content = source.runtimePackage.ttrpg
  if (!content || !isTtrpgRuntimeContentV2(content) || !content.campaign.runtimePolicy.enabled) throw new Error('[ttrpg-open-context] 冻结作品未允许模型情境读取')
  const context = consumer === 'actor' ? await loadTtrpgOpenPlayerContextV1(input)
    : consumer === 'party-narrator' ? await loadTtrpgOpenKpContextV1(input) : await loadTtrpgOpenGmOracleContextV1(input)
  if (source.runtimeSourceHash !== context.readEvidence.runtimeSourceHash) throw new Error('[ttrpg-open-context] 情境来源不是本实例冻结内容')
  const immutableSource = source.source.kind === 'release'
    ? { table: 'productReleases', recordId: source.source.productReleaseId, field: 'manifestJson', raw: (await db.productReleases.get(source.source.productReleaseId))?.manifestJson }
    : { table: 'productBuilds', recordId: source.source.productBuildId, field: 'previewManifestJson', raw: (await db.productBuilds.get(source.source.productBuildId))?.previewManifestJson }
  if (!immutableSource.raw || await hashProductProductionValueV2(JSON.parse(immutableSource.raw).runtimePackage) !== source.packageHash) throw new Error('[ttrpg-open-context] 冻结情境的实际来源字段不一致')
  const frozenSourceRef = { table: immutableSource.table, recordId: immutableSource.recordId, field: immutableSource.field,
    revision: source.packageHash, contentHash: await sha256Text(immutableSource.raw) }
  const state = await readProductRuntimeState(input.sessionId), runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime?.authorization || !runtime.openRun || state.lastSequence !== context.readEvidence.sequence) throw new TtrpgOpenReadConflictV1('读取情境来源期间进度已变化')
  const recipients = consumer === 'actor' ? [input.actorKey] : [...runtime.authorization.selectedActorKeys]
  const oracleScope = consumer === 'gm-assistant' && 'oracleRuntimeReferencePolicy' in context ? context.oracleRuntimeReferencePolicy : undefined
  const normalizationScope = consumer === 'gm-assistant' && 'normalizationRuntimeReferencePolicy' in context ? context.normalizationRuntimeReferencePolicy : undefined
  const runtimeScope = normalizationScope ? { audience: normalizationScope.oraclePolicy.audience, recipientActorKeys: normalizationScope.recipientActorKeys } : oracleScope
  const oracleGuidanceScope = normalizationScope ? { oracleSourceRef: normalizationScope.oraclePolicy.oracleSourceRef, ...runtimeScope,
    snapshotHash: normalizationScope.oraclePolicy.references.snapshotHash, reviewSourceRef: normalizationScope.reviewSourceRef, reviewHash: normalizationScope.reviewHash }
    : oracleScope ? { oracleSourceRef: oracleScope.oracleSourceRef, audience: oracleScope.audience,
      recipientActorKeys: oracleScope.recipientActorKeys, snapshotHash: oracleScope.references.snapshotHash } : undefined
  const policy = content.campaign.contextPolicy
  const sourceKey = TTRPG_OPEN_GUIDANCE_SOURCES_V1[consumer]
  const visible = (audience: string, knownBy: readonly string[]) => runtimeScope ? isTtrpgOpenOracleRuntimeGuidanceVisibleV1(runtimeScope, audience, knownBy) : audience === 'public' || audience === 'party'
    || consumer === 'gm-assistant' && audience === 'gm-only'
    || audience === 'private' && (consumer === 'gm-assistant' ? knownBy.includes('gm') : recipients.every(key => knownBy.includes(key)))
  const rows: Array<{ suffix: string; title: string; value: unknown; mandatory: boolean; kind: 'fact' | 'reference'; authority: ContextResourceDescriptorV1['authority'] }> = [{
    suffix: `context-contract.${consumer}`, title: '情境指引与历史叙述的权限边界', mandatory: true, kind: 'fact', authority: 'confirmed-evidence',
    value: { schema: 'storyforge.ttrpg-open-context-guidance-contract', version: runtimeScope ? 2 : 1, consumer, maximumContextTokens: policy?.maximumContextTokens ?? 16000,
      ...(runtimeScope ? { oracleGuidanceScope } : {}),
      noRuleAuthority: true, noKnowledgeGrant: true, narrationIsNotMechanicalEvidence: true, readSourceDependenciesRequired: true },
  }]
  for (const { consumers, trigger } of policy?.triggers ?? []) {
    if (!consumers.includes(consumer) || !visible(trigger.audience, trigger.knownByActorKeys)) continue
    rows.push({ suffix: `trigger.${await hashCanonicalValue(trigger.triggerKey)}`, title: `作者情境指引 · ${(await hashCanonicalValue(trigger.triggerKey)).slice(0, 12)}`, mandatory: false, kind: 'reference', authority: 'author-canon',
      value: { schema: 'storyforge.ttrpg-open-authored-context-guidance', version: 1, triggerKey: trigger.triggerKey,
        text: trigger.injectText, noRuleAuthority: true, noKnowledgeGrant: true } })
  }
  for (const narration of runtime.openRun.narrations ?? []) {
    const mayRead = consumer === 'gm-assistant'
      ? narration.binding.viewerKey === runtime.authorization.seats.find(s => s.role === 'gm')?.viewerKey
      : recipients.every(key => narration.recipientActorKeys.includes(key))
    if (!mayRead || runtimeScope && (runtimeScope.audience === 'public' || runtimeScope.audience === 'party'
      && !runtimeScope.recipientActorKeys.every(key => narration.recipientActorKeys.includes(key)))) continue
    rows.push({ suffix: `recent.${await hashCanonicalValue(narration.sourceRef)}`, title: `已保存叙述 · ${(await hashCanonicalValue(narration.sourceRef)).slice(0, 12)}`, mandatory: false, kind: 'reference', authority: 'confirmed-evidence',
      value: { schema: 'storyforge.ttrpg-open-narration-recall', version: 1, paragraphs: narration.narration.paragraphs.map(p => p.text),
        noRuleAuthority: true, noKnowledgeGrant: true, reliability: 'narrated' } })
  }
  const policyHash = await hashCanonicalValue({ sourceKey, consumer, fullIsAtomic: true, originalRead: false,
    ...(runtimeScope ? { oracleGuidanceScope } : {}) })
  const resources: TtrpgOpenResourceRowV1[] = await Promise.all(rows.map(async row => {
    const text = canonicalStringify(row.value), contentHash = await sha256Text(text), tokenCount = estimateTokens(text)
    const descriptor: ContextResourceDescriptorV1 = { version: 1, resourceKey: `fact:ttrpg-open:${context.readEvidence.sessionKey}:${input.actorKey}:${row.suffix}`,
      sourceKey, kind: row.kind, title: row.title, shortSummary: row.title, authority: row.authority,
      contentRevision: context.readEvidence.sequence, contentHash, policyRevision: runtimeScope ? 2 : 1, policyHash,
      scope: { projectId: workspace.projectId, worldId: workspace.worldId, workId: workspace.workId, productRuntimeSessionId: input.sessionId, runtimeActorKey: input.actorKey },
      relations: [], sourceRefs: [frozenSourceRef, { table: 'productRuntimeSessions', recordId: input.sessionId, field: 'runtimeHeadStateJson',
        revision: context.readEvidence.sequence, contentHash: context.readEvidence.stateHash }], tokenEstimate: { full: tokenCount }, availableDepths: ['full'], priority: row.mandatory ? 'must-read' : 'normal' }
    return { descriptor, content: text, tokenCount }
  }))
  const head = await readProductRuntimeStateVersion(input.sessionId)
  if (head.sequence !== context.readEvidence.sequence || head.stateHash !== context.readEvidence.stateHash) throw new TtrpgOpenReadConflictV1('读取情境来源期间状态已变化')
  return { fingerprint: await hashCanonicalValue({ scope, runtimeSourceHash: context.readEvidence.runtimeSourceHash, stateHash: context.readEvidence.stateHash, visibilityHash: context.visibilityHash }), resources }
}
export const TTRPG_OPEN_ACTOR_CONTEXT_PROVIDER_V1 = createTtrpgOpenGuidanceProviderV1('actor')
export const TTRPG_OPEN_PARTY_CONTEXT_PROVIDER_V1 = createTtrpgOpenGuidanceProviderV1('party-narrator')
export const TTRPG_OPEN_GM_CONTEXT_PROVIDER_V1 = createTtrpgOpenGuidanceProviderV1('gm-assistant')
