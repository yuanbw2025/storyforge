import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import ShortNovelShowcase, { SHORT_NOVEL_SHOWCASES } from '../../src/components/short-novel/ShortNovelShowcase'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

afterEach(async () => {
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('R-SHORT3 短篇成品只在短篇功能页展示', () => {
  it('挂载在 ShortNovelStudio 并提供四篇可阅读终稿', async () => {
    const studioSource = readFileSync(resolve(process.cwd(), 'src/components/short-novel/ShortNovelStudio.tsx'), 'utf8')
    expect(studioSource).toContain("import ShortNovelShowcase from './ShortNovelShowcase'")
    expect(studioSource).toContain('<ShortNovelShowcase />')
    expect(SHORT_NOVEL_SHOWCASES).toHaveLength(4)

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    mounted.push({ host, root })
    await act(async () => root.render(<ShortNovelShowcase />))
    expect(host.querySelector('[data-testid="short-novel-showcase"]')).not.toBeNull()
    for (const story of SHORT_NOVEL_SHOWCASES) expect(host.textContent).toContain(story.title)
    expect(host.textContent).not.toContain('婚礼第零桌')
    expect(host.textContent).not.toContain('凌晨四点，月亮来买面包')

    const readButton = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.getAttribute('aria-label') === '阅读完整样例《盐从记忆里长出来》')
    expect(readButton).toBeDefined()
    await act(async () => readButton!.click())
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('母亲第三次问起海的时候')

    const closeButton = host.querySelector<HTMLButtonElement>('button[aria-label="关闭阅读器"]')
    expect(closeButton).not.toBeNull()
    await act(async () => closeButton!.click())
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })
})
