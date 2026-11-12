import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImportDocIntro, ImportReusableSessionBanner } from '../../src/components/system/import/ImportDocOverview'
import { ImportPipelineControls } from '../../src/components/system/import/ImportRuntimeView'
import CodexImportReviewModal from '../../src/components/system/import/CodexImportReviewModal'
import useImportDocumentPreparation from '../../src/components/system/import/useImportDocumentPreparation'
import type { ImportSession } from '../../src/lib/types/import-session'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

async function mount(element: React.ReactElement) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(element))
  return host
}

const session: ImportSession = {
  id: 12,
  projectId: 1,
  filename: '设定集.md',
  fileHash: 'hash',
  totalChars: 12345,
  totalChunks: 3,
  chunkSize: 50000,
  chunks: [],
  merged: { worldview: {}, characters: [], outline: [] },
  rollingContext: '',
  importTarget: 'project',
  status: 'done',
  createdAt: 1,
  updatedAt: 1,
}

// A presentation fixture. The durable import tests exercise receipt integrity.
const confirmedChunk: ImportSession['chunks'][number] = {
  index: 0,
  startChar: 0,
  endChar: 100,
  charCount: 100,
  status: 'done' as const,
  attempts: 1,
  durableParse: {
    claimKey: 'claim-1',
    runId: 1,
    confirmation: { editedHash: '1'.repeat(64), receipt: {
      version: 1, runId: 1, generation: 1, contractHash: '2'.repeat(64),
      contextManifestHashes: ['3'.repeat(64)], candidateHashes: ['4'.repeat(64)], adoptionEventIds: [1],
      postStateHash: '5'.repeat(64), verifierSetVersion: 'test-v1', criteria: [], acceptedAt: 1, receiptHash: '6'.repeat(64),
    } },
  },
}

function ImportPreparationHarness() {
  const preparation = useImportDocumentPreparation()
  return createElement('div', null,
    createElement('button', { onClick: () => preparation.handleRawTextChange('第一章\n镜海之门开启。') }, '载入粘贴文本'),
    createElement('button', { onClick: preparation.prepareConfirmation }, '准备解析'),
    createElement('span', { 'data-testid': 'state' }, preparation.showConfirm
      ? `${preparation.plans?.length}|${preparation.previewPlans?.length}|${preparation.sourceBlob().filename}`
      : 'closed'),
  )
}

describe('AUDIT-6 · 文档导入视图', () => {
  it('介绍区使用当前切块大小并展示文件限制', async () => {
    const host = await mount(createElement(ImportDocIntro, { chunkSize: 50000 }))
    expect(host.textContent).toContain('AI 分块文档解析')
    expect(host.textContent).toContain('每块约 50,000 字')
    expect(host.textContent).toContain('支持的文件格式与大小上限')
  })

  it('作者确认的会话只有查看/忽略两个常驻操作，其余动作按原落点和原文可用性出现', async () => {
    const onApplyProject = vi.fn()
    const onApplyReference = vi.fn()
    const onIgnore = vi.fn()
    const onShowReport = vi.fn()
    const host = await mount(createElement(ImportReusableSessionBanner, {
      session: { ...session, chunks: [confirmedChunk], importTarget: 'project' },
      applying: false,
      originalTextAvailable: false,
      onApplyProject,
      onApplyReference,
      onShowReport,
      onIgnore,
    }))

    // 原落点是当前项目：只有本地图内的“浅层”参考可用，深层需要恢复原文；
    // 从原项目会话直接灌回设定库会与既有落点重复，因此不提供该按钮。
    const buttons = Array.from(host.querySelectorAll('button'))
    expect(buttons.map(button => button.textContent?.trim())).toEqual([
      '查看导入记录',
      '保存为项目参考 · 浅层',
      '忽略',
    ])
    for (const button of buttons) await act(async () => button.click())
    expect(onShowReport).toHaveBeenCalledOnce()
    expect(onApplyReference).toHaveBeenCalledOnce()
    expect(onApplyReference).toHaveBeenCalledWith('quick')
    expect(onApplyProject).not.toHaveBeenCalled()
    expect(onIgnore).toHaveBeenCalledOnce()
    expect(host.textContent).toContain('深层分析需要恢复原文件')
  })

  it('原文可恢复时才给出深层参考，参考目标的会话才能采用到当前项目设定库', async () => {
    const onApplyProject = vi.fn()
    const onApplyReference = vi.fn()
    const host = await mount(createElement(ImportReusableSessionBanner, {
      session: { ...session, chunks: [confirmedChunk], importTarget: 'reference' },
      applying: false,
      originalTextAvailable: true,
      onApplyProject,
      onApplyReference,
      onShowReport: vi.fn(),
      onIgnore: vi.fn(),
    }))
    const labels = Array.from(host.querySelectorAll('button')).map(button => button.textContent?.trim())
    expect(labels).toContain('采用到当前项目设定库')
    expect(labels).not.toContain('保存为项目参考 · 浅层')
    await act(async () => Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('采用到当前项目设定库'))!.click())
    expect(onApplyProject).toHaveBeenCalledOnce()

    const project = await mount(createElement(ImportReusableSessionBanner, {
      session: { ...session, chunks: [confirmedChunk], importTarget: 'project' },
      applying: false, originalTextAvailable: true, onApplyProject, onApplyReference,
      onShowReport: vi.fn(), onIgnore: vi.fn(),
    }))
    const deep = Array.from(project.querySelectorAll('button')).find(button => button.textContent?.includes('深层'))!
    await act(async () => deep.click())
    expect(onApplyReference).toHaveBeenCalledOnce()
    expect(onApplyReference).toHaveBeenCalledWith('deep')
  })

  it('词条候选审查允许取消、改名和改分类，确认时只交回选中项', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const host = await mount(createElement(CodexImportReviewModal, {
      filename: '设定集.md',
      categories: [
        {
          ref: 'builtin:city',
          categoryId: 1,
          domain: 'humanity',
          label: '城池重镇',
          fields: [],
        },
        {
          ref: 'builtin:faction',
          categoryId: 2,
          domain: 'humanity',
          label: '势力',
          fields: [],
        },
      ],
      candidates: [
        {
          categoryRef: 'builtin:city',
          name: '临渊城',
          summary: '海门重镇',
          description: '',
          fields: {},
          tags: [],
          confidence: 0.91,
          evidence: [{ chunkIndex: 0, quote: '临渊城扼守海峡' }],
        },
        {
          categoryRef: 'builtin:faction',
          name: '海盟',
          summary: '',
          description: '',
          fields: {},
          tags: [],
          confidence: 0.6,
          evidence: [{ chunkIndex: 1, quote: '海盟七部' }],
        },
      ],
      onConfirm,
      onCancel: vi.fn(),
    }))

    const firstName = host.querySelectorAll<HTMLInputElement>('input')[0]
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      valueSetter.call(firstName, '新临渊城')
      firstName.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const secondToggle = host.querySelector<HTMLButtonElement>('button[aria-label="取消选择 海盟"]')!
    await act(async () => secondToggle.click())
    const confirm = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('确认导入 1 条'))!
    await act(async () => confirm.click())

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onConfirm.mock.calls[0][0]).toHaveLength(1)
    expect(onConfirm.mock.calls[0][0][0].name).toBe('新临渊城')
    expect(host.textContent).toContain('逐字证据')
  })

  it('流水线控制栏按 phase 显示暂停、恢复和取消命令', async () => {
    const onPause = vi.fn()
    const onResume = vi.fn()
    const onCancel = vi.fn()
    const host = await mount(createElement(ImportPipelineControls, {
      phase: 'paused',
      canResume: true,
      onPause,
      onResume,
      onCancel,
    }))
    expect(host.textContent).toContain('恢复')
    expect(host.textContent).toContain('取消')
    expect(host.textContent).not.toContain('暂停')
    const resume = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('恢复'))!
    const cancel = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('取消'))!
    await act(async () => resume.click())
    await act(async () => cancel.click())
    expect(onResume).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('文档准备控制器为粘贴文本生成切块和 Blob 兜底', async () => {
    const host = await mount(createElement(ImportPreparationHarness))
    const load = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '载入粘贴文本')!
    const prepare = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '准备解析')!
    await act(async () => load.click())
    await act(async () => prepare.click())
    expect(host.querySelector('[data-testid="state"]')?.textContent).toBe('1|1|粘贴内容.txt')
  })
})
