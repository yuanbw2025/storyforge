import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TextOpenWorldCreatorArtifactEditSelectionV1 } from '../../src/lib/open-world/creator-artifact-edit'
import type { WorkspaceScope } from '../../src/lib/types'

const coreMocks = vi.hoisted(() => ({
  abandon: vi.fn(),
  cancelIntake: vi.fn(),
  confirm: vi.fn(),
  generate: vi.fn(),
  prepare: vi.fn(),
  read: vi.fn(),
  reject: vi.fn(),
  resume: vi.fn(),
  revise: vi.fn(),
}))

vi.mock('../../src/lib/open-world/creator-artifact-edit', () => ({
  abandonTextOpenWorldCreatorArtifactEditUnknownModelOutcomeV1: coreMocks.abandon,
  cancelTextOpenWorldCreatorArtifactEditIntakeV1: coreMocks.cancelIntake,
  confirmTextOpenWorldCreatorArtifactEditIntentV1: coreMocks.confirm,
  generateTextOpenWorldCreatorArtifactEditCandidateV1: coreMocks.generate,
  prepareTextOpenWorldCreatorArtifactEditV1: coreMocks.prepare,
  readLatestTextOpenWorldCreatorArtifactEditStateV1: coreMocks.read,
  rejectTextOpenWorldCreatorArtifactEditCandidateV1: coreMocks.reject,
  resumeTextOpenWorldCreatorArtifactEditIntakeV1: coreMocks.resume,
  reviseTextOpenWorldCreatorArtifactEditCandidateV1: coreMocks.revise,
}))

import {
  cancelTextOpenWorldCreatorArtifactEditIntakeV1,
  generateTextOpenWorldCreatorArtifactEditCandidateV1,
  resumeTextOpenWorldCreatorArtifactEditIntakeV1,
} from '../../src/lib/product-production/service'

const SCOPE: WorkspaceScope = { projectId: 501, worldId: 502, workId: 503 }
const SELECTION: TextOpenWorldCreatorArtifactEditSelectionV1 = {
  scope: SCOPE,
  productionId: 601,
  buildId: 701,
  expectedSnapshotHash: 'a'.repeat(64),
  artifactKey: 'text-open-world.story-arc',
  entityIdentity: 'story:root',
}

describe('Text Open World G5-06 · ProductProduction Creator edit façade', () => {
  beforeEach(() => {
    for (const mock of Object.values(coreMocks)) mock.mockReset()
    coreMocks.generate.mockResolvedValue({ ok: true })
    coreMocks.resume.mockResolvedValue({ ok: true })
  })

  it('Agent façade 不向核心 Harness 穿透调用者夹带的 runAI 或 modelIdentity', async () => {
    const surplusRunAI = vi.fn(async () => '{"forged":true}')
    const input = {
      selection: SELECTION,
      mode: 'agent' as const,
      authorInstruction: '只修改角色摘要。',
      runAI: surplusRunAI,
      modelIdentity: { provider: 'forged-provider', model: 'forged-model' },
    }

    await generateTextOpenWorldCreatorArtifactEditCandidateV1(input)

    expect(coreMocks.generate).toHaveBeenCalledOnce()
    const forwarded = coreMocks.generate.mock.calls[0]![0] as Record<string, unknown>
    expect(forwarded).toMatchObject({
      selection: SELECTION,
      mode: 'agent',
      authorInstruction: '只修改角色摘要。',
    })
    expect(forwarded).toHaveProperty('aiConfig')
    expect(forwarded).not.toHaveProperty('runAI')
    expect(forwarded).not.toHaveProperty('modelIdentity')
    expect(surplusRunAI).not.toHaveBeenCalled()
  })

  it('direct façade 仅转发受支持的确定性参数', async () => {
    const operations = [{
      op: 'replace' as const,
      fieldId: 'field.story-summary',
      baseValueHash: 'b'.repeat(64),
      value: '新摘要',
    }]
    const input = {
      selection: SELECTION,
      mode: 'direct' as const,
      operations,
      runAI: vi.fn(),
      modelIdentity: { provider: 'forged-provider', model: 'forged-model' },
    }

    await generateTextOpenWorldCreatorArtifactEditCandidateV1(input)

    expect(coreMocks.generate).toHaveBeenCalledWith({
      selection: SELECTION,
      mode: 'direct',
      operations,
      signal: undefined,
    })
  })

  it('intake resume façade 只接受 selection/runId/signal，并使用当前 AI 配置而不穿透伪造 runner', async () => {
    const controller = new AbortController()
    const forgedRunner = vi.fn(async () => '{"forged":true}')
    const input = {
      selection: SELECTION,
      runId: 801,
      signal: controller.signal,
      runAI: forgedRunner,
      modelIdentity: { provider: 'forged-provider', model: 'forged-model' },
      authorInstruction: '伪造的新指令',
      operations: [{
        op: 'replace' as const,
        fieldId: 'field.story-summary',
        baseValueHash: 'b'.repeat(64),
        value: '伪造值',
      }],
    }

    await resumeTextOpenWorldCreatorArtifactEditIntakeV1(input)

    expect(coreMocks.resume).toHaveBeenCalledOnce()
    const forwarded = coreMocks.resume.mock.calls[0]![0] as Record<string, unknown>
    expect(forwarded).toMatchObject({
      selection: SELECTION,
      runId: 801,
      signal: controller.signal,
    })
    expect(forwarded).toHaveProperty('aiConfig')
    expect(forwarded).not.toHaveProperty('runAI')
    expect(forwarded).not.toHaveProperty('modelIdentity')
    expect(forwarded).not.toHaveProperty('authorInstruction')
    expect(forwarded).not.toHaveProperty('operations')
    expect(forgedRunner).not.toHaveBeenCalled()
  })

  it('intake cancel façade 只转发精确 selection 与 runId', async () => {
    coreMocks.cancelIntake.mockResolvedValue({ ok: true })
    const input = {
      selection: SELECTION,
      runId: 802,
      acknowledgePossibleCharge: true,
      authorInstruction: '不得穿透',
    }

    await cancelTextOpenWorldCreatorArtifactEditIntakeV1(input)

    expect(coreMocks.cancelIntake).toHaveBeenCalledWith({
      selection: SELECTION,
      runId: 802,
    })
  })
})
