import { describe, expect, it } from 'vitest'
import packageMetadata from '../../package.json'
import { APP_VERSION } from '../../src/lib/version'

describe('应用版本号单一事实源', () => {
  it('界面展示版本始终来自 package.json', () => {
    expect(APP_VERSION).toBe(`v${packageMetadata.version}`)
  })
})
