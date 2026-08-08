import { describe, expect, it } from 'vitest'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import {
  createContextManifestFromAssemblyV1,
  parseContextManifestV1,
  verifyContextManifestIntegrityV1,
} from '../../src/lib/agent/run/context-manifest'
import {
  buildAgentSkillInputGuidanceV1,
  getAgentSkillV1,
  resolveAgentSkillInputStateV1,
  validateAgentSkillContextEvidenceV1,
} from '../../src/lib/agent/skill-registry'

function contextResult(input: {
  included?: string[]
  omitted?: string[]
  trimmed?: string[]
  sourceEvidence?: Array<{
    key: string
    status: 'included' | 'omitted' | 'trimmed'
    delivery: 'full' | 'truncated' | 'none'
    originalTokens: number
    inputTokens: number
  }>
}) {
  return {
    included: input.included ?? [],
    omitted: input.omitted ?? [],
    trimmed: input.trimmed ?? [],
    sourceEvidence: input.sourceEvidence,
    totalInputTokens: input.sourceEvidence?.reduce((sum, source) => sum + source.inputTokens, 0) ?? 0,
    inputBudget: 10_000,
  }
}

describe('R-HARNESS15 · Skill 输入状态与精确上下文交付证据', () => {
  it('单源按预算截断时记录截断前后 token，Manifest 不再把残片伪装成全文', async () => {
    const assembled = await assembleContext({
      projectId: 1,
      sourceKeys: ['manualText'],
      manualSourceText: '潮'.repeat(20_000),
      inputBudgetTokens: 8_000,
      sourceBudgetScale: 0.1,
    })
    const evidence = assembled.sourceEvidence?.[0]
    expect(evidence).toMatchObject({
      key: 'manualText',
      status: 'included',
      delivery: 'truncated',
      inputTokens: assembled.totalInputTokens,
    })
    expect(evidence!.originalTokens).toBeGreaterThan(evidence!.inputTokens)

    const manifest = await createContextManifestFromAssemblyV1({
      runId: 15,
      stepId: 'context-intake',
      attempt: 1,
      projectId: 1,
      worldGroupId: null,
      declaredSourceKeys: ['manualText'],
      assembled,
      readerVersion: 'assemble-context-h15',
    })
    expect(manifest.sources[0]).toMatchObject({
      key: 'manualText',
      status: 'included',
      delivery: 'truncated',
      originalTokens: evidence!.originalTokens,
      tokens: evidence!.inputTokens,
    })
    expect(JSON.stringify(manifest)).not.toContain('潮潮潮')
    expect(await verifyContextManifestIntegrityV1(manifest)).toBe(true)
    expect(() => parseContextManifestV1({
      ...manifest,
      sources: [{
        ...manifest.sources[0],
        originalTokens: manifest.sources[0].tokens,
      }],
    })).toThrow('truncated 来源必须证明')
  })

  it('同一 Skill 对无字段、部分字段、完整字段给出固定策略，且只注入命中的策略', () => {
    const skill = getAgentSkillV1('outline.volumes', 'outline')
    const empty = resolveAgentSkillInputStateV1(skill, [contextResult({
      omitted: [...skill.inputPolicy.sourceKeys],
    })])
    expect(empty).toMatchObject({ state: 'empty', handling: 'create-from-request' })

    const partial = resolveAgentSkillInputStateV1(skill, [contextResult({
      included: ['worldview'],
      omitted: ['storyCore', 'characters', 'storyArcs'],
      sourceEvidence: [{
        key: 'worldview',
        status: 'included',
        delivery: 'full',
        originalTokens: 120,
        inputTokens: 120,
      }],
    })])
    expect(partial).toMatchObject({
      state: 'partial',
      handling: 'reference-and-create',
      availableSourceKeys: ['worldview'],
      missingSourceKeys: ['storyCore', 'characters', 'storyArcs'],
    })
    const partialGuidance = buildAgentSkillInputGuidanceV1(skill, partial)
    expect(partialGuidance).toContain('partial / reference-and-create')
    expect(partialGuidance).toContain('锁定已有上游设定')
    expect(partialGuidance).not.toContain('上游设定为空')
    expect(partialGuidance).not.toContain('严格把已有世界')

    const complete = resolveAgentSkillInputStateV1(skill, [contextResult({
      included: ['worldview', 'storyCore', 'characters'],
      trimmed: ['storyArcs'],
      sourceEvidence: [
        { key: 'worldview', status: 'included', delivery: 'full', originalTokens: 120, inputTokens: 120 },
        { key: 'storyCore', status: 'included', delivery: 'truncated', originalTokens: 400, inputTokens: 180 },
        { key: 'characters', status: 'included', delivery: 'full', originalTokens: 90, inputTokens: 90 },
        { key: 'storyArcs', status: 'trimmed', delivery: 'none', originalTokens: 200, inputTokens: 0 },
      ],
    })])
    expect(complete).toMatchObject({
      state: 'complete',
      handling: 'grounded-transform',
      truncatedSourceKeys: ['storyCore'],
      trimmedSourceKeys: ['storyArcs'],
    })
    expect(buildAgentSkillInputGuidanceV1(skill, complete))
      .toContain('不得假装已看到其全文')
  })

  it('需要上游或作者输入的 Skill 不会把空输入分类成自由创作', () => {
    const chapterSkill = getAgentSkillV1('outline.chapters', 'outline')
    const proseSkill = getAgentSkillV1('prose.generate', 'prose')
    const inspirationSkill = getAgentSkillV1('inspiration.reverse', 'inspiration')
    for (const skill of [chapterSkill, proseSkill]) {
      expect(resolveAgentSkillInputStateV1(skill, [contextResult({
        omitted: [...skill.inputPolicy.sourceKeys],
      })])).toMatchObject({ state: 'empty', handling: 'require-upstream' })
    }
    expect(resolveAgentSkillInputStateV1(inspirationSkill, [contextResult({
      omitted: ['inspirationWorkspace'],
    })])).toMatchObject({ state: 'empty', handling: 'require-author-input' })
  })

  it('durable 边界拒绝伪造状态、来源越权和截断 token 证据', () => {
    const skill = getAgentSkillV1('outline.volumes', 'outline')
    const result = contextResult({
      included: ['worldview'],
      omitted: ['storyCore', 'characters', 'storyArcs'],
      sourceEvidence: [{
        key: 'worldview',
        status: 'included',
        delivery: 'full',
        originalTokens: 120,
        inputTokens: 120,
      }],
    })
    const evidence = {
      profile: 'balanced' as const,
      included: result.included,
      omitted: result.omitted,
      trimmed: result.trimmed,
      sourceEvidence: result.sourceEvidence,
      inputState: resolveAgentSkillInputStateV1(skill, [result]),
      estimatedInputTokens: 120,
      inputBudgetTokens: 10_000,
    }
    expect(() => validateAgentSkillContextEvidenceV1(skill, evidence)).not.toThrow()
    expect(() => validateAgentSkillContextEvidenceV1(skill, {
      ...evidence,
      inputState: { ...evidence.inputState, state: 'complete' },
    })).toThrow('输入状态证据与实际来源不一致')
    expect(() => validateAgentSkillContextEvidenceV1(skill, {
      ...evidence,
      included: [...evidence.included, 'chapterContent'],
    })).toThrow('上下文来源越权')
    expect(() => validateAgentSkillContextEvidenceV1(skill, {
      ...evidence,
      sourceEvidence: [{
        key: 'worldview',
        status: 'included',
        delivery: 'truncated',
        originalTokens: 120,
        inputTokens: 120,
      }],
    })).toThrow('truncated 证据不一致')
  })
})
