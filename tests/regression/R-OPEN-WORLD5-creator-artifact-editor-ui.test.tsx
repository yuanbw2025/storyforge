import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TextOpenWorldCreatorEditCandidateV1, TextOpenWorldCreatorEditIntentV1 } from '../../src/lib/open-world/creator-artifact-edit-contract'
import type { TextOpenWorldCreatorEditTargetContextV1 } from '../../src/lib/open-world/creator-artifact-edit-context'
import type { WorkspaceScope } from '../../src/lib/types'

const editMocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  generate: vi.fn(),
  revise: vi.fn(),
  read: vi.fn(),
  abandon: vi.fn(),
  cancelIntake: vi.fn(),
  resumeIntake: vi.fn(),
  reject: vi.fn(),
  confirm: vi.fn(),
}))

vi.mock('../../src/lib/product-production/service', () => ({
  prepareTextOpenWorldCreatorArtifactEditV1: editMocks.prepare,
  generateTextOpenWorldCreatorArtifactEditCandidateV1: editMocks.generate,
  reviseTextOpenWorldCreatorArtifactEditCandidateV1: editMocks.revise,
  readLatestTextOpenWorldCreatorArtifactEditStateV1: editMocks.read,
  abandonTextOpenWorldCreatorArtifactEditUnknownModelOutcomeV1: editMocks.abandon,
  cancelTextOpenWorldCreatorArtifactEditIntakeV1: editMocks.cancelIntake,
  rejectTextOpenWorldCreatorArtifactEditCandidateV1: editMocks.reject,
  resumeTextOpenWorldCreatorArtifactEditIntakeV1: editMocks.resumeIntake,
  confirmTextOpenWorldCreatorArtifactEditIntentV1: editMocks.confirm,
}))

import TextOpenWorldCreatorArtifactEditor, {
  type TextOpenWorldCreatorArtifactEditSelectionV1,
} from '../../src/components/text-game/TextOpenWorldCreatorArtifactEditor'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SCOPE: WorkspaceScope = { projectId: 401, worldId: 402, workId: 403 }
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const SELECTION: TextOpenWorldCreatorArtifactEditSelectionV1 = {
  scope: SCOPE,
  productionId: 71,
  buildId: 81,
  expectedSnapshotHash: HASH_A,
  artifactKey: 'text-open-world.player-build',
  entityIdentity: 'character:hero',
}

function targetContext(): TextOpenWorldCreatorEditTargetContextV1 {
  const common = {
    schema: 'storyforge.text-open-world-creator-edit-field' as const,
    version: 1 as const,
    artifactKey: 'text-open-world.player-build' as const,
    entityIdentity: 'character:hero',
    maximumUtf8Bytes: 10_000,
    mutationPolicy: 'replace-only' as const,
    stableIdPolicy: 'preserve' as const,
    entitySetPolicy: 'preserve' as const,
    entityOrderPolicy: 'preserve' as const,
  }
  return {
    schema: 'storyforge.text-open-world-creator-edit-target-context',
    version: 1,
    governanceSnapshotHash: HASH_A,
    production: {
      id: 71,
      productionKey: 'text-open-world.primary.fixture',
      title: '盐脊',
      status: 'preview-ready',
      stateRevision: 9,
    },
    build: {
      id: 81,
      buildNumber: 4,
      status: 'preview-ready',
      controlEpoch: 8,
      planHash: HASH_A,
      stateRevision: 7,
      manifestHash: HASH_B,
      rootTerminalReceiptHash: HASH_C,
    },
    target: {
      schema: 'storyforge.text-open-world-creator-edit-target',
      version: 1,
      artifactKey: 'text-open-world.player-build',
      artifactVersion: 3,
      artifactKind: 'text-open-world.player-build',
      artifactContentHash: HASH_B,
      entityIdentity: 'character:hero',
      ownerTaskKey: 'p4.player-build',
    },
    ownerSiblingGroup: {
      schema: 'storyforge.text-open-world-creator-edit-owner-sibling-group',
      version: 1,
      ownerTaskKey: 'p4.player-build',
      skillId: 'text-open-world.player-build.v1',
      dependencyTaskKeys: ['p2.experience-design'],
      outputArtifactKeys: ['text-open-world.player-build', 'text-open-world.progression-catalogs'],
      acceptanceGateIds: ['identity-preserved', 'domain-valid'],
      baseSiblings: [],
      baseGroupHash: HASH_A,
    },
    producerEvidence: {} as TextOpenWorldCreatorEditTargetContextV1['producerEvidence'],
    productionValidationReceiptHash: HASH_B,
    baseDraftHash: HASH_A,
    stableStructureHash: HASH_B,
    semanticDraft: {
      schema: 'storyforge.text-open-world-creator-edit-semantic-draft',
      version: 1,
      artifactKey: 'text-open-world.player-build',
      entityIdentity: 'character:hero',
      fields: [
        { fieldId: 'hero.summary', label: '角色简介', valueKind: 'string', value: '旧简介' },
        { fieldId: 'hero.power', label: '力量', valueKind: 'number', value: 3 },
        { fieldId: 'hero.protected', label: '关键保护', valueKind: 'boolean', value: true },
        { fieldId: 'hero.tags', label: '角色标签', valueKind: 'string-array', value: ['巡灯人', '调查者'] },
      ],
    },
    semanticDraftHash: HASH_C,
    editableFields: [
      { ...common, fieldId: 'hero.summary', jsonPointer: '/hero/summary', label: '角色简介', valueKind: 'string', baseValueHash: HASH_A },
      { ...common, fieldId: 'hero.power', jsonPointer: '/hero/power', label: '力量', valueKind: 'number', baseValueHash: HASH_A },
      { ...common, fieldId: 'hero.protected', jsonPointer: '/hero/protected', label: '关键保护', valueKind: 'boolean', baseValueHash: HASH_A },
      { ...common, fieldId: 'hero.tags', jsonPointer: '/hero/tags', label: '角色标签', valueKind: 'string-array', baseValueHash: HASH_A },
    ],
  }
}

function editCandidate(overrides: Partial<TextOpenWorldCreatorEditCandidateV1> = {}): TextOpenWorldCreatorEditCandidateV1 {
  return {
    schema: 'storyforge.text-open-world-creator-edit-candidate',
    version: 1,
    portable: false,
    production: { productionId: 71, productionKey: 'text-open-world.primary.fixture', stateRevision: 9 },
    baseBuild: {
      buildId: 81,
      buildNumber: 4,
      stateRevision: 7,
      controlEpoch: 8,
      planHash: HASH_A,
      manifestHash: HASH_B,
      rootTerminalReceiptHash: HASH_C,
    },
    governanceSnapshotHash: HASH_A,
    target: targetContext().target,
    editableFields: targetContext().editableFields,
    ownerSiblingGroup: targetContext().ownerSiblingGroup,
    producerEvidence: targetContext().producerEvidence,
    baseDraftHash: HASH_A,
    patch: {
      schema: 'storyforge.text-open-world-creator-edit-patch',
      version: 1,
      baseDraftHash: HASH_A,
      operations: [{ op: 'replace', fieldId: 'hero.summary', baseValueHash: HASH_A, value: '新简介' }],
      patchHash: HASH_B,
    },
    rebuiltArtifacts: [
      {
        schema: 'storyforge.text-open-world-creator-edit-rebuilt-artifact',
        version: 1,
        artifactKey: 'text-open-world.player-build',
        requirementKey: null,
        kind: 'text-open-world.player-build',
        baseVersion: 3,
        nextVersion: 4,
        baseContentHash: HASH_A,
        contentHash: HASH_B,
        payload: {}, metadata: {}, quality: {}, rights: {}, byteSize: 100,
      },
      {
        schema: 'storyforge.text-open-world-creator-edit-rebuilt-artifact',
        version: 1,
        artifactKey: 'text-open-world.progression-catalogs',
        requirementKey: null,
        kind: 'text-open-world.progression-catalogs',
        baseVersion: 3,
        nextVersion: 4,
        baseContentHash: HASH_A,
        contentHash: HASH_C,
        payload: {}, metadata: {}, quality: {}, rights: {}, byteSize: 100,
      },
    ],
    validation: {
      schema: 'storyforge.text-open-world-creator-edit-validation',
      version: 1,
      validatorId: 'text-open-world.player-build.edit.v1',
      validatorVersion: '1',
      status: 'usable-with-warnings',
      requiredGateIds: ['identity-preserved', 'domain-valid'],
      passedGateIds: ['identity-preserved', 'domain-valid'],
      validatedArtifacts: [
        { artifactKey: 'text-open-world.player-build', contentHash: HASH_B },
        { artifactKey: 'text-open-world.progression-catalogs', contentHash: HASH_C },
      ],
      issues: [{
        code: 'tow.edit.tone-drift',
        severity: 'warning',
        artifactKey: 'text-open-world.player-build',
        fieldId: 'hero.summary',
        message: '角色语气可能发生变化',
      }],
      validationHash: HASH_C,
    },
    identityDelta: {} as TextOpenWorldCreatorEditCandidateV1['identityDelta'],
    referenceDelta: {} as TextOpenWorldCreatorEditCandidateV1['referenceDelta'],
    mode: 'direct',
    modelEvidence: null,
    modelUsage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 8 },
    revisionProvenance: null,
    status: 'usable-with-warnings',
    createdAt: 1_788_000_000_000,
    candidateHash: HASH_C,
    ...overrides,
  }
}

function editIntent(candidate: TextOpenWorldCreatorEditCandidateV1): TextOpenWorldCreatorEditIntentV1 {
  return {
    schema: 'storyforge.text-open-world-creator-edit-intent',
    version: 1,
    portable: false,
    candidate,
    candidateHash: candidate.candidateHash,
    warningAcknowledgementCodes: ['tow.edit.tone-drift'],
    warningAcknowledgementHash: HASH_A,
    confirmedAt: 1_788_000_001_000,
    intentHash: HASH_B,
  }
}

function setText(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = control instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value)
  control.dispatchEvent(new Event('input', { bubbles: true }))
}

function button(host: ParentNode, label: string): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    .find(item => item.textContent?.trim() === label)
  if (!result) throw new Error(`找不到按钮：${label}`)
  return result
}

async function waitFor(assertion: () => void | Promise<void>): Promise<void> {
  const started = Date.now()
  let last: unknown
  while (Date.now() - started < 5_000) {
    try {
      await act(async () => { await assertion() })
      return
    } catch (cause) {
      last = cause
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
  }
  throw last
}

describe('Text Open World G5-06 · Creator Artifact 编辑 UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    for (const mock of Object.values(editMocks)) mock.mockReset()
    editMocks.prepare.mockResolvedValue(targetContext())
    editMocks.read.mockResolvedValue(null)
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('直接修改四类字段，展示完整 sibling/gates/usage，并逐项确认警告后只交接影响分析', async () => {
    const candidate = editCandidate()
    const intent = editIntent(candidate)
    editMocks.generate.mockResolvedValue({
      runId: 901, runState: 'awaiting_confirmation', candidate, intent: null,
    })
    editMocks.confirm.mockResolvedValue({
      runId: 901, runState: 'completed', candidate, intent,
    })
    await act(async () => root.render(createElement(TextOpenWorldCreatorArtifactEditor, {
      selection: SELECTION,
      eligible: true,
    })))
    await waitFor(() => expect(host.textContent).toContain('角色简介'))

    expect(host.querySelector('input[aria-label="力量"]')).not.toBeNull()
    expect(host.textContent).toContain('关键保护')
    expect(host.textContent).toContain('角色标签')
    const summary = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="角色简介"]')!
    await act(async () => setText(summary, '新简介'))
    await act(async () => button(host, '生成修改候选').click())
    await waitFor(() => expect(host.textContent).toContain('完整 sibling 输出'))

    expect(editMocks.generate).toHaveBeenCalledWith(expect.objectContaining({
      selection: SELECTION,
      mode: 'direct',
      operations: [expect.objectContaining({ fieldId: 'hero.summary', value: '新简介' })],
    }))
    expect(host.textContent).toContain('2/2')
    expect(host.textContent).toContain('通过 2/2')
    expect(host.textContent).toContain('0 / 0')
    expect(host.textContent).toContain('修改候选已持久化；尚未改写当前 Build。')
    const confirm = button(host, '确认修改方案并进入影响分析')
    expect(confirm.disabled).toBe(true)

    const warning = host.querySelector<HTMLInputElement>('fieldset input[type="checkbox"]')!
    await act(async () => warning.click())
    expect(confirm.disabled).toBe(false)
    await act(async () => confirm.click())
    await waitFor(() => expect(editMocks.confirm).toHaveBeenCalledWith({
      selection: SELECTION,
      runId: 901,
      warningAcknowledgementCodes: ['tow.edit.tone-drift'],
    }))
    expect(host.textContent).toContain('修改意图已确认，等待影响分析；当前 Build 未被改写。')
  })

  it('Agent 模式只提交精确目标与自然语言要求，失败时仍保留直改入口', async () => {
    editMocks.generate.mockRejectedValue(new Error('capability-unbound: 尚未配置 AI Key'))
    await act(async () => root.render(createElement(TextOpenWorldCreatorArtifactEditor, {
      selection: SELECTION,
      eligible: true,
    })))
    await waitFor(() => expect(host.textContent).toContain('让 Agent 修改'))

    await act(async () => button(host, '让 Agent 修改').click())
    const instruction = host.querySelector<HTMLTextAreaElement>('textarea[placeholder^="说明要修改什么"]')!
    await act(async () => setText(instruction, '让主角简介更克制，但保留巡灯人身份。'))
    await act(async () => button(host, '生成修改候选').click())
    await waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent)
      .toContain('尚未配置 AI Key'))
    expect(editMocks.generate).toHaveBeenCalledWith({
      selection: SELECTION,
      mode: 'agent',
      authorInstruction: '让主角简介更克制，但保留巡灯人身份。',
    })
    expect(button(host, '直接修改字段').disabled).toBe(false)
    expect(host.textContent).toContain('没有 AI Key 时仍可切回“直接修改字段”')
  })

  it('刷新后恢复待确认候选，可修订或拒绝，且不声称已更新当前内容', async () => {
    const candidate = editCandidate()
    editMocks.read.mockResolvedValue({
      runId: 902, runState: 'awaiting_confirmation', candidate, intent: null,
    })
    editMocks.revise.mockResolvedValue({
      runId: 902, runState: 'awaiting_confirmation', candidate, intent: null,
    })
    editMocks.reject.mockResolvedValue({ runId: 902, runState: 'failed' })
    await act(async () => root.render(createElement(TextOpenWorldCreatorArtifactEditor, {
      selection: SELECTION,
      eligible: true,
    })))
    await waitFor(() => expect(host.textContent).toContain('修改候选'))
    expect(button(host, '修订修改候选')).not.toBeNull()

    await act(async () => button(host, '修订修改候选').click())
    await waitFor(() => expect(editMocks.revise).toHaveBeenCalledWith(expect.objectContaining({
      selection: SELECTION,
      runId: 902,
      operations: [expect.objectContaining({ fieldId: 'hero.summary', value: '新简介' })],
    })))
    await act(async () => button(host, '拒绝此修改方案').click())
    await waitFor(() => expect(editMocks.reject).toHaveBeenCalledWith({
      selection: SELECTION,
      runId: 902,
    }))
    expect(host.textContent).toContain('修改方案已拒绝；当前 Build 未被改写。')
    expect(host.textContent).not.toContain('当前内容已更新')
  })

  it('恢复结果未知 blocker 后要求两步风险确认，再通过 façade 显式放弃', async () => {
    editMocks.read
      .mockResolvedValueOnce({
        kind: 'model-outcome-unknown',
        runId: 903,
        runState: 'paused',
        ownerTaskKey: 'p4.player-build',
        message: '同一 sibling 内容组存在结果未知的模型请求；系统不会自动重发或再次计费。',
        snapshot: {},
      })
      .mockResolvedValueOnce(null)
    editMocks.abandon.mockResolvedValue({ runId: 903, runState: 'cancelled' })
    await act(async () => root.render(createElement(TextOpenWorldCreatorArtifactEditor, {
      selection: SELECTION,
      eligible: true,
    })))
    await waitFor(() => expect(host.querySelector(
      '[data-testid="text-open-world-creator-edit-model-outcome-blocker"]',
    )).not.toBeNull())

    expect(host.textContent).toContain('模型结果状态未知，已阻止同组再次生成')
    expect(host.textContent).toContain('Run #903')
    expect(editMocks.abandon).not.toHaveBeenCalled()
    await act(async () => button(host, '放弃这个结果未知的请求').click())

    const confirmation = host.querySelector(
      '[data-testid="text-open-world-creator-edit-abandon-confirmation"]',
    )
    expect(confirmation).not.toBeNull()
    expect(confirmation?.textContent).toContain('远端模型请求可能已经产生费用')
    expect(confirmation?.textContent).toContain('不会自动重试')
    expect(editMocks.abandon).not.toHaveBeenCalled()

    await act(async () => button(host, '我已知晓，确认放弃').click())
    await waitFor(() => expect(editMocks.abandon).toHaveBeenCalledWith({
      selection: SELECTION,
      runId: 903,
      acknowledgePossibleCharge: true,
    }))
    await waitFor(() => expect(host.textContent).toContain(
      '结果未知的模型请求已由作者明确放弃',
    ))
    expect(editMocks.read).toHaveBeenCalledTimes(2)
    expect(host.querySelector(
      '[data-testid="text-open-world-creator-edit-model-outcome-blocker"]',
    )).toBeNull()
  })

  it('未调用模型的 intake 不会自动继续，并可直接安全取消', async () => {
    editMocks.read
      .mockResolvedValueOnce({
        kind: 'intake-ready',
        runId: 904,
        runState: 'planned',
        mode: 'agent',
        ownerTaskKey: 'p4.player-build',
        message: '修改请求已安全保存，尚未形成候选；请由作者明确继续。',
        snapshot: {},
      })
      .mockResolvedValueOnce(null)
    editMocks.cancelIntake.mockResolvedValue({ runId: 904, runState: 'cancelled' })
    await act(async () => root.render(createElement(TextOpenWorldCreatorArtifactEditor, {
      selection: SELECTION,
      eligible: true,
    })))
    await waitFor(() => expect(host.querySelector(
      '[data-testid="text-open-world-creator-edit-intake-ready"]',
    )).not.toBeNull())

    expect(host.textContent).toContain('尚未调用模型/形成候选')
    expect(button(host, '继续生成修改候选')).not.toBeNull()
    expect(editMocks.resumeIntake).not.toHaveBeenCalled()
    expect(editMocks.cancelIntake).not.toHaveBeenCalled()
    await act(async () => button(host, '取消未调用请求').click())

    await waitFor(() => expect(editMocks.cancelIntake).toHaveBeenCalledWith({
      selection: SELECTION,
      runId: 904,
    }))
    await waitFor(() => expect(host.textContent).toContain('没有产生模型费用'))
    expect(editMocks.resumeIntake).not.toHaveBeenCalled()
    expect(editMocks.read).toHaveBeenCalledTimes(2)
  })

  it('未调用模型的 intake 只有作者点击继续后才恢复原 Run', async () => {
    const candidate = editCandidate()
    editMocks.read.mockResolvedValue({
      kind: 'intake-ready',
      runId: 905,
      runState: 'running',
      mode: 'agent',
      ownerTaskKey: 'p4.player-build',
      message: '修改请求已安全保存，尚未形成候选；请由作者明确继续。',
      snapshot: {},
    })
    editMocks.resumeIntake.mockResolvedValue({
      runId: 905,
      runState: 'awaiting_confirmation',
      candidate,
      intent: null,
    })
    await act(async () => root.render(createElement(TextOpenWorldCreatorArtifactEditor, {
      selection: SELECTION,
      eligible: true,
    })))
    await waitFor(() => expect(host.querySelector(
      '[data-testid="text-open-world-creator-edit-intake-ready"]',
    )).not.toBeNull())
    expect(editMocks.resumeIntake).not.toHaveBeenCalled()

    await act(async () => button(host, '继续生成修改候选').click())
    await waitFor(() => expect(editMocks.resumeIntake).toHaveBeenCalledWith({
      selection: SELECTION,
      runId: 905,
    }))
    await waitFor(() => expect(host.textContent).toContain('完整 sibling 输出'))
    expect(editMocks.generate).not.toHaveBeenCalled()
    expect(editMocks.cancelIntake).not.toHaveBeenCalled()
  })

  it('同组已确认修改以影响分析 blocker 呈现，并隐藏所有新建或确认动作', async () => {
    editMocks.read.mockResolvedValue({
      kind: 'impact-analysis-pending',
      runId: 906,
      runState: 'completed',
      ownerTaskKey: 'p4.player-build',
      target: {
        artifactKey: 'text-open-world.player-build',
        entityIdentity: 'character:other',
      },
      message: '同一 sibling 内容组已有作者确认的修改，必须先由影响分析与修复 Build 承接。',
      snapshot: {},
    })
    await act(async () => root.render(createElement(TextOpenWorldCreatorArtifactEditor, {
      selection: SELECTION,
      eligible: true,
    })))
    await waitFor(() => expect(host.querySelector(
      '[data-testid="text-open-world-creator-edit-impact-analysis-blocker"]',
    )).not.toBeNull())

    expect(host.textContent).toContain('同一内容组已有确认修改')
    expect(host.textContent).toContain('Run #906')
    expect(host.textContent).toContain('修复 Build 承接前不会创建相互冲突的新修改')
    expect(host.querySelector('[role="tablist"]')).toBeNull()
    expect(Array.from(host.querySelectorAll('button')).some(item => (
      item.textContent?.includes('生成修改候选')
      || item.textContent?.includes('确认修改方案')
    ))).toBe(false)
    expect(editMocks.generate).not.toHaveBeenCalled()
    expect(editMocks.confirm).not.toHaveBeenCalled()
  })

  it('不符合治理条件时不读取编辑上下文，也不显示可执行按钮', async () => {
    await act(async () => root.render(createElement(TextOpenWorldCreatorArtifactEditor, {
      selection: SELECTION,
      eligible: false,
      ineligibleReason: '该 Artifact 尚未通过产品生产合同验证。',
    })))
    expect(host.textContent).toContain('尚未通过产品生产合同验证')
    expect(host.querySelector('[data-testid="text-open-world-creator-artifact-editor"]')).toBeNull()
    expect(editMocks.prepare).not.toHaveBeenCalled()
    expect(editMocks.read).not.toHaveBeenCalled()
  })
})
