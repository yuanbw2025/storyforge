import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChapterEditorToolbar from '../../src/components/editor/ChapterEditorToolbar'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function mount(patch: Record<string, unknown> = {}) {
  const props = {
    isStreaming: false,
    hasText: true,
    organizingChapter: false,
    hasOrganizationCandidate: false,
    analyzingImpact: false,
    impactInfo: null,
    impactPatchTargets: [],
    impactPatchTargetId: null,
    impactPatchSummary: '',
    impactPatchReason: '',
    impactPatchCandidate: null,
    impactPatchBusy: false,
    impactPatchError: null,
    hasOutline: true,
    showOutlinePreview: false,
    showReviewPanel: false,
    consistencyAlertCount: 0,
    showNotePanel: false,
    customInstruction: '',
    perspectiveCharacterId: null,
    perspectiveCharacters: [
      { id: 7, name: '守灯人' },
      { id: 8, name: '钟匠' },
    ],
    onGenerate: vi.fn(),
    onContinue: vi.fn(),
    onExpand: vi.fn(),
    onPolish: vi.fn(),
    onDeAI: vi.fn(),
    onOrganizeChapter: vi.fn(),
    onAnalyzeImpact: vi.fn(),
    onDismissImpact: vi.fn(),
    onImpactPatchTargetChange: vi.fn(),
    onImpactPatchSummaryChange: vi.fn(),
    onImpactPatchReasonChange: vi.fn(),
    onCreateImpactPatch: vi.fn(),
    onConfirmImpactPatch: vi.fn(),
    onRejectImpactPatch: vi.fn(),
    onToggleOutlinePreview: vi.fn(),
    onToggleReviewPanel: vi.fn(),
    onToggleNotePanel: vi.fn(),
    onCustomInstructionChange: vi.fn(),
    onPerspectiveCharacterChange: vi.fn(),
    ...patch,
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(ChapterEditorToolbar, props)))
  return { host, props }
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.trim() === label)
  if (!match) throw new Error(`missing button: ${label}`)
  return match
}

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('AUDIT-6 / HEALTH-4 · 正文编辑器工具栏', () => {
  it('逐项转发现有 AI、提取和面板命令', async () => {
    const { host, props } = await mount()
    for (const label of ['✨ 生成正文', '📝 续写', '📖 扩写', '💎 润色', '🔥 去AI味', '整理本章', '影响分析', '大纲预览', '质量审校', '便签']) {
      await act(async () => button(host, label).click())
    }
    expect(props.onGenerate).toHaveBeenCalledOnce()
    expect(props.onContinue).toHaveBeenCalledOnce()
    expect(props.onExpand).toHaveBeenCalledOnce()
    expect(props.onPolish).toHaveBeenCalledOnce()
    expect(props.onDeAI).toHaveBeenCalledOnce()
    expect(props.onOrganizeChapter).toHaveBeenCalledOnce()
    expect(props.onAnalyzeImpact).toHaveBeenCalledOnce()
    expect(props.onToggleOutlinePreview).toHaveBeenCalledOnce()
    expect(props.onToggleReviewPanel).toHaveBeenCalledOnce()
    expect(props.onToggleNotePanel).toHaveBeenCalledOnce()
  })

  it('无正文或任务忙碌时保持原禁用边界', async () => {
    const { host } = await mount({
      isStreaming: true,
      hasText: false,
      organizingChapter: true,
      analyzingImpact: true,
    })
    for (const label of ['✨ 生成正文', '📝 续写', '📖 扩写', '💎 润色', '🔥 去AI味', '分析中...', '质量审校']) {
      expect(button(host, label).disabled).toBe(true)
    }
    expect(button(host, '停止整理').disabled).toBe(true)
    expect(button(host, '便签').disabled).toBe(false)
  })

  it('展示影响分析结果、开关状态并转发组合输入', async () => {
    const { host, props } = await mount({
      impactInfo: '2 条事实需要复核',
      showOutlinePreview: true,
      showReviewPanel: true,
      showNotePanel: true,
    })
    expect(host.textContent).toContain('2 条事实需要复核')
    expect(button(host, '大纲预览').getAttribute('aria-pressed')).toBe('true')
    expect(button(host, '质量审校').getAttribute('aria-pressed')).toBe('true')
    expect(button(host, '便签').getAttribute('aria-pressed')).toBe('true')
    await act(async () => button(host, '×').click())
    expect(props.onDismissImpact).toHaveBeenCalledOnce()

    const input = host.querySelector('input')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '保持冷峻语气')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(props.onCustomInstructionChange).toHaveBeenCalledWith('保持冷峻语气')
  })

  it('当前正文存在一致性告警时在审校入口显示计数', async () => {
    const { host } = await mount({ consistencyAlertCount: 3 })
    const review = Array.from(host.querySelectorAll('button'))
      .find(item => item.textContent?.includes('质量审校'))
    expect(review?.textContent).toContain('3')
  })

  it('影响修订候选只转发创建、确认和拒绝动作', async () => {
    const { host, props } = await mount({
      impactInfo: '后续大纲需要复核',
      impactPatchTargets: [{ id: 12, title: '第二章', summary: '旧摘要' }],
      impactPatchTargetId: 12,
      impactPatchSummary: '新摘要',
      impactPatchReason: '正文改变后续动机',
    })
    await act(async () => button(host, '生成修订候选').click())
    expect(props.onCreateImpactPatch).toHaveBeenCalledOnce()

    const candidate = {
      version: 1,
      type: 'impact-patch-candidate',
      projectId: 1,
      worldGroupId: null,
      sourceChapterId: 3,
      sourceTextHash: 'a'.repeat(64),
      sourceGraphHash: 'b'.repeat(64),
      proposal: {
        target: 'outlineNodes',
        recordId: 12,
        fields: { summary: '候选摘要' },
        reason: '正文改变后续动机',
        evidenceRefs: [],
      },
      createdAt: 1,
      durable: {
        runId: 5,
        stepId: 'impact-patch:apply',
        attempt: 1,
        contextManifestHash: 'c'.repeat(64),
        candidateHash: 'd'.repeat(64),
      },
    } as any
    const rendered = await mount({
      impactInfo: '待确认',
      impactPatchTargets: [{ id: 12, title: '第二章', summary: '旧摘要' }],
      impactPatchTargetId: 12,
      impactPatchSummary: '候选摘要',
      impactPatchReason: '正文改变后续动机',
      impactPatchCandidate: candidate,
    })
    await act(async () => button(rendered.host, '确认修订').click())
    await act(async () => button(rendered.host, '放弃修订').click())
    expect(rendered.props.onConfirmImpactPatch).toHaveBeenCalledOnce()
    expect(rendered.props.onRejectImpactPatch).toHaveBeenCalledOnce()
  })

  it('明确选择章节叙事视角并允许恢复为不指定', async () => {
    const { host, props } = await mount({ perspectiveCharacterId: 7 })
    const select = host.querySelector('select[aria-label="叙事视角角色"]') as HTMLSelectElement
    expect(select.value).toBe('7')
    expect(select.textContent).toContain('守灯人')

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      setter.call(select, '8')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(props.onPerspectiveCharacterChange).toHaveBeenCalledWith(8)

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      setter.call(select, '')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(props.onPerspectiveCharacterChange).toHaveBeenCalledWith(null)
  })
})
