import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { StepCard, type StepResult } from '../../src/components/settings/prompt/WorkflowRunner'
import type { PromptWorkflowStep } from '../../src/lib/types/workflow'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const step: PromptWorkflowStep = {
  stepId: 'step-1',
  label: '一句话故事',
  promptModuleKey: 'story.generate',
  saveTarget: { type: 'storyCore-field', field: 'logline' },
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

async function mount(result: StepResult) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const onSave = vi.fn()
  const onUserInputChange = vi.fn()
  const onOutputChange = vi.fn()

  await act(async () => {
    root.render(createElement(StepCard, {
      step,
      index: 0,
      result,
      isCurrent: result.status === 'pending',
      onSkip: vi.fn(),
      onRetry: vi.fn(),
      onSave,
      onUserInputChange,
      onOutputChange,
      saved: false,
      hasProject: true,
    }))
  })

  return { host, root, onSave, onUserInputChange, onOutputChange }
}

describe('HEALTH-4 · 工作流步骤卡用户路径', () => {
  it('生成前输入会传给工作流运行器', async () => {
    const mounted = await mount({ stepId: step.stepId, output: '', status: 'pending' })
    const textarea = mounted.host.querySelector('textarea')!

    await act(async () => setTextareaValue(textarea, '用户自己的故事种子'))

    expect(mounted.onUserInputChange).toHaveBeenLastCalledWith('用户自己的故事种子')
    await act(async () => mounted.root.unmount())
    mounted.host.remove()
  })

  it('编辑 AI 输出后保存使用编辑值，而不是原始输出', async () => {
    const mounted = await mount({ stepId: step.stepId, output: 'AI 原始结果', status: 'done' })
    const textareas = mounted.host.querySelectorAll('textarea')
    expect(textareas).toHaveLength(2)

    await act(async () => setTextareaValue(textareas[1], '用户修改后的结果'))
    expect(mounted.onOutputChange).toHaveBeenLastCalledWith('用户修改后的结果')
    const saveButton = Array.from(mounted.host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('保存到'))!
    await act(async () => saveButton.click())

    expect(mounted.onSave).toHaveBeenCalledWith('用户修改后的结果', step.saveTarget)
    await act(async () => mounted.root.unmount())
    mounted.host.remove()
  })
})
