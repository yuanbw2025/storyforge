import type {AgentRunSnapshotV1} from '../agent/run/event-store'
import {parseContextManifestV1, verifyContextManifestIntegrityV1} from '../agent/run/context-manifest'
import {readAgentRunArtifactExactV1} from '../memory/artifact-store'
import {sha256Text} from '../ai/chapter-memory/text-normalization'
import {chatRetrievalVersionForReader, supportsChatCorrectionContextV1, type ChatRetrievalVersion} from './context-selection'
import type {ChatNarrativeActionV1} from '../types/chat-narrative'
import {supportsChatSceneTransitionPromptV1} from './narrative-scene-transition'
import type {CharacterInteractionRuntimeState} from '../types'
import {buildInteractionContextWindow} from './runtime'
import {formatInteractionRuntimeContextV1} from './context-format'
import {pendingChatMemoryCorrectionsV1} from './memory-reconciliation'

export async function assertChatMemoryCorrectionInputV1(snapshot: AgentRunSnapshotV1, projectId: number,
  state: CharacterInteractionRuntimeState, actorKey: string): Promise<void> {
  if (pendingChatMemoryCorrectionsV1(state, actorKey).length
    && !supportsChatCorrectionContextV1(await readChatCandidateRetrievalVersion(snapshot, projectId, 'interactionRuntime', actorKey, state))) {
    throw new Error('原行动没有读取完整记忆修正依据，请取消后明确发起新行动；不会自动替换旧输入或重发。')
  }
}

/** A review follows its saved producer's reader. Old situation runs did not
 * retain a packet and keep the conservative v1 memory policy. */
export async function readChatCandidateRetrievalVersion(snapshot: AgentRunSnapshotV1, projectId: number,
  sourceKey: 'interactionRuntime' | 'chatSituationRuntime', participantKey?: string, state?: CharacterInteractionRuntimeState): Promise<ChatRetrievalVersion> {
  const packet = snapshot.events.find(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'context-packet'
    && e.payload.stepId === 'interaction:runtime-candidate' && e.payload.attempt === 1)
  if (packet?.type !== 'evidence.artifact.recorded') return sourceKey === 'interactionRuntime' ? 'legacy' : 'chat-relevance-v1'
  const body = JSON.parse(await readAgentRunArtifactExactV1({projectId, artifactKind: 'context-packet', contentHash: packet.payload.contentHash}))
  const manifest = parseContextManifestV1(body.manifest), source = manifest.sources.find(s => s.key === sourceKey)
  const assembled = snapshot.events.find(e => e.type === 'context.assembled' && e.payload.stepId === 'interaction:runtime-candidate' && e.payload.attempt === 1)
  if (!await verifyContextManifestIntegrityV1(manifest) || typeof body.text !== 'string' || !source
    || source.status !== 'included' || assembled?.type !== 'context.assembled' || assembled.payload.manifestHash !== manifest.manifestHash
    || participantKey != null && body.participantKey !== participantKey) throw new Error('行动来源读取版本无法核验，已停止审查。')
  const version = sourceKey === 'interactionRuntime' ? chatRetrievalVersionForReader(source.readerVersion)
    : ['chat-situation-runtime-view-v15', 'chat-situation-runtime-view-v16', 'chat-situation-runtime-view-v17', 'chat-situation-runtime-view-v18'].includes(source.readerVersion ?? '') ? 'chat-relevance-v9' : source.readerVersion === 'chat-situation-runtime-view-v14' ? 'chat-relevance-v8' : source.readerVersion === 'chat-situation-runtime-view-v13' ? 'chat-relevance-v7' : source.readerVersion === 'chat-situation-runtime-view-v12' ? 'chat-relevance-v6' : source.readerVersion === 'chat-situation-runtime-view-v11' ? 'chat-relevance-v5' : ['chat-situation-runtime-view-v8', 'chat-situation-runtime-view-v9', 'chat-situation-runtime-view-v10'].includes(source.readerVersion ?? '') ? 'chat-relevance-v4' : source.readerVersion === 'chat-situation-runtime-view-v7' ? 'chat-relevance-v3' : source.readerVersion === 'chat-situation-runtime-view-v6' ? 'chat-relevance-v2' : source.readerVersion === 'chat-situation-runtime-view-v5' ? 'chat-relevance-v1' : null
  if (!version) throw new Error('行动来源读取版本无法核验，已停止审查。')
  if (sourceKey === 'interactionRuntime') {
    const profile = state?.profiles.find(p => p.participantKey === participantKey)
    if (!profile || !state) throw new Error('行动来源读取版本缺少原角色视角。')
    const expected = formatInteractionRuntimeContextV1(profile, buildInteractionContextWindow(state, profile.participantKey, {retrievalVersion: version}))
    if (source.contentHash !== await sha256Text(expected) || !body.text.includes(expected)) throw new Error('行动来源正文与读取版本不一致。')
  } else if (source.contentHash !== await sha256Text(body.text)) throw new Error('情境来源正文与记录不一致。')
  return version
}

/** Authorization must be in the actor's saved input, not merely available to the coordinator. */
export async function assertChatSceneTransitionInputV1(snapshot: AgentRunSnapshotV1, projectId: number,
  state: CharacterInteractionRuntimeState, actorKey: string, actions: readonly ChatNarrativeActionV1[]): Promise<void> {
  const transitions = actions.flatMap(a => a.sceneTransition ? [a.sceneTransition] : [])
  if (!transitions.length) return
  const producer = snapshot.contract.executionBindings?.find(b => b.stepId === 'interaction:runtime-candidate')
  if (!supportsChatSceneTransitionPromptV1(producer?.promptVersion)) throw new Error('旧生成合同不支持转场；保留候选，不自动换约或重发。')
  const version = await readChatCandidateRetrievalVersion(snapshot, projectId, 'interactionRuntime', actorKey, state)
  if (!supportsChatCorrectionContextV1(version)) throw new Error('转场缺少可核验的原角色输入。')
  const view = buildInteractionContextWindow(state, actorKey, {retrievalVersion: version})
  for (const t of transitions) {
    const source = view.messages.find(m => m.role === 'player' && m.eventSequence === t.playerEventSequence)
    const original = state.messages.find(m => m.role === 'player' && m.eventSequence === t.playerEventSequence)
    if (!source || source.text !== original?.text || !source.text.includes(t.playerExcerpt)
      || !view.chatNarrative?.facts.some(f => f.factKey === t.destinationFactKey && f.text.includes(t.destinationExcerpt))) {
      throw new Error('转场原输入缺少完整玩家消息或目的地事实；不能使用协调者额外知识补授权。')
    }
  }
}
