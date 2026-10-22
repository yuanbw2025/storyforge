import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { createAgentSkillExecutionBindingV1 } from '../../src/lib/agent/execution-binding'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { renderTtrpgOpenDesignWorldReadsV1 } from '../../src/lib/ttrpg/open-authoring-design-prompt'
import { renderTtrpgOpenProductionWorldReadsV2, type TtrpgOpenWorldReadsInputV1 } from '../../src/lib/ttrpg/open-world-reads'
import { TTRPG_OPEN_PRODUCTION_BINDINGS_V2, isTtrpgOpenProductionTaskV2 } from '../../src/lib/ttrpg/open-production-bindings'
import { ttrpgOpenProductionOutputTypesV2, ttrpgOpenProductionSystemPromptV2 } from '../../src/lib/ttrpg/open-production-prompts'
import { TTRPG_OPEN_LAYER_METADATA_KEYS_V1, parseTtrpgOpenSourceFactsArtifactV1,
  parseTtrpgOpenRuleSystemArtifactV1, parseTtrpgOpenSituationLayerArtifactV1 } from '../../src/lib/ttrpg/open-production-artifacts'
import { openPublicationCampaignFixture, openRuleFixture } from '../helpers/ttrpg-open-content'

/** Type-check the delivered documentation itself, including all referenced
 * nested types, against independently parser-accepted JSON. No generated files. */
function wireTypeErrors(types: string, candidate: unknown): string[] {
  const file = '/virtual/ttrpg-production-wire.ts'
  const options: ts.CompilerOptions = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext, types: [], lib: ['lib.es2022.d.ts'] }
  const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host)
  host.getSourceFile = (name, ...args) => name === file
    ? ts.createSourceFile(name, `${types}\nconst candidate: TtrpgOpenProductionOutputV2 = ${JSON.stringify(candidate)};`, ts.ScriptTarget.ES2022, true)
    : original(name, ...args)
  return ts.getPreEmitDiagnostics(ts.createProgram([file], options, host))
    .map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n'))
}

async function reads(): Promise<TtrpgOpenWorldReadsInputV1> {
  const content = '{"name":"灯塔","secret":"完整来源字段"}', contentHash = await sha256Text(content)
  const sourceRefs = [{ table: 'worldReleases', recordId: 1, field: 'records.location.1', revision: 'release-r1', contentHash }]
  return { retrievalTrace: { mandatory: [{ resourceKey: 'world-release:release:entities:location:lighthouse',
    sourceKey: 'worldRelease', reason: 'mandatory', depth: 'full', revision: 'release-r1', contentHash,
    policyRevision: 1, policyHash: 'a'.repeat(64), sourceRefs, tokenCount: 20 }], autoSelected: [], agentReads: [] },
    sourceSnapshots: [{ sourceKey: 'worldRelease', resourceKey: 'world-release:release:entities:location:lighthouse', sourceRefs, content }] }
}

describe('R-TTRPGOPEN2 versioned complete production wire foundation', () => {
  it.each(Object.entries(TTRPG_OPEN_PRODUCTION_BINDINGS_V2))('registers a new exact task/Skill pair without upgrading %s', (taskKey, binding) => {
    const current = getAgentSkillV1(binding.skillId), legacy = getAgentSkillV1(binding.skillId.replace(/v2$/, 'v1'))
    expect(current.promptVersion).toBe(binding.promptVersion)
    expect(current.contextSourceKeys).toEqual(legacy.contextSourceKeys)
    expect(current.optionalContextSourceKeys).toEqual(legacy.optionalContextSourceKeys)
    expect(current.writeTargets).toEqual(legacy.writeTargets)
    expect(current.maxOutputTokens).toBe(legacy.maxOutputTokens)
    expect(createAgentSkillExecutionBindingV1(current)).not.toEqual(createAgentSkillExecutionBindingV1(legacy))
    expect(isTtrpgOpenProductionTaskV2({ taskKey, skillId: current.id, executionMode: 'model' })).toBe(true)
    expect(isTtrpgOpenProductionTaskV2({ taskKey, skillId: legacy.id, executionMode: 'model' })).toBe(false)
    expect(isTtrpgOpenProductionTaskV2({ taskKey, skillId: current.id, executionMode: 'deterministic' })).toBe(false)
    expect(isTtrpgOpenProductionTaskV2({ taskKey: 'content.design', skillId: current.id, executionMode: 'model' })).toBe(false)
  })

  it.each(['ttrpg.open.source-facts', 'ttrpg.open.rule-system', 'ttrpg.open.situation-layer'] as const)(
    'delivers a self-contained nested format accepting real parser-validated %s JSON', taskKey => {
    const campaign = openPublicationCampaignFixture(), rule = openRuleFixture()
    const sourceFacts = { schema: 'storyforge.ttrpg-open-source-facts', version: 1,
      factPolicy: campaign.frozenWorldPredicateIndex.entries.map(fact => ({ fact, authorConfirmed: false })) }
    const system = { schema: 'storyforge.ttrpg-open-rule-system', version: 1, characterTemplates: campaign.characterTemplates,
      entityBindings: campaign.entityBindings, sessionZero: campaign.sessionZero, gmMode: campaign.gmMode,
      informationPolicy: campaign.informationPolicy }
    const layer = { schema: 'storyforge.ttrpg-open-situation-layer', version: 1, authoring: {
      situationTemplates: campaign.situationTemplates, openingSituationKeys: campaign.openingSituationKeys,
      effectPlanTemplates: campaign.effectPlanTemplates, pressure: { clocks: campaign.clocks, fronts: campaign.fronts },
      companionPolicy: campaign.companionPolicy, stageClosurePolicy: campaign.stageClosurePolicy,
      dynamicEntityTemplates: campaign.dynamicEntityTemplates, runtimePolicy: campaign.runtimePolicy },
      metadata: Object.fromEntries(TTRPG_OPEN_LAYER_METADATA_KEYS_V1.map(key => [key, structuredClone(campaign[key])])) }
    const candidate = taskKey === 'ttrpg.open.source-facts' ? parseTtrpgOpenSourceFactsArtifactV1(sourceFacts)
      : taskKey === 'ttrpg.open.rule-system' ? parseTtrpgOpenRuleSystemArtifactV1(system, rule)
        : parseTtrpgOpenSituationLayerArtifactV1(layer, sourceFacts)
    const types = ttrpgOpenProductionOutputTypesV2(taskKey)
    expect(wireTypeErrors(types, candidate)).toEqual([])
    expect(wireTypeErrors(types, { ...candidate, fabricatedField: 'not allowed' }).join()).toContain('fabricatedField')
    expect(ttrpgOpenProductionSystemPromptV2(taskKey)).toContain(types)
    if (taskKey === 'ttrpg.open.rule-system') {
      expect(types).toContain('interface TtrpgCharacterSheetV2')
      expect(types).toContain('attributeMappings: Record<')
      expect(types).toContain('playerProfile: {')
    }
    if (taskKey === 'ttrpg.open.situation-layer') {
      for (const key of TTRPG_OPEN_LAYER_METADATA_KEYS_V1) expect(types).toMatch(new RegExp(`\\b${key}:`))
      expect(types).toContain('interface TtrpgSituationTemplateV1')
      expect(types).toContain('interface TtrpgOpenContextPolicyV1')
      expect(types).toContain('interface TtrpgContextTriggerV1')
    }
  }, 60_000)

  it('keeps the original S2 rendered bytes and projects every actual S3 read with its own depth/hash/body', async () => {
    const input = await reads(), actual = input.retrievalTrace.mandatory[0], content = input.sourceSnapshots[0].content
    const resources = [{ resourceKey: actual.resourceKey, contentHash: actual.contentHash, depth: 'full', readContent: content }]
    expect(await renderTtrpgOpenDesignWorldReadsV1(input)).toBe(JSON.stringify({ schema: 'storyforge.ttrpg-open-design-world-reads', version: 1, resources }))
    expect(JSON.parse(await renderTtrpgOpenProductionWorldReadsV2(input))).toEqual({ schema: 'storyforge.ttrpg-open-production-world-reads', version: 2, resources })
    input.retrievalTrace.mandatory[0].depth = 'summary'
    input.sourceSnapshots[0].content = '只提供摘要'
    const partial = JSON.parse(await renderTtrpgOpenProductionWorldReadsV2(input)).resources[0]
    expect(partial).toMatchObject({ depth: 'summary', contentHash: actual.contentHash, readContent: '只提供摘要' })
    expect(partial.contentHash).not.toBe(await sha256Text(partial.readContent))
    expect(partial.readContent).not.toContain('完整来源字段')
  })
  it.each(['duplicate-read', 'duplicate-snapshot', 'missing', 'hash', 'body', 'source-ref', 'foreign-source'] as const)(
    'rejects mismatched read evidence before constructing the wire: %s', async kind => {
    const input = await reads()
    if (kind === 'duplicate-read') input.retrievalTrace.agentReads.push(input.retrievalTrace.mandatory[0])
    if (kind === 'duplicate-snapshot') input.sourceSnapshots.push(input.sourceSnapshots[0])
    if (kind === 'missing') input.sourceSnapshots = []
    if (kind === 'hash') input.retrievalTrace.mandatory[0].contentHash = 'f'.repeat(64)
    if (kind === 'body') input.sourceSnapshots[0].content += 'tampered'
    if (kind === 'source-ref') input.sourceSnapshots[0].sourceRefs = [{ ...input.sourceSnapshots[0].sourceRefs![0], field: 'other' }]
    if (kind === 'foreign-source') input.sourceSnapshots[0].sourceKey = 'other'
    await expect(renderTtrpgOpenProductionWorldReadsV2(input)).rejects.toThrow('世界读取正文与逐资源来源锚点不一致')
  })
})
