import { describe, expect, it } from 'vitest'
import { FORMAL_AI_ENTRY_BY_ID_V1 } from '../../src/lib/agent/formal-ai-entry'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { acceptAgentRunContractV3 } from '../../src/lib/agent/run/contract'
import type { AgentRunScopeV1 } from '../../src/lib/types/agent-run'
import {
  createTextOpenWorldRuntimeAIRunContractV1,
  TEXT_OPEN_WORLD_RUNTIME_AI_RUN_CONTRACT_BUILDER_ID_V1,
  TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_CONTRACTS_V1,
  TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_IDS_V1,
  validateTextOpenWorldRuntimeAISkillContractsV1,
} from '../../src/lib/open-world/runtime-ai-contract'

const scope: AgentRunScopeV1 = {
  projectId: 1,
  worldGroupId: null,
  runtime: {
    productRuntimeSessionId: 7,
    baseSequence: 3,
    stateHash: 'a'.repeat(64),
    visibilityHash: 'b'.repeat(64),
    releaseHash: 'c'.repeat(64),
  },
}

describe('R-OPEN-WORLD6 · vNext 运行时 AI Skill 合同总表', () => {
  it('六类能力逐项登记 reads/writes/model/schema/budget/failure 且保持候选只读', () => {
    expect(TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_CONTRACTS_V1).toHaveLength(6)
    expect(TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_CONTRACTS_V1.map(item => item.skillId))
      .toEqual(TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_IDS_V1)
    expect(TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_CONTRACTS_V1.map(item => item.capability))
      .toEqual(['intent', 'dialogue', 'expression', 'quest-packaging', 'direction', 'memory'])

    for (const item of TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_CONTRACTS_V1) {
      const skill = getAgentSkillV1(item.skillId)
      const entry = FORMAL_AI_ENTRY_BY_ID_V1.get(item.formalEntryId)
      expect(item.availability).toBe(item.capability === 'intent' || item.capability === 'dialogue'
        ? 'player-ui-routed'
        : 'registered-not-yet-ui-routed')
      expect(item.reads.contextSourceKeys).toEqual(['openWorldRuntime'])
      expect(item.reads.logicalSlices.length).toBeGreaterThan(0)
      expect(item.reads.forbiddenSlices).toEqual(expect.arrayContaining([
        'unrevealed-story-or-quest-content',
        'world-truth-not-known-by-player',
        'provider-credential-or-endpoint-secret',
      ]))
      expect(item.reads.contextManifestRequired).toBe(true)
      expect(skill.contextGateway).toMatchObject({
        rollout: 'required',
        providerSourceKeys: ['openWorldRuntime'],
        allowOriginalRead: false,
      })
      expect(skill.contextGateway?.allowedDepths).not.toContain('original')
      expect(item.writes).toEqual({
        formalStateWriteTargets: [],
        candidatePersistence: ['agentRunEvents', 'agentRunCheckpoints'],
        actionAuthority: 'deterministic-services-only',
        adoptAllowed: false,
      })
      expect(item.model).toMatchObject({
        selectionPolicy: 'global-runtime-task-routing',
        credentialPolicy: 'configured-byok-never-persist-in-run',
        providerAgnostic: true,
        requiredCapabilities: ['chat', 'strict-json'],
        freezeResolutionPerRun: true,
      })
      expect(item.candidateSchema).toMatchObject({
        version: 1,
        transport: 'strict-json',
        additionalProperties: false,
      })
      expect(item.candidateSchema.fields.some(field => field.name === 'kind' && field.required)).toBe(true)
      if (item.capability === 'intent') {
        expect(item.promptVersion).toBe('text-open-world-runtime-intent-v2')
        expect(item.candidateSchema.fields).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: 'actionKeys', type: 'stable-key[]', maxItems: 4 }),
          expect.objectContaining({ name: 'choiceKeys', type: 'stable-key[]', maxItems: 4 }),
        ]))
      }
      expect(item.budget).toMatchObject({ maxModelCalls: 1, maxToolCalls: 0, maxAttemptsPerStep: 1 })
      expect(item.failurePolicy).toMatchObject({
        staleInput: 'discard-candidate',
        unknownResult: 'do-not-resend-query-by-run',
        hiddenRetryAllowed: false,
      })
      expect(skill.contextSourceKeys).toEqual(['openWorldRuntime'])
      expect(skill.writeTargets).toEqual([])
      expect(entry).toMatchObject({
        skillId: item.skillId,
        categories: [item.model.routeCategory],
        runContractBuilderId: TEXT_OPEN_WORLD_RUNTIME_AI_RUN_CONTRACT_BUILDER_ID_V1,
        executionBoundary: 'product-runtime',
        entryKind: 'formal',
        candidateKind: item.candidateSchema.schemaId,
        adoptAllowed: false,
        adoptionTargets: [],
        allowedCallers: ['src/lib/open-world/runtime-ai-execution.ts'],
      })
    }
  })

  it.each(TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_IDS_V1)('%s 派生可恢复的 V3 product-runtime RunContract', async skillId => {
    const registered = TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_CONTRACTS_V1.find(item => item.skillId === skillId)!
    const contract = await createTextOpenWorldRuntimeAIRunContractV1({
      skillId,
      objective: `执行 ${registered.capability} 候选`,
      scope,
      runtimeBindingHash: 'd'.repeat(64),
    })
    const accepted = await acceptAgentRunContractV3(contract)
    expect(accepted.contract).toMatchObject({
      version: 3,
      executionBoundary: 'product-runtime',
      permissions: { contextSourceKeys: ['openWorldRuntime'], writeTargets: [] },
      budget: {
        maxModelCalls: 1,
        maxToolCalls: 0,
        maxInputTokens: registered.budget.maxInputTokens,
        maxOutputTokens: registered.budget.maxOutputTokens,
        maxAttemptsPerStep: 1,
        maxProtocolErrors: 0,
      },
    })
    expect(accepted.contractHash).toMatch(/^[a-f0-9]{64}$/)
    expect(accepted.contract.executionBindings).toHaveLength(1)
    expect(accepted.contract.executionBindings[0]).toMatchObject({
      version: 2,
      skillVersion: 2,
      skillId,
      promptVersion: registered.promptVersion,
      contextSourceKeys: ['openWorldRuntime'],
      writeTargets: [],
      formalEntry: { version: 1, entryId: registered.formalEntryId },
    })
  })

  it('拓宽写权限、调用预算或 strict JSON 闭集都会 fail closed', () => {
    const writes = structuredClone(TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_CONTRACTS_V1)
    Object.assign(writes[0].writes, { adoptAllowed: true })
    expect(() => validateTextOpenWorldRuntimeAISkillContractsV1(writes)).toThrow(/正式状态写权限/)

    const calls = structuredClone(TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_CONTRACTS_V1)
    Object.assign(calls[0].budget, { maxModelCalls: 2 })
    expect(() => validateTextOpenWorldRuntimeAISkillContractsV1(calls)).toThrow(/预算无效/)

    const openSchema = structuredClone(TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_CONTRACTS_V1)
    Object.assign(openSchema[0].candidateSchema, { additionalProperties: true })
    expect(() => validateTextOpenWorldRuntimeAISkillContractsV1(openSchema)).toThrow(/输出Schema无效/)
  })

  it('缺少精确 runtime 边界或使用无效 binding hash 时拒绝建 Run', async () => {
    await expect(createTextOpenWorldRuntimeAIRunContractV1({
      skillId: 'prose.text-open-world-runtime-intent',
      objective: '映射玩家输入',
      scope: { projectId: 1, worldGroupId: null },
      runtimeBindingHash: 'd'.repeat(64),
    })).rejects.toThrow(/精确Release\/Session\/Sequence/)
    await expect(createTextOpenWorldRuntimeAIRunContractV1({
      skillId: 'prose.text-open-world-runtime-intent',
      objective: '映射玩家输入',
      scope,
      runtimeBindingHash: 'not-a-hash',
    })).rejects.toThrow(/runtimeBindingHash/)
  })
})
