import { describe, expect, it } from 'vitest'
import packageMetadata from '../../package.json'
import { APP_BUILD_ID, APP_VERSION } from '../../src/lib/version'

describe('应用版本号单一事实源', () => {
  it('界面展示版本始终来自 package.json', () => {
    expect(APP_VERSION).toBe(`v${packageMetadata.version}`)
    expect(APP_BUILD_ID).toMatch(new RegExp(`^v${packageMetadata.version.replaceAll('.', '\\.')}\\+[0-9a-z]+$`))
  })
})
