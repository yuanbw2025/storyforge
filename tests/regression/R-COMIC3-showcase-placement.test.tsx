import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import ComicShowcase, { COMIC_SHOWCASES } from '../../src/components/comic/ComicShowcase'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

afterEach(async () => {
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('R-COMIC3 漫画成品只在小说转漫画页展示', () => {
  it('挂载在 ComicStudio 并提供四套可放大完整漫画', async () => {
    const studioSource = readFileSync(resolve(process.cwd(), 'src/components/comic/ComicStudio.tsx'), 'utf8')
    expect(studioSource).toContain('import ComicShowcase from "./ComicShowcase"')
    expect(studioSource).toContain('<ComicShowcase />')
    expect(COMIC_SHOWCASES).toHaveLength(4)

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    mounted.push({ host, root })
    await act(async () => root.render(<ComicShowcase />))
    expect(host.querySelector('[data-testid="comic-showcase"]')).not.toBeNull()
    for (const comic of COMIC_SHOWCASES) expect(host.textContent).toContain(comic.title)
    expect(host.textContent).not.toContain('盐从记忆里长出来')
    expect(host.textContent).not.toContain('婚礼第零桌')

    const previewButton = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.getAttribute('aria-label') === '查看完整漫画《凌晨四点，月亮来买面包》')
    expect(previewButton).toBeDefined()
    await act(async () => previewButton!.click())
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('深靛夜色 / 黄油金光')

    const closeButton = host.querySelector<HTMLButtonElement>('button[aria-label="关闭漫画预览"]')
    expect(closeButton).not.toBeNull()
    await act(async () => closeButton!.click())
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })
})
