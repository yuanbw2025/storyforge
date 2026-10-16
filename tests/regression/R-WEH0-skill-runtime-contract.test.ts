import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertAgentSkillBindingMatchesAssemblyV2,
  assertAgentSkillExecutionBindingIntegrityV2,
  createAgentSkillExecutionBindingV2,
} from '../../src/lib/agent/execution-binding'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import {
  buildProseGenerationRunContractV2,
  buildProseGenerationRunContractV3,
  resolveProseGenerationExecutionBindingV2,
} from '../../src/lib/agent/run/prose-generation-durable'
import { parseAgentRunContractV2, parseAgentRunContractV3 } from '../../src/lib/agent/run/contract'
import {
  portableizeAgentRunContractV1,
  rebindPortableAgentRunContractV1,
} from '../../src/lib/agent/run/contract-portability'
import { canonicalStringify, hashCanonicalValue } from '../../src/lib/agent/run/hash'
import {
  resolveOutlineGenerationExecutionBindingV2,
  resolveOutlineGenerationSourceKeysV2,
} from '../../src/lib/outline/harness'

describe('WEH-0A · Skill → formal Run 单向派生', () => {
  it('正文的 Work 与 Canon Provider 进入同一 Gateway packet，Blueprint 与 POV 认知由该 packet 投影', async () => {
    const withoutPerspective = await resolveProseGenerationExecutionBindingV2({ operation: 'generate' })
    const withPerspective = await resolveProseGenerationExecutionBindingV2({
      operation: 'generate',
      perspectiveCharacterId: 7,
    })

    expect([...withoutPerspective.contextSourceKeys].sort()).toEqual(['ragSelection', 'workAuthoringIntent'])
    expect([...withPerspective.contextSourceKeys].sort()).toEqual(['ragSelection', 'workAuthoringIntent'])
    expect(withPerspective.optionalContextActivations).toEqual([])
    expect(getAgentSkillV1('prose.generate').inputPolicy.sourceKeys).toContain('activeNarrativeBlueprint')
    expect(getAgentSkillV1('prose.generate').inputPolicy.sourceKeys).toContain('characterKnowledge')
  })

  it('大纲只在明确续接候选存在时激活 priorOutlineCandidate', async () => {
    const request = { kind: 'chapters' as const, volumeId: 9 }
    const normal = await resolveOutlineGenerationExecutionBindingV2({ request })
    const continued = await resolveOutlineGenerationExecutionBindingV2({
      request,
      priorOutlineCandidateText: '上一卷候选正文',
    })

    expect(normal.contextSourceKeys).not.toContain('priorOutlineCandidate')
    expect(continued.contextSourceKeys).toContain('priorOutlineCandidate')
    expect(resolveOutlineGenerationSourceKeysV2({ request })).toEqual(normal.contextSourceKeys)
    expect(resolveOutlineGenerationSourceKeysV2({ request, hasPriorOutlineCandidate: true }))
      .toEqual(continued.contextSourceKeys)
  })

  it('入口边界属于 Run：formal 可形成候选写权限，非正式边界写集合为空', async () => {
    const request = { kind: 'chapters' as const, volumeId: 9 }
    const formal = await resolveOutlineGenerationExecutionBindingV2({
      request,
      executionBoundary: 'formal',
    })
    const evaluation = await resolveOutlineGenerationExecutionBindingV2({
      request,
      executionBoundary: 'evaluation',
    })
    expect(formal.writeTargets).toEqual([expect.objectContaining({
      table: 'outlineNodes',
      mode: 'author-confirmed',
    })])
    expect(evaluation.writeTargets).toEqual([])
  })

  it('V2 Run permissions 精确等于 Skill binding，并冻结定义/策略 hash', async () => {
    const contract = await buildProseGenerationRunContractV3({
      projectId: 1,
      worldGroupId: null,
      chapterId: 2,
      operation: 'continue',
      perspectiveCharacterId: 7,
    })
    const binding = contract.executionBindings[0]
    const { stepId: _stepId, ...skillBinding } = binding

    expect(contract.version).toBe(3)
    expect(contract.executionBoundary).toBe('formal')
    expect(contract.permissions.contextSourceKeys).toEqual(binding.contextSourceKeys)
    expect(contract.permissions.writeTargets).toEqual(binding.writeTargets)
    expect(binding.writeTargets).toEqual([{
      table: 'chapters',
      fields: ['content', 'wordCount'],
      mode: 'author-confirmed',
    }])
    await expect(assertAgentSkillExecutionBindingIntegrityV2(skillBinding)).resolves.toBeUndefined()

    const widened = structuredClone(contract)
    widened.permissions.contextSourceKeys.push('manualText')
    expect(() => parseAgentRunContractV3(widened)).toThrow('实际来源并集')
  })

  it('已登记来源或字段也不能越过 Skill 授权', async () => {
    const prose = getAgentSkillV1('prose.generate', 'prose')
    await expect(createAgentSkillExecutionBindingV2(prose, {
      optionalContextActivations: [{
        sourceKey: 'manualText',
        reasonCode: 'explicit-runtime-boundary',
      }],
    })).rejects.toThrow('未授权 optional source')
    await expect(createAgentSkillExecutionBindingV2(prose, {
      writeTargets: [{
        table: 'chapters',
        fields: ['content', 'notes'],
        mode: 'author-confirmed',
      }],
    })).rejects.toThrow('未授权写字段')
  })

  it('Skill definition 或策略快照被篡改时拒绝恢复', async () => {
    const binding = await resolveProseGenerationExecutionBindingV2({ operation: 'generate' })
    await expect(assertAgentSkillExecutionBindingIntegrityV2({
      ...binding,
      contextAccessPolicyHash: '0'.repeat(64),
    })).rejects.toThrow('contextAccessPolicyHash 不匹配')
  })

  it('V2 contract 可导出为便携编号并在新项目只读恢复', async () => {
    const contract = await buildProseGenerationRunContractV2({
      projectId: 1,
      worldGroupId: null,
      chapterId: 2,
      operation: 'generate',
    })
    const portable = await portableizeAgentRunContractV1({
      contractJson: canonicalStringify(contract),
      contractHash: await hashCanonicalValue(contract),
      idMaps: new Map([['chapters', new Map([[2, 0]])]]),
    })
    expect(portable.contract.version).toBe(2)
    expect(portable.contract.scope.chapterIds).toEqual([1])

    const rebound = await rebindPortableAgentRunContractV1({
      contractJson: portable.contractJson,
      contractHash: portable.contractHash,
      projectId: 9,
      idMaps: new Map([['chapters', new Map([[0, 22]])]]),
    })
    expect(rebound.contract.version).toBe(2)
    expect(rebound.contract.scope).toMatchObject({ projectId: 9, chapterIds: [22] })
    expect(rebound.contract.executionBindings).toEqual(contract.executionBindings)
  })

  it('WEH-0A 已落盘 V2 无 executionBoundary 时仍可读取', async () => {
    const contract = await buildProseGenerationRunContractV2({
      projectId: 1,
      worldGroupId: null,
      chapterId: 2,
      operation: 'generate',
    })
    expect(contract.version).toBe(2)
    expect('executionBoundary' in contract).toBe(false)
    expect(parseAgentRunContractV2(contract)).toEqual(contract)
  })

  it('V3 formal boundary 在便携导出与项目重绑定后保持不变', async () => {
    const contract = await buildProseGenerationRunContractV3({
      projectId: 1,
      worldGroupId: null,
      chapterId: 2,
      operation: 'generate',
    })
    const portable = await portableizeAgentRunContractV1({
      contractJson: canonicalStringify(contract),
      contractHash: await hashCanonicalValue(contract),
      idMaps: new Map([['chapters', new Map([[2, 0]])]]),
    })
    const rebound = await rebindPortableAgentRunContractV1({
      contractJson: portable.contractJson,
      contractHash: portable.contractHash,
      projectId: 9,
      idMaps: new Map([['chapters', new Map([[0, 22]])]]),
    })
    expect(rebound.contract).toMatchObject({
      version: 3,
      executionBoundary: 'formal',
      scope: { projectId: 9, chapterIds: [22] },
    })
  })

  it('assembly 必须覆盖 binding 的精确声明集合', async () => {
    const binding = await resolveProseGenerationExecutionBindingV2({ operation: 'generate' })
    const assembly = {
      text: '',
      segments: [],
      included: [],
      omitted: [...binding.contextSourceKeys],
      trimmed: [],
      sourceEvidence: binding.contextSourceKeys.map(key => ({
        key,
        status: 'omitted' as const,
        delivery: 'none' as const,
        originalTokens: 0,
        inputTokens: 0,
      })),
      totalInputTokens: 0,
      inputBudget: 1,
      overBudgetBeforeTrim: false,
      overBudgetAfterTrim: false,
    }
    expect(() => assertAgentSkillBindingMatchesAssemblyV2(binding, assembly)).not.toThrow()
    assembly.sourceEvidence.pop()
    expect(() => assertAgentSkillBindingMatchesAssemblyV2(binding, assembly)).toThrow('实际来源集合')
  })

  it('正式 UI 与批量细纲不再拥有 prose/outline/detail 手写来源数组', () => {
    const chapterEditor = readFileSync(resolve(process.cwd(), 'src/components/editor/ChapterEditor.tsx'), 'utf8')
    const outlinePanel = readFileSync(resolve(process.cwd(), 'src/components/outline/OutlinePanel.tsx'), 'utf8')
    const detailController = readFileSync(resolve(process.cwd(), 'src/components/outline/useDetailedOutlineGenerationController.ts'), 'utf8')
    const batchDetailRunner = readFileSync(resolve(process.cwd(), 'src/lib/ai/batch-detail-runner.ts'), 'utf8')
    expect(chapterEditor).not.toContain('PROSE_GENERATION_SOURCE_KEYS_V1')
    expect(chapterEditor).toContain('prepareProseGatewayAssemblyV1')
    expect(chapterEditor).not.toContain('sourceKeys: generationBinding.contextSourceKeys')
    expect(outlinePanel).not.toContain('OUTLINE_GENERATION_SOURCE_KEYS')
    expect(outlinePanel).toContain('prepareOutlineGatewayAssemblyV1')
    expect(detailController).not.toContain('DETAILED_OUTLINE_GENERATION_SOURCE_KEYS_V1')
    expect(detailController).not.toContain('sourceKeys: [')
    expect(detailController).toContain('prepareDetailedOutlineGatewayAssemblyV1')
    expect(batchDetailRunner).not.toContain('contextResolver')
    expect(batchDetailRunner).not.toContain('sourceKeys: [')
    expect(batchDetailRunner).toContain('prepareDetailedOutlineGatewayAssemblyV1')
    expect(batchDetailRunner).toContain("executeRegisteredAIEntryV1(\n          'outline.detail.batch'")
  })
})
