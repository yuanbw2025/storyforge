import { expect, test } from '@playwright/test'
import { captured, musicPlaying, prepare, snapshot } from '../helpers/avg-once-audio-browser-fixture'

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`interrupted sound channels have distinct reachable recovery controls and preserve independent generations at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport)
    await prepare(page, 7000, true, false, false, 7000)
    for (const channel of ['sfx', 'ambience']) await expect.poll(() => page.locator(`audio[data-channel="${channel}"]`).evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > .02)).toBe(true)
    const before = await snapshot(page)
    expect(before.receipts.map((r: { status: string }) => r.status)).toEqual(['requested', 'requested'])
    await page.reload()
    const sfx = page.getByRole('status', { name: '音效恢复', exact: true })
    const ambience = page.getByRole('status', { name: '环境音恢复', exact: true })
    await expect(sfx).toContainText('上次声音播放未确认结束。')
    await expect(ambience).toContainText('上次声音播放未确认结束。')
    await musicPlaying(page)
    expect(await snapshot(page)).toEqual(before)
    expect((await captured(page)).filter(e => ['sfx', 'ambience'].includes(e.channel) && e.type === 'playing')).toEqual([])
    const boxes = await Promise.all([sfx.boundingBox(), ambience.boundingBox()])
    for (const box of boxes) {
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
    }
    expect(boxes[0]!.y + boxes[0]!.height).toBeLessThanOrEqual(boxes[1]!.y)
    // Bounding boxes may be inside the viewport yet clipped by an ancestor.
    // Check real initial hit targets before Playwright can auto-scroll them.
    for (const recovery of [sfx, ambience]) {
      const button = recovery.getByRole('button', { name: '重新播放声音片段', exact: true })
      expect(await button.evaluate(element => {
        const box = element.getBoundingClientRect()
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
      })).toBe(true)
    }
    await page.getByRole('button', { name: '历史', exact: true }).click()
    await page.getByRole('dialog', { name: '历史回看', exact: true }).getByRole('button', { name: '关闭', exact: true }).click()
    expect(await snapshot(page)).toEqual(before)
    await page.screenshot({ path: info.outputPath(`audio-recovery-${viewport.width}.png`), fullPage: true })
    await sfx.getByRole('button', { name: '重新播放声音片段', exact: true }).click()
    await expect.poll(() => page.locator('audio[data-channel="sfx"]').evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > .02)).toBe(true)
    let current = await snapshot(page)
    expect(current.receipts.find((r: { channel: string }) => r.channel === 'sfx').generation).toBeGreaterThan(before.receipts.find((r: { channel: string }) => r.channel === 'sfx').generation)
    expect(current.receipts.find((r: { channel: string }) => r.channel === 'ambience')).toEqual(before.receipts.find((r: { channel: string }) => r.channel === 'ambience'))
    await ambience.getByRole('button', { name: '重新播放声音片段', exact: true }).click()
    await expect.poll(() => page.locator('audio[data-channel="ambience"]').evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > .02)).toBe(true)
    current = await snapshot(page)
    expect(current.receipts.find((r: { channel: string }) => r.channel === 'ambience').generation).toBeGreaterThan(before.receipts.find((r: { channel: string }) => r.channel === 'ambience').generation)
  })
}
