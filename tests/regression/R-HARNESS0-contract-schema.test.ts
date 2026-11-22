import { describe, expect, it } from 'vitest'
import {
  acceptAgentRunContractV1,
  parseAgentRunContractV1,
} from '../../src/lib/agent/run/contract'
import { AgentRunSchemaError } from '../../src/lib/agent/run/schema-utils'
import { parseAgentRunEventV1 } from '../../src/lib/agent/run/event-schema'
import { canonicalStringify } from '../../src/lib/agent/run/hash'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { AGENT_RUN_MAXIMUM_CONTRACT_JSON_BYTES_V1, readAgentRunContractJsonV1 } from '../../src/lib/agent/run/checkpoint-contract'

function validContract() {
  return {
    version: 1,
    objective: '依据已登记上下文生成并验证一份卷纲候选',
    workflowKind: 'generate-verify-revise',
    scope: {
      projectId: 7,
      worldGroupId: null,
      outlineNodeIds: [12],
    },
    permissions: {
      contextSourceKeys: ['worldview', 'storyCore'],
      writeTargets: [
        { table: 'outlineNodes', fields: ['summary'], mode: 'author-confirmed' },
      ],
    },
    runtimeBindingHash: 'a'.repeat(64),
    budget: {
      maxModelCalls: 3,
      maxToolCalls: 0,
      maxInputTokens: 12_000,
      maxOutputTokens: 4_000,
      maxAttemptsPerStep: 2,
    },
    acceptance: [
      { id: 'outline.output', kind: 'output-present', required: true },
      { id: 'outline.gate', kind: 'gate-passed', required: true },
      { id: 'outline.confirmed', kind: 'author-confirmed', required: true },
    ],
    verificationPlan: [
      {
        id: 'outline.deterministic',
        kind: 'deterministic',
        verifier: 'outline-structure-v1',
        criterionIds: ['outline.output', 'outline.gate'],
      },
      {
        id: 'outline.terminal',
        kind: 'terminal',
        verifier: 'terminal-receipt-v1',
        criterionIds: ['outline.confirmed'],
      },
    ],
    failurePolicy: {
      onProtocolError: 'retry',
      onVerificationFailure: 'revise',
      onStaleInput: 'pause-for-author',
    },
  }
}

it('a valid large contract remains readable in accepted and revised ledger events', async () => {
  const source = validContract()
  source.acceptance = Array.from({ length: 1500 }, (_, index) => ({
    id: `outline.criterion.${index}`, kind: 'output-present', required: true,
  }))
  source.verificationPlan = [{
    id: 'outline.complete', kind: 'terminal', verifier: 'terminal-receipt-v1',
    criterionIds: source.acceptance.map(criterion => criterion.id),
  }]
  const accepted = await acceptAgentRunContractV1(source)
  const contractJson = canonicalStringify(accepted.contract)
  expect(contractJson.length).toBeGreaterThan(100_000)
  for (const type of ['contract.accepted', 'contract.revised']) {
    expect(() => parseAgentRunEventV1({
      version: 1, runId: 9, sequence: 2, generation: 1, projectId: 7,
      worldGroupId: null, contractHash: accepted.contractHash, type,
      createdAt: 1_786_111_000_002,
      payload: { contractJson, ...(type === 'contract.revised' ? { previousContractHash: 'a'.repeat(64) } : {}) },
    })).not.toThrow()
  }
})

it('retains long contract snapshot strings and still rejects empty/non-string snapshots', () => {
  const maximum = AGENT_RUN_MAXIMUM_CONTRACT_JSON_BYTES_V1
  expect(() => readAgentRunContractJsonV1('', 'contract')).toThrow('必须是非空字符串')
  expect(() => readAgentRunContractJsonV1({}, 'contract')).toThrow('必须是非空字符串')
  const ascii = 'x'.repeat(maximum + 1)
  expect(readAgentRunContractJsonV1(ascii, 'contract').length).toBe(ascii.length)
  const multibyte = '汉'.repeat(Math.floor(maximum / 3) + 1)
  expect(multibyte.length).toBeLessThan(maximum)
  expect(readAgentRunContractJsonV1(multibyte, 'contract').length).toBe(multibyte.length)
})

it('accepts a structurally valid long contract with every binding intact and a readable ledger event', async () => {
  const source = validContract()
  const bindingJson = JSON.stringify({ note: '汉'.repeat(62_000) })
  const oversized = {
    ...source,
    executionBindings: Array.from({ length: 190 }, (_, index) => ({
      version: 1, stepId: `outline.step.${index}`, skillId: 'outline.generate', skillVersion: 1,
      promptVersion: '1', toolSchemaVersion: '1', toolSchemaHash: 'b'.repeat(64),
      formalEntry: { version: 1, entryId: 'outline.generate', bindingJson, bindingHash: 'c'.repeat(64) },
    })),
  }
  const parsed = parseAgentRunContractV1(oversized)
  expect(parsed.executionBindings?.length).toBe(190)
  const accepted = await acceptAgentRunContractV1(oversized)
  const contractJson = canonicalStringify(accepted.contract)
  expect(new TextEncoder().encode(contractJson).byteLength).toBeGreaterThan(AGENT_RUN_MAXIMUM_CONTRACT_JSON_BYTES_V1)
  expect(accepted.contractHash).toMatch(/^[a-f0-9]{64}$/)
  const lastBinding = accepted.contract.executionBindings?.[189]
  if (!lastBinding?.formalEntry) throw new Error('Final long binding missing')
  expect(lastBinding.formalEntry.bindingJson.length).toBe(bindingJson.length)
  expect(await sha256Text(lastBinding.formalEntry.bindingJson)).toBe(await sha256Text(bindingJson))
  const event = parseAgentRunEventV1({
    version: 1, runId: 9, sequence: 1, generation: 1, projectId: 7,
    worldGroupId: null, contractHash: accepted.contractHash, type: 'contract.accepted',
    createdAt: 1_786_111_000_002, payload: { contractJson },
  })
  if (event.type !== 'contract.accepted') throw new Error('Accepted contract event missing')
  expect(event.payload.contractJson.length).toBe(contractJson.length)
  expect(await sha256Text(event.payload.contractJson)).toBe(accepted.contractHash)
})

describe('R-HARNESS0-contract-schema · RunContractV1', () => {
  it('只接受三注册表内的读取和写入，并生成确定性 contract hash', async () => {
    const first = await acceptAgentRunContractV1(validContract())
    const source = validContract()
    const reordered = {
      failurePolicy: source.failurePolicy,
      verificationPlan: source.verificationPlan,
      acceptance: source.acceptance,
      budget: source.budget,
      permissions: source.permissions,
      runtimeBindingHash: source.runtimeBindingHash,
      scope: source.scope,
      workflowKind: source.workflowKind,
      objective: source.objective,
      version: source.version,
    }
    const second = await acceptAgentRunContractV1(reordered)

    expect(first.contract.scope).toEqual({ projectId: 7, worldGroupId: null, outlineNodeIds: [12] })
    expect(first.contractHash).toMatch(/^[0-9a-f]{64}$/)
    expect(second.contractHash).toBe(first.contractHash)
  })

  it('可选 Runner 预算进入规范化契约和 hash', async () => {
    const baseline = await acceptAgentRunContractV1(validContract())
    const source = validContract()
    const extended = {
      ...source,
      budget: {
        ...source.budget,
        maxToolResultTokens: 24_000,
        maxProtocolErrors: 2,
      },
    }
    const accepted = await acceptAgentRunContractV1(extended)

    expect(accepted.contract.budget).toMatchObject({
      maxToolResultTokens: 24_000,
      maxProtocolErrors: 2,
    })
    expect(accepted.contractHash).not.toBe(baseline.contractHash)
    extended.budget.maxProtocolErrors = -1
    expect(() => parseAgentRunContractV1(extended)).toThrow('contract.budget.maxProtocolErrors')
  })

  it('拒绝未登记的上下文源', () => {
    const contract = validContract()
    contract.permissions.contextSourceKeys = ['worldview', 'componentHandBuiltPrompt']

    expect(() => parseAgentRunContractV1(contract)).toThrow('未登记的上下文源 componentHandBuiltPrompt')
  })

  it('拒绝未登记的数据表和 FIELD_REGISTRY 字段', () => {
    const unknownTable = validContract()
    unknownTable.permissions.writeTargets = [
      { table: 'parallelCanon', fields: ['summary'], mode: 'author-confirmed' },
    ]
    expect(() => parseAgentRunContractV1(unknownTable)).toThrow('未登记的数据表 parallelCanon')

    const unknownField = validContract()
    unknownField.permissions.writeTargets = [
      { table: 'outlineNodes', fields: ['agentPrivateSummary'], mode: 'author-confirmed' },
    ]
    expect(() => parseAgentRunContractV1(unknownField)).toThrow(
      'outlineNodes.agentPrivateSummary 未在 FIELD_REGISTRY 登记',
    )
  })

  it('领域写回扩展必须与 ADOPTION_EXTENSIONS 的目标表精确匹配', () => {
    const contract = validContract() as any
    contract.permissions.writeTargets = [{
      table: 'temporalFacts',
      fields: [],
      mode: 'author-confirmed',
      adoptionExtension: 'fact-ledger',
    }]
    expect(parseAgentRunContractV1(contract).permissions.writeTargets[0]).toEqual({
      table: 'temporalFacts',
      fields: [],
      mode: 'author-confirmed',
      adoptionExtension: 'fact-ledger',
    })

    contract.permissions.writeTargets[0].adoptionExtension = 'knowledge-ledger'
    expect(() => parseAgentRunContractV1(contract)).toThrow('未登记或与目标表不匹配')
    delete contract.permissions.writeTargets[0].adoptionExtension
    expect(() => parseAgentRunContractV1(contract)).toThrow('可写目标必须声明至少一个字段')
  })

  it('只读工作流即使字段合法也不得声明写集合', () => {
    const contract = validContract()
    contract.workflowKind = 'read-only-audit'

    expect(() => parseAgentRunContractV1(contract)).toThrow('只读任务的写集合必须为空')
  })

  it('拒绝未知字段、空验收集和未被验证的必需验收项', () => {
    const unknown = { ...validContract(), modelCanDeclareDone: true }
    expect(() => parseAgentRunContractV1(unknown)).toThrowError(AgentRunSchemaError)
    expect(() => parseAgentRunContractV1(unknown)).toThrow('contract.modelCanDeclareDone: 未知字段')

    const emptyAcceptance = validContract()
    emptyAcceptance.acceptance = []
    expect(() => parseAgentRunContractV1(emptyAcceptance)).toThrow('contract.acceptance: 不得为空')

    const unverified = validContract()
    unverified.verificationPlan = [
      {
        id: 'outline.terminal',
        kind: 'terminal',
        verifier: 'terminal-receipt-v1',
        criterionIds: ['outline.output'],
      },
    ]
    expect(() => parseAgentRunContractV1(unverified)).toThrow('必需验收项 outline.gate 未被验证')
  })

  it('必须存在代码侧 terminal verifier', () => {
    const contract = validContract()
    contract.verificationPlan = [
      {
        id: 'outline.deterministic',
        kind: 'deterministic',
        verifier: 'outline-structure-v1',
        criterionIds: ['outline.output', 'outline.gate', 'outline.confirmed'],
      },
    ]

    expect(() => parseAgentRunContractV1(contract)).toThrow('必须包含 terminal verifier')
  })
})
