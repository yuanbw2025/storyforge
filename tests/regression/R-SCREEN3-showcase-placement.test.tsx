import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import ScreenplayShowcase, { SCREENPLAY_SHOWCASES } from '../../src/components/screenplay/ScreenplayShowcase'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

afterEach(async () => {
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('R-SCREEN3 剧本成品只在小说转剧本页展示', () => {
  it('挂载在 ScreenplayStudio 并提供四套可预览专业剧本', async () => {
    const studioSource = readFileSync(resolve(process.cwd(), 'src/components/screenplay/ScreenplayStudio.tsx'), 'utf8')
    expect(studioSource).toContain("import ScreenplayShowcase from './ScreenplayShowcase'")
    expect(studioSource).toContain('<ScreenplayShowcase />')
    expect(SCREENPLAY_SHOWCASES).toHaveLength(4)

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    mounted.push({ host, root })
    await act(async () => root.render(<ScreenplayShowcase />))
    expect(host.querySelector('[data-testid="screenplay-showcase"]')).not.toBeNull()
    for (const screenplay of SCREENPLAY_SHOWCASES) expect(host.textContent).toContain(screenplay.title)
    expect(host.textContent).not.toContain('盐从记忆里长出来')
    expect(host.textContent).not.toContain('凌晨四点，月亮来买面包')

    const previewButton = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.getAttribute('aria-label') === '查看专业剧本《婚礼第零桌》')
    expect(previewButton).toBeDefined()
    await act(async () => previewButton!.click())
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Title: 婚礼第零桌')

    const closeButton = host.querySelector<HTMLButtonElement>('button[aria-label="关闭剧本预览"]')
    expect(closeButton).not.toBeNull()
    await act(async () => closeButton!.click())
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })
})
