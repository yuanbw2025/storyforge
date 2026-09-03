import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { PromptWorkflow } from '../../src/lib/types/workflow'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'
import WorkflowEditor from '../../src/components/settings/prompt/WorkflowEditor'
import { useWorkflowStore } from '../../src/stores/workflow'
import { createLinearWorkflowGraph } from '../../src/lib/workflow/graph'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function baseWorkflow(): PromptWorkflow {
  const steps: PromptWorkflow['steps'] = [
    {
      stepId: 'seed',
      label: '故事种子',
      promptModuleKey: 'story.generate',
      userConfirmRequired: true,
    },
    {
      stepId: 'world',
      label: '世界设定',
      promptModuleKey: 'worldview.dimension',
      inputMapping: { previousOutput: 'storyCore' },
      userConfirmRequired: true,
    },
    {
      stepId: 'character',
      label: '角色设计',
      promptModuleKey: 'character.generate',
      userConfirmRequired: true,
    },
  ]
  return {
    id: 92001,
    scope: 'user',
    name: '画布 UI 测试',
    description: '',
    steps,
    graph: createLinearWorkflowGraph(steps),
    createdAt: 1,
    updatedAt: 1,
  }
}

async function mount(workflow = baseWorkflow()) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      createElement(DialogProvider, null,
        createElement(ToastProvider, null,
          createElement(WorkflowEditor, { workflow, onClose: () => undefined }),
        ),
      ),
    )
  })
  return { host, root }
}

function buttonByLabel(host: HTMLElement, label: string): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`missing button: ${label}`)
  return button
}

describe('FLOW-1 · 节点画布用户路径', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useWorkflowStore.setState({ workflows: [], loaded: false })
    await db.promptWorkflows.put(baseWorkflow())
  })

  it('当前工作流直接呈现显式节点图，作者可建立分支并保存刷新', async () => {
    const mounted = await mount()
    expect(mounted.host.querySelectorAll('[data-testid^="workflow-node-"]')).toHaveLength(3)
    expect(mounted.host.textContent).toContain('故事种子 → 世界设定.storyCore')
    expect(mounted.host.textContent).toContain('世界设定 → 角色设计.worldContext')

    await act(async () => buttonByLabel(mounted.host, '从 故事种子 输出').click())
    await act(async () => buttonByLabel(mounted.host, '连接到 角色设计').click())
    expect(mounted.host.textContent).toContain('故事种子 → 角色设计.worldContext')

    const save = Array.from(mounted.host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('保存 *')) as HTMLButtonElement
    await act(async () => save.click())
    const stored = await db.promptWorkflows.get(92001)
    expect(stored?.graph?.edges).toHaveLength(3)
    expect(stored?.graph?.edges).toContainEqual(expect.objectContaining({
      sourceStepId: 'seed',
      targetStepId: 'character',
      targetVariable: 'worldContext',
    }))

    await act(async () => mounted.root.unmount())
    mounted.host.remove()
  })

  it('画布在交互时拒绝形成环路，坏边不会进入草稿或数据库', async () => {
    const mounted = await mount()

    await act(async () => buttonByLabel(mounted.host, '从 角色设计 输出').click())
    await act(async () => buttonByLabel(mounted.host, '连接到 故事种子').click())

    expect(mounted.host.textContent).toContain('工作流图包含环路')
    expect(mounted.host.textContent).not.toContain('角色设计 → 故事种子.worldContext')
    expect((await db.promptWorkflows.get(92001))?.graph?.edges).toHaveLength(2)

    await act(async () => mounted.root.unmount())
    mounted.host.remove()
  })
})
