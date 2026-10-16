import type { ContextGatewayExecutionV1 } from '../context-gateway/execution'
import type { AssembleContextResult } from '../registry/types'
import { resolveAgentSkillInputStateV1, type AgentSkillDefinitionV1 } from './skill-registry'

const INPUT_SOURCE_BY_TABLE: Readonly<Record<string, string>> = {
  works: 'workStatus',
  worldviews: 'worldview',
  powerSystems: 'powerSystem',
  cultivationSystems: 'powerSystem',
  storyCores: 'storyCore',
  creativeRules: 'creativeRules',
  characters: 'characters',
  storyArcs: 'storyArcs',
  storylineProgress: 'storylineProgress',
  outlineNodes: 'existingVolumeOutlines',
  detailedOutlines: 'detailedOutline',
  chapters: 'writtenChapterProgress',
  codexEntries: 'codex',
  userStyleProfiles: 'userStyleProfile',
}

/** Shared projection from the exact Gateway packet into the registered assembly contract. */
export function assembleContextGatewayPacketV1(
  execution: ContextGatewayExecutionV1,
  inputBudget: number,
): AssembleContextResult {
  const content = execution.contextPacket.content
  const providerKeys = execution.session?.providers.map(binding => binding.source.key) ?? ['ragSelection']
  const blocks = execution.sourceBlocks ?? [{ sourceKey: 'ragSelection', content, contentHash: execution.contextPacket.contentHash, tokenCount: execution.contextPacket.tokenCount }]
  const bySource = new Map(blocks.map(block => [block.sourceKey, block]))
  const included = content.trim() ? providerKeys.filter(key => bySource.has(key)) : []
  const omitted = providerKeys.filter(key => !included.includes(key))
  return {
    text: content,
    segments: included.map(key => ({
      label: execution.session?.providers.find(binding => binding.source.key === key)?.source.label ?? 'Context Gateway 精确选取资料',
      layer: 'L0',
      content: bySource.get(key)!.content,
      tokens: bySource.get(key)!.tokenCount,
      trimmable: false,
    })),
    included,
    omitted,
    trimmed: [],
    // Evidence is split by Provider; the model still receives the single exact packet.
    sourceEvidence: providerKeys.map(key => ({
      key,
      status: included.includes(key) ? 'included' as const : 'omitted' as const,
      delivery: included.includes(key) ? 'full' as const : 'none' as const,
      sourceHash: bySource.get(key)?.contentHash,
      originalCharacters: bySource.get(key)?.content.length ?? 0,
      inputCharacters: bySource.get(key)?.content.length ?? 0,
      originalTokens: bySource.get(key)?.tokenCount ?? 0,
      inputTokens: bySource.get(key)?.tokenCount ?? 0,
    })),
    totalInputTokens: execution.contextPacket.tokenCount,
    inputBudget,
    overBudgetBeforeTrim: false,
    overBudgetAfterTrim: false,
  }
}

export function contextGatewayInputStateSourceKeysV1(
  skill: AgentSkillDefinitionV1,
  execution: ContextGatewayExecutionV1,
): string[] {
  const available = new Set(execution.contextPacket.sourceRefs
    .map(ref => INPUT_SOURCE_BY_TABLE[ref.table])
    .filter((key): key is string => Boolean(key)))
  for (const snapshot of execution.sourceSnapshots ?? []) {
    if (snapshot.sourceKey && skill.inputPolicy.sourceKeys.includes(snapshot.sourceKey)) available.add(snapshot.sourceKey)
  }
  if (
    skill.inputPolicy.sourceKeys.includes('targetCharacter')
    && execution.contextPacket.sourceRefs.some(ref => ref.table === 'characters')
  ) available.add('targetCharacter')
  if (skill.inputPolicy.sourceKeys.includes('chapterOutline')
    && execution.contextPacket.sourceRefs.some(ref => ref.table === 'outlineNodes')) {
    available.add('chapterOutline')
  }
  if (skill.inputPolicy.sourceKeys.includes('activeNarrativeBlueprint')
    && execution.contextPacket.sourceRefs.some(ref => [
      'narrativeModules', 'narrativeNodes', 'narrativeBeats', 'narrativeChoices',
    ].includes(ref.table))) {
    available.add('activeNarrativeBlueprint')
  }
  if (skill.inputPolicy.sourceKeys.includes('chapterContinuityHandoff')
    && execution.contextPacket.sourceRefs.some(ref => (
      ref.table === 'chapters' && ['content', 'continuityHandoff', 'planReconciliation'].includes(ref.field)
    ))) available.add('chapterContinuityHandoff')
  if (skill.inputPolicy.sourceKeys.includes('characterKnowledge')
    && execution.contextPacket.sourceRefs.some(ref => ref.table === 'knowledgeLedger')) {
    available.add('characterKnowledge')
  }
  if (skill.inputPolicy.sourceKeys.includes('currentFacts')
    && execution.contextPacket.sourceRefs.some(ref => ref.table === 'temporalFacts')) {
    available.add('currentFacts')
  }
  if (skill.inputPolicy.sourceKeys.includes('consistencyDossier')
    && execution.retrievalTrace.mandatory.some(item => item.resourceKey.endsWith(':consistency-dossier'))) {
    available.add('consistencyDossier')
  }
  return skill.inputPolicy.sourceKeys.filter(key => available.has(key))
}

export function projectContextGatewayInputStateV1(
  skill: AgentSkillDefinitionV1,
  execution: ContextGatewayExecutionV1,
  assembled: AssembleContextResult,
) {
  const available = new Set(contextGatewayInputStateSourceKeysV1(skill, execution))
  return resolveAgentSkillInputStateV1(skill, [{
    included: skill.inputPolicy.sourceKeys.filter(key => available.has(key)),
    omitted: skill.inputPolicy.sourceKeys.filter(key => !available.has(key)),
    trimmed: [],
    totalInputTokens: assembled.totalInputTokens,
    inputBudget: assembled.inputBudget,
  }])
}
