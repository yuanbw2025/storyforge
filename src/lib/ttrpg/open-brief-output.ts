/** Citation selection is semantic; authority and attribution come only from exact delivered source bytes. */
import type { ContextGatewaySourceSnapshotInputV1 } from '../context-gateway/attempt-evidence'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { canonicalStringify } from '../agent/run/hash'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import * as p from './open-contract-parse'
import { ttrpgOpenDeliveredCommonIdentitiesV1 } from './open-common-identity-contract'
import { TTRPG_OPEN_COMMON_IDENTITY_SOURCE_V1 } from './open-model-purpose-contract'

import { parseTtrpgOpenBriefAttributionV1, TTRPG_OPEN_BRIEF_ENTRY_KINDS_V1, TTRPG_OPEN_BRIEF_RELIABILITY_V1, type TtrpgOpenBriefAttributionV1 } from './open-brief-contract'
export { parseTtrpgOpenBriefV1, type TtrpgOpenBriefV1, type TtrpgOpenBriefAttributionV1 } from './open-brief-contract'

/** This is not a substitute for the Gateway/candidate proof. Its inputs must be the retained actual full reads. */
export async function ttrpgOpenDeliveredBriefAttributionsV1(reads: readonly ContextGatewaySourceSnapshotInputV1[]): Promise<TtrpgOpenBriefAttributionV1[]> {
  const bodies = reads.map(read => {
    if (!['ttrpgOpenBriefInput', 'ttrpgOpenPartyMemory', TTRPG_OPEN_COMMON_IDENTITY_SOURCE_V1].includes(read.sourceKey ?? '') || !read.resourceKey?.includes(':gm:')
      || typeof read.content !== 'string') p.fail('复盘引用只接受本次准确的共同资料完整读取')
    const value = p.object(JSON.parse(read.content as string), 'delivered recap resource')
    if (value.version !== 1 && !(read.sourceKey === 'ttrpgOpenPartyMemory' && value.schema === 'storyforge.ttrpg-open-memory-context' && value.version === 2)) p.fail('复盘引用来源版本未支持')
    return { read, value }
  })
  const contracts = bodies.filter(({ read, value }) => read.sourceKey === 'ttrpgOpenBriefInput' && value.schema === 'storyforge.ttrpg-open-brief-contract')
  const frames = bodies.filter(({ read, value }) => read.sourceKey === 'ttrpgOpenBriefInput' && value.schema === 'storyforge.ttrpg-open-brief-frame')
  const memoryContracts = bodies.filter(({ read, value }) => read.sourceKey === 'ttrpgOpenPartyMemory' && value.schema === 'storyforge.ttrpg-open-memory-context-contract')
  if (contracts.length !== 1 || frames.length !== 1 || memoryContracts.length !== 1
    || contracts[0].value.consumer !== 'party-narrator'
    || ['noMechanicalAuthority', 'noKnowledgeGrant', 'noWorldWrite', 'noPlayerDecision'].some(key => contracts[0].value[key] !== true)
    || memoryContracts[0].value.noMechanicalAuthority !== true || memoryContracts[0].value.noKnowledgeGrant !== true
    || contracts[0].value.citationsOnlyFromDeliveredResources !== true || contracts[0].value.keepOriginalReliabilityAndObserver !== true
    || memoryContracts[0].value.consumer !== 'party-narrator') p.fail('复盘缺少唯一准确交付合同与阶段视图')
  const recipients = p.keys(frames[0].value.recipientActorKeys, 'actual recap recipients', 1000, 1)
  const commonReads = bodies.filter(({ read }) => read.sourceKey === TTRPG_OPEN_COMMON_IDENTITY_SOURCE_V1)
  const common = ttrpgOpenDeliveredCommonIdentitiesV1(commonReads.map(row => row.value), recipients)
  const result: TtrpgOpenBriefAttributionV1[] = []
  for (const { read, value } of bodies) {
    const schema = value.schema
    if (read.sourceKey === TTRPG_OPEN_COMMON_IDENTITY_SOURCE_V1 && schema === 'storyforge.ttrpg-open-common-identities-context') {
      if (!read.resourceKey!.endsWith(':common-identity-contract')) p.fail('共同身份合同没有同一资源身份')
      continue
    }
    if (schema === 'storyforge.ttrpg-open-brief-contract' || schema === 'storyforge.ttrpg-open-memory-context-contract') continue
    let source: Omit<TtrpgOpenBriefAttributionV1, 'resourceKey' | 'contextSourceKey' | 'contentHash'>
    if (read.sourceKey === 'ttrpgOpenBriefInput' && schema === 'storyforge.ttrpg-open-brief-frame' && read.resourceKey!.endsWith(':brief-frame')) {
      source = { citationKey: 'brief.frame', kind: 'stage', reliability: 'confirmed', observerKey: null, origin: null, sourceRef: null }
    } else if (read.sourceKey === 'ttrpgOpenBriefInput' && schema === 'storyforge.ttrpg-open-brief-entry') {
      const entry = p.record(value.entry, ['sourceKey', 'kind', 'reliability', 'observerKey', 'value'], 'actual recap entry')
      const citationKey = p.key(entry.sourceKey, 'recap entry citation')
      if (!read.resourceKey!.endsWith(`:brief-entry.${citationKey}`)) p.fail('复盘条目没有同一真实资源身份')
      const kind = p.oneOf(entry.kind, TTRPG_OPEN_BRIEF_ENTRY_KINDS_V1, 'recap entry kind')
      const reliability = p.oneOf(entry.reliability, TTRPG_OPEN_BRIEF_RELIABILITY_V1, 'recap source reliability')
      const body = p.object(entry.value, 'recap entry body')
      source = { citationKey, kind, reliability, observerKey: p.nullable(entry.observerKey, p.key, 'actual recap observer'),
        origin: body.origin === undefined ? null : p.oneOf(body.origin, ['human-authored', 'model-reviewed'], 'retained source origin'),
        sourceRef: body.sourceRef === undefined ? null : parseTtrpgOpenSourceRefV1(body.sourceRef) }
    } else if (read.sourceKey === TTRPG_OPEN_COMMON_IDENTITY_SOURCE_V1 && schema === 'storyforge.ttrpg-open-common-identity') {
      const row = common.find(row => row.citationKey === value.citationKey)
      if (!row || !read.resourceKey!.endsWith(`:common-${row.citationKey}`)) p.fail('共同身份没有准确完整交付资源')
      source = { citationKey: row.citationKey, kind: 'known-identity', reliability: row.reliability, observerKey: null, origin: null, sourceRef: null }
    } else if (read.sourceKey === 'ttrpgOpenPartyMemory' && schema === 'storyforge.ttrpg-open-memory-context') {
      const revisionKey = p.key(value.revisionKey, 'actual memory revision'), audience = p.oneOf(value.audience, ['public', 'party', 'private'], 'party recap memory audience')
      const knownBy = p.keys(value.knownBy, 'memory frozen recipients', 1000, 0)
      if (audience !== 'public' && !recipients.every(key => knownBy.includes(key)) || value.noMechanicalAuthority !== true || value.noKnowledgeGrant !== true) p.fail('复盘记忆不属于每名实际接收者或声称额外权威')
      source = { citationKey: `memory.${revisionKey}`, kind: 'memory', reliability: p.oneOf(value.reliability, ['observed', 'hearsay', 'belief'], 'memory original reliability'),
        observerKey: p.nullable(value.observerKey, p.key, 'memory original observer'), origin: p.oneOf(value.origin, ['human-authored', 'model-reviewed'], 'memory original origin'),
        sourceRef: parseTtrpgOpenSourceRefV1(value.sourceRef) }
      if (value.version === 2) {
        if (source.origin !== 'model-reviewed') p.fail('模型记忆来源代际不一致')
        const previous = p.list(value.sourceAttributions, 'actual model memory original sources', parseTtrpgOpenBriefAttributionV1, 256, 1)
        const flattened = previous.flatMap(attribution => attribution.originalSources ?? [attribution])
        const unique = new Map<string, typeof flattened[number]>()
        for (const attribution of flattened) {
          const identity = `${attribution.resourceKey}:${attribution.contentHash}`, existing = unique.get(identity)
          if (existing && canonicalStringify(existing) !== canonicalStringify(attribution)) p.fail('多代记忆的同一原始来源标记发生冲突')
          unique.set(identity, attribution)
        }
        source.originalSources = [...unique.values()]
      }
    } else p.fail('复盘引用混入其他来源或非完整资源')
    if (result.some(previous => previous.citationKey === source.citationKey)) p.fail('复盘引用身份重复或存在冲突')
    result.push(parseTtrpgOpenBriefAttributionV1({ ...source, resourceKey: read.resourceKey!, contextSourceKey: read.sourceKey as TtrpgOpenBriefAttributionV1['contextSourceKey'], contentHash: await sha256Text(read.content as string) }))
  }
  return result
}
