import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DialogProvider } from '../../src/components/shared/Dialog'
import PromptTemplateEditor from '../../src/components/settings/prompt/PromptTemplateEditor'
import { ToastProvider } from '../../src/components/shared/Toast'
import { db } from '../../src/lib/db/schema'
import { REGISTRY_BY_NAME } from '../../src/lib/registry/project-tables'
import type { PromptTemplate } from '../../src/lib/types/prompt'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { usePromptStore } from '../../src/stores/prompt'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ai = vi.hoisted(() => ({
  start: vi.fn(async () => '好示例一：用具体动作呈现人物犹疑。\n===EXAMPLE===\n好示例二：用环境回声收束冲突。'),
  reset: vi.fn(),
  stop: vi.fn(),
  setOperation: vi.fn(),
  restore: vi.fn(),
}))

vi.mock('../../src/hooks/useAIStream', () => ({
  useAIStream: () => ({
    output: '', isStreaming: false, error: null, tokenUsage: null, operation: null,
    start: ai.start, reset: ai.reset, stop: ai.stop,
    setOperation: ai.setOperation, restore: ai.restore,
  }),
}))

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

function configuredAI() {
  useAIConfigStore.setState({
    config: {
      provider: 'custom', apiKey: 'test-key', baseUrl: 'http://localhost:1234/v1',
      model: 'harness75-test', temperature: 0.7, maxTokens: 0,
    },
    presets: [], taskRoutes: {},
  })
}

async function seedTemplate(scope: 'system' | 'user' = 'user'): Promise<PromptTemplate> {
  const row: PromptTemplate = {
    scope,
    moduleKey: 'prompt.operations',
    promptType: 'generate',
    name: scope === 'user' ? '作者提示词草稿' : '系统提示词',
    description: '验证示例只进入编辑草稿',
    systemPrompt: '你是叙事编辑。',
    userPromptTemplate: '请处理：{{userHint}}',
    variables: ['userHint'],
    isActive: false,
    createdAt: 1,
    updatedAt: 1,
  }
  const id = await db.promptTemplates.add(row) as number
  return { ...row, id }
}

function button(host: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('button'))
    .find(item => item.textContent?.includes(label))
}

async function mount(template: PromptTemplate) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(
    createElement(DialogProvider, null,
      createElement(ToastProvider, null,
        createElement(PromptTemplateEditor, {
          template,
          onChanged: vi.fn(),
          onDeleted: vi.fn(),
        }))),
  ))
  return host
}

async function generateGoodExample(host: HTMLElement) {
  const generate = Array.from(host.querySelectorAll('button'))
    .find(item => item.textContent?.trim() === 'AI 生成') as HTMLButtonElement
  await act(async () => {
    generate.click()
    await Promise.resolve()
  })
  await vi.waitFor(() => expect(ai.start).toHaveBeenCalledOnce())
  await vi.waitFor(() => expect(host.textContent).toContain('好示例一'))
}

describe.sequential('R-HARNESS75 · Prompt 示例生成只进入作者草稿', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    usePromptStore.setState({ templates: [], loaded: false })
    configuredAI()
    ai.start.mockClear()
    ai.reset.mockClear()
  })

  afterEach(async () => {
    while (mounted.length > 0) {
      const item = mounted.pop()!
      await act(async () => item.root.unmount())
      item.host.remove()
    }
    db.close()
  })

  it('AI 输出只改变内存 draft，作者点击顶部保存后才写全局 promptTemplates', async () => {
    const template = await seedTemplate()
    const host = await mount(template)

    await generateGoodExample(host)

    const [messages, , meta] = ai.start.mock.calls[0] as unknown as [
      Array<{ role: string; content: string }>, unknown, { category: string },
    ]
    expect(messages.map(message => message.content).join('\n')).toContain('你是叙事编辑。')
    expect(messages.map(message => message.content).join('\n')).toContain('请处理：{{userHint}}')
    expect(meta).toEqual({ category: 'prompt.examples' })
    const beforeSave = await db.promptTemplates.get(template.id!)
    expect(beforeSave?.examples).toBeUndefined()
    expect(await db.agentRuns.count()).toBe(0)
    expect(REGISTRY_BY_NAME.get('promptTemplates')).toMatchObject({ owner: 'global', exportable: false })
    expect(host.textContent).toContain('点击顶部「保存」后才会生效')
    expect(button(host, '保存')?.disabled).toBe(false)

    await act(async () => {
      button(host, '保存')!.click()
      await Promise.resolve()
    })
    await vi.waitFor(async () => {
      const saved = await db.promptTemplates.get(template.id!)
      expect(saved?.examples?.good?.map(example => example.text)).toEqual([
        '好示例一：用具体动作呈现人物犹疑。',
        '好示例二：用环境回声收束冲突。',
      ])
    })
  })

  it('未保存即离开会丢弃生成草稿，不把内存结果伪装成 durable 业务候选', async () => {
    const template = await seedTemplate()
    const host = await mount(template)
    await generateGoodExample(host)

    const current = mounted.pop()!
    await act(async () => current.root.unmount())
    current.host.remove()

    const persisted = (await db.promptTemplates.get(template.id!))!
    const remounted = await mount(persisted)
    expect(remounted.textContent).not.toContain('好示例一')
    expect((await db.promptTemplates.get(template.id!))?.examples).toBeUndefined()
  })

  it('缺少模型配置时零调用，系统模板保持只读且没有生成或保存入口', async () => {
    const userTemplate = await seedTemplate()
    useAIConfigStore.setState({
      config: {
        provider: 'deepseek', apiKey: '', baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat', temperature: 0.7, maxTokens: 0,
      },
      presets: [], taskRoutes: {},
    })
    const userHost = await mount(userTemplate)
    const generate = Array.from(userHost.querySelectorAll('button'))
      .find(item => item.textContent?.trim() === 'AI 生成') as HTMLButtonElement
    await act(async () => generate.click())
    expect(ai.start).not.toHaveBeenCalled()
    expect((await db.promptTemplates.get(userTemplate.id!))?.examples).toBeUndefined()

    const systemTemplate = await seedTemplate('system')
    const systemHost = await mount(systemTemplate)
    expect(Array.from(systemHost.querySelectorAll('button'))
      .some(item => item.textContent?.trim() === 'AI 生成')).toBe(false)
    expect(button(systemHost, '保存')).toBeUndefined()
  })
})
