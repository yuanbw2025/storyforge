import Dexie from 'dexie'
import { db } from '../db/schema'
import { readOwnedRows, resolveScope } from '../workspace/scope'
import type { Chapter, DetailedOutline, OutlineNode, WorkspaceScope, ChatMessage } from '../types'
import { useAIConfigStore } from '../../stores/ai-config'
import { executeRegisteredAIEntryV1 } from './formal-ai-entry'
import { resolveRequestConfig } from '../ai/client'
import { prepareGenerationNode, type GenerationNode } from '../generation/generation-node'
import { prepareDetailedOutlineGatewayAssemblyV1 } from '../outline/detail-gateway-context'
import { buildDetailSceneGeneratePrompt, buildEnhancedDetailPrompt } from '../ai/adapters/detail-scene-adapter'
import { buildAgentSkillInputGuidanceV1, getAgentSkillV1 } from './skill-registry'
import { contextGatewayInputStateSourceKeysV1, projectContextGatewayInputStateV1 } from './context-gateway-input'
import { attachAgentContextInputStateV1, evidenceFromContextResult } from './context-policy'
import { buildNarrativeBriefV1, formatNarrativeBriefForPromptV1 } from './narrative-brief'
import { buildDetailedOutlineCopilotPatchV1, buildDetailedOutlineSceneMergeGuidanceV1, detailedOutlinePostStateMatchesPatchV1, type DetailedOutlineCopilotOperationV1 } from './detailed-outline-copilot'
import { hashCanonicalValue } from './run/hash'
import { adopt, adoptionTransactionTablesV1 } from '../registry/adopt'
import { assertDetailedOutlineTargetsUnwrittenFutureV1 } from '../outline/future-boundary'
import { resolveUnwrittenChapterTargetV1 } from './prose-copilot'
import type { OutlineGatewayAssemblyV1 } from '../outline/gateway-context'

export interface DetailedOutlineAuthoringSnapshotV1 {
  outlineNodeId: number
  summary: string
  baseDetailed: DetailedOutline | null
  baselineHash: string
  validCharacterIds: number[]
  validForeshadowIds: number[]
}

/** One prompt adapter shared by the stepped page and the main Agent. */
export function buildDetailedOutlineAuthoringPromptV1(input: {
  operation: DetailedOutlineCopilotOperationV1; chapterTitle: string; chapterSummary: string
  assembled: OutlineGatewayAssemblyV1; currentDetailed?: DetailedOutline | null; authorRequest?: string
}) {
  const skill = getAgentSkillV1('outline.details', 'outline')
  const inputState = projectContextGatewayInputStateV1(skill, input.assembled.contextGatewayExecution, input.assembled)
  const guidance = [buildAgentSkillInputGuidanceV1(skill, inputState), buildDetailedOutlineSceneMergeGuidanceV1(input.currentDetailed?.scenes ?? [])].filter(Boolean).join('\n\n')
  const authorRequest = input.authorRequest ?? (input.operation === 'scenes' ? `把《${input.chapterTitle}》拆成可执行场景，必须推动章节状态发生变化。` : `完善《${input.chapterTitle}》的场景、冲突、情绪变化和结尾压力。`)
  const narrativeBrief = buildNarrativeBriefV1({ authorRequest, assembled: input.assembled })
  const base = input.operation === 'scenes'
    ? buildDetailSceneGeneratePrompt(input.chapterTitle, input.chapterSummary, input.assembled.text, '', '', guidance)
    : buildEnhancedDetailPrompt(input.chapterTitle, input.chapterSummary, '', '', input.assembled.text, '', '', guidance)
  const messages: ChatMessage[] = [{ role: 'system', content: formatNarrativeBriefForPromptV1(narrativeBrief) }, ...base]
  return { messages, narrativeBrief, inputState }
}

export async function detailedOutlineExpectedPatchV1(snapshot: DetailedOutlineAuthoringSnapshotV1, raw: string) {
  const patch = buildDetailedOutlineCopilotPatchV1({ raw, operation: 'enhanced', currentScenes: snapshot.baseDetailed?.scenes ?? [], chapterSummary: snapshot.summary, validCharacterIds: new Set(snapshot.validCharacterIds), validForeshadowIds: new Set(snapshot.validForeshadowIds) })
  const existing = new Set(snapshot.baseDetailed?.scenes.map(scene => scene.sceneId) ?? [])
  const prefix = (await hashCanonicalValue({ baseline: snapshot.baselineHash, raw })).slice(0, 24)
  patch.scenes = patch.scenes?.map((scene, index) => existing.has(scene.sceneId) ? scene : { ...scene, sceneId: `scene-${prefix}-${index}` })
  return patch
}

export async function detailedOutlineAuthoringPostStateMatchesV1(scope: WorkspaceScope, snapshot: DetailedOutlineAuthoringSnapshotV1, raw: string) {
  const row = (await readOwnedRows<DetailedOutline>(scope, 'detailedOutlines', { owner: 'work' })).find(item => item.outlineNodeId === snapshot.outlineNodeId)
  return detailedOutlinePostStateMatchesPatchV1(row, snapshot.outlineNodeId, await detailedOutlineExpectedPatchV1(snapshot, raw))
}

export async function adoptDetailedOutlineAuthoringV1(scope: WorkspaceScope, worldGroupId: number | null, snapshot: DetailedOutlineAuthoringSnapshotV1, raw: string): Promise<void> {
  await assertDetailedOutlineTargetsUnwrittenFutureV1({ scope, worldGroupId, outlineNodeId: snapshot.outlineNodeId })
  const patch = await detailedOutlineExpectedPatchV1(snapshot, raw)
  await db.transaction('rw', adoptionTransactionTablesV1('detailedOutlines'), async () => {
    const outline = (await readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' })).find(row => row.id === snapshot.outlineNodeId)
    const detailed = (await readOwnedRows<DetailedOutline>(scope, 'detailedOutlines', { owner: 'work' })).find(row => row.outlineNodeId === snapshot.outlineNodeId) ?? null
    if (!outline || (outline.worldGroupId ?? null) !== worldGroupId
      || await Dexie.waitFor(hashCanonicalValue({ outline, detailed })) !== snapshot.baselineHash) throw new Error('章纲或场景细纲已变化，请重新生成候选。')
    const result = await adopt({ projectId: scope.projectId, scope, worldGroupId, target: 'detailedOutlines', mode: 'add', data: { outlineNodeId: snapshot.outlineNodeId, ...patch } })
    if (!result.written.length || result.skipped.length || result.unknown.length || result.typeErrors.length || result.fkErrors.length) throw new Error('场景细纲未能完整写入，已回滚。')
  })
}

export async function prepareDetailedOutlineAuthoringV1(input: { projectId: number; scope?: WorkspaceScope; worldGroupId: number | null; authorRequest: string; signal?: AbortSignal }) {
  const scope = await resolveScope({ projectId: input.projectId, scope: input.scope })
  const [outlines, chapters, details, characters, foreshadows] = await Promise.all([
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
    readOwnedRows<DetailedOutline>(scope, 'detailedOutlines', { owner: 'work' }),
    readOwnedRows<{ id: number }>(scope, 'characters', { owner: 'world' }),
    readOwnedRows<{ id: number }>(scope, 'foreshadows', { owner: 'work' }),
  ])
  const { outline } = resolveUnwrittenChapterTargetV1(input.authorRequest, outlines, chapters, input.worldGroupId)
  const currentDetailed = details.find(row => row.outlineNodeId === outline.id) ?? null
  const snapshot: DetailedOutlineAuthoringSnapshotV1 = { outlineNodeId: outline.id!, summary: outline.summary, baseDetailed: currentDetailed, baselineHash: await hashCanonicalValue({ outline, detailed: currentDetailed }), validCharacterIds: characters.map(row => row.id), validForeshadowIds: foreshadows.map(row => row.id) }
  const config = useAIConfigStore.getState().config
  const assembled = await prepareDetailedOutlineGatewayAssemblyV1({ projectId: input.projectId, scope, worldGroupId: input.worldGroupId, outlineNodeId: outline.id!, operation: 'enhanced', authorRequest: input.authorRequest, config, signal: input.signal })
  const prompt = buildDetailedOutlineAuthoringPromptV1({ operation: 'enhanced', chapterTitle: outline.title, chapterSummary: outline.summary, assembled, currentDetailed, authorRequest: input.authorRequest })
  const skill = getAgentSkillV1('outline.details', 'outline')
  const contextEvidence = attachAgentContextInputStateV1(evidenceFromContextResult('full', assembled), prompt.inputState)
  contextEvidence.inputStateSourceKeys = contextGatewayInputStateSourceKeysV1(skill, assembled.contextGatewayExecution)
  const node: GenerationNode<void, string, void> = { id: `outline.details:${outline.id}`, kind: 'outline.details', editableInput: true, assembleInput: () => prompt.messages, run: messages => executeRegisteredAIEntryV1('outline.detail.enhance', messages, config, { category: 'detail.enhance', projectId: input.projectId }, input.signal), adopt: raw => adoptDetailedOutlineAuthoringV1(scope, input.worldGroupId, snapshot, raw) }
  const route = resolveRequestConfig(config, { category: 'detail.enhance' }).config
  return { scope, snapshot, node, prepared: prepareGenerationNode(node, undefined), assembled, narrativeBrief: prompt.narrativeBrief, contextEvidence, contextSources: contextEvidence.included, label: `场景细纲 · ${outline.title}`, modelIdentity: { provider: route.provider, model: route.model } }
}
