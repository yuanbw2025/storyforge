import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ReferenceDetailCard from '../../src/components/project/ReferenceDetailCard'
import type { Reference } from '../../src/lib/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

function reference(patch: Partial<Reference> = {}): Reference {
  return {
    id: 7,
    projectId: 1,
    title: '镜城纪事',
    author: '测试作者',
    type: 'story',
    note: '学习多线叙事',
    url: '',
    analysisStatus: 'none',
    importedData: {
      worldview: { worldOrigin: '镜海退潮后形成七座城邦' },
      characters: [{ name: '林照雪', role: '主角', personality: '冷静' }],
      outline: [{ title: '第一卷', summary: '守城与远行' }],
      sourceFilename: 'mirror.md',
      importedAt: 1,
    },
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

async function mountCard() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  const onUpdate = vi.fn()
  const onDelete = vi.fn()
  await act(async () => root.render(createElement(ReferenceDetailCard, {
    reference: reference(),
    referenceIndex: 0,
    onUpdate,
    onDelete,
  })))
  return { host, onUpdate, onDelete }
}

describe('AUDIT-6 / HEALTH-4 · 项目参考详情', () => {
  it('保留作品分析入口并正确切换世界观、角色和大纲导入内容', async () => {
    const { host } = await mountCard()
    expect(host.textContent).toContain('上传文件并分析')

    const worldview = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('世界观'))!
    await act(async () => worldview.click())
    expect(host.textContent).toContain('镜海退潮后形成七座城邦')

    const characters = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('角色'))!
    await act(async () => characters.click())
    const character = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('林照雪'))!
    await act(async () => character.click())
    expect(host.textContent).toContain('冷静')

    const outline = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('大纲'))!
    await act(async () => outline.click())
    expect(host.textContent).toContain('第一卷')
    expect(host.textContent).toContain('守城与远行')
  })

  it('基本信息修改和删除只通过父级回调执行', async () => {
    const { host, onUpdate, onDelete } = await mountCard()
    const info = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('基本信息'))!
    await act(async () => info.click())
    const type = host.querySelector<HTMLSelectElement>('select[aria-label="参考类型"]')!
    await act(async () => {
      type.value = 'historical'
      type.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onUpdate).toHaveBeenCalledWith({ type: 'historical' })

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="删除项目参考"]')!.click())
    expect(onDelete).toHaveBeenCalledOnce()
  })
})
