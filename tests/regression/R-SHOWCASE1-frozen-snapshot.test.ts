import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('R-SHOWCASE1 社区成品进入冻结 E2E 工作区', () => {
  it('只复制功能页运行所需的样例资源，不复制整套大体积漫画交付包', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/serve-e2e-snapshot.mjs'), 'utf8')

    expect(source).toContain("'showcase/short-novel'")
    expect(source).toContain("'showcase/screenplay'")
    for (const slug of ['before-rain-stops', 'borrowed-flame', 'before-the-gun', 'moon-buys-bread']) {
      expect(source).toContain(`'showcase/comic/${slug}/art/final/community-preview-ui.jpg'`)
    }
    expect(source).not.toMatch(/^\s*'showcase\/comic',?$/m)
    expect(source).toContain('await mkdir(dirname(snapshotTarget), { recursive: true })')
  })
})
