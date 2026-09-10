import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import MotionDramaShowcase, { MOTION_DRAMA_SHOWCASE } from '../../src/components/motion-drama/MotionDramaShowcase'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

afterEach(async () => {
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('R-MOTIONDRAMA2 漫剧验收成果只在漫剧功能页展示', () => {
  it('挂载在 MotionDramaStudio 并提供完整可下载逐镜执行包', async () => {
    const studioSource = readFileSync(resolve(process.cwd(), 'src/components/motion-drama/MotionDramaStudio.tsx'), 'utf8')
    expect(studioSource).toContain("import MotionDramaShowcase from './MotionDramaShowcase'")
    expect(studioSource).toContain('<MotionDramaShowcase />')
    expect(MOTION_DRAMA_SHOWCASE.pack).toContain('SHOT 01')
    expect(MOTION_DRAMA_SHOWCASE.pack).toContain('SHOT 02')
    expect(MOTION_DRAMA_SHOWCASE.pack).toContain('match-cut')

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    mounted.push({ host, root })
    await act(async () => root.render(<MotionDramaShowcase />))
    expect(host.querySelector('[data-testid="motion-drama-showcase"]')).not.toBeNull()
    expect(host.textContent).toContain('末班车回声')
    expect(host.textContent).not.toContain('盐从记忆里长出来')
    expect(host.textContent).not.toContain('雨停之前')

    const previewButton = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.getAttribute('aria-label') === '查看《末班车回声》完整漫剧执行包')
    expect(previewButton).toBeDefined()
    await act(async () => previewButton!.click())
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('@图片1')
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('只改一类问题')

    const closeButton = host.querySelector<HTMLButtonElement>('button[aria-label="关闭漫剧执行包"]')
    expect(closeButton).not.toBeNull()
    await act(async () => closeButton!.click())
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })
})
