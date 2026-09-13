import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldResultExpressionPanel from '../../src/components/text-game/TextOpenWorldResultExpressionPanel'
import type { TextOpenWorldFeedbackReceiptV1 } from '../../src/lib/types'
import type { TextOpenWorldRuntimeExpressionPresentationV1 } from '../../src/lib/open-world/runtime-expression'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function feedback(): TextOpenWorldFeedbackReceiptV1 {
  return {
    schema: 'storyforge.text-open-world.feedback-receipt',
    version: 1,
    phase: 'terminal',
    status: 'succeeded',
    sessionId: 1,
    commandId: 'command.expression.ui',
    actionKey: 'action.accept-main',
    targetKey: 'quest.main.1',
    baseSequence: 2,
    outcomeCommitted: true,
    commandSequence: 3,
    resultingSequence: 4,
    resultingStateHash: 'a'.repeat(64),
    outcomeFingerprint: 'b'.repeat(64),
    gameplayStateChanged: true,
    changes: [],
    randomEvidence: [],
    reason: null,
    degradation: null,
    presentation: { headline: '接受主线任务已完成', details: [], mayNarrateSuccess: true },
    evidenceEventIds: [3, 4],
    evidenceEventSequences: [3, 4],
    receiptHash: 'c'.repeat(64),
  }
}

function presentation(): TextOpenWorldRuntimeExpressionPresentationV1 {
  return {
    version: 1,
    source: 'ai-candidate',
    status: 'generated',
    commandId: 'command.expression.ui',
    receiptHash: 'c'.repeat(64),
    kind: 'quest',
    text: '委托被郑重记入旅程，新的目标已在任务记录中展开。',
    dialogue: '',
    evidenceEventSequences: [3, 4],
    assertedReferences: [
      { kind: 'action', key: 'action.accept-main' },
      { kind: 'outcome', key: 'outcome.succeeded' },
    ],
    baseSequence: 4,
    candidateHash: 'd'.repeat(64),
    contextManifestHash: 'e'.repeat(64),
    runId: 8,
  }
}

describe('R-OPEN-WORLD6 · 终态结果演绎玩家界面', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('只为终态回执开放显式生成，并把AI正文与正式证据分层显示', async () => {
    const onGenerate = vi.fn()
    await act(async () => root.render(createElement(TextOpenWorldResultExpressionPanel, {
      feedback: feedback(), presentation: null, busy: false, issue: null, onGenerate,
    })))
    const button = host.querySelector('button') as HTMLButtonElement
    expect(button.textContent).toContain('AI演绎本次结果')
    expect(host.textContent).toContain('系统回执是唯一正式结果')
    await act(async () => button.click())
    expect(onGenerate).toHaveBeenCalledOnce()

    await act(async () => root.render(createElement(TextOpenWorldResultExpressionPanel, {
      feedback: feedback(), presentation: presentation(), busy: false, issue: null, onGenerate,
    })))
    expect(host.textContent).toContain('任务结果 · AI只读候选')
    expect(host.textContent).toContain('新的目标已在任务记录中展开')
    expect(host.textContent).toContain('正式事件 #3、#4')
    expect(host.textContent).toContain('不写游戏状态')
    expect(host.querySelector('button')).toBeNull()
  })

  it('模型失败只显示安全降级且非终态回执不开放演绎', async () => {
    const onGenerate = vi.fn()
    await act(async () => root.render(createElement(TextOpenWorldResultExpressionPanel, {
      feedback: feedback(), presentation: null, busy: false,
      issue: 'provider secret should never appear', onGenerate,
    })))
    expect(host.textContent).toContain('AI演绎当前不可用')
    expect(host.textContent).not.toContain('provider secret')
    expect(host.textContent).toContain('重新尝试AI演绎')

    await act(async () => root.render(createElement(TextOpenWorldResultExpressionPanel, {
      feedback: { ...feedback(), phase: 'pending', status: 'pending', outcomeCommitted: false },
      presentation: null, busy: false, issue: null, onGenerate,
    })))
    expect(host.querySelector('[data-testid="text-open-world-runtime-expression"]')).toBeNull()
  })
})
