import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { acceptAgentRunContract } from '../../src/lib/agent/run/contract'
import {
  createAgentRunV1,
  readAgentRunV1,
  reviseAgentRunContractV1,
} from '../../src/lib/agent/run/event-store'
import { canonicalStringify } from '../../src/lib/agent/run/hash'
import { createAgentSkillExecutionBindingV2 } from '../../src/lib/agent/execution-binding'
import { freezeFormalAIEntryBindingV1 } from '../../src/lib/agent/formal-ai-entry'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

async function createRun(label: string) {
  const { scope } = await seedCurrentWorkspace(label)
  const snapshot = await createAgentRunV1({ scope, contract: {
    version: 1,
    runtimeBindingHash: 'a'.repeat(64),
    objective: label,
    workflowKind: 'direct-generation',
    scope: { projectId: scope.projectId, worldGroupId: null },
    permissions: {
      contextSourceKeys: ['worldview'],
      writeTargets: [{ table: 'storyCores', fields: ['theme'], mode: 'candidate-only' }],
    },
    budget: {
      maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 100,
      maxOutputTokens: 100, maxAttemptsPerStep: 1,
    },
    acceptance: [{ id: 'output', kind: 'output-present', required: true }],
    verificationPlan: [{
      id: 'terminal', kind: 'terminal', verifier: 'b01-integrity-fixture', criterionIds: ['output'],
    }],
    failurePolicy: {
      onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author',
    },
  } })
  return { scope, snapshot }
}

async function ledgerRows() {
  return { runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray() }
}

describe.sequential('B01 public Run reader · row and replayed contract integrity', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('reads an unchanged genuine V1 ledger without modifying any original row', async () => {
    const { scope, snapshot } = await createRun('B01 matching V1 contract')
    const before = await ledgerRows()
    const read = await readAgentRunV1(scope, snapshot.run.id)
    expect(read.contract.version).toBe(1)
    expect(read.run.contractHash).toBe(read.projection.contractHash)
    expect(read.run.contractJson).toBe(snapshot.run.contractJson)
    expect(await ledgerRows()).toEqual(before)
  })

  it.each([2, 3] as const)('reads a matching V%i ledger produced from the registered extraction binding', async version => {
    const { scope } = await seedCurrentWorkspace(`B01 matching contract V${version}`)
    // The same registered adaptive profile used by the existing compatibility
    // fixture; version 2 omits the version 3 executionBoundary field.
    const planHash = 'a'.repeat(64)
    const binding = await createAgentSkillExecutionBindingV2(getAgentSkillV1('world-origin.codex-extract.v2'), {
      taskRequest: { version: 'task-request-binding-v2', planHash, materialAllocationHash: 'b'.repeat(64) },
      outputForecastTokens: 0,
    })
    const snapshot = await createAgentRunV1({ scope, contract: {
      version,
      ...(version === 3 ? { executionBoundary: 'formal' } : {}),
      objective: `B01 matching registered contract V${version}`,
      workflowKind: 'long-running-resumable',
      scope: { projectId: scope.projectId, worldGroupId: null },
      runtimeBindingHash: planHash,
      permissions: { contextSourceKeys: binding.contextSourceKeys, writeTargets: binding.writeTargets },
      executionBindings: [{ ...binding, stepId: 'world-origin:codex-extract-v2',
        formalEntry: await freezeFormalAIEntryBindingV1('world.codex.extract.v2') }],
      budget: {
        maxModelCalls: 0, maxToolCalls: 0, maxInputTokens: 0, maxOutputTokens: 0, maxAttemptsPerStep: 1,
        allocation: { version: 'task-budget-allocation-v2', mode: 'adaptive-plan', planHash,
          inputBasis: 'prepared-complete-request-v2', outputBasis: 'source-token-estimate-v1',
          modelCallsBasis: 'remaining-exact-frontier-v2', hardConstraints: null },
      },
      acceptance: [{ id: 'output', kind: 'output-present', required: true }],
      verificationPlan: [{ id: 'terminal', kind: 'terminal', verifier: 'b01-integrity-fixture', criterionIds: ['output'] }],
      failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
    } })
    const before = await ledgerRows()
    const read = await readAgentRunV1(scope, snapshot.run.id)
    expect(read.contract.version).toBe(version)
    expect(read.run.contractHash).toBe(read.projection.contractHash)
    expect(read.run.contractJson).toBe(snapshot.run.contractJson)
    expect(await ledgerRows()).toEqual(before)
  })

  it('rejects a self-consistent replacement row when the original events still bind another contract', async () => {
    const { scope, snapshot } = await createRun('B01 original accepted contract')
    const replacement = await acceptAgentRunContract({
      ...snapshot.contract, objective: 'B01 replacement never accepted by this ledger',
    })
    expect(replacement.contractHash).not.toBe(snapshot.projection.contractHash)
    await db.agentRuns.update(snapshot.run.id, {
      contractJson: canonicalStringify(replacement.contract),
      contractHash: replacement.contractHash,
      contractVersion: replacement.contract.version,
    })
    const before = await ledgerRows()
    await expect(readAgentRunV1(scope, snapshot.run.id)).rejects.toMatchObject({ code: 'projection_columns' })
    expect(await ledgerRows()).toEqual(before)
  })

  it('reads an actual contract.revised event and its matching current row without repairing history', async () => {
    const { scope, snapshot } = await createRun('B01 before authorized revision')
    const revised = await reviseAgentRunContractV1({
      scope, runId: snapshot.run.id, expectedLastSequence: snapshot.projection.lastSequence,
      contract: { ...snapshot.contract, objective: 'B01 authorized revised contract' },
    })
    expect(revised.run.contractHash).not.toBe(snapshot.run.contractHash)
    const before = await ledgerRows()
    const read = await readAgentRunV1(scope, snapshot.run.id)
    expect(read.run.contractHash).toBe(revised.run.contractHash)
    expect(read.projection.contractHash).toBe(revised.run.contractHash)
    expect(read.events.filter(event => event.type === 'contract.revised')).toHaveLength(1)
    expect(await ledgerRows()).toEqual(before)
  })

  it('still rejects a foreign owner without changing the valid owner ledger', async () => {
    const { scope, snapshot } = await createRun('B01 owner contract')
    const foreign = await seedCurrentWorkspace('B01 foreign workspace')
    const before = await ledgerRows()
    await expect(readAgentRunV1(foreign.scope, snapshot.run.id)).rejects.toMatchObject({ code: 'scope' })
    expect((await readAgentRunV1(scope, snapshot.run.id)).run.contractHash).toBe(snapshot.run.contractHash)
    expect(await ledgerRows()).toEqual(before)
  })
})
