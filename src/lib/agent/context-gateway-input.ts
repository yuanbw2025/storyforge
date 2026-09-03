import type { ContextGatewayExecutionV1 } from '../context-gateway/execution'
import type { AssembleContextResult } from '../registry/types'
import { resolveAgentSkillInputStateV1, type AgentSkillDefinitionV1 } from './skill-registry'

const INPUT_SOURCE_BY_TABLE: Readonly<Record<string, string>> = {
  projects: 'projectStatus',
  worldviews: 'worldview',
  storyCores: 'storyCore',
  characters: 'characters',
  storyArcs: 'storyArcs',
  storylineProgress: 'storylineProgress',
  outlineNodes: 'existingVolumeOutlines',
  detailedOutlines: 'detailedOutline',
  chapters: 'writtenChapterProgress',
  codexEntries: 'codex',
}

/** Shared projection from the exact Gateway packet into the registered assembly contract. */
export function assembleContextGatewayPacketV1(
  execution: ContextGatewayExecutionV1,
  inputBudget: number,
): AssembleContextResult {
  const content = execution.contextPacket.content
  const included = content.trim() ? ['ragSelection'] : []
  const omitted = included.length ? [] : ['ragSelection']
  return {
    text: content,
    segments: included.length ? [{
      label: 'Context Gateway 精确选取资料',
      layer: 'L0',
      content,
      tokens: execution.contextPacket.tokenCount,
      trimmable: false,
    }] : [],
    included,
    omitted,
    trimmed: [],
    sourceEvidence: [{
      key: 'ragSelection',
      status: included.length ? 'included' : 'omitted',
      delivery: included.length ? 'full' : 'none',
      sourceHash: execution.contextPacket.contentHash,
      originalCharacters: content.length,
      inputCharacters: content.length,
      originalTokens: execution.contextPacket.tokenCount,
      inputTokens: execution.contextPacket.tokenCount,
    }],
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
