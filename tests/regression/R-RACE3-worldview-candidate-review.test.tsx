import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorldviewFieldCandidateReview from '../../src/components/worldview/WorldviewFieldCandidateReview'
import { compareWorldviewTextBlocksV1 } from '../../src/lib/agent/worldview-text-comparison'
import { parseWorldviewFieldCandidateDraft } from '../../src/lib/agent/worldview-field-copilot'

function pending(operation: 'create' | 'expand' | 'rewrite' | 'polish' = 'expand') {
  return {
    event: {
      id: 17,
      content: JSON.stringify({
        field: 'races',
        value: '## 身份\n潮民用潮痕辨认亲族。\n\n## 组织\n议席按航季轮换，并新增盐路仲裁席。',
        temporaryAssumptions: ['盐路仲裁席是本轮临时假设。'],
      }),
    },
    payload: {
      label: '种族与民族',
      worldviewFieldOperation: operation,
      baseSnapshot: {
        values: {
          races: '## 身份\n潮民用潮痕辨认亲族。\n\n## 组织\n议席按七次退潮轮换。\n\n## 旧俗\n失传的盐灯祭。',
        },
      },
    },
  } as any
}

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function renderReview(operation: 'create' | 'expand' | 'rewrite' | 'polish', onUpdate = vi.fn()) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => {
    root.render(<WorldviewFieldCandidateReview candidate={pending(operation)} busy={false} onUpdate={onUpdate} />)
  })
  return { host, onUpdate }
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  textarea.dispatchEvent(new Event('change', { bubbles: true }))
}

afterEach(async () => {
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('RACE-3 · worldview candidate dual-version review', () => {
  it('确定性块对照区分保留、可能改写、增加和删除，且结果可重建', () => {
    const original = '## 身份\n潮民用潮痕辨认亲族。\n\n## 组织\n议席按七次退潮轮换。\n\n## 旧俗\n失传的盐灯祭。'
    const candidate = '## 身份\n潮民用潮痕辨认亲族。\n\n## 组织\n议席按航季轮换，并新增盐路仲裁席。\n\n## 新俗\n钟声决定迁民身份。'
    const first = compareWorldviewTextBlocksV1(original, candidate)
    const replay = compareWorldviewTextBlocksV1(original, candidate)
    expect(replay).toEqual(first)
    expect(first.version).toBe('worldview-text-block-compare-v1')
    expect(first.rows.map(row => row.status)).toEqual(expect.arrayContaining([
      'unchanged', 'possibly-rewritten', 'removed', 'added',
    ]))
  })

  it('expand/polish 只让作者编辑 value，保留原文、临时假设和非事实声明', async () => {
    const onUpdate = vi.fn()
    const { host } = await renderReview('polish', onUpdate)

    const editor = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="种族与民族候选内容"]')!
    expect(editor.value).not.toContain('"field"')
    expect(host.querySelector('textarea[aria-label="种族与民族原文"]')).not.toBeNull()
    expect(host.textContent).toContain('不是事实校验')
    expect(host.textContent).toContain('不会随正文自动写入 Canon')

    await act(async () => setTextareaValue(editor, '作者手动调整后的完整候选正文。'))
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(parseWorldviewFieldCandidateDraft(onUpdate.mock.calls[0][0])).toEqual({
      field: 'races',
      value: '作者手动调整后的完整候选正文。',
      temporaryAssumptions: ['盐路仲裁席是本轮临时假设。'],
    })
  })

  it('rewrite 以新版为主并折叠原文；create 不伪造不存在的前版', async () => {
    const rewrite = await renderReview('rewrite')
    expect(rewrite.host.textContent).toContain('查看重写前原文')
    expect(rewrite.host.textContent).not.toContain('同步滚动')

    const create = await renderReview('create')
    expect(create.host.textContent).toContain('新建候选正文')
    expect(create.host.textContent).not.toContain('文本块对照')
  })
})
