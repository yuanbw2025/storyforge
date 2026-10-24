import {db} from '../db/schema'
import {readInstanceAgentRunV1} from '../agent/run/event-store'
import {parseContextManifestV1, verifyContextManifestIntegrityV1} from '../agent/run/context-manifest'
import {hashCanonicalValue} from '../agent/run/hash'
import {sha256Text} from '../ai/chapter-memory/text-normalization'
import {readAgentRunArtifactExactV1} from '../memory/artifact-store'
import {assertInstanceBinding} from '../product/runtime-instances'
import type {WorkspaceScope} from '../types'
import {formatInteractionRuntimeContextV1} from './context-format'
import {buildInteractionContextWindow, interactionRetrievalView, interactionVisibilityView} from './runtime'
import {readProductRuntimeState} from './runtime-api'
import {isImportedCompletedInteractionRunV1} from './runtime-run-recovery'
import {chatRetrievalVersionForReader} from './context-selection'
import {chatMemoryPlayerViewV1} from './memory-management'
import {chatRelationshipHistoryRowsV1} from './relationship-history-context'

const STEP = 'interaction:runtime-candidate'
const SKILLS = ['character.chat-narrative-action', 'character.chat-narrative-options']
const matches = (contract: {executionBindings?: Array<{skillId: string}>}) => contract.executionBindings?.some(b => SKILLS.includes(b.skillId))
function fail(): never {throw new Error('这次调用的上下文证据不完整或不一致，无法展示。现有故事不受影响。')}

export async function listChatContextInspectionsV1(scope: WorkspaceScope, sessionId: number) {
  const owner = await assertInstanceBinding(sessionId, scope)
  if (owner.kind !== 'character-interaction') return []
  const rows = await db.agentRuns.where('productRuntimeSessionId').equals(sessionId).toArray()
  return rows.filter(row => matches(JSON.parse(row.contractJson))).sort((a, b) => b.id! - a.id!)
    .map(row => ({runId: row.id!, createdAt: row.createdAt}))
}

/** Read exact delivered evidence, then project only information also known to
 * the player at that historical boundary. Never return prompts or role secrets. */
export async function readChatContextInspectionV1(scope: WorkspaceScope, sessionId: number, runId: number) {
  const owner = await assertInstanceBinding(sessionId, scope)
  const snapshot = await readInstanceAgentRunV1(scope, runId)
  if (owner.kind !== 'character-interaction' || snapshot.run.productRuntimeSessionId !== sessionId || !matches(snapshot.contract)) fail()
  const artifactEvent = (kind: string) => snapshot.events.find(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === kind && e.payload.stepId === STEP && e.payload.attempt === 1)
  const recorded = artifactEvent('context-packet')
  if (recorded?.type !== 'evidence.artifact.recorded') return {available: false as const, reason: '这次历史调用没有保存可核验的完整上下文；不会用当前局面代替。'}
  const request = artifactEvent('rendered-request')
  const assembled = snapshot.events.find(e => e.type === 'context.assembled' && e.payload.stepId === STEP && e.payload.attempt === 1)
  const sent = snapshot.events.find(e => e.type === 'model.requested' && e.payload.stepId === STEP && e.payload.attempt === 1)
  if (!sent) return {available: false as const, reason: '这次运行尚未记录实际发送模型请求。'}
  if (request?.type !== 'evidence.artifact.recorded' || assembled?.type !== 'context.assembled' || sent.type !== 'model.requested') fail()
  const [packetText, requestText] = await Promise.all([
    readAgentRunArtifactExactV1({projectId: scope.projectId, artifactKind: 'context-packet', contentHash: recorded.payload.contentHash}),
    readAgentRunArtifactExactV1({projectId: scope.projectId, artifactKind: 'rendered-request', contentHash: request.payload.contentHash}),
  ])
  const packet = JSON.parse(packetText), delivered = JSON.parse(requestText)
  const messages = Array.isArray(delivered) ? delivered : delivered?.version === 1 ? delivered.messages : null
  const requestOptions = Array.isArray(delivered) ? undefined : delivered?.requestOptions
  if (!Array.isArray(delivered) && (Object.keys(delivered ?? {}).sort().join(',') !== 'messages,requestOptions,version' || !requestOptions || typeof requestOptions !== 'object' || Array.isArray(requestOptions))) fail()
  if (packet.version !== 1 || typeof packet.text !== 'string' || !packet.text || typeof packet.participantKey !== 'string') fail()
  const manifest = parseContextManifestV1(packet.manifest)
  if (!await verifyContextManifestIntegrityV1(manifest) || manifest.stepId !== STEP || manifest.attempt !== 1 || manifest.manifestHash !== assembled.payload.manifestHash
    || manifest.sources.length !== 1 || manifest.sources[0].key !== 'interactionRuntime' || manifest.sources[0].status !== 'included'
    || manifest.sources[0].contentHash !== await sha256Text(packet.text)) fail()
  if (!Array.isArray(messages) || !messages.some(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes(packet.text))
    || sent.payload.bindingHash !== await hashCanonicalValue({runtimeBindingHash: snapshot.contract.runtimeBindingHash, manifestHash: manifest.manifestHash, messages, ...(requestOptions ? {requestOptions} : {})})) fail()
  const events = await db.productRuntimeEvents.where('sessionId').equals(sessionId).toArray()
  const imported = isImportedCompletedInteractionRunV1(snapshot, events)
  if (!imported && (manifest.runId !== runId || manifest.scope.projectId !== scope.projectId)) fail()
  const boundary = snapshot.contract.scope.runtime
  if (!boundary || boundary.releaseHash !== owner.runtimeSourceHash) fail()
  const originalState = await readProductRuntimeState(sessionId, boundary.baseSequence)
  if (!imported && await sha256Text(JSON.stringify(originalState)) !== boundary.stateHash) fail()
  const state = originalState.interaction
  if (!state?.chatNarrative) fail()
  const profile = state.profiles.find(p => p.participantKey === packet.participantKey)
  if (!profile) fail()
  if (await hashCanonicalValue(interactionRetrievalView(state, packet.participantKey)) !== boundary.visibilityHash) fail()
  const source = manifest.sources[0]
  const retrievalVersion = chatRetrievalVersionForReader(source.readerVersion)
  const legacy = retrievalVersion === 'legacy'
  const view = buildInteractionContextWindow(state, packet.participantKey, {maxCharacters: 24_000, maxRecentMessages: 32,
    retrievalVersion: retrievalVersion ?? 'legacy'})
  if (retrievalVersion == null || formatInteractionRuntimeContextV1(profile, view) !== packet.text) {
    return {available: false as const, reason: '这次输入经过裁剪或使用了不同的读取版本，无法完整还原可见条目；不会冒充完整上下文。'}
  }
  if (!legacy && (!packet.selection || await hashCanonicalValue(packet.selection) !== await hashCanonicalValue(view.selection))) fail()
  const visible = interactionVisibilityView(state, state.playerKey)
  const playerMessages = new Set(visible.messages.map(m => m.messageId)), selectedMessages = new Set(view.messages.map(m => m.messageId))
  const sharedMessages = interactionVisibilityView(state, packet.participantKey).messages.filter(m => playerMessages.has(m.messageId))
  const excluded = new Set(state.chatNarrative.excludedMessageIds ?? [])
  const known = new Set(visible.knowledge.map(k => `${k.knowledgeKey}\0${k.content}`))
  const memories = new Set(state.memories.filter(m => chatMemoryPlayerViewV1(state, m)?.content === m.content).map(m => m.memoryId))
  const shared = interactionVisibilityView(state, packet.participantKey)
  const selection = view.selection ? {
    ...(view.selection.history ? {
      ...(view.selection.version === 6 ? {relationships: chatRelationshipHistoryRowsV1(state, packet.participantKey,
        interactionRetrievalView(state, packet.participantKey).messages).filter(row => row.messages.length === 2
        && row.messages.every(message => playerMessages.has(message.messageId))).map(row => ({content: row.change.reason,
        included: view.selection!.history!.some(d => d.kind === 'relationships' && d.key === row.key && d.included), reason: 'historical-relevance' as const}))} : {}),
      facts: shared.chatNarrative!.facts.filter(f => visible.chatNarrative!.facts.some(p => p.factKey === f.factKey)).map(f => ({content: f.text,
        included: view.selection!.history!.some(d => d.kind === 'facts' && d.key === f.factKey && d.included), reason: 'historical-relevance' as const})),
      threads: shared.chatNarrative!.threads.filter(t => visible.chatNarrative!.threads.some(p => p.threadKey === t.threadKey)).map(t => ({content: `${t.title}：${t.question}`,
        included: view.selection!.history!.some(d => d.kind === 'threads' && d.key === t.threadKey && d.included), reason: 'historical-relevance' as const})),
    } : {}),
    knowledge: shared.knowledge.filter(k => known.has(`${k.knowledgeKey}\0${k.content}`)).map(k => {
      const decision = view.selection!.knowledge.find(d => d.key === k.knowledgeKey)!
      return {content: k.content, included: decision.included, reason: decision.reason}
    }),
    ...(view.selection.commitments ? {commitments: [
      ...(shared.chatNarrative?.goals.flatMap(g => g.commitments ?? []) ?? []), ...(shared.sharedCommitments ?? []),
    ].filter(c => c.audienceKeys.includes(state.playerKey)).map(c => {
      const decision = view.selection!.commitments!.find(d => d.key === c.commitmentKey)!
      return {content: c.terms, included: decision.included, reason: decision.reason}
    })} : {}),
    memories: shared.memories.filter(m => memories.has(m.memoryId)).map(m => {
      const decision = view.selection!.memories.find(d => d.key === m.memoryId)!
      return {content: m.content, included: decision.included, reason: decision.reason}
    }),
  } : undefined
  return {available: true as const, runId, actorName: profile.name, baseSequence: boundary.baseSequence,
    manifestHash: manifest.manifestHash, sourceReleaseHash: boundary.releaseHash, inputTokens: manifest.totalInputTokens,
    persona: {name: state.chatNarrative.persona.name, description: state.chatNarrative.persona.description},
    facts: view.chatNarrative!.facts.filter(f => f.audienceKeys.includes(state.playerKey)).map(f => f.text),
    threads: view.chatNarrative!.threads.filter(t => t.audienceKeys.includes(state.playerKey)).map(t => ({title: t.title, question: t.question, status: t.status})),
    knowledge: view.knowledge.filter(k => known.has(`${k.knowledgeKey}\0${k.content}`)).map(k => k.content),
    memories: view.memories.filter(m => memories.has(m.memoryId)).map(m => m.content),
    memoryCorrections: (view.memoryCorrections ?? []).filter(m => memories.has(m.memoryId)
      && m.sources.every(source => playerMessages.has(source.messageId))).map(m => ({content: m.content,
      sources: m.sources.map(source => ({text: source.text,
        speaker: source.speakerKey === state.playerKey ? state.chatNarrative!.persona.name : state.profiles.find(p => p.participantKey === source.speakerKey)?.name ?? '角色'}))})),
    commitments: [
      ...view.chatNarrative!.goals.flatMap(g => (g.commitments ?? []).map(c => ({...c, actorKey: g.actorKey}))),
      ...(view.sharedCommitments ?? []),
    ].filter(c => c.audienceKeys.includes(state.playerKey)).map(c => ({actorName: state.profiles.find(p => p.participantKey === c.actorKey)?.name ?? '角色',
      terms: c.terms, declared: c.declared.excerpt, resolution: c.resolution ? {kind: c.resolution.kind, excerpt: c.resolution.excerpt} : null})),
    ...(selection ? {selection} : {}),
    messages: view.messages.filter(m => playerMessages.has(m.messageId)).map(m => ({messageId: m.messageId, text: m.text,
      speaker: m.speakerKey === state.playerKey ? state.chatNarrative!.persona.name : state.profiles.find(p => p.participantKey === m.speakerKey)?.name ?? '角色'})),
    omissions: {excludedMessages: sharedMessages.filter(m => excluded.has(m.messageId)).length,
      budgetMessages: sharedMessages.filter(m => !excluded.has(m.messageId) && !selectedMessages.has(m.messageId)).length},
  }
}

export type ChatContextInspectionV1 = Awaited<ReturnType<typeof readChatContextInspectionV1>>
