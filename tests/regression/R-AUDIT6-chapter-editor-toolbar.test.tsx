import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChapterEditorToolbar from '../../src/components/editor/ChapterEditorToolbar'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function mount(patch: Record<string, unknown> = {}) {
  const props = {
    isStreaming: false,
    isPreparingGeneration: false,
    hasText: true,
    organizingChapter: false,
    hasOrganizationCandidate: false,
    analyzingImpact: false,
    impactInfo: null,
    impactRemediationPlan: null,
    futureEvolutionPlan: null,
    impactDownstreamSchedule: null,
    impactRemediationBusy: false,
    impactRemediationReceipt: null,
    impactRemediationError: null,
    impactReviewItemId: null,
    impactReviewDecision: 'acknowledged',
    impactReviewNote: '',
    impactReviewBusy: false,
    impactReviewReceipt: null,
    impactReviewError: null,
    impactReviewRecords: [],
    impactPatchTargets: [],
    impactPatchTargetId: null,
    impactPatchSummary: '',
    impactPatchReason: '',
    impactPatchCandidate: null,
    impactPatchBusy: false,
    impactPatchError: null,
    impactOutlineRegenerationTargets: [],
    impactOutlineRegenerationItemId: null,
    impactOutlineRegenerationCandidate: null,
    impactOutlineRegenerationBusy: false,
    impactOutlineRegenerationReceipt: null,
    impactOutlineRegenerationError: null,
    impactStoryTimelineRegenerationTargets: [],
    impactStoryTimelineRegenerationItemId: null,
    impactStoryTimelineRegenerationCandidate: null,
    impactStoryTimelineRegenerationBusy: false,
    impactStoryTimelineRegenerationReceipt: null,
    impactStoryTimelineRegenerationError: null,
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
    onRunImpactRemediation: vi.fn(),
    onReplanImpactRemediation: vi.fn(),
    onImpactReviewItemChange: vi.fn(),
    onImpactReviewDecisionChange: vi.fn(),
    onImpactReviewNoteChange: vi.fn(),
    onExecuteImpactReview: vi.fn(),
    onOpenImpactManualEntry: vi.fn(),
    onConfirmImpactPatch: vi.fn(),
    onRejectImpactPatch: vi.fn(),
    onImpactOutlineRegenerationItemChange: vi.fn(),
    onGenerateImpactOutlineRegeneration: vi.fn(),
    onConfirmImpactOutlineRegeneration: vi.fn(),
    onRejectImpactOutlineRegeneration: vi.fn(),
    onImpactStoryTimelineRegenerationItemChange: vi.fn(),
    onGenerateImpactStoryTimelineRegeneration: vi.fn(),
    onConfirmImpactStoryTimelineRegeneration: vi.fn(),
    onRejectImpactStoryTimelineRegeneration: vi.fn(),
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

  it('正文前置组装期间显示准备状态并阻止重复点击', async () => {
    const { host, props } = await mount({ isPreparingGeneration: true })
    const preparing = button(host, '准备中...')

    expect(preparing.disabled).toBe(true)
    await act(async () => preparing.click())
    expect(props.onGenerate).not.toHaveBeenCalled()
    expect(button(host, '📝 续写').disabled).toBe(true)
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

  it('H57 生成式章纲入口只转发目标、生成、确认和拒绝，不与手填 patch 混用', async () => {
    const target = {
      itemId: 'impact-remediation:outline:12',
      id: 12,
      title: '第二章',
      summary: '旧摘要',
    }
    const { host, props } = await mount({
      impactInfo: '已恢复人工修正后的当前计划',
      impactOutlineRegenerationTargets: [target],
      impactOutlineRegenerationItemId: target.itemId,
      impactPatchTargets: [{ id: 12, title: '第二章', summary: '旧摘要' }],
    })
    expect(host.textContent).toContain('H57 生成式下游重建')
    await act(async () => button(host, 'AI 重建章纲候选').click())
    expect(props.onGenerateImpactOutlineRegeneration).toHaveBeenCalledOnce()
    expect(props.onCreateImpactPatch).not.toHaveBeenCalled()

    const candidate = {
      candidateHash: 'e'.repeat(64),
      result: {
        summary: '半开启的潮门迫使钟楼改变撤离计划。',
        reason: '保持上游事实与后续因果一致。',
        evidenceRefs: ['章节正文', '当前章节大纲'],
      },
    } as any
    const rendered = await mount({
      impactInfo: '待作者确认',
      impactOutlineRegenerationTargets: [target],
      impactOutlineRegenerationItemId: target.itemId,
      impactOutlineRegenerationCandidate: candidate,
      impactPatchTargets: [{ id: 12, title: '第二章', summary: '旧摘要' }],
    })
    expect(rendered.host.textContent).toContain('半开启的潮门')
    expect(rendered.host.textContent).not.toContain('生成修订候选')
    await act(async () => button(rendered.host, '确认重建摘要').click())
    await act(async () => button(rendered.host, '放弃候选').click())
    expect(rendered.props.onConfirmImpactOutlineRegeneration).toHaveBeenCalledOnce()
    expect(rendered.props.onRejectImpactOutlineRegeneration).toHaveBeenCalledOnce()
  })

  it('H57 单事件年表入口冻结身份字段，并与章纲及手填候选互斥', async () => {
    const target = {
      itemId: 'impact-remediation:timeline-event:21',
      id: 21,
      title: '潮门开启',
    }
    const { host, props } = await mount({
      impactInfo: '已恢复人工修正后的当前计划',
      impactStoryTimelineRegenerationTargets: [target],
      impactStoryTimelineRegenerationItemId: target.itemId,
      impactPatchTargets: [{ id: 12, title: '第二章', summary: '旧摘要' }],
    })
    expect(host.textContent).toContain('H57 年表重建')
    expect(host.textContent).toContain('标题、章节绑定与顺序保持冻结')
    await act(async () => button(host, 'AI 重建年表候选').click())
    expect(props.onGenerateImpactStoryTimelineRegeneration).toHaveBeenCalledOnce()
    expect(props.onCreateImpactPatch).not.toHaveBeenCalled()

    const candidate = {
      candidateHash: 'f'.repeat(64),
      targetBaseline: {
        title: '潮门开启', storyTime: '第七日', importance: 2,
        description: '潮门完全开启。',
      },
      result: {
        storyTime: '第七日黄昏', importance: 3,
        description: '潮门只开启一半。',
        reason: '与作者修正后的正文一致。',
        evidenceRefs: ['章节正文', '目标故事年表事件'],
      },
    } as any
    const rendered = await mount({
      impactInfo: '待作者确认',
      impactStoryTimelineRegenerationTargets: [target],
      impactStoryTimelineRegenerationItemId: target.itemId,
      impactStoryTimelineRegenerationCandidate: candidate,
      impactOutlineRegenerationTargets: [{ itemId: 'outline:12', id: 12, title: '第二章', summary: '旧摘要' }],
      impactPatchTargets: [{ id: 12, title: '第二章', summary: '旧摘要' }],
    })
    expect(rendered.host.textContent).toContain('潮门只开启一半')
    expect(rendered.host.textContent).not.toContain('AI 重建章纲候选')
    expect(rendered.host.textContent).not.toContain('生成修订候选')
    await act(async () => button(rendered.host, '确认重建年表事件').click())
    await act(async () => button(rendered.host, '放弃年表候选').click())
    expect(rendered.props.onConfirmImpactStoryTimelineRegeneration).toHaveBeenCalledOnce()
    expect(rendered.props.onRejectImpactStoryTimelineRegeneration).toHaveBeenCalledOnce()
  })

  it('显示绑定 hash 的确定性影响处理计划，不触发隐藏执行', async () => {
    const { host, props } = await mount({
      impactInfo: '后续产物需要处理',
      impactRemediationPlan: {
        version: 1,
        source: { table: 'chapters', recordId: 3, sourceTextHash: 'a'.repeat(64) },
        graphHash: 'b'.repeat(64),
        items: [],
        counts: { total: 5, deterministic: 2, authorConfirmed: 3 },
        planHash: 'c'.repeat(64),
      },
    })
    expect(host.textContent).toContain('处理计划 5 项')
    expect(host.textContent).toContain('系统重建 2')
    expect(host.textContent).toContain('作者复核 0/3')
    expect(host.textContent).toContain('cccccccccccc')
    await act(async () => button(host, '执行系统重建').click())
    expect(props.onRunImpactRemediation).toHaveBeenCalledOnce()
    await act(async () => button(host, '刷新计划').click())
    expect(props.onReplanImpactRemediation).toHaveBeenCalledOnce()
    expect(props.onCreateImpactPatch).not.toHaveBeenCalled()
  })

  it('把未来保护边界、阶段链和产品反馈回路显示给作者', async () => {
    const { host } = await mount({
      impactInfo: '未来演化计划已生成',
      futureEvolutionPlan: {
        frontier: {
          protectedOutlineNodeIds: [1, 2],
          futureOutlineNodeIds: [3, 4, 5],
        },
        futureTargets: [
          { detailStatus: 'present' },
          { detailStatus: 'missing' },
          { detailStatus: 'missing' },
        ],
        stages: [
          { id: 'foundation', label: '未来故事线与新角色', readiness: 'ready', purpose: '新增未来基座' },
          { id: 'detail', label: '未来细纲', readiness: 'ready', purpose: '生成未写细纲' },
          { id: 'product-projection', label: '游戏、跑团与角色聊天投影', readiness: 'empty-target', purpose: '消费发布' },
        ],
        planHash: 'f'.repeat(64),
      },
    })
    expect(host.querySelector('[aria-label="FUTURE-1 未来演化边界"]')).not.toBeNull()
    expect(host.textContent).toContain('历史保护 2 章')
    expect(host.textContent).toContain('未来章纲 3 章')
    expect(host.textContent).toContain('缺细纲 2 章')
    expect(host.textContent).toContain('未来故事线与新角色')
    expect(host.textContent).toContain('游戏、跑团与角色聊天投影（待上游）')
    expect(host.textContent).toContain('反馈重新进入本循环')
  })

  it('作者复核项只转发决定和理由，不冒充正式修正', async () => {
    const authorItem = {
      id: 'impact-remediation:fact:12',
      nodeId: 'fact:12',
      kind: 'fact',
      table: 'temporalFacts',
      recordId: 12,
      action: 'review-fact',
      mode: 'author-confirmed',
      reason: '事实来自被修改正文，需作者复核。',
      dependencyNodeIds: ['source:chapters:3'],
    }
    const { host, props } = await mount({
      impactInfo: '事实需要作者复核',
      impactRemediationPlan: {
        version: 1,
        source: { table: 'chapters', recordId: 3, sourceTextHash: 'a'.repeat(64) },
        graphHash: 'b'.repeat(64),
        items: [authorItem],
        counts: { total: 1, deterministic: 0, authorConfirmed: 1 },
        planHash: 'c'.repeat(64),
      },
      impactReviewItemId: authorItem.id,
      impactReviewNote: '证据仍然成立。',
      impactReviewReceipt: 'd'.repeat(64),
      impactReviewRecords: [{
        runId: 9,
        receiptHash: 'd'.repeat(64),
        recordedAt: 1,
        output: {
          planHash: 'c'.repeat(64),
          graphHash: 'b'.repeat(64),
          sourceTextHash: 'a'.repeat(64),
          itemId: authorItem.id,
          decision: 'acknowledged',
          note: '证据仍然成立。',
        },
      }],
    })
    expect(host.textContent).toContain('只记录决定和理由，不修改正文、事实、状态或大纲')
    expect(host.textContent).toContain('复核事实')
    expect(host.textContent).toContain('作者复核回执 dddddddddddd')
    expect(host.textContent).toContain('最近决定：已确认')

    await act(async () => button(host, '需人工处理').click())
    expect(props.onImpactReviewDecisionChange).toHaveBeenCalledWith('needs-manual-action')

    const input = host.querySelector('input[aria-label="作者复核理由"]') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '需要进入事实账本处理。')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(props.onImpactReviewNoteChange).toHaveBeenCalledWith('需要进入事实账本处理。')
    await act(async () => button(host, '记录复核').click())
    expect(props.onExecuteImpactReview).toHaveBeenCalledOnce()
    expect(props.onRunImpactRemediation).not.toHaveBeenCalled()
  })

  it('已记录需人工处理时提供既有入口交接，不创建旁路修复面板', async () => {
    const authorItem = {
      id: 'impact-remediation:fact:12',
      nodeId: 'fact:12',
      kind: 'fact',
      table: 'temporalFacts',
      recordId: 12,
      action: 'review-fact',
      mode: 'author-confirmed',
      reason: '事实证据失效。',
      dependencyNodeIds: [],
    }
    const { host, props } = await mount({
      impactInfo: '事实需要人工处理',
      impactRemediationPlan: {
        version: 1,
        source: { table: 'chapters', recordId: 3, sourceTextHash: 'a'.repeat(64) },
        graphHash: 'b'.repeat(64),
        items: [authorItem],
        counts: { total: 1, deterministic: 0, authorConfirmed: 1 },
        planHash: 'c'.repeat(64),
      },
      impactReviewItemId: authorItem.id,
      impactReviewRecords: [{
        runId: 9,
        receiptHash: 'd'.repeat(64),
        recordedAt: 1,
        output: {
          planHash: 'c'.repeat(64),
          graphHash: 'b'.repeat(64),
          sourceTextHash: 'a'.repeat(64),
          itemId: authorItem.id,
          decision: 'needs-manual-action',
          note: '请到事实库处理。',
        },
      }],
    })
    await act(async () => button(host, '打开人工入口').click())
    expect(props.onOpenImpactManualEntry).toHaveBeenCalledOnce()
  })

  it('展示 H57 跨类型调度的完成、待确认、阻断与人工计数', async () => {
    const { host } = await mount({
      impactInfo: '已恢复人工修正后的当前计划。',
      impactDownstreamSchedule: {
        version: 1,
        kind: 'impact-downstream-schedule',
        portable: false,
        sourceChapterId: 3,
        replanRunId: 12,
        replanReceiptHash: 'a'.repeat(64),
        replanOutputHash: 'b'.repeat(64),
        planHash: 'c'.repeat(64),
        graphHash: 'd'.repeat(64),
        items: [{
          status: 'ready',
          policyId: 'author-coupled-derived-v1',
          policyReason: '该记录属于耦合或整章集合产物；单条 H57 item 不得扩大为集合替换。',
          manualModule: 'inventory',
        }, {}, {}, {}, {}, {}],
        counts: {
          blocked: 1,
          ready: 2,
          'awaiting-confirmation': 1,
          'needs-manual-action': 1,
          completed: 1,
        },
        nextItemIds: ['ready:1', 'ready:2'],
        settled: false,
        scheduleHash: 'e'.repeat(64),
      },
    })
    const progress = host.querySelector('[aria-label="H57 下游调度进度"]')
    expect(progress?.textContent).toContain('H57 下游 1/6')
    expect(progress?.textContent).toContain('可继续 2')
    expect(progress?.textContent).toContain('待确认 1')
    expect(progress?.textContent).toContain('依赖阻断 1')
    expect(progress?.textContent).toContain('需人工 1')
    expect(progress?.textContent).toContain('调度 eeeeeeeeeeee')
    expect(host.querySelector('[aria-label="H57 当前执行器策略"]')?.textContent)
      .toContain('策略 author-coupled-derived-v1')
    expect(host.querySelector('[aria-label="H57 当前执行器策略"]')?.textContent)
      .toContain('人工入口 inventory')
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
