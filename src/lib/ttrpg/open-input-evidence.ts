import { verifyTtrpgOpenContextSelectionEvidenceV1 } from './open-context-selection-evidence'
import type { TtrpgOpenModelCallV1 } from './open-model-calls'
/** Frozen, exact Gateway evidence available before the model response exists. */
import type { ContextManifestV2, WorkspaceScope } from '../types'
import type { ContextGatewayPreflightEvidenceV1 } from '../context-gateway/attempt-evidence'
import { verifyContextGatewayPreflightEvidenceV1 } from '../context-gateway/attempt-evidence'
import type { ContextGatewayExecutionV1 } from '../context-gateway/execution'
import { verifyContextManifestIntegrityV2 } from '../agent/run/context-manifest'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { estimateTokens } from '../ai/context-budget'
import { db } from '../db/schema'
import { CONTEXT_SOURCE_BY_KEY } from '../registry/context-sources'
import type { TtrpgOpenContextSelectionReceiptV1 } from './open-context-selection'

import { assertTtrpgOpenFrozenContextSourcesV1 } from './open-model-purpose-contract'
import { readInstanceAgentRunV1 } from '../agent/run/event-store'

export const TTRPG_OPEN_INPUT_SOURCE_KEYS_V1 = ['ttrpgOpenAuthority', 'ttrpgOpenKnowledge'] as const
export interface TtrpgOpenInputEvidenceV1 {
  schema: 'storyforge.ttrpg-open-input-evidence'
  version: 1
  manifest: ContextManifestV2
  preflight: ContextGatewayPreflightEvidenceV1
  selector: ContextGatewayExecutionV1['selector']
  sufficiency: ContextGatewayExecutionV1['sufficiency']
  retrievalTrace: ContextGatewayExecutionV1['retrievalTrace']
  gatewayVersionHash: string
  policyHash: string
  /** Internal validation only; never included in the Context Packet or model messages. */
  publicKernelHash?: string
  contextSelection?: TtrpgOpenContextSelectionReceiptV1
  contextAssembly?: { schema: 'storyforge.ttrpg-context-assembly'; version: 1; eventType: 'ttrpg.context.assembled'; receiptHash: string }
}

export async function verifyTtrpgOpenInputEvidenceV1(input: {
  scope: WorkspaceScope; runId: number; stepId: string; attempt: number
  evidence: TtrpgOpenInputEvidenceV1; requestHash: string; inputManifestHash: string
  sessionId: number; sessionKey: string; actorKey: string; skillId?: string; call?: TtrpgOpenModelCallV1; mode: 'reserve' | 'dispatch' | 'finish'
}): Promise<void> {
  const e = input.evidence, manifest = e.manifest
  const snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
  const sourceKeys = assertTtrpgOpenFrozenContextSourcesV1(input.skillId ?? 'prose.ttrpg-open-intent', snapshot.contract.permissions.contextSourceKeys)
  const [project, world, work] = await Promise.all([db.projects.get(input.scope.projectId),
    db.worlds.get(input.scope.worldId), db.works.get(input.scope.workId)])
  if (e.schema !== 'storyforge.ttrpg-open-input-evidence' || e.version !== 1
    || manifest.version !== 2 || !await verifyContextManifestIntegrityV2(manifest)
    || manifest.runId !== input.runId || manifest.stepId !== input.stepId || manifest.attempt !== input.attempt
    || manifest.scope.projectId !== input.scope.projectId || manifest.scope.workspaceUid !== project?.workspaceUid
    || manifest.scope.worldCode !== world?.code || manifest.scope.workCode !== work?.code
    || world?.projectId !== input.scope.projectId || work?.worldId !== input.scope.worldId
    || manifest.manifestHash !== input.inputManifestHash
    || e.preflight.promptHash !== input.requestHash
    || manifest.sources.map(source => source.key).sort().join(',') !== [...sourceKeys].sort().join(',')) {
    throw new Error('[ttrpg-open-input] 冻结 Gateway 输入不属于此请求/角色工作区')
  }
  const bodies = await verifyContextGatewayPreflightEvidenceV1({ ...input, preflight: e.preflight,
    selector: e.selector, sufficiency: e.sufficiency, retrievalTrace: e.retrievalTrace,
    gatewayVersionHash: e.gatewayVersionHash, policyHash: e.policyHash })
  await verifyTtrpgOpenContextSelectionEvidenceV1({ ...input, skillId: input.skillId ?? 'prose.ttrpg-open-intent', snapshot, bodies, sourceKeys })
  const prefix = `fact:ttrpg-open:${input.sessionKey}:${input.actorKey}:`
  if (e.selector.selected.some(item => !item.resourceKey.startsWith(prefix)
    || !sourceKeys.includes(item.sourceKey))) {
    throw new Error('[ttrpg-open-input] 输入读取越过当前角色权限')
  }
  if (input.mode !== 'finish') {
    const providers = new Map<string, { provider: import('../registry/types').ContextResourceProviderV1; assertCurrent?: () => Promise<void> }>()
    for (const sourceKey of new Set(e.selector.selected.map(item => item.sourceKey))) {
      const registered = CONTEXT_SOURCE_BY_KEY.get(sourceKey)?.resources
      if (!registered) throw new Error('[ttrpg-open-input] 冻结来源缺少正式 Provider')
      const session = await registered.openReadSession?.({ ...input.scope, productRuntimeSessionId: input.sessionId, runtimeActorKey: input.actorKey })
      providers.set(sourceKey, session ?? { provider: registered })
    }
    for (const item of e.selector.selected) {
      const read = await providers.get(item.sourceKey)!.provider.read({ scope: { ...input.scope, productRuntimeSessionId: input.sessionId,
        runtimeActorKey: input.actorKey }, resourceKey: item.resourceKey, depth: 'full', maxTokens: manifest.inputBudget })
      if (read.contentHash !== item.contentHash || read.descriptor.policyHash !== item.policyHash) {
        throw new Error('[ttrpg-open-input] 实际角色输入或读取权限已经 stale')
      }
    }
    for (const session of providers.values()) await session.assertCurrent?.()
  }
  for (const source of manifest.sources) {
    const refs = e.preflight.artifacts.filter(ref => ref.role === 'source-snapshot' && ref.sourceKey === source.key)
      .sort((a, b) => (a.resourceKey ?? '').localeCompare(b.resourceKey ?? ''))
    const content = refs.map(ref => {
      const snapshot = JSON.parse(bodies[ref.contentHash]) as { content: unknown }
      if (typeof snapshot.content !== 'string') throw new Error('[ttrpg-open-input] 角色输入必须保留完整 JSON 原文')
      return snapshot.content
    }).join('\n')
    if (!refs.length || source.status !== 'included' || source.delivery !== 'full'
      || source.contentHash !== await sha256Text(content) || source.tokens !== estimateTokens(content)
      || refs.some(ref => !e.selector.selected.some(item => item.resourceKey === ref.resourceKey
        && item.sourceKey === source.key && item.depth === 'full' && item.contentHash === ref.sourceContentHash))) {
      throw new Error('[ttrpg-open-input] Manifest 与实际角色读取证据不一致')
    }
  }
  if (e.preflight.contextPacket.tokenCount > manifest.inputBudget) {
    throw new Error('[ttrpg-open-input] 实际上下文预算不一致')
  }
}
